"""Isolated UI fixture: fake model responses are explicitly test-only."""
import os, sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import gateway, network, store as s
from backend.app import app
import uvicorn

calls=[]
gateway.select=lambda *a,**k:'library-fixture'
def generate(model,messages):
    calls.append(messages);time.sleep(.4)
    prompt=messages[-1]['content']
    if '当前原文：' in prompt:
        body=prompt.split('当前原文：\n')[-1]
        return json.dumps({'items':[{'topic':'设备档案','title':'来源与记录','body':'测试资料要求保留日期与来源。','quote':body[:30],'explicit_user_statement':True}]},ensure_ascii=False)
    if '只做检索规划' in messages[0]['content']:
        return '{"queries":["设备记录"],"need_original":true}'
    return '这是隔离测试模型的回复。已读取本次所选范围；不代表真实模型质量。'
gateway.generate=generate
network.fetch=lambda *a,**k:(_ for _ in ()).throw(ValueError('External network forbidden in fixture'))
@app.get('/fixture/requests')
def requests():return {'calls':calls}
app.router.routes[:]=app.router.routes[-1:]+app.router.routes[:-1]
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
