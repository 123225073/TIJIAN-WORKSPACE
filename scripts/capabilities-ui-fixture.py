"""Isolated system configuration UI test; never contacts a model or platform."""
import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import gateway,network
from backend.app import app
import uvicorn
requests=[]
gateway.select=lambda *a,**k:'fixture-only'
def generate(model,messages):
    requests.append(messages)
    return '这是隔离验收回复，不是真实模型结果。'
gateway.generate=generate
network.fetch=lambda *a,**k:(_ for _ in ()).throw(ValueError('Network forbidden in fixture'))
@app.get('/fixture/requests')
def collected():return requests
app.router.routes[:]=app.router.routes[-1:]+app.router.routes[:-1]
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
