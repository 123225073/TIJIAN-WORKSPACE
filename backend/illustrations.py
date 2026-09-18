"""Private article illustrations; generation and insertion are separate actions."""
import base64, io, re
from urllib.parse import urljoin
import httpx
from PIL import Image
from fastapi import Depends, UploadFile, File
from . import store as s, gateway as g, jobs, network

LIMIT=8_000_000
PATTERN=re.compile(r'/api/illustrations/([a-f0-9]{32})/file')

def image_uri(raw):
    if not raw or len(raw)>LIMIT:raise ValueError('图片为空或超过8MB，请使用较小图片')
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.width*im.height>25_000_000 or im.format not in ['PNG','JPEG','WEBP']:raise ValueError()
            mime=Image.MIME[im.format];im.verify()
    except Exception:raise ValueError('图片格式无效，仅支持 PNG、JPEG、WebP（2500万像素以内）')
    return 'data:'+mime+';base64,'+base64.b64encode(raw).decode()

def fetch_image(url):
    with httpx.Client(timeout=45,trust_env=False,follow_redirects=False) as client:
        for _ in range(4):
            target,host,extensions=network.public_target(url)
            with client.stream('GET',target,headers=host,extensions=extensions) as response:
                if response.is_redirect:url=urljoin(url,response.headers['location']);continue
                if response.status_code!=200:raise ValueError('图片下载失败，请重新生成')
                raw=bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw)>LIMIT:raise ValueError('图片超过8MB')
                return bytes(raw)
    raise ValueError('图片下载重定向过多')

def generate(model,prompt,size='1024x1024',probe=False):
    m,p=g.model_record(model)
    if m['capability']!='image' or (not probe and not (m.get('verified') and m.get('published'))):raise ValueError('请选择已验证上架的生图模型')
    if size not in ['1024x1024','1536x1024','1024x1536']:raise ValueError('图片尺寸无效')
    target,host,extensions=network.public_target(g.endpoint(p,'images/generations'))
    payload={'model':m['model'],'prompt':prompt,'n':1,'size':size}
    with httpx.Client(timeout=httpx.Timeout(300,connect=20),trust_env=False) as client:
        with client.stream('POST',target,headers={**g.headers(p),**host},extensions=extensions,json=payload) as response:
            if response.status_code!=200:raise ValueError(f'生图失败 HTTP {response.status_code}，请检查该服务是否支持 Images 接口及所选尺寸')
            raw=bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw)>LIMIT*2:raise ValueError('生图响应超过上限')
    import json
    try:entry=json.loads(raw).get('data',[])[0]
    except (ValueError,IndexError,TypeError):raise ValueError('服务没有返回图片')
    if entry.get('b64_json'):
        try:binary=base64.b64decode(entry['b64_json'],validate=True)
        except Exception:raise ValueError('服务返回的图片编码无效')
    elif entry.get('url'):binary=fetch_image(entry['url'])
    else:raise ValueError('服务没有返回可用图片')
    return image_uri(binary)

def expanded(owner,body):
    def replace(match):
        obj=s.get(owner,match[1])
        if obj['kind']!='illustration' or obj.get('archived'):raise ValueError('配图不可用，请检查后再导出')
        return obj['data_uri']
    return PATTERN.sub(replace,body)

def register(app,user,error):
    def content(owner,id):
        obj=s.get(owner,id)
        if obj['kind']!='content' or obj.get('archived'):error(400,'请选择有效成果')
        return obj

    @app.get('/api/illustrations/{id}/file')
    def read(id:str,u=Depends(user)):
        obj=s.get(u['id'],id)
        if obj['kind']!='illustration' or obj.get('archived'):error(404,'图片不存在')
        return {'data_uri':obj['data_uri']}

    @app.post('/api/content/{id}/illustrations')
    @jobs.serialized
    def create(id:str,data:dict,u=Depends(user)):
        owner=u['id'];obj=content(owner,id);prompt=str(data.get('prompt','')).strip()
        if not prompt or len(prompt)>4000:error(400,'请填写4000字以内的画面要求')
        if any(j.get('input',{}).get('content_id')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):error(409,'此文章正在生成图片，请等待完成')
        model=str(data.get('model_id',''));m,p=g.model_record(model)
        if m['capability']!='image' or not (m.get('verified') and m.get('published')):error(400,'请选择已验证上架的生图模型')
        def run(progress,event):
            progress('正在生成配图，完成后请预览并选择插入位置')
            uri=generate(model,'为文章制作一张配图。避免生成难以辨认的文字，不伪造实地照片或招标原件。文章主题：'+obj.get('title','')+'\n用户画面要求：'+prompt,data.get('size','1024x1024'))
            if event.is_set():return {'cancelled':True}
            row=s.put(owner,'illustration',{'title':prompt[:80],'content_id':id,'data_uri':uri,'model_id':model,'prompt':prompt,'source_type':'AI生成','created':s.now()})
            return {'illustration_id':row['id'],'content_id':id}
        return jobs.start(owner,'生成文章配图',run,{'action':'illustration','content_id':id,'task_id':obj.get('task_id')})

    @app.post('/api/content/{id}/illustrations/upload')
    async def upload(id:str,file:UploadFile=File(...),u=Depends(user)):
        content(u['id'],id);raw=await file.read(LIMIT+1)
        row=s.put(u['id'],'illustration',{'title':(file.filename or '本地图片')[:100],'content_id':id,'data_uri':image_uri(raw),'source_type':'本地上传','created':s.now()})
        return {'illustration_id':row['id']}

    @app.post('/api/content/{id}/illustrations/insert')
    @jobs.serialized
    def insert(id:str,data:dict,u=Depends(user)):
        owner=u['id'];obj=content(owner,id);pic=s.get(owner,str(data.get('illustration_id','')))
        if pic['kind']!='illustration' or pic.get('archived') or pic.get('content_id')!=id:error(400,'请选择本文章的配图')
        if data.get('version')!=obj['version']:error(409,'文章已修改，请保存并重新选择插入位置')
        body=obj.get('body','');position=data.get('position')
        if not isinstance(position,int) or not 0<=position<=len(body):error(400,'插入位置无效')
        link='/api/illustrations/'+pic['id']+'/file'
        if link in body:return obj
        caption=re.sub(r'[\[\]<>\r\n]','',str(data.get('caption') or pic['source_type']))[:200]
        body=body[:position]+'\n\n!['+caption+']('+link+')\n\n'+body[position:]
        return s.export_object(owner,s.put(owner,'content',{**obj,'body':body,'check':None,'status':'draft'},id,obj['version']))
