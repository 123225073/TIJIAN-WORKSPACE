"""V2 media routes. Register explicitly with register(app, user, admin, error).

Wire contract: list endpoints return {items: [...]}; mutations return the object.
Draft: {tool,title,input,options,brand_id?,profile_id?,source_ids?}; PATCH needs version.
Generate: {draft_id,version,confirmed:true,request_id}. Retry the SAME request_id.
Upload: multipart file; local by default, ?provider=hifly&confirmed=true uploads too.
Asset library: ?asset_type=voice|avatar&refresh=true imports PUBLIC Hifly resources only.
Run statuses: queued/preparing/submitting/running/succeeded/failed/unknown/archive_failed/interrupted.
Unknown submission is never automatically retried. Refresh polls existing task IDs.

Contracts checked 2026-10-07 (account capabilities and real billing remain untested):
https://api.hifly.cc/hifly.html
https://help.aliyun.com/zh/model-studio/text-to-video-api-reference
https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/
https://help.aliyun.com/zh/model-studio/qwen-image-api
https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
https://shotstack.io/docs/api/ (Edit and Ingest, not invented public file hosting)
"""
from __future__ import annotations

import base64
from concurrent.futures import Executor
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

import httpx
from fastapi import BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageFont, ImageOps

from . import gateway as g, jobs, network, store as s, media_registry, ark_video

MAX_FILE = 500 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
HIFLY_POLL_TIMEOUT = 24 * 3600  # Local monitoring limit; no provider expiry is assumed.
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
    'text_video': ('文字生成视频', 'ark', 'video', []),
    'image_video': ('素材参考视频', 'ark', 'video', []),
    'compose': ('素材成片', 'shotstack', 'video', ['scenes']),
}
COMPAT = {
    'image': ['text_image', 'photo_talk', 'avatar_create', 'image_edit', 'text_video', 'image_video', 'audio_avatar', 'compose'],
    'video': ['avatar_create', 'text_avatar', 'audio_avatar', 'text_video', 'image_video', 'compose'], 'audio': ['audio_avatar', 'voice_create', 'text_video', 'image_video', 'compose'],
    'avatar': ['text_avatar', 'audio_avatar'], 'voice': ['text_avatar', 'photo_talk', 'tts'],
}
EXTENSIONS = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
              '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.gif': 'image/gif',
              '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime'}
OPTIONS = {
    'text_avatar': {'st_show': [0, 1]}, 'audio_avatar': {}, 'photo_talk': {'model': [5, 6]},
    'avatar_create': {'model': [1, 2]}, 'voice_create': {}, 'tts': {},
    'text_image': {'size': ['1024*1024', '2048*2048'], 'watermark': [True, False], 'n': list(range(1, 7))},
    'image_edit': {'size': ['1024*1024', '2048*2048'], 'watermark': [True, False], 'n': list(range(1, 7))},
    'compose': {'resolution': ['sd', 'hd', '1080'], 'aspectRatio': ['16:9', '9:16', '1:1']},
}
MODELS = {'text_image': 'qwen-image-2.0-pro', 'image_edit': 'qwen-image-2.0-pro'}


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
    if TOOLS[tool][1] == 'hifly':
        if value != 'service:hifly':
            raise StudioError('数字人及声音功能仅支持飞影官方 API v2')
        return
    if value.startswith('media:'):
        media_registry.choice(tool, value[6:]);return
    if tool in media_registry.VIDEO_TOOLS:
        raise ValueError('AI 视频只允许绑定火山方舟官方 Seedance')
    if value == 'service:' + TOOLS[tool][1]:return
    if tool not in ('text_image','image_edit'):raise ValueError('此功能需要绑定对应媒体 API，不能绑定文本或图片模型')
    m,p=g.model_record(value)
    if m['capability']!='image' or not(m.get('published') and p.get('published',True)):raise ValueError('请选择已上架的图片模型及平台')


def selection(tool, model_id=None):
    if TOOLS[tool][1] == 'hifly':
        value = model_id if model_id is not None else s.config('bindings', {}).get(tool)
        return '' if value == '' else 'service:hifly'
    if tool in media_registry.VIDEO_TOOLS:
        value = model_id or s.config('bindings',{}).get(tool)
        if value is None:return ark_video.DEFAULT_MODEL
        if value == '':return ''
        if value.startswith('media:') and any(m['id'] == value[6:] and (m.get('provider_id') == 'ark' or m.get('published')) for m in media_registry.models()):return value
        return ark_video.DEFAULT_MODEL
    return model_id or s.config('bindings',{}).get(tool) or 'service:'+TOOLS[tool][1]


def bound_image(tool, model_id=None):
    value=selection(tool,model_id)
    return value if tool in ('text_image','image_edit') and not value.startswith(('service:', 'media:')) else None


def tool_options(tool, model_id=None, *, active=True):
    selected=selection(tool,model_id)
    if selected.startswith('media:'):
        model,_=media_registry.choice(tool,selected[6:],active=active)
        return media_registry.options(model) if media_registry.adapter_ready(model) else {}
    if tool in media_registry.VIDEO_TOOLS:return {}
    mid=bound_image(tool,model_id)
    if mid:
        from .illustrations import sizes
        model, _ = g.model_record(mid)
        quality = ['auto','low','medium','high']
        if model['model'].startswith('gpt-image-2.5'):
            quality += ['xhigh','max']
        return {'size':sizes(mid),'quality':quality}
    return OPTIONS[tool]


def image_reference_limit(tool, model_id):
    if tool not in ('text_image', 'image_edit'):
        return 0
    selected = selection(tool, model_id)
    if selected.startswith('media:'):
        model, _ = media_registry.choice(tool, selected[6:], active=False)
        return media_registry.REFERENCE_LIMITS.get(model['family'], {}).get('image', 0 if tool == 'text_image' else 1)
    if selected == 'service:aliyun':
        return 3 if tool == 'image_edit' else 0
    if bound_image(tool, selected):
        model, _ = g.model_record(selected)
        # Other OpenAI-compatible model names have no verified multi-image contract.
        return 16 if model['model'].startswith('gpt-image-') else 1
    return 1


def model_choices(tool):
    if tool in media_registry.VIDEO_TOOLS:
        return media_registry.choices(tool)
    result=[{'id':'service:'+TOOLS[tool][1],'title':MODELS.get(tool,TOOLS[tool][0]),'options':OPTIONS[tool], 'configured':bool(s.config(CONFIG,{}).get(TOOLS[tool][1],{}).get('secret')) and s.config(CONFIG,{}).get(TOOLS[tool][1],{}).get('enabled',True), **({'reference_limits': {'image': image_reference_limit(tool, 'service:aliyun')}} if tool in ('text_image','image_edit') else {})}]
    if tool in media_registry.DIGITAL_TOOLS | media_registry.IMAGE_TOOLS:result += media_registry.choices(tool)
    if tool in ('text_image','image_edit'):
        for m in s.config('models',[]):
            try: _, p = g.model_record(m['id'])
            except ValueError: continue
            if m.get('capability')=='image' and m.get('published') and p.get('published',True):
                result.append({'id':m['id'],'title':m['title'],'options':tool_options(tool,m['id']),'configured':True, 'reference_limits': {'image': image_reference_limit(tool, m['id'])}})
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
                    if urlsplit(url).hostname == 'ark.cn-beijing.volces.com':
                        raw = response.read()[:MAX_JSON]
                        try:code = json.loads(raw).get('error', {}).get('code', '')
                        except ValueError:code = ''
                        code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9._-]{0,150}', code) else ''
                        hints = {401:'请检查方舟API Key', 403:'请检查模型开通及账号权限', 429:'官方请求限流，请稍后重试'}
                        raise Rejected('方舟拒绝请求（HTTP ' + str(response.status_code) + (' · '+code if code else '') + '）：' + hints.get(response.status_code, '请核对账号余额、素材审核与参数'))
                    raise Rejected(f'媒体服务拒绝请求（HTTP {response.status_code}），请检查配置、余额及素材要求')
                raise StudioError(f'媒体服务响应异常（HTTP {response.status_code}），请查询原任务，勿重复提交')
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_JSON:
                    raise StudioError('媒体服务响应过大')
            if method == 'PUT' or response.status_code == 204:
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
    if provider == 'hifly' and value.get('code', 0) != 0 and not (method == 'GET' and '/task?' in path and value.get('status') == 4):
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
        raise StudioError('仅支持 PNG/JPEG/WebP/BMP/TIFF/GIF、MP3/WAV/M4A、MP4/MOV')
    result = {'mime_type': mime, 'asset_type': mime.split('/')[0], 'size': path.stat().st_size}
    if mime.startswith('image/'):
        try:
            with Image.open(path) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP', 'BMP', 'TIFF', 'GIF') or Image.MIME[image.format] != mime or image.width * image.height > 40_000_000:
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
                rate = str(video.get('avg_frame_rate') or '0/1').split('/')
                result['fps'] = float(rate[0]) / float(rate[1]) if len(rate) == 2 and float(rate[1]) else 0
        except Exception:
            raise StudioError('无法识别媒体轨道或时长，请检查文件') from None
    return result


