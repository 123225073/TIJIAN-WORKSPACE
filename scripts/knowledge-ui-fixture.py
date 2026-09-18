import os,sys,json,re,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import gateway,network
from backend.app import app
import uvicorn
calls=[]
gateway.select=lambda *a,**k:'knowledge-fixture'
def generate(model,messages):
    calls.append(messages);time.sleep(.8)
    text=messages[-1]['content']
    ref=re.search(r'<资料 id="([^"]+)"',text).group(1)
    if 'NO_RESULT_FIXTURE' in text:return '{"items":[]}'
    if 'FAIL_FIXTURE' in text:raise ValueError('隔离验收：模拟服务失败，未生成建议')
    return json.dumps({'items':[{'title':'验收知识建议','body':'设备检查记录应保留时间与来源。','type':'knowledge','source_ids':[ref]}]},ensure_ascii=False)
gateway.generate=generate
network.fetch=lambda *a,**k:(_ for _ in ()).throw(ValueError('External network forbidden in fixture'))
@app.get('/fixture/requests')
def collected():return {'count':len(calls)}
app.router.routes[:]=app.router.routes[-1:]+app.router.routes[:-1]
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
