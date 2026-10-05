"""Official Ark Seedance contract. No reseller routing or automatic paid retries.

Spec: https://docs.volcengine.com/docs/ark/create-video-generation-task-api
"""
import base64
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import urlsplit

from . import gateway as g, network

BASE_URL = 'https://ark.cn-beijing.volces.com'
TASKS = '/api/v3/contents/generations/tasks'
DEFAULT_MODEL = 'media:ark-seedance-25'
LIMITS = {
    'seedance-2.5': {'image': 30, 'video': 10, 'audio': 10, 'duration': 30},
    'seedance-2.0': {'image': 9, 'video': 3, 'audio': 3, 'duration': 15},
    'seedance-2.0-fast': {'image': 9, 'video': 3, 'audio': 3, 'duration': 15},
    'seedance-2.0-mini': {'image': 9, 'video': 3, 'audio': 3, 'duration': 15},
}
MODES = ['text', 'reference', 'first_frame', 'first_last_frame', 'edit', 'extend']


class ArkError(ValueError):
    pass


def options(model):
    family = model['family']
    latest = family == 'seedance-2.5'
    resolutions = ['480p', '720p']
    if family in ('seedance-2.5', 'seedance-2.0'):
        resolutions.append('1080p')
    if family == 'seedance-2.0':
        resolutions.append('4k')
    return {
        'resolution': resolutions,
        'ratio': ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', 'adaptive'],
        'duration': [-1, *range(4, LIMITS[family]['duration'] + 1)],
        'generate_audio': [True, False], 'watermark': [False, True],
        'return_last_frame': [False, True], 'web_search': [False, True],
        'priority': list(range(10)),
        **({'output_format': ['mp4', 'mov'], 'draft': [False, True]} if latest else {}),
    }


def public_url(value):
    if not isinstance(value, str) or len(value) > 8192:
        raise ArkError('参考素材地址无效')
    if re.fullmatch(r'asset://[A-Za-z0-9_-]{1,200}', value):
        return value
    p = urlsplit(value)
    if p.scheme != 'https' or p.username or p.password or not p.hostname or p.fragment:
        raise ArkError('请输入公开 HTTPS 素材地址或方舟 asset://素材ID')
    network.public_url(value)
    return value


def storage_ready(service):
    return all(service.get(k) for k in ('tos_bucket', 'tos_region', 'tos_access_secret', 'tos_secret'))


def references(inputs):
    result = []
    for kind in ('image', 'video', 'audio'):
        ids = inputs.get(kind + '_ids') or ([inputs['image_id']] if kind == 'image' and inputs.get('image_id') else [])
        result.extend({'kind': kind, 'id': id} for id in ids)
    remote = inputs.get('remote_references', [])
    if not isinstance(remote, list) or len(remote) > 50:
        raise ArkError('外部参考素材列表无效')
    for ref in remote:
        if not isinstance(ref, dict) or set(ref) - {'kind', 'url', 'title', 'duration'} or ref.get('kind') not in ('image', 'video', 'audio'):
            raise ArkError('外部素材类型无效')
        public_url(ref.get('url'))
        if 'duration' in ref and (type(ref['duration']) not in (int, float) or not math.isfinite(ref['duration']) or ref['duration'] <= 0):
            raise ArkError('参考素材时长无效')
        if not isinstance(ref.get('title', ''), str) or len(ref.get('title', '')) > 200:
            raise ArkError('参考素材名称无效')
        result.append(ref)
    return result