def _public(obj, models=None):
    if obj.get('asset_type') in ('image', 'video'):obj={**obj,'compat':COMPAT[obj['asset_type']]}
    out = {k: v for k, v in obj.items() if k not in {'local_file', 'remote', 'provider_resource_id', 'service_scope', 'upload_scope', 'upload_until', 'snapshot', 'result', 'batch', 'batch_submission_done', 'busy_until', 'prompt_original'}}
    if obj.get('snapshot'):
        snap=obj['snapshot'];mid=snap.get('model_id','')
        title=next((m.get('title',mid) for m in (s.config('models',[]) if models is None else models) if m.get('id')==mid),mid)
        out['generation']={k:snap.get(k) for k in ('input','options','model_id','brand_id','profile_id')}
        out['generation']['model_title']=title
        if obj.get('prompt_original') is not None:
            out['generation']['prompt_original']=obj['prompt_original']
    if isinstance(obj.get('batch'), list):
        batch = obj['batch']
        out['batch_total'] = len(batch)
        out['result_count'] = sum(len(item.get('urls') or []) for item in batch)
        out['billing_progress'] = {
            'task_ids': sum(bool(item.get('task_id')) for item in batch),
            'uncertain_submissions': sum(item.get('status') == 'unknown' and not item.get('task_id') for item in batch),
            'not_submitted': sum(item.get('status') in ('queued', 'not_submitted') for item in batch),
        }
        out['output_items'] = [
            {'index': index + 1, 'status': item['status'],
             **({'task_id': item['task_id']} if item.get('task_id') else {}),
             **({'asset_ids': item['asset_ids']} if item.get('asset_ids') else {}),
             **({'error': item['error']} if item.get('error') else {})}
            for index, item in enumerate(batch)
        ]
    elif isinstance(obj.get('result'), dict):
        result = obj['result']
        count = len(result['urls']) if isinstance(result.get('urls'), list) else 1 if result.get('data_uri') else 0
        if count:
            saved = set(obj.get('asset_ids') or [])
            out['result_count'] = count
            out['output_items'] = []
            for index in range(count):
                asset_id = s.digest(obj['id'] + ':image') if obj.get('provider') == 'images' else s.digest('studio-asset:' + obj['id'] + ':' + str(index))
                ready = asset_id in saved
                status = 'ready' if ready else 'save_failed' if obj.get('status') == 'archive_failed' and not obj.get('busy_until', 0) > time.time() else 'saving'
                out['output_items'].append({'index': index + 1, 'status': status, **({'asset_id': asset_id} if ready else {})})
    if obj.get('local_file') and obj.get('status') == 'ready':
        out['file_url'] = '/api/studio/assets/' + obj['id'] + '/file'
        if obj.get('asset_type') == 'image':
            out['thumbnail_url'] = '/api/studio/assets/' + obj['id'] + '/thumbnail'
    return out


def upload(owner, file, provider=None, confirmed=False, enqueue=None):
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
        asset = s.put(owner, 'studio_asset', {**asset, 'upload_status': 'queued',
                      'upload_scope': _scope('hifly', _service('hifly'))}, id)
        if enqueue is None:
            jobs.POOL.submit(_upload_hifly, owner, id)
        else:
            enqueue(owner, id)
        asset = s.get(owner, id)
    return _public(asset)


def _upload_hifly(owner, id):
    try:
        asset = _object(owner, id, 'studio_asset')
        service = _service('hifly')
        if asset.get('upload_scope') != _scope('hifly', service):
            raise StudioError('上传前服务账号已变更，请重新确认上传')
        _hifly_file(owner, asset, service)
        with s.LOCK:
            asset = s.get(owner, id)
            s.put(owner, 'studio_asset', {**asset, 'upload_status': 'uploaded', 'error': None}, id)
    except PendingUpload:
        return  # Another background worker owns this upload.
    except Exception:
        with s.LOCK:
            asset = s.get(owner, id)
            s.put(owner, 'studio_asset', {**asset, 'upload_status': 'failed',
                  'error': '本地文件已保存，飞影上传未完成；生成时可再次上传'}, id)


def _asset(owner, id, asset_type, tool):
    asset = _object(owner, id, 'studio_asset')
    if asset.get('asset_type') != asset_type or asset.get('status') != 'ready' or tool not in (COMPAT[asset_type] if asset_type in ('image', 'video') else asset.get('compat', [])):
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
    if data.get('model_id') is not None and not isinstance(data['model_id'], str):raise StudioError('模型编号无效')
    chosen=(selection(tool, data.get('model_id')) or ark_video.DEFAULT_MODEL) if tool in media_registry.VIDEO_TOOLS else data.get('model_id') or ''
    if chosen is not None and not isinstance(chosen,str):raise StudioError('模型编号无效')
    if chosen and TOOLS[tool][1] == 'hifly':
        validate_binding(tool, chosen)
    elif chosen:
        if chosen.startswith('media:'):
            media_registry.choice(tool,chosen[6:],active=complete)
        else:validate_binding(tool,chosen)
    allowed = set(TOOLS[tool][3])
    if tool in media_registry.VIDEO_TOOLS:allowed.update({'prompt', 'image_id'})
    required = list(TOOLS[tool][3])
    if tool in ('text_avatar', 'audio_avatar'):
        allowed.add('video_id')
        if inputs.get('video_id'):
            required = ['text', 'video_id'] if tool == 'text_avatar' else ['audio_id', 'video_id']
    if tool == 'audio_avatar' and chosen.startswith('media:'):
        model, _ = media_registry.choice(tool, chosen[6:], active=complete)
        if model['family'] == 'infinitetalk':
            allowed = {'audio_id', 'image_id'}
            required = ['audio_id', 'image_id']
    limits = {}
    if tool in media_registry.VIDEO_TOOLS and chosen and chosen.startswith('media:'):
        model, _ = media_registry.choice(tool, chosen[6:], active=complete)
        limits = media_registry.REFERENCE_LIMITS.get(model['family'], {})
        allowed.update({'image_ids', 'video_ids', 'audio_ids'})
        if model.get('provider_id') == 'ark':allowed.update({'reference_mode', 'remote_references', 'draft_run'})
    if tool=='text_image' and bound_image(tool,chosen):
        allowed.update({'image_id','image_ids'})
        limits={'image': image_reference_limit(tool, chosen)}
    if tool=='text_image' and chosen.startswith('media:'):
        model,_=media_registry.choice(tool,chosen[6:],active=complete)
        if model['family']=='gpt-image-2.5-edit':
            allowed.update({'image_id','image_ids'})
            limits=media_registry.REFERENCE_LIMITS[model['family']]
    if tool=='image_edit':
        allowed.add('image_ids')
        limits={'image': image_reference_limit(tool, chosen)}
    if tool=='image_edit':
        allowed.update({'edit_marks','image_layers'})
        if inputs.get('edit_marks') or inputs.get('image_layers'):
            required=[key for key in required if key!='prompt']
    if tool == 'avatar_create':
        allowed = {'image_id', 'video_id'}
    _strict(inputs, allowed)
    choices=tool_options(tool,chosen,active=complete)
    if tool in media_registry.VIDEO_TOOLS and model.get('provider_id') == 'ark':
        try:ark_video.validate(model, inputs, options, lambda id, kind: _asset(owner, id, kind, tool), complete=complete)
        except ark_video.ArkError as exc:raise StudioError(str(exc)) from None
        if inputs.get('draft_run'):
            sample = _object(owner, _text(inputs['draft_run'], '样片记录', 128), 'studio_run')
            if sample.get('provider') != 'ark' or sample.get('status') != 'succeeded' or not sample.get('snapshot', {}).get('options', {}).get('draft') or sample.get('model_id') != chosen:
                raise StudioError('请选择当前模型在本账号已成功生成的样片')
            if time.time() - datetime.fromisoformat(sample.get('submitted_at') or sample['created']).timestamp() > 7*86400:raise StudioError('样片任务已超过官方7天有效期，请重新制作样片')
    else:
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
            _text(value, key, 10000 if key == 'text' or tool in media_registry.VIDEO_TOOLS else 1500,
                  not complete or tool in media_registry.VIDEO_TOOLS or (tool == 'image_edit' and key == 'prompt' and bool(inputs.get('edit_marks') or inputs.get('image_layers'))))
            if key == 'text' and re.search(r'<[^>]+>', value):
                raise StudioError('口播文本不支持HTML标签')
    if tool=='image_edit':
        for key,limit in (('edit_marks',12),('image_layers',16)):
            items=inputs.get(key,[])
            if not isinstance(items,list) or len(items)>limit:
                raise StudioError('图片编辑区域或画布对象数量超出限制')
            seen=set()
            for item in items:
                if not isinstance(item,dict):raise StudioError('图片编辑数据格式无效')
                mark=key=='edit_marks'
                _strict(item,['id','x','y','width','height','instruction'] if mark else ['id','asset_id','x','y','width','height'])
                uid=_text(item.get('id'),'编辑对象编号',128)
                if uid in seen:raise StudioError('图片编辑对象编号重复')
                seen.add(uid)
                for field in ('x','y','width','height'):
                    value=item.get(field)
                    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1:
                        raise StudioError('图片编辑坐标无效')
                if not item['width'] or not item['height'] or item['x']+item['width']>1.000001 or item['y']+item['height']>1.000001:
                    raise StudioError('图片编辑对象超出原图边界')
                if mark:_text(item.get('instruction',''),'区域修改要求',300,True)
                else:_asset(owner,_text(item.get('asset_id'),'画布图片ID',128),'image',tool)
        if complete and any(not str(mark.get('instruction') or '').strip() for mark in inputs.get('edit_marks',[])):
            raise StudioError('请填写每个已框选区域的修改要求')
        if complete and not (str(inputs.get('prompt') or '').strip() or inputs.get('edit_marks') or inputs.get('image_layers')):
            raise StudioError('请填写整图或区域修改要求，或添加图片对象')
    for kind in ('image', 'video', 'audio'):
        key = kind + '_ids'
        if key not in inputs:
            continue
        ids = inputs[key]
        if not isinstance(ids, list) or len(ids) > limits.get(kind, 0) or len(ids) != len(set(map(str, ids))):
            raise StudioError('参考素材数量超过当前模型支持范围：' + kind)
        for id in ids:
            _asset(owner, _text(id, '参考素材ID', 128), kind, tool)
        if complete and kind in ('video','audio') and limits.get('duration'):
            durations=[_asset(owner,id,kind,tool).get('duration') for id in ids]
            if any(not d for d in durations) or sum(durations)>limits['duration']:
                raise StudioError('参考素材总时长超过模型限制，或素材时长尚未验证：'+kind)
    if limits.get('image') and inputs.get('image_id') and len(set([inputs['image_id'],*(inputs.get('image_ids') or [])]))>limits['image']:
        raise StudioError('主图与参考图合计超过当前模型上限')
    if inputs.get('image_ids') and inputs.get('image_id') and inputs['image_id'] != inputs['image_ids'][0]:
        raise StudioError('首张参考图与主图不一致')
    if complete and tool == 'image_edit' and inputs.get('edit_marks') and len(inputs.get('image_ids') or [inputs['image_id']]) >= limits['image']:
        raise StudioError('参考图已达模型上限，无法再加入区域标注图；请减少一张参考图')
    if complete and bound_image(tool,chosen):
        image_ids=inputs.get('image_ids') or ([inputs['image_id']] if inputs.get('image_id') else [])
        for image_id in image_ids:
            asset=_asset(owner,image_id,'image',tool)
            if asset.get('size',0)>50_000_000 or asset.get('width',0)*asset.get('height',0)>25_000_000:
                raise StudioError('参考图片超过当前图片接口的大小或像素限制，请换用较小图片')
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
        if tool=='text_image' and chosen.startswith('media:') and model['family']=='gpt-image-2.5-edit' and not (inputs.get('image_id') or inputs.get('image_ids')):
            raise StudioError('参考图生成模型至少需要一张参考图片')
        if any(not inputs.get(key) for key in required):
            raise StudioError('请填写当前工具全部必填输入')
        if tool in ('text_avatar', 'audio_avatar') and bool(inputs.get('avatar_id')) == bool(inputs.get('video_id')):
            raise StudioError('文字或音频驱动需要且只能选择一个飞影形象或一段人物视频')
        if tool == 'avatar_create' and bool(inputs.get('image_id')) == bool(inputs.get('video_id')):
            raise StudioError('创建形象需要且只能选择一张照片或一段视频')
        if tool == 'avatar_create' and inputs.get('video_id') and 'model' in options:
            raise StudioError('视频形象不接受图片形象模型选项')
        for key, asset in assets.items():
            limit = 20 * 1024 * 1024 if tool == 'voice_create' else 100 * 1024 * 1024 if tool == 'audio_avatar' and asset.get('asset_type') == 'audio' else MAX_FILE
            if asset.get('size', 0) > limit:
                raise StudioError('所选素材超过当前供应商接口的大小限制')
            if tool in ('voice_create', 'audio_avatar', 'avatar_create', 'text_avatar') and asset.get('asset_type') in ('audio', 'video'):
                if not asset.get('duration'):
                    raise StudioError('素材时长尚未验证，不能提交付费生成；请安装ffprobe后重新上传，本地文件已保留')
                upper = 180 if tool == 'voice_create' else 1800
                if not 5 <= asset['duration'] <= upper:
                    raise StudioError('当前接口需要5秒至' + str(upper) + '秒的素材')
                if tool == 'avatar_create' and asset['asset_type'] == 'video':
                    dimensions = [asset.get('width') or 0, asset.get('height') or 0]
                    if asset.get('video_codec') != 'h264' or min(dimensions) < 360 or max(dimensions) > 4096:
                        raise StudioError('视频形象需要H.264编码、360p至4K画面，请转码后重新上传')
    return {**data, **({'model_id': chosen} if tool in media_registry.VIDEO_TOOLS else {}), 'title': data.get('title', ''), 'input': inputs, 'options': options}


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
    # Claim in SQLite, release the DB lock before touching the provider.
    with s.conn() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT * FROM objects WHERE id=? AND owner=? AND kind='studio_asset'", (asset['id'], owner)).fetchone()
        if not row:
            raise s.Missing('素材不存在或无权访问')
        current = s.unpack(row)
        old = current.get('remote', {}).get(scope, {})
        if old.get('file_id'):
            return old['file_id']
        if current.get('upload_until', 0) > time.time():
            raise PendingUpload('素材正在上传，请等待上传完成')
        current.update(upload_until=time.time() + 600, upload_status='uploading')
        c.execute('UPDATE objects SET data=?,version=version+1 WHERE id=?', (json.dumps(current, ensure_ascii=False), asset['id']))
    try:
        path = _path(owner, current['local_file'])
        result = _api('hifly', 'POST', '/api/v2/hifly/tool/create_upload_url', {'file_extension': path.suffix[1:]}, service)
        file_id = _text(result.get('file_id'), '飞影上传ID', 500)
        with path.open('rb') as stream:
            _request('PUT', result['upload_url'], headers={'Content-Type': result['content_type']}, content=stream)
        with s.LOCK:
            current = s.get(owner, asset['id'])
            s.put(owner, 'studio_asset', {**current, 'remote': {**current.get('remote', {}), scope: {'file_id': file_id}},
                  'upload_status': 'uploaded', 'error': None}, asset['id'])
        return file_id
    finally:
        with s.LOCK:
            current = s.get(owner, asset['id'])
            s.put(owner, 'studio_asset', {**current, 'upload_until': 0,
                  'upload_status': 'failed' if current.get('upload_status') == 'uploading' else current.get('upload_status')}, asset['id'])


