"""Administrative catalogue for intermediary media services.

Entries describe possible integrations.  No entry implies that an API adapter has
been implemented or that a paid generation call can be made.
"""
from urllib.parse import urlsplit
import hashlib
import re
import httpx

from . import gateway as g, network, store as s, ark_video

PROVIDER_KEY = 'media_registry_providers'
MODEL_KEY = 'media_registry_models'
VIDEO_TOOLS = {'text_video', 'image_video'}
IMAGE_TOOLS = {'text_image', 'image_edit'}
DIGITAL_TOOLS = {'text_avatar', 'audio_avatar', 'photo_talk', 'avatar_create'}
TOOLS = VIDEO_TOOLS | IMAGE_TOOLS | DIGITAL_TOOLS
FAMILIES = {
    'seedance-2.0': ('AI 视频', VIDEO_TOOLS),
    'seedance-2.5': ('AI 视频', VIDEO_TOOLS),
    'seedance-2.0-fast': ('AI 视频', VIDEO_TOOLS),
    'seedance-2.0-mini': ('AI 视频', VIDEO_TOOLS),
    'gpt-image-2.5-text': ('AI 生图', {'text_image'}),
    'gpt-image-2.5-edit': ('AI 生图', IMAGE_TOOLS),
    'infinitetalk': ('数字人口播', {'audio_avatar'}),
    'heygen-avatar-v': ('数字人口播', {'text_avatar', 'audio_avatar'}),
    'heygen-avatar-v-create': ('形象克隆', {'avatar_create'}),
}
REFERENCE_LIMITS = {**ark_video.LIMITS, 'gpt-image-2.5-edit': {'image': 16}}
IMAGE_OPTIONS = {'aspect_ratio': ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1', '1:2', '3:1', '1:3', '9:21'], 'resolution': ['1k', '2k', '4k'], 'quality': ['low', 'medium', 'high', 'xhigh', 'max'], 'output_format': ['png', 'jpeg', 'webp']}
IMAGE_BATCH_COUNTS = [1, 2, 3, 4]  # App limit: one separately billed prediction per image.


def options(model):
    family = model['family']
    if family.startswith('seedance-') and model.get('provider_id') == 'ark':
        return ark_video.options(model)
    if family.startswith('seedance-'):
        return {'aspect_ratio': ['16:9','9:16','4:3','3:4','1:1','21:9'], 'resolution': ['480p','720p','1080p','4k'], 'generate_audio': [True,False], 'duration': list(range(4, REFERENCE_LIMITS[family]['duration']+1))}
    if family.startswith('gpt-image-2.5-'):
        return {**IMAGE_OPTIONS, 'n': IMAGE_BATCH_COUNTS}
    return {}


def adapter_ready(model):
    path = model.get('api_model_id', '')
    if model['family'].startswith('seedance-'):
        if model.get('provider_id') != 'ark':
            return model.get('provider_id') == 'wavespeed' and path in ('bytedance/seedance-2.0/text-to-video','bytedance/seedance-2.5/text-to-video')
        prefix = {'seedance-2.5':'doubao-seedance-2-5-', 'seedance-2.0':'doubao-seedance-2-0-', 'seedance-2.0-fast':'doubao-seedance-2-0-fast-', 'seedance-2.0-mini':'doubao-seedance-2-0-mini-'}[model['family']]
        return bool(re.fullmatch(r'ep-[a-zA-Z0-9-]+', path) or re.fullmatch(re.escape(prefix) + r'\d{6}', path))
    if model.get('provider_id') != 'wavespeed':
        return False
    if model['family'] in ('gpt-image-2.5-text', 'gpt-image-2.5-edit'):
        return path in {f'openai/gpt-image-2.5-{tier}/{operation}' for tier in ('flare', 'sunburst') for operation in ('text-to-image', 'edit')} and (path.endswith('/edit') == (model['family'] == 'gpt-image-2.5-edit'))
    return False
PRESET_PROVIDERS = [
    {'id': 'ark', 'title': '火山引擎 · 方舟官方', 'category': 'AI 视频', 'base_url': ark_video.BASE_URL, 'docs_url': 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh', 'published': True},
    {'id': 'segmind', 'title': 'Segmind', 'category': '数字人', 'base_url': 'https://api.segmind.com', 'docs_url': 'https://docs.segmind.com/', 'published': True},
    {'id': 'wavespeed', 'title': 'WaveSpeedAI', 'category': '图片与数字人', 'base_url': 'https://api.wavespeed.ai', 'docs_url': 'https://wavespeed.ai/docs/docs-api', 'published': True},
]
PRESET_MODELS = [
    {'id': 'segmind-seedance-20', 'provider_id': 'segmind', 'title': 'Seedance 2.0', 'family': 'seedance-2.0', 'tools': ['text_video', 'image_video'], 'published': False},
    {'id': 'segmind-seedance-25', 'provider_id': 'segmind', 'title': 'Seedance 2.5', 'family': 'seedance-2.5', 'tools': ['text_video', 'image_video'], 'published': False},
    {'id': 'wavespeed-seedance-20', 'provider_id': 'wavespeed', 'title': 'Seedance 2.0', 'api_model_id': 'bytedance/seedance-2.0/text-to-video', 'family': 'seedance-2.0', 'tools': ['text_video', 'image_video'], 'published': False},
    {'id': 'wavespeed-seedance-25', 'provider_id': 'wavespeed', 'title': 'Seedance 2.5', 'api_model_id': 'bytedance/seedance-2.5/text-to-video', 'family': 'seedance-2.5', 'tools': ['text_video', 'image_video'], 'published': False},
    *[{'id': id, 'provider_id': 'ark', 'title': title, 'api_model_id': api_id, 'family': family, 'tools': ['text_video', 'image_video'], 'published': True}
      for id, title, api_id, family in [
          ('ark-seedance-25', 'Seedance 2.5', 'doubao-seedance-2-5-260628', 'seedance-2.5'),
          ('ark-seedance-20', 'Seedance 2.0', 'doubao-seedance-2-0-260128', 'seedance-2.0'),
          ('ark-seedance-20-fast', 'Seedance 2.0 Fast', 'doubao-seedance-2-0-fast-260128', 'seedance-2.0-fast'),
          ('ark-seedance-20-mini', 'Seedance 2.0 Mini', 'doubao-seedance-2-0-mini-260615', 'seedance-2.0-mini')]],
    *[{'id': f'wavespeed-gpt-image-25-{tier}-{operation}', 'provider_id': 'wavespeed', 'title': f'GPT Image 2.5 {tier.title()} · {"生成" if operation == "text" else "参考图生成"}', 'api_model_id': f'openai/gpt-image-2.5-{tier}/{"text-to-image" if operation == "text" else "edit"}', 'family': f'gpt-image-2.5-{operation}', 'tools': ['text_image'] if operation == 'text' else ['text_image', 'image_edit'], 'published': True} for tier in ('flare', 'sunburst') for operation in ('text', 'edit')],
    {'id': 'wavespeed-infinitetalk', 'provider_id': 'wavespeed', 'title': 'InfiniteTalk（照片+音频）', 'family': 'infinitetalk', 'tools': ['audio_avatar'], 'published': True},
    {'id': 'segmind-heygen-avatar-v', 'provider_id': 'segmind', 'title': 'HeyGen Avatar V', 'family': 'heygen-avatar-v', 'tools': ['text_avatar', 'audio_avatar'], 'published': True},
    {'id': 'segmind-heygen-avatar-create', 'provider_id': 'segmind', 'title': 'HeyGen Avatar V 形象创建', 'family': 'heygen-avatar-v-create', 'tools': ['avatar_create'], 'published': True},
]


class RegistryError(ValueError):
    pass


def _rows(key, presets):
    saved = s.config(key, {})
    rows = [dict(item, **saved.get(item['id'], {})) for item in presets if not saved.get(item['id'], {}).get('archived')]
    if key == MODEL_KEY:
        for row in rows:
            # Existing installations stored the old preset tool list before reference-image generation existed.
            if row['id'].startswith('wavespeed-gpt-image-25-') and row['id'].endswith('-edit') and row.get('tools') == ['image_edit']:
                row['tools'] = ['text_image', 'image_edit']
    return rows + [dict(value, id=id) for id, value in saved.items() if id not in {x['id'] for x in presets} and not value.get('archived')]


def providers():
    return _rows(PROVIDER_KEY, PRESET_PROVIDERS)


def models():
    # One-time shelving retains all account configuration and history. Shared image
    # and digital-human providers remain active. Administrators can re-enable later.
    with s.LOCK:
        if not s.config('ark_video_migrated', False):
            saved = s.config(MODEL_KEY, {})
            for model in _rows(MODEL_KEY, PRESET_MODELS):
                if set(model.get('tools', [])) & VIDEO_TOOLS and model.get('provider_id') != 'ark':
                    saved[model['id']] = {**saved.get(model['id'], {}), 'published': False}
            s.set_config(MODEL_KEY, saved)
            s.set_config('ark_video_migrated', True)
    return _rows(MODEL_KEY, PRESET_MODELS)


def _public_provider(item):
    return {k: v for k, v in item.items() if k not in ('secret', 'tos_access_secret', 'tos_secret')} | {'has_key': bool(item.get('secret')), 'has_tos_key': bool(item.get('tos_access_secret')), 'has_tos_secret': bool(item.get('tos_secret')), 'storage_ready': ark_video.storage_ready(item), 'adapter_ready': item['id'] in ('wavespeed', 'ark')}


def catalogue():
    ps = providers()
    return {'providers': [_public_provider(p) for p in ps],
            'models': [{**m, 'category': FAMILIES[m['family']][0], 'adapter_ready': adapter_ready(m)} for m in models() if m.get('provider_id') in {p['id'] for p in ps}],
            'notice': 'AI 视频默认使用火山方舟官方 Seedance；原中转视频模型保留并下架。配置 API Key 后可测试连接；本地视频参考需配置火山TOS。实际生成由用户确认并按官方账号计费。'}


def _url(value):
    if not isinstance(value, str):
        raise RegistryError('Base URL 格式无效')
    p = urlsplit(value)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.port not in (None, 443) or p.query or p.fragment or p.path not in ('', '/'):
        raise RegistryError('Base URL 必须是无路径、无凭据的 HTTPS 根地址')
    network.public_url(value)
    return value.rstrip('/')


def _id(value):
    import re
    if not isinstance(value, str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,63}', value):
        raise RegistryError('编号只能使用小写字母、数字和连字符')
    return value


def save_provider(data):
    if not isinstance(data, dict) or set(data) - {'id', 'title', 'category', 'base_url', 'api_key', 'published', 'archived', 'docs_url', 'tos_bucket', 'tos_region', 'tos_access_key', 'tos_secret_key'}:
        raise RegistryError('服务字段不受支持')
    id = _id(data.get('id'))
    old = next((p for p in providers() if p['id'] == id), None)
    if not old and not data.get('title'):
        raise RegistryError('新服务需要名称')
    item = dict(old or {})
    for key in ('title', 'category', 'docs_url'):
        if key in data:
            if not isinstance(data[key], str) or len(data[key]) > 200:
                raise RegistryError('服务名称或分类无效')
            item[key] = data[key].strip()
    if item.get('docs_url'):
        docs = urlsplit(item['docs_url'])
        if docs.scheme != 'https' or not docs.hostname or docs.username or docs.password:
            raise RegistryError('接口文档须使用公开 HTTPS 地址')
    if 'base_url' in data:
        item['base_url'] = _url(data['base_url'])
    if not item.get('base_url'):
        raise RegistryError('请填写 Base URL')
    if id == 'ark':
        if item['base_url'] != ark_video.BASE_URL:
            raise RegistryError('AI 视频仅使用火山方舟官方北京服务地址')
        for key in ('tos_bucket', 'tos_region'):
            if key in data:
                val = data[key]
                pattern = r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]' if key == 'tos_bucket' else r'cn-(beijing|shanghai|guangzhou)'
                if not isinstance(val, str) or (val and not re.fullmatch(pattern, val)):
                    raise RegistryError('TOS桶名称或地域无效')
                item[key] = val
        for field, key in [('tos_access_key', 'tos_access_secret'), ('tos_secret_key', 'tos_secret')]:
            if data.get(field):
                if not isinstance(data[field], str) or len(data[field]) > 4096:
                    raise RegistryError('TOS访问密钥无效')
                item[key] = g.cipher().encrypt(data[field].strip().encode()).decode()
    elif any(k.startswith('tos_') for k in data):
        raise RegistryError('TOS设置仅用于火山方舟官方视频')
    for key in ('published', 'archived'):
        if key in data:
            if type(data[key]) is not bool:
                raise RegistryError(key + ' 必须为布尔值')
            item[key] = data[key]
    if item.get('archived'):
        item['published'] = False
    if 'api_key' in data and data['api_key'] not in (None, ''):
        key = data['api_key']
        if not isinstance(key, str) or len(key) > 4096 or not key.strip():
            raise RegistryError('API Key 无效')
        item['secret'] = g.cipher().encrypt(key.encode()).decode()
    item['id'] = id
    saved = s.config(PROVIDER_KEY, {})
    saved[id] = item
    s.set_config(PROVIDER_KEY, saved)
    return _public_provider(item)


def save_model(data):
    if not isinstance(data, dict) or set(data) - {'id', 'provider_id', 'title', 'family', 'tools', 'published', 'archived', 'api_model_id'}:
        raise RegistryError('模型字段不受支持')
    id = _id(data.get('id'))
    old = next((m for m in models() if m['id'] == id), None)
    item = dict(old or {})
    item.update(data)
    provider = next((p for p in providers() if p['id'] == item.get('provider_id')), None)
    if not provider:
        raise RegistryError('请选择已有服务平台')
    if item.get('published') and not provider.get('published'):
        raise RegistryError('请先上架服务平台，才能上架模型')
    family = item.get('family')
    if family not in FAMILIES:
        raise RegistryError('模型类别不受支持')
    if family.startswith('seedance-') and item.get('provider_id') == 'ark' and not adapter_ready(item):
        raise RegistryError('模型ID与Seedance版本不匹配；可使用对应的官方ID或ep-接入点ID')
    tools = item.get('tools')
    if not isinstance(tools, list) or not tools or any(not isinstance(t, str) for t in tools) or len(tools) != len(set(tools)) or not set(tools) <= FAMILIES[family][1]:
        raise RegistryError('功能绑定与模型类别不匹配')
    if not isinstance(item.get('title'), str) or not 0 < len(item['title'].strip()) <= 100:
        raise RegistryError('模型名称无效')
    if 'api_model_id' in item and (not isinstance(item['api_model_id'], str) or len(item['api_model_id']) > 200 or not re.fullmatch(r'[a-zA-Z0-9/._-]+', item['api_model_id'])):
        raise RegistryError('模型接口编号无效')
    for key in ('published', 'archived'):
        if key in item and type(item[key]) is not bool:
            raise RegistryError(key + ' 必须为布尔值')
    saved = s.config(MODEL_KEY, {})
    saved[id] = item
    s.set_config(MODEL_KEY, saved)
    return item


def _request(url, headers):
    target, host, extensions = network.public_target(url)
    with httpx.Client(timeout=25, trust_env=False, follow_redirects=False) as client:
        response = client.get(target, headers={**headers, **host}, extensions=extensions)
    if response.status_code != 200:
        raise RegistryError(f'连接测试失败 HTTP {response.status_code}，请核对密钥和服务地址')
    if len(response.content) > 10_000_000:
        raise RegistryError('模型目录过大，已停止读取')
    try:
        return response.json()
    except ValueError:
        raise RegistryError('服务未返回 JSON 模型目录')


def _family(record):
    model = str(record.get('model_id') or record.get('slug') or record.get('id') or '').lower()
    if 'gpt-image-2.5-' in model and ('flare' in model or 'sunburst' in model):
        return 'gpt-image-2.5-edit' if model.endswith('/edit') else 'gpt-image-2.5-text' if model.endswith('/text-to-image') else None
    if 'seedance' in model:
        return 'seedance-2.5' if '2.5' in model or '2-5' in model else 'seedance-2.0' if '2.0' in model or '2-0' in model else None
    if 'infinitetalk' in model:
        return 'infinitetalk'
    if 'heygen' in model and 'avatar' in model:
        return 'heygen-avatar-v-create' if 'create' in model or 'twin' in model else 'heygen-avatar-v'
    return None


def discover_provider(id):
    provider = next((p for p in providers() if p['id'] == id), None)
    if not provider:
        raise RegistryError('服务平台不存在')
    if not provider.get('secret'):
        raise RegistryError('请先配置 API Key')
    key = g.cipher().decrypt(provider['secret'].encode()).decode()
    if id == 'ark':
        _request(ark_video.BASE_URL + ark_video.TASKS + '?page_size=1', {'Authorization': 'Bearer ' + key})
        return {'connected': True, 'catalogue_count': 4, 'added': 0, 'note': '官方任务查询接口连接成功；模型已预置，模型开通权限和生成能力需另外验证。本次未生成视频。'}
    if id == 'wavespeed':
        result = _request(provider['base_url'].rstrip('/') + '/api/v3/models', {'Authorization': 'Bearer ' + key})
        records = result.get('data', []) if isinstance(result, dict) else []
        if result.get('code') != 200 or not isinstance(records, list):
            raise RegistryError('平台没有返回有效的模型目录')
    elif id == 'segmind':
        _request(provider['base_url'].rstrip('/') + '/v1/get-user-credits', {'x-api-key': key})
        result = _request('https://api.spotprod.segmind.com/inference-model-information/list', {})
        records = result if isinstance(result, list) else next((v for v in result.values() if isinstance(v, list)), []) if isinstance(result, dict) else []
        if not isinstance(records, list):
            raise RegistryError('平台没有返回有效的模型目录')
    else:
        raise RegistryError('此平台尚无已核实的免费模型目录接口；已保存配置，无法验证或自动获取模型')
    saved = s.config(MODEL_KEY, {})
    known = {(m.get('provider_id'), m.get('api_model_id')) for m in models()}
    added = 0
    for record in records[:5000]:
        if not isinstance(record, dict) or record.get('is_depreciated'):
            continue
        family = _family(record)
        api_id = record.get('model_id') or record.get('slug') or record.get('id')
        if not family or not isinstance(api_id, str) or (id, api_id) in known:
            continue
        model_id = id + '-' + hashlib.sha256(api_id.encode()).hexdigest()[:16]
        saved[model_id] = {'id': model_id, 'provider_id': id, 'title': str(record.get('name') or record.get('title') or api_id)[:100], 'api_model_id': api_id, 'family': family, 'tools': sorted(FAMILIES[family][1]), 'published': False, 'discovered_at': s.now()}
        known.add((id, api_id))
        added += 1
    s.set_config(MODEL_KEY, saved)
    return {'connected': True, 'catalogue_count': len(records), 'added': added, 'note': '只导入当前支持分类的模型，默认下架；连接测试不等于生成能力验证'}


def choice(tool, id, *, active=True):
    if tool not in TOOLS:
        raise RegistryError('此功能不支持中转服务模型')
    candidates = models()
    if not active:
        saved = s.config(MODEL_KEY, {}).get(id)
        if saved and not any(m['id'] == id for m in candidates):
            candidates.append(saved)
    model = next((m for m in candidates if m['id'] == id and tool in m['tools']), None)
    if not model:
        raise RegistryError('模型不存在或未绑定当前功能')
    provider = next((p for p in providers() if p['id'] == model['provider_id']), None)
    if not provider and not active:
        provider = s.config(PROVIDER_KEY, {}).get(model['provider_id'])
    if not provider or (active and (not provider.get('published') or not model.get('published'))):
        raise RegistryError('模型或服务已下架，无法用于新任务')
    return model, provider


def choices(tool):
    out = []
    for model in models():
        try:
            m, p = choice(tool, model['id'])
        except RegistryError:
            continue
        ready = adapter_ready(m)
        out.append({'id': 'media:' + m['id'], 'title': m['title'] + ' · ' + p['title'], 'family': m['family'], 'provider': p['id'], 'storage_ready': ark_video.storage_ready(p), 'modes': ark_video.MODES if m['family'] == 'seedance-2.5' else ark_video.MODES[:4] if m['family'].startswith('seedance-') else [], 'reference_limits': REFERENCE_LIMITS.get(m['family'], {}), 'options': options(m) if ready else {}, 'configured': ready and bool(p.get('secret')), 'adapter_ready': ready, 'reason': '请在管理后台配置平台 API Key' if ready and not p.get('secret') else '接口适配待完成' if not ready else ''})
    return out
