"""Isolated UI fixture. Explicit test model; never touches live keys or services."""
import json,os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import uvicorn
from backend import store as s,gateway as g,streaming,illustrations
from backend.app import app
s.init()
s.set_config('providers',[{'id':'fixture','title':'隔离测试服务','base_url':'https://example.invalid','protocol':'chat','secret':'fixture-only'}])
s.set_config('models',[{'id':'fixture-text','provider':'fixture','model':'fixture','title':'隔离测试文本','verified':True,'published':True,'capability':'text'},
                      *[{'id':id,'provider':'fixture','model':model,'title':title,'verified':True,'published':True,'capability':'image'} for id,model,title in [('fixture-image','gpt-image-1','隔离标准图片'),('fixture-image2','gpt-image-2.5','隔离2K图片')]]])
s.set_config('bindings',{'writing':'fixture-text','profile':'fixture-text','benchmark':'fixture-text','text_image':'fixture-image','image_edit':'fixture-image'})

def test_image(*args,**kwargs):
    import io
    from PIL import Image,ImageDraw
    raw=io.BytesIO();image=Image.new('RGB',(1024,1024),'#e5efe4');draw=ImageDraw.Draw(image)
    draw.rectangle((280,160,744,864),fill='#1e4938');draw.line((512,160,512,864),fill='#b7c59a',width=6)
    draw.text((30,30),'ISOLATED UI TEST - NOT AN AI IMAGE',fill='#173c2b');image.save(raw,format='PNG')
    return illustrations.image_uri(raw.getvalue())
illustrations.generate=test_image
g.select=lambda *args,**kwargs:'fixture-text'
def generate(model,messages,probe=False):
    if '只返回 JSON 对象，键为' in messages[0]['content']:
        return json.dumps({'title':'AI访谈测试品牌','products':'电梯信息整理','facts':'用户提供的事实'},ensure_ascii=False)
    if '六个字符串字段' in messages[0]['content']:
        return json.dumps({'title':'隔离测试IP','position':'电梯服务讲解','audience':'物业','style':'通俗','views':'事实为先','channels':'视频号'},ensure_ascii=False)
    text='【隔离模型测试结果，不是真实AI输出】\n\n电梯更新先看检验记录，再看使用情况。请向专业机构核实具体方案。'
    for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.008)
    return text
g.generate=generate
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