def _image_data(owner, asset):
    if asset['size'] > 10 * 1024 * 1024 or asset.get('width', 0) < 1:
        raise StudioError('图片必须为有效图片且不超过10MB')
    return 'data:' + asset['mime_type'] + ';base64,' + base64.b64encode(_path(owner, asset['local_file']).read_bytes()).decode()


def _layered_image(owner, inputs):
    """Build the visible canvas in memory for AI editing; keep stored assets intact."""
    layers = inputs.get('image_layers') or []
    if not layers:
        return None
    base = _asset(owner, inputs['image_id'], 'image', 'image_edit')
    try:
        with Image.open(_path(owner, base['local_file'])) as source:
            canvas = ImageOps.exif_transpose(source).convert('RGBA')
        if canvas.width * canvas.height > 40_000_000:
            raise StudioError('原图像素过大，无法加入图片对象')
        background = Image.new('RGBA', canvas.size, 'white')
        background.alpha_composite(canvas)
        canvas = background
        for item in layers:
            asset = _asset(owner, item['asset_id'], 'image', 'image_edit')
            with Image.open(_path(owner, asset['local_file'])) as source:
                overlay = ImageOps.exif_transpose(source).convert('RGBA')
            width = max(1, round(item['width'] * canvas.width))
            height = max(1, round(item['height'] * canvas.height))
            x, y = round(item['x'] * canvas.width), round(item['y'] * canvas.height)
            canvas.alpha_composite(overlay.resize((width, height), Image.Resampling.LANCZOS), (x, y))
        output = io.BytesIO()
        for quality in (90, 78, 65):
            output.seek(0); output.truncate(0)
            canvas.convert('RGB').save(output, format='JPEG', quality=quality, optimize=True)
            if output.tell() <= 10 * 1024 * 1024:
                return output.getvalue(), 'image/jpeg'
        raise StudioError('合成后的原图超过10MB，请缩小原图后重试')
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise StudioError('图片对象无法读取，未提交生成任务') from exc


def _guide_font(size):
    # These fonts contain Chinese glyphs. If none is installed, numbered labels
    # remain legible and the complete instructions stay in the text prompt.
    candidates = (
        'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf',
        '/System/Library/Fonts/PingFang.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    )
    for candidate in candidates:
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size), True
            except OSError:
                pass
    try:
        return ImageFont.truetype('DejaVuSans.ttf', size), False
    except OSError:
        return ImageFont.load_default(), False


def _guide_lines(draw, value, font, width):
    lines = []
    for paragraph in value.splitlines() or ['']:
        line = ''
        for char in paragraph:
            if line and draw.textlength(line + char, font=font) > width:
                lines.append(line)
                line = char
            else:
                line += char
        lines.append(line)
    return lines


