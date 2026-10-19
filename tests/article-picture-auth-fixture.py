"""Private image preview fixture: real routes/auth/SQLite/files, no app lifespan.

Only authentication, existing image reads and export routes are exposed. There
are no generation endpoints, model bindings, provider keys or background jobs.
"""
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
directory = Path(sys.argv[1]).resolve()
assert directory.is_relative_to(ROOT / '.runtime')
assert directory.name.startswith('article-picture-auth-')
os.environ['TIJIAN_DATA'] = str(directory / 'data')

from fastapi import FastAPI, Depends
from fastapi.responses import HTMLResponse
from PIL import Image
from backend import store as s, media_studio, illustrations
from backend.app import app as original, user

s.init()
with s.conn() as c:
    owner = c.execute("SELECT id FROM users WHERE email='admin'").fetchone()['id']
    c.execute('INSERT INTO users VALUES (?,?,?,?,?,1)',
              ('fixture-other', 'other', 'Other', s.password_hash('fixture-other-password'), 'user'))
images = []
for index, asset_id in enumerate(['a' * 32, 'b' * 64, 'c' * 32]):
    buffer = io.BytesIO()
    Image.new('RGB', (48 + index, 32 + index), ['red', 'green', 'blue'][index]).save(buffer, format='PNG')
    raw = buffer.getvalue()
    filename = asset_id + '.png'
    media_studio._path(owner, filename).write_bytes(raw)
    s.put(owner, 'studio_asset', {'asset_type': 'image', 'status': 'ready', 'local_file': filename, 'mime_type': 'image/png', 'title': 'Fixture PNG'}, id=asset_id)
    images.append(asset_id)
legacy = s.put(owner, 'illustration', {'data_uri': illustrations.image_uri(raw)})
content = s.put(owner, 'content', {'title': 'Auth fixture', 'body': ''})

app = FastAPI()
app.exception_handlers.update(original.exception_handlers)
paths = {'/api/auth/login', '/api/studio/assets/{id}/file', '/api/illustrations/{id}/file', '/api/content/{id}/export'}
app.router.routes.extend(route for route in original.routes if getattr(route, 'path', '') in paths)

@app.get('/fixture-data')
def data(u=Depends(user)):
    assert u['id'] == owner
    return {'assets': images, 'illustration': legacy['id'], 'content': content['id']}

@app.post('/fixture-body')
def body(data: dict, u=Depends(user)):
    row = s.get(u['id'], content['id'])
    return s.put(u['id'], 'content', {**row, 'body': data['body']}, id=row['id'], expected=row['version'])

@app.get('/')
def page():
    return HTMLResponse('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[2]), log_level='error', access_log=False)
