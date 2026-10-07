"""Seed disposable UI SQLite only; no provider traffic or real credentials."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store as s, gateway as g, media_studio as m
data = json.load(sys.stdin)
root = Path(os.environ['TIJIAN_DATA']).resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('hifly-ui-')
s.init()
s.set_config(m.CONFIG, {'hifly': {'base_url': m.PROVIDERS['hifly']['base_url'], 'enabled': True,
    'secret': g.cipher().encrypt(b'isolated-fixture-only').decode()}})
service = m._service('hifly')
for kind in ['avatar', 'voice']:
    s.put(data['owner'], 'studio_asset', {'title': '隔离飞影' + kind, 'asset_type': kind,
        'status': 'ready', 'provider': 'hifly', 'provider_resource_id': 'fixture-' + kind,
        'compat': m.COMPAT[kind], 'service_scope': m._scope('hifly', service)})
for kind in ['video', 'audio', 'image']:
    name = s.uid() + {'video': '.mp4', 'audio': '.wav', 'image': '.png'}[kind]
    p = m._path(data['owner'], name)
    p.write_bytes(b'isolated-local-input-not-a-real-media-file')
    s.put(data['owner'], 'studio_asset', {'title': '隔离本地' + kind, 'asset_type': kind,
        'status': 'ready', 'provider': 'local', 'local_file': name, 'duration': 8,
        'size': p.stat().st_size, 'width': 1280, 'height': 720, 'video_codec': 'h264', 'compat': m.COMPAT[kind]})
feed = s.put(data['owner'], 'feed', {'title': '隔离只读信源', 'enabled': True, 'url': 'https://example.invalid'})
s.put(data['owner'], 'news', {'title': '隔离行业资讯对比度验证', 'feed_id': feed['id'],
    'category': '行业线索', 'body': '仅用于本机界面验证，不是真实新闻', 'region': '隔离测试'})
