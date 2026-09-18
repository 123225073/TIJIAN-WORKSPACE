from __future__ import annotations
import json, os, re, time
import httpx
from cryptography.fernet import Fernet
from . import store as s
from .network import public_url,public_target

KEYFILE=s.DATA/'provider.key'
def cipher():
    if not KEYFILE.exists():
        KEYFILE.write_bytes(Fernet.generate_key());os.chmod(KEYFILE,0o600)
    return Fernet(KEYFILE.read_bytes())

def providers():return s.config('providers',[])
def public_providers():
    values=[{k:v for k,v in p.items() if k!='secret'}|{'has_key':bool(p.get('secret'))} for p in providers()]
    from urllib.parse import urlsplit
    matches=[p for p in values if urlsplit(p.get('base_url','')).hostname=='api.deepseek.com']
    if not matches:
        matches=[{'id':'preset-deepseek','title':'DeepSeek','base_url':'https://api.deepseek.com','protocol':'chat','has_key':False,'preset':True}];values+=matches
    for p in matches:p.update(api_key_url='https://platform.deepseek.com/api_keys',docs_url='https://api-docs.deepseek.com/')
    return values
def save_provider(data):
    values=providers();old=next((x for x in values if x['id']==data.get('id')),None)
    url=data['base_url'].strip().rstrip('/')
    if not url.startswith('https://'):raise ValueError('模型凭据只通过HTTPS连接发送')
    public_url(url)
    p={'id':old['id'] if old else s.uid(),'title':data.get('title','模型服务'),'base_url':url,'protocol':data.get('protocol','chat'),'status':'configured','secret':old.get('secret','') if old else ''}
    if data.get('api_key'):p['secret']=cipher().encrypt(data['api_key'].encode()).decode()
    if not p['secret']:raise ValueError('请输入API密钥')
    values=[x for x in values if x['id']!=p['id']]+[p];s.set_config('providers',values)
    if old and (data.get('api_key') or old['base_url']!=url or old['protocol']!=p['protocol']):
        models=s.config('models',[])
        for m in models:
            if m['provider']==p['id']:m.update(verified=False,published=False)
        s.set_config('models',models)
    return p['id']

def endpoint(p,path):
    root=p['base_url'];return root+('/' if root.endswith('/v1') else '/v1/')+path

def headers(p):return {'Authorization':'Bearer '+cipher().decrypt(p['secret'].encode()).decode(),'Content-Type':'application/json'}

def discover(id):
    p=next((x for x in providers() if x['id']==id),None)
    if not p:raise ValueError('模型服务不存在')
    target,host,extensions=public_target(endpoint(p,'models'))
    with httpx.Client(timeout=25,trust_env=False) as client:r=client.get(target,headers={**headers(p),**host},extensions=extensions)
    if r.status_code!=200:raise ValueError(f'模型发现失败 HTTP {r.status_code}')
    old=s.config('models',[])
    for x in r.json().get('data',[]):
        if not isinstance(x,dict) or not isinstance(x.get('id'),str):continue
        mid=x['id']
        if any(m['provider']==id and m['model']==mid for m in old):continue
        cap='image' if any(v in mid.lower() for v in ['image','imagen','banana','dall-e']) else 'text'
        old.append({'id':s.uid(),'provider':id,'model':mid,'title':mid,'capability':cap,'verified':False,'published':False})
    s.set_config('models',old)
    return old

def model_record(id):
    m=next((x for x in s.config('models',[]) if x['id']==id),None)
    if not m:raise ValueError('模型不存在')
    p=next((x for x in providers() if x['id']==m['provider']),None)
    if not p:raise ValueError('模型服务不存在')
    return m,p

