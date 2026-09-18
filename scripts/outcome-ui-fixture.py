"""Isolated deterministic UI fixture, never used by the desktop product."""
import os,sys,json,io,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import gateway,store as s,illustrations,streaming
from backend.app import app
from PIL import Image
import uvicorn
s.init()
s.set_config('providers',[{'id':'fixture-a','title':'测试服务 A','base_url':'https://example.com','protocol':'chat','secret':'fixture-only'}])
s.set_config('models',[{'id':'fixture-text','provider':'fixture-a','model':'fixture-text','title':'文本模型 A','capability':'text','verified':True,'published':True},{'id':'fixture-image','provider':'fixture-a','model':'fixture-image','title':'配图模型 A','capability':'image','verified':True,'published':True}])
s.set_config('providers',s.config('providers')+[{'id':'fixture-'+str(i),'title':'测试平台 '+str(i),'base_url':'https://example.com','protocol':'chat','secret':'fixture-only'} for i in range(1,9)])
s.set_config('models',s.config('models')+[{'id':'fixture-bad','provider':'fixture-a','model':'fixture-bad','title':'失败验证模型','capability':'text','verified':False,'published':False}])
gateway.select=lambda *a,**k:'fixture-text'
def generate(model,messages,probe=False):
    streaming.emit('start')
    if model=='fixture-bad':time.sleep(.7);raise ValueError('测试服务返回 HTTP 503；请稍后重试')
    if '工作成果编辑' in messages[0]['content']:
        data=json.loads(messages[1]['content'])
        text=(data['当前成果'] or '# 项目机会\n\n## 判断依据\n用于隔离测试的选题与资料依据。')+'\n\n已合并新要求。'
    else:text='连接正常' if probe else '# 项目机会\n\n## 判断依据\n根据所选成果继续讨论；用于隔离测试。'
    for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.035 if not probe else .15)
    streaming.emit('end',text);return text
gateway.generate=generate
def picture(*args,**kwargs):
    image=Image.new('RGB',(500,300),'#23685e');buf=io.BytesIO();image.save(buf,format='PNG');return illustrations.image_uri(buf.getvalue())
illustrations.generate=picture
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
