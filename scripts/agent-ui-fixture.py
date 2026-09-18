import os,sys,json,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import gateway
from backend.app import app
import uvicorn
gateway.select=lambda *a,**k:'agent-ui-fixture'
def generate(model,messages):
 time.sleep(.15)
 if '操作规划器' in messages[0]['content']:
  data=json.loads(messages[-1]['content']);text=data['conversation'][-1]['text']
  if '记住' in text:return json.dumps({'reply':'已整理记忆，请核对。','action':'memory','ready':True,'fields':{'title':'简洁中文','body':'默认使用简洁中文'},'notes':[]},ensure_ascii=False)
  if '你好' in text:return json.dumps({'reply':'你好，我可以帮你查资料和整理信息。','action':None,'ready':False},ensure_ascii=False)
  return json.dumps({'reply':'已整理定位，请核对。','action':'profile','ready':True,'fields':{'title':'小沙说电梯','position':'项目合作与销售获客','audience':'同行与物业','style':'通俗务实','views':'先讲清项目','body':'完整定位方案，来自隔离测试模型。'},'notes':['这是测试模型的结果，不代表真实模型质量']},ensure_ascii=False)
 return '定位已经明确，可以整理。'
gateway.generate=generate
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
