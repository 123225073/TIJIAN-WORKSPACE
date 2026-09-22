"""V2 media routes. Register explicitly with register(app, user, admin, error).

Wire contract: list endpoints return {items: [...]}; mutations return the object.
Draft: {tool,title,input,options,brand_id?,profile_id?,source_ids?}; PATCH needs version.
Generate: {draft_id,version,confirmed:true,request_id}. Retry the SAME request_id.
Upload: multipart file; local by default, ?provider=hifly&confirmed=true uploads too.
Asset library: ?asset_type=voice|avatar&refresh=true imports PUBLIC Hifly resources only.
Run statuses: queued/preparing/submitting/running/succeeded/failed/unknown/archive_failed/interrupted.
Unknown submission is never automatically retried. Refresh polls existing task IDs.

Contracts checked 2026-09-22 (account capabilities and real billing remain untested):
https://api.hifly.cc/hifly.html
https://help.aliyun.com/zh/model-studio/text-to-video-api-reference
https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/
https://help.aliyun.com/zh/model-studio/qwen-image-api
https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
https://shotstack.io/docs/api/ (Edit and Ingest, not invented public file hosting)
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

import httpx
from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from . import gateway as g, jobs, network, store as s

MAX_FILE = 500 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
CONFIG = 'studio_services'
PROVIDERS = {
    'hifly': {'title': '飞影', 'base_url': 'https://hfw-api.hifly.cc', 'docs_url': 'https://api.hifly.cc/hifly.html', 'signup_url': 'https://hifly.cc/intro/api.html'},
    'aliyun': {'title': '阿里云百炼', 'base_url': 'https://dashscope.aliyuncs.com', 'docs_url': 'https://help.aliyun.com/zh/model-studio/', 'signup_url': 'https://bailian.console.aliyun.com/'},
    'shotstack': {'title': 'Shotstack', 'base_url': 'https://api.shotstack.io', 'docs_url': 'https://shotstack.io/docs/api/', 'signup_url': 'https://dashboard.shotstack.io/'},
}
TOOLS = {
    'text_avatar': ('文字口播', 'hifly', 'video', ['text', 'avatar_id', 'voice_id']),
    'audio_avatar': ('音频口播', 'hifly', 'video', ['audio_id', 'avatar_id']),
    'photo_talk': ('照片说话', 'hifly', 'video', ['text', 'image_id', 'voice_id']),
    'avatar_create': ('创建形象', 'hifly', 'avatar', []),
    'voice_create': ('创建声音', 'hifly', 'voice', ['audio_id']),
    'tts': ('文本配音', 'hifly', 'audio', ['text', 'voice_id']),
    'text_image': ('AI生图', 'aliyun', 'image', ['prompt']),
    'image_edit': ('图片修改', 'aliyun', 'image', ['prompt', 'image_id']),
    'text_video': ('文字生成视频', 'aliyun', 'video', ['prompt']),
    'image_video': ('图片生成视频', 'aliyun', 'video', ['prompt', 'image_id']),
    'compose': ('素材成片', 'shotstack', 'video', ['scenes']),
}
COMPAT = {
    'image': ['text_image', 'photo_talk', 'avatar_create', 'image_edit', 'image_video', 'compose'],
    'video': ['avatar_create', 'compose'], 'audio': ['audio_avatar', 'voice_create', 'compose'],
    'avatar': ['text_avatar', 'audio_avatar'], 'voice': ['text_avatar', 'photo_talk', 'tts'],
}
EXTENSIONS = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
              '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime'}
OPTIONS = {
    'text_avatar': {'st_show': [0, 1]}, 'audio_avatar': {}, 'photo_talk': {'model': [5, 6]},
    'avatar_create': {'model': [1, 2]}, 'voice_create': {}, 'tts': {},
    'text_image': {'size': ['1024*1024', '2048*2048'], 'watermark': [True, False]},
    'image_edit': {'size': ['1024*1024', '2048*2048'], 'watermark': [True, False]},
    'text_video': {'resolution': ['720P', '1080P'], 'ratio': ['16:9', '9:16', '1:1', '4:3', '3:4'], 'duration': list(range(2, 16)), 'watermark': [True, False]},
    'image_video': {'resolution': ['480P', '720P', '1080P'], 'watermark': [True, False]},
    'compose': {'resolution': ['sd', 'hd', '1080'], 'aspectRatio': ['16:9', '9:16', '1:1']},
}
MODELS = {'text_image': 'qwen-image-2.0-pro', 'image_edit': 'qwen-image-2.0-pro',
          'text_video': 'wan2.7-t2v-2026-06-12', 'image_video': 'wan2.2-i2v-flash'}


class StudioError(ValueError):
    """Only locally authored, credential-free text may enter this exception."""


class Rejected(StudioError):
    pass


class PendingUpload(StudioError):
    pass


def _strict(data, allowed):
    if not isinstance(data, dict) or set(data) - set(allowed):
        raise StudioError('字段不受支持，请按创作接口结构提交')


def _text(value, name, maximum=10000, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        raise StudioError(f'{name}为空或超出长度限制')
    return value


def _integer(value):
    return type(value) is int and value >= 1


def _base(provider, value):
    p = urlsplit(value)
    host = p.hostname or ''
    allowed = host == urlsplit(PROVIDERS[provider]['base_url']).hostname
    if provider == 'aliyun':
        allowed = host in {'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'} or bool(re.fullmatch(r'[a-zA-Z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1)\.maas\.aliyuncs\.com', host))
    if p.scheme != 'https' or not allowed or p.username or p.password or p.port not in (None, 443) or p.path not in ('', '/') or p.query or p.fragment:
        raise StudioError('仅支持所选服务官方 HTTPS 根地址')
    network.public_url(value)
    return value.rstrip('/')


def settings():
    saved = s.config(CONFIG, {})
    return {'providers': [{**preset, 'provider': name, 'base_url': saved.get(name, {}).get('base_url', preset['base_url']),
                           'enabled': saved.get(name, {}).get('enabled', True), 'has_key': bool(saved.get(name, {}).get('secret')),
                           'environment': saved.get(name, {}).get('environment', 'stage'),
                           'verification': 'documented_not_live'} for name, preset in PROVIDERS.items()]}


def save_settings(data):
    _strict(data, ['provider', 'api_key', 'base_url', 'enabled', 'environment'])
    name = data.get('provider')
    if name not in PROVIDERS:
        raise StudioError('未知媒体服务')
    with s.LOCK:
        values = s.config(CONFIG, {})
        old = values.get(name, {})
        enabled = data.get('enabled', old.get('enabled', True))
        if type(enabled) is not bool:
            raise StudioError('enabled 必须为布尔值')
        item = {**old, 'base_url': _base(name, data.get('base_url', old.get('base_url', PROVIDERS[name]['base_url']))), 'enabled': enabled}
        if 'api_key' in data and data['api_key']:
            key = _text(data['api_key'], 'API密钥', 4096)
            try:
                unchanged = bool(old.get('secret')) and g.cipher().decrypt(old['secret'].encode()).decode() == key
            except Exception:
                unchanged = False
            if not unchanged:
                item['secret'] = g.cipher().encrypt(key.encode()).decode()
        if name == 'shotstack':
            env = data.get('environment', old.get('environment', 'stage'))
            if env not in ('stage', 'v1'):
                raise StudioError('Shotstack 环境必须为 stage 或 v1')
            item['environment'] = env
        values[name] = item
        s.set_config(CONFIG, values)
    return settings()


def _service(provider):
    item = s.config(CONFIG, {}).get(provider, {})
    if not item.get('secret') or not item.get('enabled', True):
        raise StudioError(PROVIDERS[provider]['title'] + '尚未配置或已停用，请联系管理员；未提交生成')
    return item


def validate_binding(tool, value):
    if not value:return
    if value == 'service:' + TOOLS[tool][1] or (tool=='text_video' and value=='service:aliyun:wan2.7-t2v'):return
    if tool not in ('text_image','image_edit'):raise ValueError('此功能需要绑定对应媒体 API，不能绑定文本或图片模型')
    m,p=g.model_record(value)
    if m['capability']!='image' or not(m.get('verified') and m.get('published')):raise ValueError('请选择已验证、已上架的图片模型')


def selection(tool, model_id=None):
    return model_id or s.config('bindings',{}).get(tool) or 'service:'+TOOLS[tool][1]


def bound_image(tool, model_id=None):
    value=selection(tool,model_id)
    return value if tool in ('text_image','image_edit') and not value.startswith('service:') else None


def tool_options(tool, model_id=None):
    mid=bound_image(tool,model_id)
    if mid:
        from .illustrations import sizes
        return {'size':sizes(mid),'quality':['auto','low','medium','high']}
    return OPTIONS[tool]


def model_choices(tool):
    result=[{'id':'service:'+TOOLS[tool][1],'title':MODELS.get(tool,TOOLS[tool][0]),'options':OPTIONS[tool], 'configured':bool(s.config(CONFIG,{}).get(TOOLS[tool][1],{}).get('secret')) and s.config(CONFIG,{}).get(TOOLS[tool][1],{}).get('enabled',True)}]
    if tool=='text_video':result.append({**result[0],'id':'service:aliyun:wan2.7-t2v','title':'wan2.7-t2v'})
    if tool in ('text_image','image_edit'):
        for m in s.config('models',[]):
            if m.get('capability')=='image' and m.get('verified') and m.get('published'):
                result.append({'id':m['id'],'title':m['title'],'options':tool_options(tool,m['id']),'configured':True})
    return result


def _scope(provider, service):
    # Resource IDs are bound to the account AND region/environment that created them.
    return s.digest(provider + service['base_url'] + service.get('environment', '') + service['secret'])


def _request(method, url, *, headers=None, payload=None, content=None):
    if urlsplit(url).scheme != 'https':
        raise StudioError('媒体服务必须使用 HTTPS')
    target, host, extensions = network.public_target(url)
    with httpx.Client(timeout=httpx.Timeout(240, connect=20), trust_env=False, follow_redirects=False) as client:
        with client.stream(method, target, headers={**(headers or {}), **host}, extensions=extensions,
                           **({'json': payload} if payload is not None else {}), **({'content': content} if content is not None else {})) as response:
            if not 200 <= response.status_code < 300:
                if 400 <= response.status_code < 500:
                    raise Rejected(f'媒体服务拒绝请求（HTTP {response.status_code}），请检查配置、余额及素材要求')
                raise StudioError(f'媒体服务响应异常（HTTP {response.status_code}），请查询原任务，勿重复提交')
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_JSON:
                    raise StudioError('媒体服务响应过大')
            if method == 'PUT':
                return {}
            try:
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError()
                return value
            except (ValueError, UnicodeError):
                raise StudioError('媒体服务未返回有效 JSON；请核查原任务') from None


def _api(provider, method, path, payload=None, service=None, asynchronous=False):
    service = service or _service(provider)
    # Validate stored configuration again before attaching credentials.
    base = _base(provider, service['base_url'])
    try:
        key = g.cipher().decrypt(service['secret'].encode()).decode()
    except Exception:
        raise StudioError('媒体服务密钥无法解密，请管理员重新保存') from None
    headers = {'x-api-key': key} if provider == 'shotstack' else {'Authorization': 'Bearer ' + key}
    if asynchronous:
        headers['X-DashScope-Async'] = 'enable'
    value = _request(method, base + path, headers=headers, payload=payload)
    if provider == 'hifly' and value.get('code', 0) != 0:
        raise Rejected('飞影拒绝请求，请核对套餐、余额和素材；未采用供应商原始错误文本')
    if provider == 'shotstack' and value.get('success') is False:
        raise Rejected('Shotstack 拒绝请求，请核对素材及配置')
    if provider == 'aliyun' and value.get('code'):
        raise Rejected('阿里云拒绝请求，请核对模型地域、余额及参数')
    return value


def _object(owner, id, kind):
    obj = s.get(owner, id)
    if obj['kind'] != kind or obj.get('archived'):
        raise s.Missing('对象不存在或无权访问')
    return obj


def _root(owner):
    directory = s.DATA / 'media_studio' / s.digest(owner)
    if directory.is_symlink() or directory.parent.is_symlink():
        raise StudioError('媒体目录不能使用符号链接')
    root = directory.resolve()
    base = s.DATA.resolve()
    if not root.is_relative_to(base):
        raise StudioError('媒体目录越界')
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path(owner, filename):
    if not re.fullmatch(r'[a-f0-9]{32,64}\.[a-z0-9]+', filename or ''):
        raise StudioError('无效的媒体文件路径')
    root = _root(owner)
    path = (root / filename).resolve()
    if not path.is_relative_to(root) or path.is_symlink():
        raise StudioError('媒体文件路径越界')
    return path


def _ffprobe():
    """Desktop supplies its packaged executable; development stays in this repo."""
    candidates = [os.environ.get('TIJIAN_FFPROBE'), str(s.ROOT / '.runtime' / 'media-tools' / 'ffprobe.exe'), shutil.which('ffprobe')]
    return next((str(Path(value).resolve()) for value in candidates if value and Path(value).is_file()), None)


def _metadata(path, ext):
    head = path.open('rb')
    try:
        magic = head.read(32)
    finally:
        head.close()
    mime = EXTENSIONS.get(ext)
    if not mime:
        raise StudioError('仅支持 PNG/JPEG/WebP、MP3/WAV/M4A、MP4/MOV')
    result = {'mime_type': mime, 'asset_type': mime.split('/')[0], 'size': path.stat().st_size}
    if mime.startswith('image/'):
        try:
            with Image.open(path) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP') or Image.MIME[image.format] != mime or image.width * image.height > 40_000_000:
                    raise ValueError()
                result.update(width=image.width, height=image.height)
                image.verify()
        except Exception:
            raise StudioError('图片内容无效、尺寸过大或与文件扩展名不符') from None
    elif ext == '.wav' and not (magic.startswith(b'RIFF') and magic[8:12] == b'WAVE'):
        raise StudioError('WAV 文件内容无效')
    elif ext == '.mp3' and not (magic.startswith(b'ID3') or (len(magic) > 1 and magic[0] == 255 and magic[1] & 224 == 224)):
        raise StudioError('MP3 文件内容无效')
    elif ext in ('.mp4', '.m4a', '.mov') and magic[4:8] != b'ftyp':
        raise StudioError('媒体容器无效，请使用标准 MP4/MOV/M4A')
    probe = _ffprobe()
    if probe and not mime.startswith('image/'):
        try:
            info = json.loads(subprocess.run([probe, '-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', str(path)], capture_output=True, timeout=20, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout)
            kinds = {stream.get('codec_type') for stream in info.get('streams', [])}
            if result['asset_type'] not in kinds:
                raise ValueError()
            duration = float(info['format']['duration'])
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError()
            result['duration'] = duration
            video = next((stream for stream in info.get('streams', []) if stream.get('codec_type') == 'video'), None)
            if video:
                result.update(width=video.get('width'), height=video.get('height'), video_codec=video.get('codec_name'))
        except Exception:
            raise StudioError('无法识别媒体轨道或时长，请检查文件') from None
    return result


def _public(obj):
    if obj.get('asset_type')=='image':obj={**obj,'compat':COMPAT['image']}
    out = {k: v for k, v in obj.items() if k not in {'local_file', 'remote', 'provider_resource_id', 'service_scope', 'snapshot', 'result', 'busy_until'}}
    if obj.get('snapshot'):
        snap=obj['snapshot'];mid=snap.get('model_id','')
        title=next((m.get('title',mid) for m in s.config('models',[]) if m.get('id')==mid),mid)
        out['generation']={k:snap.get(k) for k in ('input','options','model_id','brand_id','profile_id')}
        out['generation']['model_title']=title
    if obj.get('local_file') and obj.get('status') == 'ready':
        out['file_url'] = '/api/studio/assets/' + obj['id'] + '/file'
    return out


def upload(owner, file, provider=None, confirmed=False):
    if provider not in (None, '', 'hifly'):
        raise StudioError('上传目标仅支持飞影；其他工具在确认生成后处理所选素材')
    if provider and confirmed is not True:
        raise StudioError('上传云端需要明确 confirmed=true')
    if provider:
        _service(provider)
    name = (file.filename or '').replace('\\', '/').rsplit('/', 1)[-1]
    ext = Path(name).suffix.lower()
    if ext not in EXTENSIONS:
        raise StudioError('文件格式不支持')
    id = s.uid()
    path = _path(owner, id + ext)
    total = 0
    try:
        with path.open('xb') as output:
            while chunk := file.file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_FILE:
                    raise StudioError('单个文件不能超过500MB')
                output.write(chunk)
        if not total:
            raise StudioError('不能上传空文件')
        metadata = _metadata(path, ext)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    asset = s.put(owner, 'studio_asset', {**metadata, 'title': name[:200], 'local_file': path.name,
                  'status': 'ready', 'provider': 'local', 'compat': COMPAT[metadata['asset_type']]}, id)
    if provider:
        try:
            _hifly_file(owner, asset, _service('hifly'))
        except Exception:
            asset = s.put(owner, 'studio_asset', {**s.get(owner, id), 'upload_status': 'failed', 'error': '本地文件已保存，飞影上传失败；生成时可再次上传'}, id)
        else:
            asset = s.get(owner, id)
    return _public(asset)


def _asset(owner, id, asset_type, tool):
    asset = _object(owner, id, 'studio_asset')
    if asset.get('asset_type') != asset_type or asset.get('status') != 'ready' or tool not in (COMPAT['image'] if asset_type=='image' else asset.get('compat', [])):
        raise StudioError('所选素材类型、状态或兼容用途不符合当前工具')
    if asset_type in ('avatar', 'voice'):
        service = _service('hifly')
        if asset.get('provider') != 'hifly' or asset.get('service_scope') != _scope('hifly', service):
            raise StudioError('形象或声音属于其他服务账号，请重新选择兼容资源')
    elif not _path(owner, asset.get('local_file')).is_file():
        raise StudioError('本地素材文件不存在')
    return asset


def _validate(owner, data, complete=False):
    _strict(data, ['tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'])
    tool = data.get('tool')
    if tool not in TOOLS:
        raise StudioError('不支持此创作工具')
    _text(data.get('title', ''), '标题', 200, True)
    inputs, options = data.get('input', {}), data.get('options', {})
    chosen=data.get('model_id')
    if chosen is not None and not isinstance(chosen,str):raise StudioError('模型编号无效')
    if chosen:validate_binding(tool,chosen)
    allowed = set(TOOLS[tool][3])
    if tool=='text_image' and bound_image(tool,chosen):allowed.add('image_id')
    if tool == 'avatar_create':
        allowed = {'image_id', 'video_id'}
    _strict(inputs, allowed)
    choices=tool_options(tool,chosen)
    _strict(options, choices)
    for key, value in options.items():
        if not any(type(value) is type(choice) and value == choice for choice in choices[key]):
            raise StudioError('当前模型不支持此生成选项：' + key)
    references = {}
    for key, kind in [('brand_id', 'studio_brand'), ('profile_id', 'profile')]:
        if data.get(key):
            references[key] = _object(owner, _text(data[key], key, 128), kind)
    profile = references.get('profile_id', {})
    if profile.get('brand_id'):
        _object(owner, profile['brand_id'], 'studio_brand')
        if data.get('brand_id') and profile['brand_id'] != data['brand_id']:
            raise StudioError('所选IP属于其他品牌，请重新选择')
    ids = data.get('source_ids', [])
    if not isinstance(ids, list) or len(ids) > 50:
        raise StudioError('source_ids 必须为最多50个对象ID')
    for id in ids:
        obj = s.get(owner, _text(id, '引用ID', 128))
        if obj['kind'] not in ('source', 'content') or obj.get('archived'):
            raise StudioError('参考资料只允许当前用户未归档的原文或作品')
    assets = {}
    for key, value in inputs.items():
        if key.endswith('_id') and value:
            assets[key] = _asset(owner, _text(value, key, 128), key[:-3], tool)
        elif key in ('text', 'prompt'):
            _text(value, key, 10000 if key == 'text' else 1500, not complete)
            if key == 'text' and re.search(r'<[^>]+>', value):
                raise StudioError('口播文本不支持HTML标签')
    scenes = inputs.get('scenes', [])
    if not isinstance(scenes, list) or len(scenes) > 50:
        raise StudioError('场景必须是最多50项的列表')
    for scene in scenes:
        _strict(scene, ['asset_id', 'length', 'trim', 'fit', 'volume', 'audio_id', 'caption'])
        asset = _object(owner, _text(scene.get('asset_id'), '场景素材ID', 128), 'studio_asset')
        if asset.get('asset_type') not in ('image', 'video'):
            raise StudioError('场景画面必须是图片或视频')
        _asset(owner, asset['id'], asset['asset_type'], tool)
        length, trim = scene.get('length'), scene.get('trim', 0)
        if type(length) not in (int, float) or not math.isfinite(length) or not 0 < length <= 600 or type(trim) not in (int, float) or not math.isfinite(trim) or trim < 0:
            raise StudioError('场景时长必须为0至600秒，裁剪起点不得为负')
        if scene.get('fit', 'crop') not in ('crop', 'cover', 'contain', 'none'):
            raise StudioError('画面适配选项无效')
        volume = scene.get('volume', 1)
        if type(volume) not in (int, float) or not math.isfinite(volume) or not 0 <= volume <= 1:
            raise StudioError('音量范围为0至1')
        if 'caption' in scene:
            _text(scene['caption'], '字幕', 500, True)
        if complete and asset['asset_type'] == 'video' and (not asset.get('duration') or trim + length > asset['duration'] + .05):
            raise StudioError('视频可用时长不足或尚未验证时长；请安装ffprobe后重新上传，不自动延长素材')
        if scene.get('audio_id'):
            audio = _asset(owner, scene['audio_id'], 'audio', tool)
            if complete and (not audio.get('duration') or length > audio['duration'] + .05):
                raise StudioError('配音可用时长不足或尚未验证；请缩短场景或补充配音')
    if complete:
        if any(not inputs.get(key) for key in TOOLS[tool][3]):
            raise StudioError('请填写当前工具全部必填输入')
        if tool == 'avatar_create' and bool(inputs.get('image_id')) == bool(inputs.get('video_id')):
            raise StudioError('创建形象需要且只能选择一张照片或一段视频')
        if tool == 'avatar_create' and inputs.get('video_id') and options:
            raise StudioError('视频形象不接受图片形象模型选项')
        if tool == 'image_video' and len(inputs['prompt']) > 800:
            raise StudioError('当前图生视频模型提示词最多800字')
        for key, asset in assets.items():
            limit = 20 * 1024 * 1024 if tool == 'voice_create' else 100 * 1024 * 1024 if tool == 'audio_avatar' else MAX_FILE
            if asset.get('size', 0) > limit:
                raise StudioError('所选素材超过当前供应商接口的大小限制')
            if tool in ('voice_create', 'audio_avatar', 'avatar_create') and asset.get('asset_type') in ('audio', 'video'):
                if not asset.get('duration'):
                    raise StudioError('素材时长尚未验证，不能提交付费生成；请安装ffprobe后重新上传，本地文件已保留')
                upper = 180 if tool == 'voice_create' else 1800
                if not 5 <= asset['duration'] <= upper:
                    raise StudioError('当前接口需要5秒至' + str(upper) + '秒的素材')
                if tool == 'avatar_create' and asset['asset_type'] == 'video':
                    dimensions = [asset.get('width') or 0, asset.get('height') or 0]
                    if asset.get('video_codec') != 'h264' or min(dimensions) < 360 or max(dimensions) > 4096:
                        raise StudioError('视频形象需要H.264编码、360p至4K画面，请转码后重新上传')
    return {**data, 'title': data.get('title', ''), 'input': inputs, 'options': options}


def save_draft(owner, data, id=None):
    with s.LOCK:
        if id:
            _strict(data, ['version', 'tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'])
            if not _integer(data.get('version')):
                raise StudioError('更新草稿必须提供整数version')
            old = _object(owner, id, 'studio_draft')
            merged = {k: v for k, v in old.items() if k in {'tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'}}
            merged.update({k: v for k, v in data.items() if k != 'version'})
            value = _validate(owner, merged)
            return s.put(owner, 'studio_draft', value, id, expected=data['version'])
        return s.put(owner, 'studio_draft', _validate(owner, data))


def _hifly_file(owner, asset, service):
    scope = _scope('hifly', service)
    old = s.get(owner, asset['id']).get('remote', {}).get(scope, {})
    if old.get('file_id'):
        return old['file_id']
    path = _path(owner, asset['local_file'])
    result = _api('hifly', 'POST', '/api/v2/hifly/tool/create_upload_url', {'file_extension': path.suffix[1:]}, service)
    file_id = _text(result.get('file_id'), '飞影上传ID', 500)
    with path.open('rb') as stream:
        _request('PUT', result['upload_url'], headers={'Content-Type': result['content_type']}, content=stream)
    current = s.get(owner, asset['id'])
    s.put(owner, 'studio_asset', {**current, 'remote': {**current.get('remote', {}), scope: {'file_id': file_id}}, 'upload_status': 'uploaded'}, asset['id'])
    return file_id


def _image_data(owner, asset):
    if asset['size'] > 10 * 1024 * 1024 or asset.get('width', 0) < 1:
        raise StudioError('图片必须为有效图片且不超过10MB')
    return 'data:' + asset['mime_type'] + ';base64,' + base64.b64encode(_path(owner, asset['local_file']).read_bytes()).decode()


def _shotstack_source(owner, asset, service):
    scope = _scope('shotstack', service)
    current = s.get(owner, asset['id'])
    remote = current.get('remote', {}).get(scope, {})
    env = service.get('environment', 'stage')
    if remote.get('url'):
        network.public_url(remote['url'])
        return remote['url']
    if not remote.get('id'):
        result = _api('shotstack', 'POST', f'/ingest/{env}/upload', service=service)['data']
        remote = {'id': _text(result['id'], '上传ID', 200)}
        with _path(owner, asset['local_file']).open('rb') as stream:
            _request('PUT', result['attributes']['url'], content=stream)
        current = s.get(owner, asset['id'])
        s.put(owner, 'studio_asset', {**current, 'remote': {**current.get('remote', {}), scope: remote}}, asset['id'])
    result = _api('shotstack', 'GET', f'/ingest/{env}/sources/' + quote(remote['id'], safe=''), service=service)['data']['attributes']
    if result.get('status') == 'failed':
        raise Rejected('Shotstack素材处理失败，请重新上传素材')
    if result.get('status') != 'ready':
        raise PendingUpload('素材已上传，等待Shotstack解析；刷新原记录继续')
    network.public_url(result['source'])
    current = s.get(owner, asset['id'])
    s.put(owner, 'studio_asset', {**current, 'remote': {**current.get('remote', {}), scope: {**remote, 'url': result['source']}}}, asset['id'])
    return result['source']


def _build(owner, draft, service):
    tool, inputs, options = draft['tool'], draft['input'], draft['options']
    provider = TOOLS[tool][1]
    assets = {key: _asset(owner, value, key[:-3], tool) for key, value in inputs.items() if key.endswith('_id') and value}
    if provider == 'hifly':
        payload = {'title': draft['title'][:20] or TOOLS[tool][0]}
        for key in ('avatar_id', 'voice_id'):
            if key in assets:
                payload[key[:-3]] = assets[key]['provider_resource_id']
        if 'text' in inputs:
            payload['text'] = inputs['text']
        payload.update(options)
        paths = {'text_avatar': 'video/create_by_tts', 'audio_avatar': 'video/create_by_audio',
                 'photo_talk': 'video/create_by_image', 'tts': 'audio/create_by_tts', 'voice_create': 'voice/create'}
        if tool == 'photo_talk':
            payload.pop('title')
            payload['image_file_id'] = _hifly_file(owner, assets['image_id'], service)
        if tool in ('audio_avatar', 'voice_create'):
            payload['file_id'] = _hifly_file(owner, assets['audio_id'], service)
        if tool == 'voice_create':
            payload['voice_type'] = 8
        if tool == 'avatar_create':
            key = 'video_id' if 'video_id' in assets else 'image_id'
            payload['file_id'] = _hifly_file(owner, assets[key], service)
            path = 'avatar/create_by_' + key[:-3]
        else:
            path = paths[tool]
        return '/api/v2/hifly/' + path, payload, False
    if provider == 'aliyun':
        if tool in ('text_image', 'image_edit'):
            content = ([{'image': _image_data(owner, assets['image_id'])}] if tool == 'image_edit' else []) + [{'text': inputs['prompt']}]
            return '/api/v1/services/aigc/multimodal-generation/generation', {'model':draft.get('model_id','').split(':',2)[2] if draft.get('model_id','').count(':')==2 else MODELS[tool], 'input': {'messages': [{'role': 'user', 'content': content}]}, 'parameters': {'n': 1, **options}}, False
        input_ = {'prompt': inputs['prompt']}
        if tool == 'image_video':
            asset = assets['image_id']
            if not all(240 <= asset.get(k, 0) <= 8000 for k in ('width', 'height')):
                raise StudioError('图生视频要求图片宽高均为240至8000像素')
            input_['img_url'] = _image_data(owner, asset)
        return '/api/v1/services/aigc/video-generation/video-synthesis', {'model':draft.get('model_id','').split(':',2)[2] if draft.get('model_id','').count(':')==2 else MODELS[tool], 'input': input_, 'parameters': options}, True
    visuals, sounds, captions = [], [], []
    start = 0
    for scene in inputs['scenes']:
        asset = _object(owner, scene['asset_id'], 'studio_asset')
        value = {'type': asset['asset_type'], 'src': _shotstack_source(owner, asset, service)}
        if asset['asset_type'] == 'video':
            value.update(trim=scene.get('trim', 0), volume=scene.get('volume', 0 if scene.get('audio_id') else 1))
        visuals.append({'asset': value, 'start': start, 'length': scene['length'], 'fit': scene.get('fit', 'crop')})
        if scene.get('audio_id'):
            audio = _object(owner, scene['audio_id'], 'studio_asset')
            sounds.append({'asset': {'type': 'audio', 'src': _shotstack_source(owner, audio, service)}, 'start': start, 'length': scene['length']})
        if scene.get('caption'):
            captions.append({'asset': {'type': 'title', 'text': scene['caption'], 'style': 'minimal', 'position': 'bottom'}, 'start': start, 'length': scene['length']})
        start += scene['length']
    tracks = [{'clips': values} for values in (captions, visuals, sounds) if values]
    return f'/edit/{service.get("environment", "stage")}/render', {'timeline': {'tracks': tracks}, 'output': {'format': 'mp4', 'resolution': 'hd', **options}}, False


def _update(owner, id, **values):
    with s.LOCK:
        item = _object(owner, id, 'studio_run')
        return s.put(owner, 'studio_run', {**item, **values}, id, expected=item['version'])


def generate(owner, data):
    _strict(data, ['draft_id', 'version', 'confirmed', 'request_id'])
    if data.get('confirmed') is not True:
        raise StudioError('生成可能产生费用并将所选素材上传云端，请明确confirmed=true')
    if not _integer(data.get('version')):
        raise StudioError('必须提供草稿整数version')
    request_id = _text(data.get('request_id'), 'request_id', 128)
    id = s.digest('studio-run:' + owner + ':' + request_id)
    # BEGIN IMMEDIATE + deterministic key protects retries across workers/processes.
    with s.LOCK:
        try:
            previous = _object(owner, id, 'studio_run')
        except s.Missing:
            previous = None
        if previous:
            if previous['draft_id'] != data.get('draft_id') or previous['draft_version'] != data['version']:
                raise s.Conflict('request_id已用于另一份草稿版本')
            return _public(previous)
        draft = _object(owner, _text(data.get('draft_id'), 'draft_id', 128), 'studio_draft')
        if draft['version'] != data['version']:
            raise s.Conflict('草稿已更新，请刷新后确认当前版本')
        clean = {k: v for k, v in draft.items() if k in {'tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'}}
        clean['model_id']=selection(draft['tool'],draft.get('model_id'))
        _validate(owner, clean, complete=True)
        provider = TOOLS[draft['tool']][1]
        bindings=s.config('bindings',{})
        if draft['tool'] in bindings and not bindings[draft['tool']]:raise StudioError('此功能已停用，请联系管理员绑定服务')
        image_model=bound_image(draft['tool'],draft.get('model_id'))
        if image_model:
            validate_binding(draft['tool'],image_model)
            m,service=g.model_record(image_model);provider='images'
        else:service = _service(provider)
        record = {'title': draft['title'], 'tool': draft['tool'], 'provider': provider, 'draft_id': draft['id'],
                  'draft_version': draft['version'], 'snapshot': clean, 'request_id': request_id, 'status': 'queued',
                  'confirmed_at': s.now(), 'service_scope': _scope(provider, service), 'model_id':image_model, 'task_id': None, 'asset_ids': [], 'created': s.now()}
        with s.conn() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT * FROM objects WHERE id=?', (id,)).fetchone()
            if row:
                existing = s.unpack(row)
                if existing['draft_id'] != draft['id'] or existing['draft_version'] != draft['version']:
                    raise s.Conflict('request_id已用于另一份草稿版本')
                return _public(existing)
            version = c.execute('SELECT version FROM objects WHERE id=? AND owner=?', (draft['id'], owner)).fetchone()
            if not version or version['version'] != data['version']:
                raise s.Conflict('草稿已更新，请重新确认')
            for row in c.execute("SELECT * FROM objects WHERE owner=? AND kind='studio_run'", (owner,)):
                existing = s.unpack(row)
                if existing['draft_id'] == draft['id'] and existing['draft_version'] == draft['version'] and existing['status'] in ('queued', 'preparing', 'submitting', 'running', 'unknown', 'archive_failed'):
                    return _public(existing)
            c.execute('INSERT INTO objects VALUES (?,?,?,?,?,?)', (id, owner, 'studio_run', json.dumps(record, ensure_ascii=False), 1, s.now()))
    jobs.POOL.submit(_work, owner, id)
    return _public(s.get(owner, id))


def _claim(owner, id):
    with s.conn() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT * FROM objects WHERE id=? AND owner=? AND kind='studio_run'", (id, owner)).fetchone()
        if not row:
            raise s.Missing('生成记录不存在')
        value = json.loads(row['data'])
        if value.get('busy_until', 0) > time.time():
            return False
        value['busy_until'] = time.time() + 3600
        c.execute('UPDATE objects SET data=?,version=version+1 WHERE id=?', (json.dumps(value, ensure_ascii=False), id))
    return True


def _poll(run, service):
    task = quote(_text(run.get('task_id'), '供应商任务ID', 500), safe='')
    provider = run['provider']
    if provider == 'hifly':
        resource = 'avatar' if run['tool'] == 'avatar_create' else 'voice' if run['tool'] == 'voice_create' else 'video'
        value = _api(provider, 'GET', f'/api/v2/hifly/{resource}/task?task_id={task}', service=service)
        status = {1: 'running', 2: 'running', 3: 'succeeded', 4: 'failed'}.get(value.get('status'), 'unknown')
        if resource in ('avatar', 'voice'):
            result = {'resource_id': value.get(resource), 'asset_type': resource}
        else:
            result = {'urls': [value.get('video_Url')], 'asset_type': TOOLS[run['tool']][2]}
        if value.get('duration'):
            result['duration'] = value['duration']
        return status, result
    if provider == 'aliyun':
        value = _api(provider, 'GET', '/api/v1/tasks/' + task, service=service)['output']
        status = {'PENDING': 'running', 'RUNNING': 'running', 'SUCCEEDED': 'succeeded', 'FAILED': 'failed', 'CANCELED': 'failed'}.get(value.get('task_status'), 'unknown')
        return status, {'urls': [value.get('video_url')], 'asset_type': 'video'}
    value = _api(provider, 'GET', f'/edit/{service.get("environment", "stage")}/render/{task}', service=service)['response']
    status = 'succeeded' if value.get('status') == 'done' else 'failed' if value.get('status') == 'failed' else 'running' if value.get('status') in ('queued', 'fetching', 'rendering', 'saving') else 'unknown'
    return status, {'urls': [value.get('url')], 'asset_type': 'video'}


def _download(owner, id, url, asset_type):
    _text(url, '成品地址', 16000)
    data = bytearray()
    with httpx.Client(timeout=httpx.Timeout(240, connect=20), trust_env=False, follow_redirects=False) as client:
        for _ in range(5):
            if urlsplit(url).scheme != 'https':
                raise StudioError('成品下载必须使用HTTPS')
            target, headers, extensions = network.public_target(url)
            with client.stream('GET', target, headers=headers, extensions=extensions) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers['location'])
                    continue
                if response.status_code != 200:
                    raise StudioError('成品下载失败，刷新原任务可重试归档')
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_FILE:
                        raise StudioError('成品超过500MB归档上限')
                break
        else:
            raise StudioError('成品下载重定向过多')
    if asset_type == 'image':
        try:
            with Image.open(io.BytesIO(data)) as image:
                ext = {'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp'}[image.format]
        except Exception:
            raise StudioError('供应商未返回有效图片') from None
    elif asset_type == 'audio':
        ext = '.wav' if data[:4] == b'RIFF' else '.m4a' if data[4:8] == b'ftyp' else '.mp3'
    else:
        ext = '.mp4'
    path = _path(owner, id + ext)
    temp = _path(owner, s.uid() + '.part')
    try:
        temp.write_bytes(data)
        metadata = _metadata(temp, ext)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    return path.name, metadata


def _archive(owner, run):
    result = run['result']
    if run['provider']=='images':
        uri=result['data_uri'];binary=base64.b64decode(uri.split(',',1)[1]);aid=s.digest(run['id']+':image')
        ext='.png' if uri.startswith('data:image/png;') else '.jpg' if uri.startswith('data:image/jpeg;') else '.webp'
        path=_path(owner,aid+ext);path.write_bytes(binary)
        metadata=_metadata(path,ext)
        metadata['requested_size']=run['snapshot']['options'].get('size','1024x1024')
        metadata['generation_model']=run['model_id']
        s.put(owner,'studio_asset',{**metadata,'title':run['title'],'local_file':path.name,'provider':'images','status':'ready','compat':COMPAT['image'],'run_id':run['id']},aid)
        return _update(owner,run['id'],status='succeeded',asset_ids=[aid],finished_at=s.now(),error=None)
    kind = result['asset_type']
    urls = result.get('urls', []) if kind not in ('avatar', 'voice') else [None]
    if not urls or any(not u for u in urls) and kind not in ('avatar', 'voice'):
        raise StudioError('任务完成但未返回可归档结果，请核查供应商任务')
    ids = list(run.get('asset_ids', []))
    for index, url in enumerate(urls):
        id = s.digest('studio-asset:' + run['id'] + ':' + str(index))
        try:
            existing = _object(owner, id, 'studio_asset')
            if existing.get('status') == 'ready':
                if id not in ids:
                    ids.append(id)
                continue
        except s.Missing:
            pass
        value = {'title': run['title'] or TOOLS[run['tool']][0], 'asset_type': kind, 'provider': run['provider'],
                 'service_scope': run['service_scope'], 'compat': COMPAT[kind], 'status': 'ready',
                 'run_id': run['id'], 'draft_id': run['draft_id'], 'draft_version': run['draft_version']}
        if kind in ('avatar', 'voice'):
            value['provider_resource_id'] = _text(result.get('resource_id'), '供应商资源ID', 500)
        else:
            filename, metadata = _download(owner, id, url, kind)
            value.update(metadata, local_file=filename)
            value['requested_size']=run['snapshot'].get('options',{}).get('size')
            value['requested_resolution']=run['snapshot'].get('options',{}).get('resolution')
        s.put(owner, 'studio_asset', value, id)
        ids.append(id)
        _update(owner, run['id'], asset_ids=ids)
    return _update(owner, run['id'], status='succeeded', asset_ids=ids, error=None, finished_at=s.now())


def _work(owner, id):
    if not _claim(owner, id):
        return
    phase = 'prepare'
    try:
        run = _object(owner, id, 'studio_run')
        if run['status'] in ('succeeded', 'failed'):
            return
        if run.get('result'):
            phase = 'archive'
            _archive(owner, run)
            return
        if run['provider']=='images':
            from . import illustrations
            if run['status'] in ('submitting','unknown'):
                _update(owner,id,status='unknown',error='上次图片提交结果未知，不会自动重复生成；请核查服务账单')
                return
            m,p=g.model_record(run['model_id'])
            if _scope('images',p)!=run['service_scope']:raise StudioError('模型服务配置已变更，请恢复原连接后继续')
            _update(owner,id,status='submitting');phase='submit'
            ref_id=run['snapshot']['input'].get('image_id')
            reference=_path(owner,_asset(owner,ref_id,'image',run['tool'])['local_file']).read_bytes() if ref_id else None
            kwargs={}
            if reference:kwargs['reference']=reference
            if run['snapshot']['options'].get('quality'):kwargs['quality']=run['snapshot']['options']['quality']
            uri=illustrations.generate(run['model_id'],run['snapshot']['input']['prompt'],run['snapshot']['options'].get('size','1024x1024'),**kwargs)
            phase='archive'
            run=_update(owner,id,result={'asset_type':'image','data_uri':uri},status='archive_failed')
            _archive(owner,run)
            return
        service = _service(run['provider'])
        if _scope(run['provider'], service) != run['service_scope']:
            raise StudioError('服务账号或地域已变更，请恢复原配置后刷新；不重复提交')
        if run.get('task_id'):
            phase = 'poll'
            status, result = _poll(run, service)
            if status == 'succeeded':
                run = _update(owner, id, result=result, status='archive_failed')
                phase = 'archive'
                _archive(owner, run)
            else:
                _update(owner, id, status=status, error='供应商任务失败，请检查素材和账户' if status == 'failed' else '供应商任务状态未知，请核查原任务，勿重复提交' if status == 'unknown' else None)
            return
        if run['status'] in ('submitting', 'unknown'):
            _update(owner, id, status='unknown', error='上次提交结果未知且未取得任务ID，请联系供应商核查；不会自动重复扣费')
            return
        _update(owner, id, status='preparing', error=None)
        _validate(owner, run['snapshot'], complete=True)
        path, payload, asynchronous = _build(owner, run['snapshot'], service)
        _update(owner, id, status='submitting')
        phase = 'submit'
        value = _api(run['provider'], 'POST', path, payload, service, asynchronous)
        if run['provider'] == 'aliyun' and run['tool'] in ('text_image', 'image_edit'):
            urls = [c['image'] for choice in value['output']['choices'] for c in choice['message']['content'] if c.get('image')]
            run = _update(owner, id, result={'asset_type': 'image', 'urls': urls}, status='archive_failed', provider_request_id=value.get('request_id'))
            phase = 'archive'
            _archive(owner, run)
        else:
            task = value['response']['id'] if run['provider'] == 'shotstack' else value['output']['task_id'] if run['provider'] == 'aliyun' else value['task_id']
            _update(owner, id, task_id=_text(task, '供应商任务ID', 500), status='running', submitted_at=s.now(), error=None)
    except PendingUpload as exc:
        _update(owner, id, status='preparing', error=str(exc))
    except Exception as exc:
        current = s.get(owner, id)
        status = 'archive_failed' if phase == 'archive' else 'unknown' if phase == 'submit' and not isinstance(exc, Rejected) else current['status'] if current.get('task_id') or current['status'] == 'unknown' else 'failed'
        message = str(exc) if isinstance(exc, StudioError) else '媒体处理失败，已保留原始输入及任务；网络提交结果未知时不会自动重提'
        _update(owner, id, status=status, error=message)
    finally:
        _update(owner, id, busy_until=0, last_checked_at=s.now())


def refresh(owner, id):
    _object(owner, id, 'studio_run')
    jobs.POOL.submit(_work, owner, id)
    return _public(s.get(owner, id))


def recover():
    """Call once after store.init(), before accepting requests on app startup.

    Never enqueue paid work here. Pollable task IDs and archived result pointers
    survive restarts; refresh is an explicit action to continue the original run.
    """
    with s.conn() as c:
        rows = [(row['owner'], s.unpack(row)) for row in c.execute("SELECT * FROM objects WHERE kind='studio_run'")]
    count = 0
    for owner, run in rows:
        status = run.get('status')
        changes = {'busy_until': 0}
        if run.get('result') and status != 'succeeded':
            changes.update(status='archive_failed', error='服务已重启，原结果已保留；刷新仅继续下载归档')
        elif run.get('task_id') and status not in ('succeeded', 'failed'):
            changes.update(status='running', error='服务已重启，供应商任务ID已保留；刷新查询原任务')
        elif status in ('submitting', 'unknown'):
            changes.update(status='unknown', error='提交期间服务重启，供应商结果未知；请核查原任务，禁止自动重复扣费')
        elif status in ('queued', 'preparing'):
            changes.update(status='interrupted', error='服务已重启，尚未提交生成；输入和已上传素材已保留，可刷新继续')
        if changes != {'busy_until': 0} or run.get('busy_until'):
            _update(owner, run['id'], **changes, recovered_at=s.now())
            count += 1
    return count


def public_resources(owner, asset_type):
    if asset_type not in ('avatar', 'voice'):
        raise StudioError('公共库只支持形象或声音')
    service = _service('hifly')
    scope = _scope('hifly', service)
    # kind=2 is mandatory: never expose the platform account's private library.
    value = _api('hifly', 'GET', f'/api/v2/hifly/{asset_type}/list?kind=2&page=1&size=20', service=service)
    for item in value.get('data', []):
        resource = _text(item.get(asset_type), '公共资源ID', 500)
        if (asset_type == 'avatar' and item.get('kind') != 2) or (asset_type == 'voice' and item.get('type') != 10):
            continue
        id = s.digest(owner + ':' + scope + ':' + asset_type + ':' + resource)
        s.put(owner, 'studio_asset', {'title': str(item.get('title') or '公共资源')[:200], 'asset_type': asset_type,
              'provider': 'hifly', 'provider_resource_id': resource, 'service_scope': scope, 'visibility': 'public',
              'status': 'ready', 'compat': COMPAT[asset_type]}, id)


def register(app, user, admin, error):
    """Mount on an existing FastAPI app; dependencies receive existing auth users."""
    def invoke(fn, *args):
        try:
            return fn(*args)
        except s.Missing:
            return error(404, '对象不存在或无权访问')
        except s.Conflict as exc:
            return error(409, str(exc))
        except StudioError as exc:
            return error(400, str(exc))
        except (ValueError, KeyError, TypeError, httpx.HTTPError, OSError):
            return error(400, '媒体请求失败，请检查字段、素材及服务配置')

    @app.get('/api/studio/catalog')
    def catalog(u=Depends(user)):
        providers = settings()['providers']
        configured = {p['provider']: p['has_key'] and p['enabled'] for p in providers}
        tools=[];bindings=s.config('bindings',{})
        for id,(title,provider,kind,required) in TOOLS.items():
            binding=bindings.get(id,'service:'+provider);ready=bool(binding) and configured[provider];model=MODELS.get(id)
            if bound_image(id):
                try:
                    validate_binding(id,binding);m,p=g.model_record(binding);model=m['title'];ready=True
                except ValueError:ready=False
                provider='images'
            try: options=tool_options(id)
            except (ValueError,KeyError):options={}
            tools.append({'id':id,'title':title,'provider':provider,'output_type':kind,'required':required,'options':options,'models':model_choices(id),'optional':['image_id'] if id=='text_image' and bound_image(id) else [],'model':model,'configured':ready,'binding':binding,'verification':'documented_not_live','requires_confirmation':True})
        return {'tools':tools,
                'providers': providers, 'billing_notice': '生成和云端处理可能计费；确认后才提交，费用以供应商账号及模型为准。接口按公开文档接入，尚未完成本账号真实联调。'}

    @app.get('/api/studio/settings')
    def get_settings(u=Depends(admin)):
        return settings()

    @app.post('/api/studio/settings')
    def set_settings(data: dict, u=Depends(admin)):
        return invoke(save_settings, data)

    @app.get('/api/studio/drafts')
    def drafts(u=Depends(user)):
        return {'items': s.list_(u['id'], 'studio_draft')}

    @app.post('/api/studio/drafts')
    def create(data: dict, u=Depends(user)):
        return invoke(save_draft, u['id'], data)

    @app.patch('/api/studio/drafts/{id}')
    def patch(id: str, data: dict, u=Depends(user)):
        return invoke(save_draft, u['id'], data, id)

    @app.post('/api/studio/upload')
    def upload_file(file: UploadFile = File(...), provider: str | None = None, confirmed: bool = False, u=Depends(user)):
        try:
            return invoke(upload, u['id'], file, provider, confirmed)
        finally:
            file.file.close()

    @app.get('/api/studio/assets')
    def assets(asset_type: str | None = None, refresh: bool = False, u=Depends(user)):
        if refresh:
            invoke(public_resources, u['id'], asset_type)
        return {'items': [_public(x) for x in s.list_(u['id'], 'studio_asset') if not asset_type or x.get('asset_type') == asset_type],
                'public_library_complete': False}

    @app.post('/api/studio/generate')
    def submit(data: dict, u=Depends(user)):
        return invoke(generate, u['id'], data)

    @app.get('/api/studio/runs')
    def runs(u=Depends(user)):
        return {'items': [_public(x) for x in s.list_(u['id'], 'studio_run')]}

    @app.post('/api/studio/runs/{id}/refresh')
    def refresh_run(id: str, u=Depends(user)):
        return invoke(refresh, u['id'], id)

    @app.get('/api/studio/assets/{id}/file')
    def asset_file(id: str, u=Depends(user)):
        def get_file():
            asset = _object(u['id'], id, 'studio_asset')
            path = _path(u['id'], asset.get('local_file'))
            if not path.is_file() or asset.get('status') != 'ready':
                raise s.Missing()
            return FileResponse(path, media_type=asset['mime_type'], filename=path.name, headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
        return invoke(get_file)