def generate(id,messages,probe=False):
    from . import streaming
    m,p=model_record(id)
    if not probe and (not m['verified'] or not m['published']):raise ValueError('模型尚未验证上架')
    path='responses' if p['protocol']=='responses' else 'chat/completions'
    payload={'model':m['model'],'stream':True,('input' if path=='responses' else 'messages'):messages}
    target,host,extensions=public_target(endpoint(p,path))
    streaming.emit('start')
    text='';complete=False
    with httpx.Client(timeout=httpx.Timeout(240,connect=20),trust_env=False) as client:
        with client.stream('POST',target,headers={**headers(p),**host},extensions=extensions,json=payload) as r:
            if r.status_code!=200:raise ValueError(f'模型调用失败 HTTP {r.status_code}，请检查连接与模型能力')
            if 'text/event-stream' not in r.headers.get('content-type',''):
                # Some compatible providers ignore stream. Report this honestly, once; no duplicate request.
                r.read();data=r.json()
                text=(data.get('output_text') or '\n'.join(c.get('text','') for o in data.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text')) if path=='responses' else data.get('choices',[{}])[0].get('message',{}).get('content','')
                if isinstance(text,list):text='\n'.join(x.get('text','') for x in text)
                complete=True;streaming.emit('buffered',text)
            else:
                for raw in streaming.events(r):
                    if raw=='[DONE]':complete=True;break
                    try:data=json.loads(raw)
                    except ValueError:raise ValueError('模型流式响应格式异常；未保存不完整内容')
                    if data.get('error') or data.get('type') in ['error','response.failed','response.incomplete']:raise ValueError('模型输出中断；未保存不完整内容，请重试')
                    delta=''
                    if path=='responses':
                        if data.get('type')=='response.output_text.delta':delta=data.get('delta','')
                        if data.get('type')=='response.completed':complete=True
                    else:
                        choices=data.get('choices',[])
                        if choices:
                            choice=choices[0];delta=choice.get('delta',{}).get('content') or ''
                            if choice.get('finish_reason') in ['length','content_filter']:raise ValueError('模型未完整输出，请缩短要求或更换模型；未覆盖已有成果')
                            if choice.get('finish_reason')=='stop':complete=True
                    if isinstance(delta,str) and delta:
                        text+=delta
                        if len(text)>2_000_000:raise ValueError('模型输出过长，已停止')
                        streaming.emit('delta',text)
                if not complete:raise ValueError('模型连接提前结束，未保存不完整内容，请重试')
    if not text:raise ValueError('模型未返回可显示内容')
    streaming.emit('end',text)
    return text

def verify(id):
    m,p=model_record(id)
    start=time.monotonic()
    if m['capability']=='image':
        from .illustrations import generate as image_generate
        image_generate(id,'A simple green leaf on a white background. No text.',probe=True)
        text='已实际生成并校验一张测试图片'
    else:text=generate(id,[{'role':'user','content':'只回答：连接正常'}],probe=True)
    if model_record(id)[1]!=p:raise ValueError('测试期间连接配置已修改，请按新配置重新测试')
    models=s.config('models',[])
    for x in models:
        if x['id']==id:x.update(verified=True,tested_at=s.now(),latency=round(time.monotonic()-start,2))
    s.set_config('models',models)
    return {'ok':True,'text':text[:100]}

def select(owner,purpose,override=None):
    bindings=s.config('bindings',{})
    prefs=s.config('prefs:'+owner,{})
    id=override or prefs.get(purpose) or bindings.get(purpose) or bindings.get('writing')
    if not id:raise ValueError('尚未绑定可用模型，请在管理后台配置并验证模型')
    m,p=model_record(id)
    if not m['verified'] or not m['published'] or m['capability']!='text':raise ValueError('所选模型不可用，请重新选择已验证的文本模型')
    return id

def json_result(text):
    text=re.sub(r'^```(?:json)?\s*|\s*```$','',text.strip())
    start=text.find('{');end=text.rfind('}')
    if start<0 or end<start:raise ValueError('模型没有返回规定的结构化结果，请重试')
    return json.loads(text[start:end+1])
