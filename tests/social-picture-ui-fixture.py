"""Isolated real image storage/auth routes; only the paid generation provider is replaced."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = Path(os.environ['TIJIAN_DATA']).resolve()
assert data.parent == root / '.runtime' and data.name.startswith('social-picture-auth-')
sys.path.insert(0, str(root))

import uvicorn
from PIL import Image, ImageDraw
from fastapi import Depends
from backend.app import app, user
from backend import store as s, illustrations

s.init()
picture = Image.new('RGB', (160, 120), '#263b59')
draw = ImageDraw.Draw(picture)
draw.rectangle((50, 15, 110, 105), fill='#9abbff')
draw.line((80, 15, 80, 105), fill='white', width=2)
picture.save(data / 'source.png', format='PNG')
s.set_config('providers', [{'id': 'fixture', 'title': 'Offline only', 'base_url': 'https://example.invalid',
                           'protocol': 'chat', 'secret': 'fixture-only'}])
s.set_config('models', [{'id': 'fixture-image', 'provider': 'fixture', 'model': 'gpt-image-1',
                        'title': '离线测试图片服务', 'verified': True, 'published': True, 'capability': 'image'}])
s.set_config('bindings', {'text_image': 'fixture-image'})


def offline_image(*args, **kwargs):
    # A real PNG is archived through normal generation code; no HTTP image response is mocked.
    return illustrations.image_uri((data / 'source.png').read_bytes())


illustrations.generate = offline_image


@app.post('/api/test/social-picture')
def seed(u=Depends(user)):
    flow = s.put(u['id'], 'studio_flow', {'title': '隔离社交图片流程'})
    content = s.put(u['id'], 'content', {'title': '隔离社交正文', 'body': '这段正文必须保持不变。',
                                       'format': '小红书文案', 'flow_id': flow['id'], 'status': 'draft'})
    return {'flow': flow, 'content': content}


uvicorn.run(app, host='127.0.0.1', port=int(os.environ['TIJIAN_PORT']), log_level='error', access_log=False)