def validate(model, inputs, opts, asset_lookup, *, complete=False, service=None):
    family = model['family']
    limits = LIMITS[family]
    mode = inputs.get('reference_mode', 'reference')
    if mode not in MODES:
        raise ArkError('视频创作方式无效')
    if mode in ('edit', 'extend') and family != 'seedance-2.5':
        raise ArkError('视频编辑和延长需要 Seedance 2.5')
    allowed = options(model)
    for key, value in opts.items():
        if key in allowed:
            if type(value) not in (str, int, bool) or not any(type(value) is type(x) and value == x for x in allowed[key]):
                raise ArkError('方舟模型不支持此参数：' + key)
        elif key == 'execution_expires_after':
            if type(value) is not int or not 3600 <= value <= 259200:
                raise ArkError('任务有效期须为1至72小时')
        elif key == 'callback_url':
            if not isinstance(value, str):
                raise ArkError('回调地址须为 HTTPS 字符串')
            if value:
                public_url(value)
                if value.startswith('asset:'):
                    raise ArkError('回调地址须为 HTTPS')
        else:
            raise ArkError('方舟模型不支持此参数：' + key)
    if opts.get('draft') and opts.get('resolution', '480p') != '480p':
        raise ArkError('样片模式仅支持480p；正式视频可再选择清晰度')
    if inputs.get('draft_run'):
        if family != 'seedance-2.5' or set(opts) - {'resolution', 'watermark', 'output_format', 'return_last_frame', 'priority', 'execution_expires_after', 'callback_url'}:
            raise ArkError('基于样片生成正式视频时，不能重新指定镜头、时长、比例或声音')
        if any(inputs.get(k) for k in ('prompt', 'image_id', 'image_ids', 'video_ids', 'audio_ids', 'remote_references')):
            raise ArkError('样片转正式视频不能同时提交提示词或参考素材')
        return []
    refs = references(inputs)
    counts = {kind: sum(ref['kind'] == kind for ref in refs) for kind in ('image', 'video', 'audio')}
    if any(counts[kind] > limits[kind] for kind in counts):
        raise ArkError('参考素材合计超过所选 Seedance 版本上限')
    if not complete:
        return refs
    if not refs and not str(inputs.get('prompt') or '').strip():
        raise ArkError('请填写提示词或添加参考素材')
    if mode == 'text' and (refs or not str(inputs.get('prompt') or '').strip()):
        raise ArkError('文字生视频需要提示词；有素材时请选择参考生视频')
    if mode in ('first_frame', 'first_last_frame'):
        if counts['image'] != (1 if mode == 'first_frame' else 2) or counts['video'] or counts['audio']:
            raise ArkError('首帧模式需要1张图片，首尾帧需要2张图片，不能混用其他参考素材')
    if mode in ('edit', 'extend') and not counts['video']:
        raise ArkError('请加入需要编辑或延长的参考视频')
    if family != 'seedance-2.5' and counts['audio'] and not (counts['video'] or counts['image']):
        raise ArkError('Seedance 2.0音频参考需同时加入图片或视频；纯音频参考可使用2.5')
    locked_ratio = family == 'seedance-2.5' and mode in ('first_frame', 'first_last_frame', 'edit', 'extend')
    if locked_ratio and opts.get('ratio', 'adaptive') != 'adaptive':
        raise ArkError('此创作方式按原素材保持比例，请选择自动适配')
    if mode == 'edit' and opts.get('duration', -1) != -1:
        raise ArkError('视频编辑按原视频保持时长，请选择智能时长')
    totals = {'video': 0, 'audio': 0}
    inline_bytes = 0
    for ref in refs:
        kind = ref['kind']
        if not ref.get('id'):
            if kind in totals and ref.get('duration'):
                minimum = 4 if kind == 'video' and mode == 'edit' else 2
                if not minimum <= ref['duration'] <= limits['duration']:
                    raise ArkError('外部参考素材时长超出官方范围')
                totals[kind] += ref['duration']
            continue  # Remote media are inspected by Ark; local metadata is verified here.
        a = asset_lookup(ref['id'], kind)
        size = a.get('size', 0)
        ext = Path(a.get('local_file', '')).suffix.lower()
        if kind == 'image':
            if ext not in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.gif') or size >= 30 * 1024 * 1024:
                raise ArkError('参考图片须为PNG/JPEG/WebP/BMP/TIFF/GIF且小于30MB')
        elif kind == 'audio':
            if ext not in ('.mp3', '.wav') or size > 15 * 1024 * 1024:
                raise ArkError('方舟音频参考仅支持MP3/WAV且不超过15MB')
        else:
            if ext not in ('.mp4', '.mov') or size > 200 * 1024 * 1024 or a.get('video_codec') not in ('h264', 'hevc'):
                raise ArkError('参考视频须为H.264/H.265的MP4/MOV且不超过200MB')
            if not 24 <= (a.get('fps') or 0) <= 60:
                raise ArkError('参考视频帧率须为24至60FPS，请转码后重新上传')
            if service is not None and not storage_ready(service):
                raise ArkError('本地参考视频需在管理后台配置火山TOS；也可使用公开HTTPS视频地址或方舟素材ID')
        if kind in ('image', 'video'):
            w, h = a.get('width') or 0, a.get('height') or 0
            if not (300 <= w <= 6000 and 300 <= h <= 6000 and .4 <= w / h <= 2.5):
                raise ArkError('参考画面宽高须为300至6000像素，宽高比0.4至2.5')
            if kind == 'video' and not 407696 <= w * h <= 8295044:
                raise ArkError('参考视频像素总数须在官方允许范围内，请调整尺寸后上传')
        if kind in totals:
            duration = a.get('duration') or 0
            minimum = 4 if kind == 'video' and mode == 'edit' else 2
            if not minimum <= duration <= limits['duration']:
                raise ArkError(f'参考{ "视频" if kind == "video" else "音频" }时长须为{minimum}至{limits["duration"]}秒')
            totals[kind] += duration
        if kind != 'video':
            inline_bytes += (size + 2) // 3 * 4
    if any(total > limits['duration'] + .001 for total in totals.values()):
        raise ArkError(f'参考视频和音频各自总时长不能超过{limits["duration"]}秒')
    if inline_bytes > 63 * 1024 * 1024 and service is not None and not storage_ready(service):
        raise ArkError('参考素材超过官方64MB请求限制，请减少素材或配置火山TOS上传')
    return refs


