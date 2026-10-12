"""Source-bundle UI + isolated SQLite. Generation/provider calls are forbidden."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from fastapi.staticfiles import StaticFiles
from backend import app as app_module, gateway, store as s, media_studio

def forbidden(*args, **kwargs):
    raise AssertionError('Speech UI verification must not call models or media providers')
gateway.generate = forbidden
media_studio._request = forbidden
s.init()
bundle = Path(os.environ['TIJIAN_SPEECH_UI_BUNDLE']).resolve()
assert bundle == s.ROOT / 'dist' or bundle.is_relative_to(s.ROOT / '.runtime')
app_module.DIST = bundle
for route in app_module.app.routes:
    if getattr(route, 'path', '') == '/assets':
        route.app = StaticFiles(directory=bundle / 'assets')
uvicorn.run(app_module.app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
