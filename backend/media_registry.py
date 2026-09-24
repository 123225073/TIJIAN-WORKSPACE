"""Administrative catalogue for intermediary media services.

Entries describe possible integrations.  No entry implies that an API adapter has
been implemented or that a paid generation call can be made.
"""
from urllib.parse import urlsplit

from . import gateway as g, network, store as s

PROVIDER_KEY = 'media_registry_providers'
MODEL_KEY = 'media_registry_models'
VIDEO_TOOLS = {'text_video', 'image_video'}
DIGITAL_TOOLS = {'text_avatar', 'audio_avatar', 'photo_talk', 'avatar_create'}
TOOLS = VIDEO_TOOLS | DIGITAL_TOOLS
FAMILIES = {
    'seedance-2.0': ('AI 视频', VIDEO_TOOLS),
    'seedance-2.5': ('AI 视频', VIDEO_TOOLS),
    'infinitetalk': ('数字人口播', {'audio_avatar'}),
    'heygen-avatar-v': ('数字人口播', {'text_avatar', 'audio_avatar'}),
    'heygen-avatar-v-create': ('形象克隆', {'avatar_create'}),
}
PRESET_PROVIDERS = [
    {'id': 'segmind', 'title': 'Segmind', 'category': '视频与数字人', 'base_url': 'https://api.segmind.com', 'docs_url': 'https://docs.segmind.com/', 'published': True},
    {'id': 'wavespeed', 'title': 'WaveSpeedAI', 'category': '视频与数字人', 'base_url': 'https://api.wavespeed.ai', 'docs_url': 'https://wavespeed.ai/docs/docs-api', 'published': True},
]
PRESET_MODELS = [
    {'id': 'segmind-seedance-20', 'provider_id': 'segmind', 'title': 'Seedance 2.0', 'family': 'seedance-2.0', 'tools': ['text_video', 'image_video'], 'published': True},
    {'id': 'segmind-seedance-25', 'provider_id': 'segmind', 'title': 'Seedance 2.5', 'family': 'seedance-2.5', 'tools': ['text_video', 'image_video'], 'published': True},
    {'id': 'wavespeed-seedance-20', 'provider_id': 'wavespeed', 'title': 'Seedance 2.0', 'family': 'seedance-2.0', 'tools': ['text_video', 'image_video'], 'published': True},
    {'id': 'wavespeed-seedance-25', 'provider_id': 'wavespeed', 'title': 'Seedance 2.5', 'family': 'seedance-2.5', 'tools': ['text_video', 'image_video'], 'published': True},
    {'id': 'wavespeed-infinitetalk', 'provider_id': 'wavespeed', 'title': 'InfiniteTalk（照片+音频）', 'family': 'infinitetalk', 'tools': ['audio_avatar'], 'published': True},
    {'id': 'segmind-heygen-avatar-v', 'provider_id': 'segmind', 'title': 'HeyGen Avatar V', 'family': 'heygen-avatar-v', 'tools': ['text_avatar', 'audio_avatar'], 'published': True},
    {'id': 'segmind-heygen-avatar-create', 'provider_id': 'segmind', 'title': 'HeyGen Avatar V 形象创建', 'family': 'heygen-avatar-v-create', 'tools': ['avatar_create'], 'published': True},
]


class RegistryError(ValueError):
    pass


def _rows(key, presets):
    saved = s.config(key, {})
    return [dict(item, **saved.get(item['id'], {})) for item in presets if not saved.get(item['id'], {}).get('archived')] + [dict(value, id=id) for id, value in saved.items() if id not in {x['id'] for x in presets} and not value.get('archived')]


def providers():
    return _rows(PROVIDER_KEY, PRESET_PROVIDERS)


def models():
    return _rows(MODEL_KEY, PRESET_MODELS)


def _public_provider(item):
    return {k: v for k, v in item.items() if k not in ('secret',)} | {'has_key': bool(item.get('secret')), 'adapter_ready': False}


def catalogue():
    ps = providers()
    return {'providers': [_public_provider(p) for p in ps],
            'models': [{**m, 'category': FAMILIES[m['family']][0], 'adapter_ready': False} for m in models()],
            'notice': '服务与模型为管理目录；接口适配尚未完成，配置密钥也不会执行付费生成。'}


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
    if not isinstance(data, dict) or set(data) - {'id', 'title', 'category', 'base_url', 'api_key', 'published', 'archived', 'docs_url'}:
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
    for key in ('published', 'archived'):
        if key in data:
            if type(data[key]) is not bool:
                raise RegistryError(key + ' 必须为布尔值')
            item[key] = data[key]
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
    if not isinstance(data, dict) or set(data) - {'id', 'provider_id', 'title', 'family', 'tools', 'published', 'archived'}:
        raise RegistryError('模型字段不受支持')
    id = _id(data.get('id'))
    old = next((m for m in models() if m['id'] == id), None)
    item = dict(old or {})
    item.update(data)
    if item.get('provider_id') not in {p['id'] for p in providers()}:
        raise RegistryError('请选择已有服务平台')
    family = item.get('family')
    if family not in FAMILIES:
        raise RegistryError('模型类别不受支持')
    tools = item.get('tools')
    if not isinstance(tools, list) or not tools or any(not isinstance(t, str) for t in tools) or len(tools) != len(set(tools)) or not set(tools) <= FAMILIES[family][1]:
        raise RegistryError('功能绑定与模型类别不匹配')
    if not isinstance(item.get('title'), str) or not 0 < len(item['title'].strip()) <= 100:
        raise RegistryError('模型名称无效')
    for key in ('published', 'archived'):
        if key in item and type(item[key]) is not bool:
            raise RegistryError(key + ' 必须为布尔值')
    saved = s.config(MODEL_KEY, {})
    saved[id] = item
    s.set_config(MODEL_KEY, saved)
    return item


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
        out.append({'id': 'media:' + m['id'], 'title': m['title'] + ' · ' + p['title'], 'family': m['family'], 'provider': p['id'], 'options': {}, 'configured': False, 'adapter_ready': False, 'reason': '接口适配待完成'})
    return out