def _annotation_guide(owner, image_id, marks, source_bytes=None):
    """Render a temporary reference image; never write it to the asset directory."""
    asset = _asset(owner, image_id, 'image', 'image_edit')
    if asset.get('width', 0) * asset.get('height', 0) > 40_000_000:
        raise StudioError('原图像素过大，无法制作区域标注图')
    try:
        with Image.open(io.BytesIO(source_bytes) if source_bytes is not None else _path(owner, asset['local_file'])) as source:
            original = ImageOps.exif_transpose(source)
            scale = min(1100 / original.width, 1800 / original.height, 4)
            size = (max(1, round(original.width * scale)), max(1, round(original.height * scale)))
            picture = original.convert('RGB').resize(size, Image.Resampling.LANCZOS)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise StudioError('原图无法读取，区域标注图未生成') from exc

    panel_width = 820
    legend = None
    for font_size in (24, 21, 18, 16, 14):
        font, cjk = _guide_font(font_size)
        probe = ImageDraw.Draw(picture)
        rows = []
        height = 90 + font_size
        for index, mark in enumerate(marks, 1):
            instruction = mark['instruction'].strip() if cjk else f'See prompt region {index}'
            lines = _guide_lines(probe, instruction, font, panel_width - 60)
            rows.append((index, lines))
            height += (len(lines) + 1) * (font_size + 8) + 18
        if height <= 2000:
            legend = rows
            break
    if legend is None:
        raise StudioError('区域说明过长，无法完整放入标注图；请缩短区域要求')
    width = picture.width + panel_width + 40
    height = max(picture.height + 40, height + 20, 512)
    if width * height > 4_200_000 or width > 2048 or height > 2048:
        raise StudioError('区域标注图尺寸超限，请换用较小的原图或缩短区域要求')
    guide = Image.new('RGB', (width, height), '#f8fafc')
    guide.paste(picture, (20, 20))
    draw = ImageDraw.Draw(guide)
    colors = ('#e11d48', '#2563eb', '#b45309', '#16a34a', '#7c3aed', '#0891b2')
    for index, mark in enumerate(marks, 1):
        color = colors[(index - 1) % len(colors)]
        x0 = 20 + round(mark['x'] * picture.width)
        y0 = 20 + round(mark['y'] * picture.height)
        x1 = 20 + round((mark['x'] + mark['width']) * picture.width) - 1
        y1 = 20 + round((mark['y'] + mark['height']) * picture.height) - 1
        draw.rectangle((x0, y0, max(x0, x1), max(y0, y1)), outline=color, width=max(3, picture.width // 300))
        label = str(index)
        label_box = draw.textbbox((0, 0), label, font=font)
        draw.rectangle((x0, y0, x0 + label_box[2] + 14, y0 + font_size + 12), fill=color)
        draw.text((x0 + 7, y0 + 4), label, fill='white', font=font)
    left = picture.width + 40
    y = 30
    draw.text((left, y), '区域修改说明' if cjk else 'EDIT GUIDE', fill='#0f172a', font=font)
    y += font_size + 28
    for index, lines in legend:
        color = colors[(index - 1) % len(colors)]
        draw.text((left, y), f'{index}.', fill=color, font=font)
        y += font_size + 8
        for line in lines:
            draw.text((left + 18, y), line, fill='#0f172a', font=font)
            y += font_size + 8
        y += 18
    output = io.BytesIO()
    guide.save(output, format='PNG', optimize=True)
    raw = output.getvalue()
    mime = 'image/png'
    if len(raw) > 8_000_000:
        for quality in (90, 75):
            output = io.BytesIO()
            guide.save(output, format='JPEG', quality=quality, optimize=True)
            raw = output.getvalue()
            if len(raw) <= 8_000_000:
                mime = 'image/jpeg'
                break
    if len(raw) > 8_000_000:
        raise StudioError('区域标注图超过8MB，请使用较小的原图')
    return raw, mime


def _guided_prompt(prompt):
    return prompt + '\n首张图片是未标注原图，最后一张是区域标注说明图。请按编号修改首张图的对应区域，保持首张图的构图与宽高比例，不要把框线、编号或说明文字输出到成品。'


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
    if tool in media_registry.VIDEO_TOOLS:
        raise StudioError('此旧视频接口不支持新任务；请选择已上架的视频模型')
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
        if tool in ('text_avatar', 'audio_avatar') and 'video_id' in assets:
            payload['video_file_id'] = _hifly_file(owner, assets['video_id'], service)
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
            ids = (inputs.get('image_ids') or [inputs['image_id']]) if tool == 'image_edit' else []
            layered = _layered_image(owner, inputs) if tool == 'image_edit' else None
            content = [{'image': ('data:' + layered[1] + ';base64,' + base64.b64encode(layered[0]).decode()) if index == 0 and layered else _image_data(owner, _asset(owner, id, 'image', tool))} for index, id in enumerate(ids)]
            marks = (inputs.get('edit_marks') or []) if tool == 'image_edit' else []
            if marks:
                guide, mime = _annotation_guide(owner, inputs['image_id'], marks, layered[0] if layered else None)
                content.append({'image': 'data:' + mime + ';base64,' + base64.b64encode(guide).decode()})
            content.append({'text': _guided_prompt(inputs['prompt']) if marks else inputs['prompt']})
            return '/api/v1/services/aigc/multimodal-generation/generation', {'model':draft.get('model_id','').split(':',2)[2] if draft.get('model_id','').count(':')==2 else MODELS[tool], 'input': {'messages': [{'role': 'user', 'content': content}]}, 'parameters': {'n': 1, **options}}, False
        raise StudioError('当前阿里云服务仅用于图片创作')
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


def _wavespeed_service(model_id, tool, *, active=True):
    model, provider = media_registry.choice(tool, model_id[6:],active=active)
    if not media_registry.adapter_ready(model):
        raise StudioError('此模型尚未适配接口，不能提交付费任务')
    if not provider.get('secret'):
        raise StudioError('生成平台尚未配置 API Key，请联系管理员')
    return model, provider


def _ark_api(service, method, path, payload=None):
    if service.get('id') != 'ark' or service['base_url'] != ark_video.BASE_URL:
        raise StudioError('AI视频仅使用火山方舟官方服务地址')
    key = g.cipher().decrypt(service['secret'].encode()).decode()
    return _request(method, ark_video.BASE_URL + path, headers={'Authorization': 'Bearer ' + key}, payload=payload)


def _ark_payload(owner, run, model, service):
    inputs, opts = run['snapshot']['input'], run['snapshot']['options']
    refs = ark_video.validate(model, inputs, opts, lambda id, kind: _asset(owner, id, kind, run['tool']), complete=True, service=service)
    sample_task = None
    if inputs.get('draft_run'):
        sample = _object(owner, inputs['draft_run'], 'studio_run')
        if sample.get('service_scope') != run['service_scope']:
            raise StudioError('样片与当前方舟服务账号不一致')
        sample_task = sample['task_id']
    def resolve(ref):
        a = _asset(owner, ref['id'], ref['kind'], run['tool'])
        return ark_video.media_url(owner, a, service, _path(owner, a['local_file']))
    return ark_video.payload(owner, model, inputs, opts, refs, resolve, sample_task=sample_task)


def migrate_video_draft(owner, draft):
    if draft.get('tool') not in media_registry.VIDEO_TOOLS:return draft
    chosen = selection(draft['tool'], draft.get('model_id'))
    if chosen == (draft.get('model_id') or ''):return draft
    # Only obsolete routes are migrated. Current official drafts keep all their settings.
    opts = dict(draft.get('options', {}))
    if 'aspect_ratio' in opts:opts['ratio'] = opts.pop('aspect_ratio')
    if isinstance(opts.get('resolution'), str):opts['resolution'] = opts['resolution'].lower()
    if opts.get('resolution') == '4k':opts.pop('resolution')
    allowed = ark_video.options({'family': 'seedance-2.5'})
    opts = {k:v for k,v in opts.items() if k in allowed and v in allowed[k]}
    return s.put(owner, 'studio_draft', {**draft, 'model_id': chosen, 'options': opts,
                 'input': {**draft.get('input', {}), 'reference_mode': 'reference'},
                 'migration_notice': '原中转视频模型已改为官方Seedance 2.5，素材与提示词已保留；请检查参数后再生成。'}, draft['id'], expected=draft['version'])


def migrate_video_bindings():
    bindings = s.config('bindings', {})
    next_bindings = dict(bindings)
    for tool in media_registry.VIDEO_TOOLS:
        if bindings.get(tool) != '':next_bindings[tool] = selection(tool)
    if next_bindings != bindings:s.set_config('bindings', next_bindings)


def _wavespeed_api(service, method, path, payload=None):
    # The key never leaves the server and is attached only to the configured API root.
    base=media_registry._url(service['base_url'])
    key=g.cipher().decrypt(service['secret'].encode()).decode()
    value=_request(method,base+path,headers={'Authorization':'Bearer '+key},payload=payload)
    if value.get('code') not in (None,200):
        raise Rejected('中转平台拒绝请求；请检查密钥、账户余额或模型参数')
    if not isinstance(value.get('data'),dict):
        raise StudioError('中转平台未返回有效任务数据；请核查原任务')
    return value['data']


def _wavespeed_upload(owner, asset_id, kind, tool, service):
    asset=_asset(owner,asset_id,kind,tool)
    path=_path(owner,asset['local_file'])
    if path.stat().st_size>200*1024*1024:
        raise StudioError('中转平台单个参考素材不能超过200MB')
    return _wavespeed_upload_bytes(path.read_bytes(), path.name, asset['mime_type'], service)


def _wavespeed_upload_bytes(raw, filename, mime, service):
    if len(raw)>200*1024*1024:
        raise StudioError('中转平台单个参考素材不能超过200MB')
    ticket=_wavespeed_api(service,'POST','/api/v3/media/uploads',{'filename':filename,'size':len(raw),'content_type':mime})
    upload=ticket.get('upload')
    if not isinstance(upload,dict) or upload.get('method')!='PUT' or not isinstance(upload.get('headers'),dict):
        raise StudioError('中转平台未返回有效素材上传凭证')
    target=upload.get('url')
    if not isinstance(target,str) or urlsplit(target).scheme!='https':
        raise StudioError('中转平台素材上传地址无效')
    headers=upload['headers']
    if any(not isinstance(k,str) or not isinstance(v,str) or k.lower() in ('authorization','host','cookie') or len(k)>100 or len(v)>2000 for k,v in headers.items()):
        raise StudioError('中转平台素材上传头无效')
    # The signed storage URL is an opaque credential. Never persist or log it.
    _request('PUT',target,headers=headers,content=raw)
    url=ticket.get('download_url')
    if not isinstance(url,str) or urlsplit(url).scheme!='https':
        raise StudioError('中转平台未返回可用的参考素材地址')
    network.public_url(url)
    return url


def _wavespeed_payload(owner, run, model, service):
    snapshot=run['snapshot'];tool=snapshot['tool'];inputs=snapshot['input'];opts=snapshot['options']
    marks=(inputs.get('edit_marks') or []) if tool=='image_edit' else []
    payload={'prompt':_guided_prompt(inputs['prompt']) if marks else inputs['prompt'],**{key:value for key,value in opts.items() if key!='n'}}
    if tool in media_registry.VIDEO_TOOLS:
        for kind in ('image','video','audio'):
            ids=list(inputs.get(kind+'_ids') or [])
            if kind=='image' and inputs.get('image_id') and inputs['image_id'] not in ids:ids.insert(0,inputs['image_id'])
            if ids:payload['reference_'+kind+'s']=[_wavespeed_upload(owner,id,kind,tool,service) for id in ids]
    elif tool=='image_edit' or (tool=='text_image' and model['family']=='gpt-image-2.5-edit'):
        ids=list(inputs.get('image_ids') or [])
        if inputs.get('image_id') and inputs['image_id'] not in ids:ids.insert(0,inputs['image_id'])
        if marks and len(ids)+1>media_registry.REFERENCE_LIMITS[model['family']]['image']:
            raise StudioError('参考图已达模型上限，无法再加入区域标注图；请减少一张参考图')
        layered = _layered_image(owner, inputs) if tool == 'image_edit' else None
        payload['images']=[_wavespeed_upload_bytes(layered[0], 'edit-base.jpg', layered[1], service) if index == 0 and layered else _wavespeed_upload(owner,id,'image',tool,service) for index,id in enumerate(ids)]
        if marks:
            guide, mime = _annotation_guide(owner, inputs['image_id'], marks, layered[0] if layered else None)
            payload['images'].append(_wavespeed_upload_bytes(guide, 'edit-guide.' + mime.split('/')[1], mime, service))
    return payload


def generate(owner, data, enqueue=None):
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
        if TOOLS[draft['tool']][1] == 'hifly' and draft.get('model_id') not in (None, '', 'service:hifly'):
            raise StudioError('旧模型及参数已保留；当前功能使用飞影 API v2，请重新选择飞影并核对素材后确认生成')
        clean = {k: v for k, v in draft.items() if k in {'tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'}}
        clean['model_id']=selection(draft['tool'],draft.get('model_id'))
        _validate(owner, clean, complete=True)
        prompt_original=None
        if draft['tool']=='image_edit':
            prompt_original=str(clean['input'].get('prompt') or '')
            parts=[str(clean['input'].get('prompt') or '').strip()]
            if clean['input'].get('image_layers'):
                parts.append('首张输入图已按画布位置叠加图片对象。请将这些对象自然融合到原图中，保留其位置和主体特征；未指定部分尽量保持原图。')
            for index,mark in enumerate(clean['input'].get('edit_marks') or [],1):
                area=f"左上角 ({mark['x']:.3f}, {mark['y']:.3f})，宽 {mark['width']:.3f}，高 {mark['height']:.3f}"
                parts.append(f"区域 {index} [{area}]：{mark['instruction'].strip()}。只修改该区域，区域外尽量保持原图。")
            prompt='\n'.join(part for part in parts if part)
            if len(prompt)>1500:raise StudioError('区域修改要求合计超过1500字，请缩短后重试')
            clean={**clean,'input':{**clean['input'],'prompt':prompt}}
        provider = TOOLS[draft['tool']][1]
        bindings=s.config('bindings',{})
        if draft['tool'] in bindings and not bindings[draft['tool']]:raise StudioError('此功能已停用，请联系管理员绑定服务')
        image_model=bound_image(draft['tool'],draft.get('model_id'))
        media_model=clean['model_id'] if clean['model_id'].startswith('media:') else None
        if media_model:
            model,service=_wavespeed_service(media_model,draft['tool']);provider=service['id']
            if provider == 'ark':
                try:ark_video.validate(model,clean['input'],clean['options'],lambda id,kind:_asset(owner,id,kind,draft['tool']),complete=True,service=service)
                except ark_video.ArkError as exc:raise StudioError(str(exc)) from None
            if draft['tool']=='image_edit' and clean['input'].get('edit_marks'):
                image_ids=clean['input'].get('image_ids') or [clean['input']['image_id']]
                if len(image_ids)+1>media_registry.REFERENCE_LIMITS[model['family']]['image']:
                    raise StudioError('参考图已达模型上限，无法再加入区域标注图；请减少一张参考图')
        elif draft['tool'] in media_registry.VIDEO_TOOLS:
            raise StudioError('请先选择火山方舟官方 Seedance 模型')
        elif image_model:
            validate_binding(draft['tool'],image_model)
            m,service=g.model_record(image_model);provider='images'
        else:service = _service(provider)
        record = {'title': draft['title'], 'tool': draft['tool'], 'provider': provider, 'draft_id': draft['id'],
                  'draft_version': draft['version'], 'snapshot': clean, 'request_id': request_id, 'status': 'queued',
                  'confirmed_at': s.now(), 'service_scope': _scope(provider, service), 'model_id':media_model or image_model, 'prompt_original':prompt_original, 'task_id': None, 'asset_ids': [], 'created': s.now()}
        if provider == 'wavespeed' and draft['tool'] in media_registry.IMAGE_TOOLS and clean['options'].get('n', 1) > 1:
            record.update(batch=[{'status': 'queued'} for _ in range(clean['options']['n'])], batch_submission_done=False)
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
    if enqueue is None:
        jobs.POOL.submit(_work, owner, id)
    else:
        enqueue(owner, id)
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


def _hifly_transition(owner, id, status):
    """Cancellation and the paid submission boundary share an atomic DB gate."""
    with s.conn() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT * FROM objects WHERE id=? AND owner=? AND kind='studio_run'", (id, owner)).fetchone()
        if not row:
            raise s.Missing('任务不存在或无权访问')
        run = s.unpack(row)
        if run['status'] not in ('queued', 'preparing') or run.get('task_id'):
            return False
        run.update(status=status, error=None)
        c.execute('UPDATE objects SET data=?,version=version+1,updated=? WHERE id=?', (json.dumps(run, ensure_ascii=False), s.now(), id))
    return True


def _poll(run, service):
    task = quote(_text(run.get('task_id'), '供应商任务ID', 500), safe='')
    provider = run['provider']
    if provider == 'ark':
        value = _ark_api(service, 'GET', ark_video.TASKS + '/' + quote(task, safe=''))
        status = value.get('status')
        metadata = {key:value[key] for key in ('resolution','ratio','duration','framespersecond','output_format','draft','model') if key in value}
        usage = value.get('usage', {})
        metadata['usage'] = {k:v for k,v in usage.items() if k in ('completion_tokens','total_tokens') and type(v) is int}
        if status == 'succeeded':
            content = value.get('content', {})
            return 'succeeded', {'asset_type':'video', 'urls':[content.get('video_url')], 'last_frame_url':content.get('last_frame_url'), 'metadata':metadata}
        if status in ('failed','cancelled','expired'):
            code = value.get('error', {}).get('code', '') if isinstance(value.get('error'), dict) else ''
            code = code if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9._-]{0,150}', code) else ''
            return status, {'error':'方舟任务'+ {'failed':'失败','cancelled':'已取消','expired':'已过期'}[status] + ('（'+code+'）' if code else '')}
        return ('queued' if status == 'queued' else 'running' if status == 'running' else 'unknown'), {}
    if provider == 'wavespeed':
        value=_wavespeed_api(service,'GET','/api/v3/predictions/'+task+'/result')
        status=value.get('status')
        if status=='completed':
            outputs=value.get('outputs')
            if not isinstance(outputs,list) or not outputs or any(not isinstance(url,str) or not url.startswith('https://') for url in outputs):
                return 'unknown',{}
            return 'succeeded',{'urls':outputs,'asset_type':TOOLS[run['tool']][2]}
        if status in ('failed','cancelled','timeout','deleted'):return 'failed',{}
        return ('running' if status in ('created','pending','processing','running','queued') else 'unknown'),{}
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
        if status == 'failed':
            result = {'error': '飞影任务失败；原任务和输入已保留，请检查素材及账号后手动确认新任务'}
        return status, result
    if provider == 'aliyun':
        value = _api(provider, 'GET', '/api/v1/tasks/' + task, service=service)['output']
        status = {'PENDING': 'running', 'RUNNING': 'running', 'SUCCEEDED': 'succeeded', 'FAILED': 'failed', 'CANCELED': 'failed'}.get(value.get('task_status'), 'unknown')
        return status, {'urls': [value.get('video_url')], 'asset_type': 'video'}
    value = _api(provider, 'GET', f'/edit/{service.get("environment", "stage")}/render/{task}', service=service)['response']
    status = 'succeeded' if value.get('status') == 'done' else 'failed' if value.get('status') == 'failed' else 'running' if value.get('status') in ('queued', 'fetching', 'rendering', 'saving') else 'unknown'
    return status, {'urls': [value.get('url')], 'asset_type': 'video'}


def _download(owner, id, url, asset_type, *, output_format=None):
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
        ext = '.mov' if output_format == 'mov' or urlsplit(url).path.lower().endswith('.mov') else '.mp4'
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
            filename, metadata = _download(owner, id, url, kind, output_format=result.get('metadata', {}).get('output_format') or run['snapshot']['options'].get('output_format')) if run['provider'] == 'ark' else _download(owner, id, url, kind)
            value.update(metadata, local_file=filename)
            value['requested_size']=run['snapshot'].get('options',{}).get('size')
            value['requested_resolution']=run['snapshot'].get('options',{}).get('resolution')
        s.put(owner, 'studio_asset', value, id)
        ids.append(id)
        _update(owner, run['id'], asset_ids=ids)
    changes = {}
    if run['provider'] == 'ark':
        changes['actual_parameters'] = result.get('metadata', {})
        if result.get('last_frame_url'):
            aid = s.digest(run['id'] + ':last-frame')
            try:existing = _object(owner, aid, 'studio_asset')
            except s.Missing:existing = {}
            if existing.get('status') != 'ready':
                filename, meta = _download(owner, aid, result['last_frame_url'], 'image')
                s.put(owner, 'studio_asset', {**meta, 'local_file':filename, 'title':run['title']+' · 尾帧', 'provider':'ark', 'status':'ready', 'compat':COMPAT['image'], 'run_id':run['id']}, aid)
            changes['last_frame_id'] = aid
    return _update(owner, run['id'], status='succeeded', asset_ids=ids, error=None, finished_at=s.now(), **changes)


def _batch_status(batch):
    states = {item['status'] for item in batch}
    if 'submitting' in states:return 'submitting'
    if states & {'running', 'saving'}:return 'running'
    if 'queued' in states:return 'queued'
    if 'unknown' in states:return 'unknown'
    if 'archive_failed' in states:return 'archive_failed'
    if states == {'succeeded'}:return 'succeeded'
    return 'partial' if 'succeeded' in states else 'failed'


def _batch_write(owner, id, batch, **run_values):
    return _update(owner, id, batch=batch, status=_batch_status(batch), **run_values)


def _batch_item(owner, id, index, *, run_values=None, **changes):
    current = _object(owner, id, 'studio_run')
    batch = [dict(item) for item in current['batch']]
    batch[index].update(changes)
    return _batch_write(owner, id, batch, **(run_values or {}))


def _batch_stop(owner, id, index, status, error):
    current = _object(owner, id, 'studio_run')
    batch = [dict(item) for item in current['batch']]
    batch[index].update(status=status, error=error)
    for item in batch[index + 1:]:
        if item['status'] == 'queued':item.update(status='not_submitted', error='前一张提交未完成，本张未提交，不会计费')
    return _batch_write(owner, id, batch, batch_submission_done=True, error=error)


def _batch_interrupt(owner, id, message):
    current = _object(owner, id, 'studio_run')
    batch = [dict(item) for item in current['batch']]
    for item in batch:
        if item['status'] == 'submitting' and not item.get('task_id'):
            item.update(status='unknown', error='供应商提交结果未知，可能已计费；不会重复提交')
        elif item['status'] == 'queued':
            item.update(status='not_submitted', error='尚未提交，不会计费')
        elif item['status'] == 'saving' and item.get('urls'):
            item.update(status='archive_failed', error='结果已返回，请刷新继续保存')
    return _batch_write(owner, id, batch, batch_submission_done=True, busy_until=0, error=message)


def _batch_archive(owner, id, index):
    run = _object(owner, id, 'studio_run')
    item = run['batch'][index]
    for output_index, url in enumerate(item['urls']):
        asset_id = s.digest(f'studio-asset:{id}:{index}:{output_index}')
        try:
            existing = _object(owner, asset_id, 'studio_asset')
        except s.Missing:
            existing = None
        if not existing or existing.get('status') != 'ready' or existing.get('run_id') != id:
            filename, metadata = _download(owner, asset_id, url, 'image')
            s.put(owner, 'studio_asset', {
                **metadata, 'title': (run['title'] or '图片作品') + f' · {index + 1}',
                'asset_type': 'image', 'provider': 'wavespeed', 'service_scope': run['service_scope'],
                'compat': COMPAT['image'], 'status': 'ready', 'run_id': id,
                'draft_id': run['draft_id'], 'draft_version': run['draft_version'], 'local_file': filename,
                'requested_resolution': run['snapshot']['options'].get('resolution'),
            }, asset_id)
        run = _object(owner, id, 'studio_run')
        slot_ids = list(run['batch'][index].get('asset_ids') or [])
        run_ids = list(run.get('asset_ids') or [])
        if asset_id not in slot_ids:slot_ids.append(asset_id)
        if asset_id not in run_ids:run_ids.append(asset_id)
        run = _batch_item(owner, id, index, status='saving', asset_ids=slot_ids,
                          run_values={'asset_ids': run_ids})
    return _batch_item(owner, id, index, status='succeeded', error=None)


def _batch_work(owner, id, run, *, allow_submit):
    if not run.get('batch_submission_done'):
        if not allow_submit:return
        if any(item['status'] != 'queued' for item in run['batch']):
            _batch_interrupt(owner, id, '批量提交被中断；已知任务仍可刷新，未知提交不会重复')
            return
        try:
            model, service = _wavespeed_service(run['model_id'], run['tool'])
            if _scope('wavespeed', service) != run['service_scope']:
                raise StudioError('服务账号或地域已变更，本批次未提交')
            _validate(owner, run['snapshot'], complete=True)
            payload = _wavespeed_payload(owner, run, model, service)
        except Exception as exc:
            _batch_interrupt(owner, id, str(exc) if isinstance(exc, StudioError) else '准备素材失败，本批次未提交')
            return
        path = '/api/v3/' + model['api_model_id']
        for index in range(len(run['batch'])):
            try:
                _, current_service = _wavespeed_service(run['model_id'], run['tool'])
                if _scope('wavespeed', current_service) != run['service_scope']:
                    raise StudioError('服务连接已变更')
            except Exception:
                _batch_stop(owner, id, index, 'not_submitted', '服务配置已变更，剩余图片未提交；已知任务仍可核查')
                return
            _batch_item(owner, id, index, status='submitting', submitted_at=s.now())
            try:
                response = _wavespeed_api(service, 'POST', path, payload)
                task_id = _text(response.get('id'), '供应商任务ID', 500)
            except Rejected as exc:
                _batch_stop(owner, id, index, 'failed', str(exc))
                return
            except Exception:
                _batch_stop(owner, id, index, 'unknown', '本张提交结果未知，可能已计费；后续图片未提交，请核查供应商账单')
                return
            _batch_item(owner, id, index, status='running', task_id=task_id, error=None)
        current = _object(owner, id, 'studio_run')
        _batch_write(owner, id, current['batch'], batch_submission_done=True, error=None)
        return

    try:
        _, service = _wavespeed_service(run['model_id'], run['tool'], active=False)
        if _scope('wavespeed', service) != run['service_scope']:
            raise StudioError('服务账号或地域已变更，请恢复原连接后核查；不会重复提交')
    except Exception as exc:
        _update(owner, id, error=str(exc) if isinstance(exc, StudioError) else '原服务连接不可用，任务ID已保留')
        return
    for index in range(len(run['batch'])):
        current = _object(owner, id, 'studio_run')
        item = current['batch'][index]
        if item['status'] in ('saving', 'archive_failed') and item.get('urls'):
            try:_batch_archive(owner, id, index)
            except Exception:_batch_item(owner, id, index, status='archive_failed', error='结果保存失败；刷新只重试下载，不重复生成')
            continue
        if item['status'] not in ('running', 'unknown') or not item.get('task_id'):
            continue
        try:
            status, result = _poll({**current, 'task_id': item['task_id']}, service)
        except Exception:
            _batch_item(owner, id, index, error='查询原任务暂时失败，可稍后继续核查')
            continue
        if status == 'succeeded':
            urls = result.get('urls') or []
            _batch_item(owner, id, index, status='saving', urls=urls, error=None)
            try:_batch_archive(owner, id, index)
            except Exception:_batch_item(owner, id, index, status='archive_failed', error='结果保存失败；刷新只重试下载，不重复生成')
        elif status == 'failed':
            _batch_item(owner, id, index, status='failed', error='供应商任务失败；费用以供应商账单为准')
        elif status == 'unknown':
            _batch_item(owner, id, index, status='unknown', error='供应商任务状态未知，请核查任务ID')
        else:
            _batch_item(owner, id, index, status='running', error=None)


def _work(owner, id, batch_refresh=False):
    if not _claim(owner, id):
        return
    phase = 'prepare'
    try:
        run = _object(owner, id, 'studio_run')
        if isinstance(run.get('batch'), list):
            _batch_work(owner, id, run, allow_submit=not batch_refresh)
            return
        if run['status'] in ('succeeded', 'failed', 'cancelled', 'expired'):
            return
        if run.get('result'):
            phase = 'archive'
            _archive(owner, run)
            return
        # Refresh only inspects an existing provider task or archives an existing
        # result. An interrupted run needs a new explicit generate request ID.
        if not run.get('task_id') and (batch_refresh or run['status'] == 'interrupted'):
            return
        if run['provider']=='images':
            from . import illustrations
            if run['status'] in ('submitting','unknown'):
                _update(owner,id,status='unknown',error='上次图片提交结果未知，不会自动重复生成；请核查服务账单')
                return
            m,p=g.model_record(run['model_id'])
            if _scope('images',p)!=run['service_scope']:raise StudioError('模型服务配置已变更，请恢复原连接后继续')
            _update(owner,id,status='submitting');phase='submit'
            inputs=run['snapshot']['input']
            ref_ids=(inputs.get('image_ids') or [inputs['image_id']]) if run['tool']=='image_edit' else (inputs.get('image_ids') or ([inputs['image_id']] if inputs.get('image_id') else []))
            layered=_layered_image(owner,inputs) if run['tool']=='image_edit' else None
            references=[layered[0] if index==0 and layered else _path(owner,_asset(owner,ref_id,'image',run['tool'])['local_file']).read_bytes() for index,ref_id in enumerate(ref_ids)]
            marks=(inputs.get('edit_marks') or []) if run['tool']=='image_edit' else []
            if marks:
                guide,_=_annotation_guide(owner,inputs['image_id'],marks,layered[0] if layered else None)
                references.append(guide)
            kwargs={}
            if references:kwargs['reference']=references if len(references)>1 else references[0]
            if run['snapshot']['options'].get('quality'):kwargs['quality']=run['snapshot']['options']['quality']
            uri=illustrations.generate(run['model_id'],_guided_prompt(inputs['prompt']) if marks else inputs['prompt'],run['snapshot']['options'].get('size','1024x1024'),**kwargs)
            phase='archive'
            run=_update(owner,id,result={'asset_type':'image','data_uri':uri},status='running')
            _archive(owner,run)
            return
        if run['provider'] in ('wavespeed','ark'):
            model,service=_wavespeed_service(run['model_id'],run['tool'],active=bool(not run.get('task_id') and not run.get('result')))
        else:service = _service(run['provider'])
        if _scope(run['provider'], service) != run['service_scope']:
            raise StudioError('服务账号或地域已变更，请恢复原配置后刷新；不重复提交')
        if run.get('task_id'):
            phase = 'poll'
            status, result = _poll(run, service)
            if status == 'succeeded':
                run = _update(owner, id, result=result, status='running')
                phase = 'archive'
                _archive(owner, run)
            else:
                _update(owner, id, status=status, error=result.get('error') or ('供应商任务状态未知，请核查原任务，勿重复提交' if status == 'unknown' else None))
            return
        if run['status'] in ('submitting', 'unknown'):
            _update(owner, id, status='unknown', error='上次提交结果未知且未取得任务ID，请联系供应商核查；不会自动重复扣费')
            return
        if run['provider'] == 'hifly':
            if not _hifly_transition(owner, id, 'preparing'):
                return
        else:
            _update(owner, id, status='preparing', error=None)
        _validate(owner, run['snapshot'], complete=True)
        if run['provider']=='ark':
            payload = _ark_payload(owner,run,model,service)
            path = ark_video.TASKS
        elif run['provider']=='wavespeed':
            payload=_wavespeed_payload(owner,run,model,service)
            path='/api/v3/'+model['api_model_id']
        else:path, payload, asynchronous = _build(owner, run['snapshot'], service)
        if run['provider'] == 'hifly':
            if not _hifly_transition(owner, id, 'submitting'):
                return
        else:
            _update(owner, id, status='submitting')
        phase = 'submit'
        value = _ark_api(service,'POST',path,payload) if run['provider']=='ark' else _wavespeed_api(service,'POST',path,payload) if run['provider']=='wavespeed' else _api(run['provider'], 'POST', path, payload, service, asynchronous)
        if run['provider'] == 'aliyun' and run['tool'] in ('text_image', 'image_edit'):
            urls = [c['image'] for choice in value['output']['choices'] for c in choice['message']['content'] if c.get('image')]
            run = _update(owner, id, result={'asset_type': 'image', 'urls': urls}, status='running', provider_request_id=value.get('request_id'))
            phase = 'archive'
            _archive(owner, run)
        else:
            task = value['id'] if run['provider'] in ('wavespeed','ark') else value['response']['id'] if run['provider'] == 'shotstack' else value['output']['task_id'] if run['provider'] == 'aliyun' else value['task_id']
            _update(owner, id, task_id=_text(task, '供应商任务ID', 500), status='running', submitted_at=s.now(), error=None)
    except PendingUpload as exc:
        if s.get(owner, id)['status'] != 'cancelled':
            _update(owner, id, status='interrupted', error=str(exc) + '；生成尚未提交。核查不会提交，请确认重新生成以创建新任务编号')
    except Exception as exc:
        current = s.get(owner, id)
        if current['status'] == 'cancelled':
            return
        if isinstance(current.get('batch'), list):
            _batch_interrupt(owner, id, '批量任务处理被中断；已知任务可刷新，未知提交不会重提')
            return
        status = 'archive_failed' if phase == 'archive' else 'unknown' if phase == 'submit' and not isinstance(exc, Rejected) else current['status'] if current.get('task_id') or current['status'] == 'unknown' else 'failed'
        message = str(exc) if isinstance(exc, (StudioError, ark_video.ArkError)) else '媒体处理失败，已保留原始输入及任务；网络提交结果未知时不会自动重提'
        _update(owner, id, status=status, error=message)
    finally:
        _update(owner, id, busy_until=0, last_checked_at=s.now())


def refresh(owner, id, enqueue=None):
    run = _object(owner, id, 'studio_run')
    if run['status'] in ('succeeded', 'failed', 'cancelled', 'expired') or run.get('busy_until', 0) > time.time():
        return _public(run)
    if enqueue is None:
        jobs.POOL.submit(_work, owner, id, True)
    else:
        enqueue(owner, id)
    return _public(s.get(owner, id))


def cancel(owner, id):
    run = _object(owner, id, 'studio_run')
    if run.get('provider') == 'hifly':
        if run['status'] in ('cancelled', 'failed', 'succeeded'):
            return _public(run)
        if not _hifly_transition(owner, id, 'cancelled'):
            raise StudioError('飞影任务已提交或结果待核查，官方未提供任务取消接口；原任务将继续查询，取消不代表退款')
        return _public(_update(owner, id, finished_at=s.now()))
    if run.get('provider') != 'ark':raise StudioError('仅支持取消官方方舟视频排队任务')
    if run['status'] in ('cancelled','expired','failed','succeeded'):return _public(run)
    if not _claim(owner, id):raise StudioError('后台正在处理此任务，请稍后再取消')
    try:
        run = _object(owner, id, 'studio_run')
        if not run.get('task_id'):
            if run['status'] != 'queued':raise StudioError('提交结果待核查，请先核查原任务')
        else:
            _, service = _wavespeed_service(run['model_id'], run['tool'], active=False)
            if _scope('ark', service) != run['service_scope']:raise StudioError('服务账号已变更，请恢复原配置')
            status, _ = _poll(run, service)
            if status != 'queued':raise StudioError('官方只允许取消排队中的任务，正在生成的任务不能取消')
            _ark_api(service, 'DELETE', ark_video.TASKS + '/' + quote(run['task_id'], safe=''))
        return _public(_update(owner, id, status='cancelled', finished_at=s.now(), error=None))
    finally:_update(owner, id, busy_until=0)


def tick():
    """Follow existing Ark/Hifly tasks and save results without resubmitting."""
    with s.conn() as c:
        rows = [(row['owner'], s.unpack(row)) for row in c.execute("SELECT * FROM objects WHERE kind='studio_run'")]
    count = 0
    for owner, run in rows:
        if run.get('provider') not in ('ark', 'hifly') or run.get('status') in ('succeeded', 'failed', 'cancelled', 'expired'):
            continue
        if not run.get('task_id') or run.get('busy_until', 0) > time.time():
            continue
        elapsed = time.time() - datetime.fromisoformat(run.get('submitted_at') or run['created']).timestamp()
        if run['provider'] == 'hifly' and not run.get('result') and elapsed > HIFLY_POLL_TIMEOUT:
            if not run.get('polling_paused'):
                _update(owner, run['id'], status='unknown', polling_paused=True,
                        error='飞影任务超过本地24小时自动监控期限；任务ID已保留，可手动核查原任务，不会重新提交')
            continue
        if run['provider'] == 'ark' and not run.get('result') and elapsed > 7 * 86400:
            _update(owner, run['id'], status='expired', error='官方任务记录已超过7天有效期；原输入已保留，不会重新提交生成')
            continue
        jobs.POOL.submit(_work, owner, run['id'], True)
        count += 1
    return count


def recover():
    """Call once after store.init(), before accepting requests on app startup.

    Never enqueue paid work here. Pollable task IDs and archived result pointers
    survive restarts; the background watcher only follows existing task IDs.
    """
    with s.conn() as c:
        rows = [(row['owner'], s.unpack(row)) for row in c.execute("SELECT * FROM objects WHERE kind='studio_run'")]
    count = 0
    for owner, run in rows:
        if isinstance(run.get('batch'), list):
            batch = [dict(item) for item in run['batch']]
            for item in batch:
                if item['status'] == 'submitting' and not item.get('task_id'):
                    item.update(status='unknown', error='服务重启时提交结果未知，可能已计费；不会重复提交')
                elif item['status'] == 'submitting' and item.get('task_id'):
                    item.update(status='running', error=None)
                elif item['status'] == 'queued':
                    item.update(status='not_submitted', error='服务重启前未提交，不会计费')
                elif item['status'] == 'saving' and item.get('urls'):
                    item.update(status='archive_failed', error='结果已返回，刷新继续保存')
            if batch != run['batch'] or run.get('busy_until') or not run.get('batch_submission_done'):
                _batch_write(owner, run['id'], batch, batch_submission_done=True, busy_until=0,
                             recovered_at=s.now(), error='服务已重启；仅核查已知供应商任务，不会补发生成')
                count += 1
            continue
        status = run.get('status')
        changes = {'busy_until': 0}
        if run.get('result') and status not in ('succeeded', 'failed', 'cancelled', 'expired'):
            changes.update(status='archive_failed', error='服务已重启，原结果已保留；刷新仅继续下载归档')
        elif run.get('task_id') and status not in ('succeeded', 'failed', 'cancelled', 'expired'):
            changes.update(status='running', error='服务已重启，供应商任务ID已保留；刷新查询原任务')
        elif status in ('submitting', 'unknown'):
            changes.update(status='unknown', error='提交期间服务重启，供应商结果未知；请核查原任务，禁止自动重复扣费')
        elif status in ('queued', 'preparing'):
            changes.update(status='interrupted', error='服务重启前尚未提交生成；核查不会提交。若要继续，请确认重新生成以创建新任务编号')
        if changes != {'busy_until': 0} or run.get('busy_until'):
            _update(owner, run['id'], **changes, recovered_at=s.now())
            count += 1
    with s.conn() as c:
        assets = [(row['owner'], s.unpack(row)) for row in c.execute("SELECT * FROM objects WHERE kind='studio_asset'")]
        libraries = [(row['owner'], s.unpack(row)) for row in c.execute("SELECT * FROM objects WHERE kind='studio_library'")]
    for owner, asset in assets:
        if asset.get('upload_until') or asset.get('upload_status') in ('queued', 'uploading'):
            s.put(owner, 'studio_asset', {**asset, 'upload_until': 0, 'upload_status': 'interrupted',
                  'error': '服务重启，云端上传未确认；本地文件已保留，生成时可重新上传'}, asset['id'])
    for owner, library in libraries:
        if library.get('status') in ('queued', 'running'):
            s.put(owner, 'studio_library', {**library, 'status': 'interrupted',
                  'error': '服务重启，公共库刷新中断；已导入资源保留'}, library['id'])
    return count


def public_resources(owner, asset_type, service=None):
    if asset_type not in ('avatar', 'voice'):
        raise StudioError('公共库只支持形象或声音')
    service = service or _service('hifly')
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


def _library_id(owner, asset_type, scope):
    return s.digest('hifly-public-library:' + owner + ':' + asset_type + ':' + scope)


def _queue_public_resources(owner, asset_type, enqueue=None):
    if asset_type not in ('avatar', 'voice'):
        raise StudioError('公共库只支持形象或声音')
    scope = _scope('hifly', _service('hifly'))
    id = _library_id(owner, asset_type, scope)
    with s.LOCK:
        try: previous = _object(owner, id, 'studio_library')
        except s.Missing: previous = {}
        if previous.get('status') in ('queued', 'running'):
            return
        s.put(owner, 'studio_library', {'asset_type': asset_type, 'service_scope': scope, 'status': 'queued'}, id)
    if enqueue is None:
        jobs.POOL.submit(_refresh_public_resources, owner, id)
    else:
        enqueue(owner, id)


def _refresh_public_resources(owner, id):
    library = _object(owner, id, 'studio_library')
    try:
        service = _service('hifly')
        if _scope('hifly', service) != library['service_scope']:
            raise StudioError('服务账号已变更，请重新刷新公共库')
        s.put(owner, 'studio_library', {**library, 'status': 'running'}, id)
        public_resources(owner, library['asset_type'], service)
        s.put(owner, 'studio_library', {**library, 'status': 'ready', 'finished_at': s.now()}, id)
    except Exception:
        s.put(owner, 'studio_library', {**library, 'status': 'failed',
              'error': '飞影公共库刷新失败；已保存的资源保留，请检查服务配置后重试'}, id)


def _background_enqueue(background_tasks, fn):
    # Real executors only start after the response is sent. Deterministic test
    # pools may execute inline, but production provider work always uses POOL.
    if isinstance(jobs.POOL, Executor):
        return lambda owner, id: background_tasks.add_task(jobs.POOL.submit, fn, owner, id)
    return None


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
        except media_registry.RegistryError as exc:
            return error(400, str(exc))
        except (ValueError, KeyError, TypeError, httpx.HTTPError, OSError):
            return error(400, '媒体请求失败，请检查字段、素材及服务配置')

    @app.get('/api/studio/catalog')
    def catalog(u=Depends(user)):
        migrate_video_bindings()
        providers = settings()['providers']
        configured = {p['provider']: p['has_key'] and p['enabled'] for p in providers}
        tools=[];bindings=s.config('bindings',{})
        for id,(title,provider,kind,required) in TOOLS.items():
            binding=bindings.get(id,'service:'+provider);ready=bool(binding) and configured.get(provider, False);model=MODELS.get(id)
            if provider == 'hifly':
                binding = selection(id)
                ready = bool(binding) and configured.get(provider, False)
            if id in media_registry.VIDEO_TOOLS:
                binding=selection(id)
                provider='media_registry'
                selected=next((m for m in model_choices(id) if m['id']==binding),None)
                ready=bool(selected and selected['configured'])
                model=None
                options=selected['options'] if selected else {}
                tools.append({'id':id,'title':title,'provider':provider,'output_type':kind,'required':required,'options':options,'models':model_choices(id),'optional':[], 'model':model,'configured':ready,'binding':binding,'status':'ready' if ready else 'unconfigured','reason':'请在管理后台配置火山方舟官方API Key并开通Seedance模型' if not ready else '', 'verification':'documented_not_live','requires_confirmation':True})
                continue
            if binding.startswith('media:'):
                selected=next((m for m in model_choices(id) if m['id']==binding),None)
                ready=bool(selected and selected['configured'])
                provider='media_registry'
                tools.append({'id':id,'title':title,'provider':provider,'output_type':kind,'required':required,'options':selected['options'] if selected else {},'models':model_choices(id),'optional':[], 'model':None,'configured':ready,'binding':binding,'status':'ready' if ready else 'unconfigured','reason':'' if ready else '该模型尚未配置密钥或接口未适配；可以保存草稿','verification':'documented_not_live' if ready else 'not_integrated','requires_confirmation':True})
                continue
            if bound_image(id):
                try:
                    validate_binding(id,binding);m,p=g.model_record(binding);model=m['title'];ready=True
                except ValueError:ready=False
                provider='images'
            try: options=tool_options(id)
            except (ValueError,KeyError):options={}
            contract = {}
            if provider == 'hifly':
                contract = {'async': True, 'api_version': 'v2'}
                if id == 'avatar_create':
                    contract['input_alternatives'] = [['image_id'], ['video_id']]
                    contract['require_any'] = ['image_id', 'video_id']
                    contract['exclusive_inputs'] = True
                    contract['creation_modes'] = [
                        {'id': 'image', 'input': 'image_id', 'options': OPTIONS['avatar_create'], 'default_options': {'model': 2}},
                        {'id': 'video', 'input': 'video_id', 'options': {}, 'formats': ['mp4', 'mov'],
                         'video_codec': 'h264', 'max_bytes': MAX_FILE, 'duration': [5, 1800], 'min_dimension': 360, 'max_dimension': 4096}]
                elif id in ('text_avatar', 'audio_avatar'):
                    contract['input_alternatives'] = [required, ['text', 'video_id'] if id == 'text_avatar' else ['audio_id', 'video_id']]
                    contract['require_any'] = ['avatar_id', 'video_id']
                    contract['exclusive_inputs'] = True
                elif id == 'photo_talk':
                    contract['default_options'] = {'model': 5}
                if bindings.get(id) and bindings[id] != 'service:hifly':
                    contract.update(legacy_binding=bindings[id], migration_notice='此功能已改用飞影 API v2；旧模型配置和历史保留，请按飞影字段重新选择素材')
            tools.append({'id':id,'title':title,'provider':provider,'output_type':kind,'required':required,'options':options,'models':model_choices(id),'optional':['image_id','video_id'] if id=='avatar_create' else ['video_id'] if id in ('text_avatar','audio_avatar') else ['image_id'] if id=='text_image' and bound_image(id) else [],'model':model,'configured':ready,'binding':binding,'verification':'documented_not_live','requires_confirmation':True, **contract})
        return {'tools':tools,
                'providers': providers, 'billing_notice': '生成和云端处理可能计费；确认后才提交，费用以供应商账号及模型为准。接口按公开文档接入，尚未完成本账号真实联调。'}

    @app.get('/api/studio/settings')
    def get_settings(u=Depends(admin)):
        return settings()

    @app.post('/api/studio/settings')
    def set_settings(data: dict, u=Depends(admin)):
        return invoke(save_settings, data)

    @app.get('/api/admin/media-registry')
    def media_registry_state(u=Depends(admin)):
        return media_registry.catalogue()

    @app.post('/api/admin/media-registry/providers')
    def media_registry_provider(data: dict, u=Depends(admin)):
        result=invoke(media_registry.save_provider,data)
        s.audit(u['id'],'save_media_provider',data.get('id',''))
        return result

    @app.post('/api/admin/media-registry/models')
    def media_registry_model(data: dict, u=Depends(admin)):
        result=invoke(media_registry.save_model,data)
        s.audit(u['id'],'save_media_model',data.get('id',''))
        return result

    @app.post('/api/admin/media-registry/providers/{id}/discover')
    def media_registry_discover(id: str, u=Depends(admin)):
        result=invoke(media_registry.discover_provider,id)
        s.audit(u['id'],'discover_media_models',id)
        return result

    @app.get('/api/studio/drafts')
    def drafts(u=Depends(user)):
        return invoke(lambda: {'items': [migrate_video_draft(u['id'], d) for d in s.list_(u['id'], 'studio_draft')]})

    @app.post('/api/studio/drafts')
    def create(data: dict, u=Depends(user)):
        return invoke(save_draft, u['id'], data)

    @app.patch('/api/studio/drafts/{id}')
    def patch(id: str, data: dict, u=Depends(user)):
        return invoke(save_draft, u['id'], data, id)

    @app.post('/api/studio/upload')
    def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...), provider: str | None = None, confirmed: bool = False, u=Depends(user)):
        try:
            return invoke(upload, u['id'], file, provider, confirmed, _background_enqueue(background_tasks, _upload_hifly))
        finally:
            file.file.close()

    @app.get('/api/studio/assets')
    def assets(background_tasks: BackgroundTasks, asset_type: str | None = None, refresh: bool = False, u=Depends(user)):
        if refresh:
            invoke(_queue_public_resources, u['id'], asset_type, _background_enqueue(background_tasks, _refresh_public_resources))
        library = {}
        if asset_type in ('avatar', 'voice'):
            service = s.config(CONFIG, {}).get('hifly', {})
            if service.get('secret'):
                try: library = _object(u['id'], _library_id(u['id'], asset_type, _scope('hifly', service)), 'studio_library')
                except s.Missing: pass
        return {'items': [_public(x) for x in s.list_(u['id'], 'studio_asset') if not asset_type or x.get('asset_type') == asset_type],
                'public_library_complete': False, 'public_library_status': library.get('status', 'idle'),
                'public_library_error': library.get('error')}

    @app.post('/api/studio/generate')
    def submit(data: dict, background_tasks: BackgroundTasks, u=Depends(user)):
        # An actual executor starts only after ASGI sends the run ID. Synchronous
        # fixture pools still execute inline for existing deterministic tests.
        enqueue = _background_enqueue(background_tasks, _work)
        return invoke(generate, u['id'], data, enqueue)

    @app.get('/api/studio/runs')
    def runs(u=Depends(user)):
        # History needs metadata and result presence, never the archived image's
        # Base64. Drop that blob in SQL before decoding; do not change storage.
        with s.conn() as c:
            rows = c.execute("""SELECT id,kind,version,updated,
                json_replace(data,'$.result.data_uri',length(json_extract(data,'$.result.data_uri'))>0) AS data
                FROM objects WHERE owner=? AND kind='studio_run' ORDER BY updated DESC""", (u['id'],)).fetchall()
            configured = c.execute("SELECT value FROM config WHERE key='models'").fetchone()
            models = json.loads(configured['value']) if configured else []
        return {'items': [_public(s.unpack(row), models) for row in rows]}

    @app.post('/api/studio/runs/{id}/refresh')
    def refresh_run(id: str, background_tasks: BackgroundTasks, u=Depends(user)):
        return invoke(refresh, u['id'], id, _background_enqueue(background_tasks, lambda owner, run_id: _work(owner, run_id, True)))

    @app.post('/api/studio/runs/{id}/cancel')
    def cancel_run(id: str, u=Depends(user)):
        return invoke(cancel, u['id'], id)

    @app.get('/api/studio/assets/{id}/thumbnail')
    def asset_thumbnail(id: str, u=Depends(user)):
        def get_thumbnail():
            # Authorize every request before reading a local image. Originals
            # remain untouched and are still used for generation and download.
            asset = _object(u['id'], id, 'studio_asset')
            path = _path(u['id'], asset.get('local_file'))
            if asset.get('asset_type') != 'image' or asset.get('status') != 'ready' or not path.is_file():
                raise s.Missing()
            with Image.open(path) as picture:
                picture.thumbnail((320, 320))
                picture = ImageOps.exif_transpose(picture).convert('RGBA')
                background = Image.new('RGB', picture.size, 'white')
                background.paste(picture, mask=picture.getchannel('A'))
                output = io.BytesIO()
                background.save(output, format='JPEG', quality=78)
            return Response(output.getvalue(), media_type='image/jpeg', headers={
                'Cache-Control': 'private, max-age=3600', 'Vary': 'Authorization',
                'X-Content-Type-Options': 'nosniff',
            })
        return invoke(get_thumbnail)

    @app.get('/api/studio/assets/{id}/file')
    def asset_file(id: str, u=Depends(user)):
        def get_file():
            asset = _object(u['id'], id, 'studio_asset')
            path = _path(u['id'], asset.get('local_file'))
            if not path.is_file() or asset.get('status') != 'ready':
                raise s.Missing()
            return FileResponse(path, media_type=asset['mime_type'], filename=path.name, headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
        return invoke(get_file)
