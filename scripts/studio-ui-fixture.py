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
s.set_config('bindings',{'writing':'fixture-text','topics':'fixture-text','profile':'fixture-text','benchmark':'fixture-text','text_image':'fixture-image','image_edit':'fixture-image'})

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
    prompt=messages[0]['content']
    if '需求识别器' in prompt:
        data=json.loads(messages[1]['content']);text=data['最新用户请求']
        action='image' if '生成' in text and '图片' in text else 'video' if '生成视频' in text else 'chat' if '怎么用' in text or text=='你好' else 'text'
        platforms=['moments'] if '朋友圈' in text else ['xiaohongshu'] if '小红书' in text else ['douyin'] if '抖音' in text else ['channels'] if '脚本' in text else ['wechat']
        return json.dumps({'action':action,'platforms':platforms if action=='text' else [],'brief':text},ensure_ascii=False)
    if '只返回JSON对象' in prompt:
        data=json.loads(messages[1]['content'])
        text=json.dumps({'title':data['平台']+'：电梯报价先看条件','body':'【隔离模型测试，不是真实AI输出】\n\n## 先明确使用条件\n\n电梯报价需要结合实际项目条件核对。 ['+'a'*32+']\n\n## 再核对服务范围\n\n请向专业机构核实具体方案。','summary':'核对项目条件和服务范围。','cover_brief':'现代电梯门与建筑空间，无文字。','caption':'先明确项目条件。','script':'【隔离测试口播】先核对使用条件，再核对服务范围。','shotlist':'镜头一：电梯门；镜头二：核对记录。','tags':'电梯'},ensure_ascii=False)
        for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.003)
        return text
    if '严格按用户的优化方向处理' in prompt:
        context=json.loads(messages[1]['content'])
        scope=context['优化范围']
        if scope=='all':
            text=json.dumps({'title':'隔离优化后的标题','body':'隔离优化后的完整正文。\n\n请人工核对事实。','summary':'隔离优化摘要','cover_brief':'依据文章内容设计现场核对画面','keywords':'维保','publishing_notes':'核对事实'},ensure_ascii=False)
        else:
            text={'title':'隔离优化后的标题','body':'隔离优化后的完整正文。\n\n请人工核对事实。','summary':'隔离优化摘要','cover_brief':'依据文章内容设计现场核对画面'}[scope]
        for i in range(1,len(text)+1):
            streaming.emit('delta',text[:i]);time.sleep(.006)
        return text
    if '"topics"' in prompt and 'rationale' in prompt:
        text=json.dumps({'topics':[{'title':'隔离测试：老旧电梯更新准备','angle':'核对检验记录','rationale':'仅为方向建议，待查证','audience':'物业经理'},{'title':'隔离测试：电梯日常检查','angle':'日常检查','rationale':'仅为测试候选','audience':'物业人员'},{'title':'隔离测试：维保沟通','angle':'沟通记录','rationale':'仅为测试候选','audience':'业主'}]},ensure_ascii=False)
        for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.01)
        return text
    if '全部为非空字符串' in prompt:
        from backend.topics import DELIVERY_FIELDS
        platform='wechat' if '公众号' in prompt else 'channels'
        text=json.dumps({key:'隔离测试草稿，请核对实际资料' for key in DELIVERY_FIELDS[platform]},ensure_ascii=False)
        for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.008)
        return text
    if '只返回 JSON 对象，键为' in messages[0]['content']:
        return json.dumps({'title':'AI访谈测试品牌','products':'电梯信息整理','facts':'用户提供的事实'},ensure_ascii=False)
    if '六个字符串字段' in messages[0]['content']:
        return json.dumps({'title':'隔离测试IP','position':'电梯服务讲解','audience':'物业','style':'通俗','views':'事实为先','channels':'视频号'},ensure_ascii=False)
    text='【隔离模型测试结果，不是真实AI输出】\n\n电梯更新先看检验记录，再看使用情况。请向专业机构核实具体方案。'
    for i in range(1,len(text)+1):streaming.emit('delta',text[:i]);time.sleep(.008)
    return text
g.generate=generate
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['TIJIAN_PORT']),log_level='error',access_log=False)