def media_url(owner, asset, service, path):
    if storage_ready(service):
        import tos
        ak = g.cipher().decrypt(service['tos_access_secret'].encode()).decode()
        sk = g.cipher().decrypt(service['tos_secret'].encode()).decode()
        region = service['tos_region']
        client = tos.TosClientV2(ak, sk, endpoint=f'https://tos-{region}.volces.com', region=region)
        raw_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        key = 'tijian/' + hashlib.sha256(owner.encode()).hexdigest()[:24] + '/' + raw_hash + path.suffix
        try:
            # Stable object key makes a retry of upload replace the same byte-identical object.
            with path.open('rb') as file:
                client.put_object(service['tos_bucket'], key, content=file, content_type=asset['mime_type'])
            return client.pre_signed_url(tos.HttpMethodType.Http_Method_Get, service['tos_bucket'], key, expires=259200).signed_url
        except Exception:
            raise ArkError('火山TOS上传失败，生成尚未提交；请检查桶、地域与访问密钥') from None
        finally:
            client.close()
    mime = asset['mime_type']
    if asset['asset_type'] == 'audio':
        mime = 'audio/mp3' if path.suffix.lower() == '.mp3' else 'audio/wav'
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()


def payload(owner, model, inputs, opts, refs, resolve, *, sample_task=None):
    content = []
    if sample_task:
        content.append({'type': 'draft_task', 'draft_task': {'id': sample_task}})
    else:
        if str(inputs.get('prompt') or '').strip():
            content.append({'type': 'text', 'text': inputs['prompt']})
        image_index = 0
        for ref in refs:
            kind = ref['kind']
            role = 'reference_' + kind
            if kind == 'image':
                if inputs.get('reference_mode') in ('first_frame', 'first_last_frame'):
                    role = 'first_frame' if image_index == 0 else 'last_frame'
                image_index += 1
            url = resolve(ref) if ref.get('id') else ref['url']
            content.append({'type': kind + '_url', kind + '_url': {'url': url}, 'role': role})
    result = {'model': model['api_model_id'], 'content': content,
              'safety_identifier': hashlib.sha256(owner.encode()).hexdigest(),
              **{k: v for k, v in opts.items() if k != 'web_search' and (k != 'callback_url' or v)}}
    if not sample_task:
        for key, value in {'resolution': '720p', 'ratio': 'adaptive', 'duration': -1,
                           'generate_audio': True, 'watermark': False}.items():
            result.setdefault(key, value)
        mode = inputs.get('reference_mode', 'reference')
        if model['family'] == 'seedance-2.5' and refs and mode in ('reference', 'edit', 'extend'):
            result['omni_reference_task_type'] = mode
        if opts.get('web_search'):
            result['tools'] = [{'type': 'web_search'}]
        if opts.get('draft'):
            result['resolution'] = '480p'
    if len(json.dumps(result).encode()) > 64 * 1024 * 1024:
        raise ArkError('参考素材超过官方64MB请求限制，请减少素材或配置TOS')
    return result
