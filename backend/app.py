from __future__ import annotations
import asyncio, csv, io, json, os, re, secrets, time, zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urljoin
from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from . import store as s, gateway as g, jobs, upstream, network, resources, maintenance, wechat, weread, library, synthesis

def error(status,msg):raise HTTPException(status,msg)

async def watcher():
    while True:
        await asyncio.sleep(30)
        for u in s.all_users():
            try:
                if s.config('workspace:'+u['id']):
                    await asyncio.to_thread(s.sync_files,u['id'])
                    last=s.config('maintenance:'+u['id'],{}).get('at','')
                    if last[:10]!=s.now()[:10]:await asyncio.to_thread(maintenance.inspect,u['id'])
            except Exception:pass

@asynccontextmanager
async def lifespan(app):
    s.init();jobs.recover();task=asyncio.create_task(watcher())
    async def subscriptions():
        while True:
            await asyncio.sleep(30)
            await asyncio.to_thread(wechat.tick)
    async def knowledge_schedule():
        while True:
            await asyncio.sleep(30)
            await asyncio.to_thread(synthesis.tick)
    subscription_task=asyncio.create_task(subscriptions())
    knowledge_task=asyncio.create_task(knowledge_schedule())
    yield
    task.cancel();subscription_task.cancel();knowledge_task.cancel()

app=FastAPI(title='梯见工作台',lifespan=lifespan,docs_url=None,redoc_url=None)

@app.middleware('http')
async def secure(request,call_next):
    if request.url.hostname not in {'127.0.0.1','localhost','::1'}:return JSONResponse({'detail':'只接受本机访问'},403)
    origin=request.headers.get('origin','')
    if origin and origin not in {str(request.base_url).rstrip('/'),'http://127.0.0.1:5178','http://localhost:5178'}:return JSONResponse({'detail':'请求来源不受信任'},403)
    try:r=await call_next(request)
    except (s.Missing,):return JSONResponse({'detail':'对象不存在或无权访问'},404)
    except s.Conflict as e:return JSONResponse({'detail':str(e)},409)
    except (ValueError,KeyError) as e:return JSONResponse({'detail':str(e) if isinstance(e,ValueError) else '缺少必要字段'},400)
    r.headers['X-Content-Type-Options']='nosniff';r.headers['Referrer-Policy']='no-referrer'
    r.headers['X-Frame-Options']='DENY'
    return r

def user(request:Request):
    token=request.headers.get('authorization','').removeprefix('Bearer ')
    with s.conn() as c:r=c.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND active=1',(s.digest(token),time.time())).fetchone()
    if not r:error(401,'请登录后继续')
    return {k:r[k] for k in ['id','email','name','role']}

def admin(u=Depends(user)):
    if u['role']!='admin':error(403,'仅管理员可操作')
    return u

from . import capabilities
capabilities.register(app,admin)
from . import douyin
douyin.register(app,user,error)
library.register(app,user)
synthesis.register(app,user)

class Auth(BaseModel):
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=10,max_length=200)
    name:str=Field(default='行业创作者',max_length=80)

ATTEMPTS={}
def limit_auth(request):
    key=request.client.host;now=time.time();a=[t for t in ATTEMPTS.get(key,[]) if now-t<60]
    if len(a)>=12:error(429,'尝试次数过多，请一分钟后重试')
    ATTEMPTS[key]=a+[now]

@app.get('/api/health')
def health():return {'ok':True,'version':'0.12.0','persistence':'sqlite+markdown','configured':bool(s.all_users())}

@app.post('/api/auth/register')
def register(data:Auth,request:Request):
    limit_auth(request)
    email=data.email.strip().lower()
    if '@' not in email:error(400,'请输入有效邮箱')
    with s.conn() as c:
        if c.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone():error(409,'此邮箱已注册')
        role='admin' if c.execute('SELECT COUNT(*) FROM users').fetchone()[0]==0 else 'user'
        id=s.uid();c.execute('INSERT INTO users VALUES (?,?,?,?,?,1)',(id,email,data.name,s.password_hash(data.password),role))
    return login(data,request)

@app.post('/api/auth/login')
def login(data:Auth,request:Request):
    limit_auth(request)
    with s.conn() as c:r=c.execute('SELECT * FROM users WHERE email=?',(data.email.strip().lower(),)).fetchone()
    if not r or not r['active'] or not s.password_ok(data.password,r['password']):error(401,'邮箱或密码不正确')
    token=secrets.token_urlsafe(40)
    with s.conn() as c:c.execute('INSERT INTO sessions VALUES (?,?,?)',(s.digest(token),r['id'],time.time()+86400*7))
    return {'token':token,'user':{k:r[k] for k in ['id','email','name','role']}}

@app.post('/api/auth/logout')
def logout(request:Request,u=Depends(user)):
    with s.conn() as c:c.execute('DELETE FROM sessions WHERE token=?',(s.digest(request.headers.get('authorization','').removeprefix('Bearer ')),))
    return {'ok':True}

@app.get('/api/state')
def state(u=Depends(user)):
    data=s.list_(u['id'])
    data=[{k:v for k,v in x.items() if k!='data_uri'} if x['kind']=='illustration' else x for x in data]
    catalogue={x['id']:x for x in data}
    data=[{**x,'freshness_warning':library.freshness(x,catalogue)} if x['kind'] in ['knowledge','memory'] else x for x in data]
    names={p['id']:p['title'] for p in g.public_providers()}
    return {'user':u,'objects':data,'workspace':s.config('workspace:'+u['id']),'settings':s.config('settings:'+u['id'],{'auto_memory':False,'retention':0}),'preferences':s.config('prefs:'+u['id'],{}),'models':[{**m,'provider_title':names.get(m['provider'],'')} for m in s.config('models',[]) if m['verified'] and m['published']],'skills':upstream.catalogue(),'bindings':s.config('bindings',{})}

@app.post('/api/workspace')
def workspace(data:dict,u=Depends(user)):
    old=s.config('workspace:'+u['id'])
    if old and data.get('path') and str(Path(data['path']).resolve())!=old:error(409,'已有工作区请先导出备份，新建位置不会自动迁移原资料')
    path=s.setup_workspace(u['id'],data.get('path'))
    if not s.list_(u['id'],'profile'):
        for name,position in [('小丁说电梯','行业人的直接表达'),('梯视界','行业观察'),('AI电梯局','AI与电梯行业实践')]:
            s.export_object(u['id'],s.put(u['id'],'profile',{'title':name,'position':position,'audience':'待通过访谈确认','style':'直接、口语化、行业人能读懂','status':'draft'}))
    if not s.list_(u['id'],'feed'):
        s.put(u['id'],'feed',{'title':'电梯行业公开资讯','url':'https://news.google.com/rss/search?q=%E7%94%B5%E6%A2%AF&hl=zh-CN&gl=CN&ceid=CN:zh-Hans','type':'rss','source_type':'聚合发现，需核对原文','enabled':True})
    return {'path':path}

def validate_subscription(data,old=None):
    old=old or {}
    url=data.get('feed_url','') or (data.get('url','') if data.get('type',old.get('type'))=='rss' else '')
    if url:
        from urllib.parse import urlparse
        if (urlparse(url).hostname or '').lower()=='mp.weixin.qq.com':
            error(400,'这里需要RSS订阅地址，不能填写公众号文章链接。请将文章链接粘贴到“获取文章”；没有订阅服务时，RSS可以留空。')

PUBLIC_KINDS={'profile','source','content','task','benchmark','feed','publication','metric','plan','feedback','memory','channel','folder'}

@app.post('/api/objects/{kind}')
def create(kind:str,data:dict,u=Depends(user)):
    validate_subscription(data)
    if kind not in PUBLIC_KINDS:error(400,'不支持此对象类型')
    if not str(data.get('title','')).strip():error(400,'请填写名称或标题')
    if kind in ['folder','source','knowledge','memory']:library.validate_folder(u['id'],kind,data)
    if kind=='memory':data['status']='accepted'
    if kind=='task':data={**data,'messages':[]};data.pop('content_id',None)
    if kind=='publication':
        obj=s.get(u['id'],data['content_id'])
        if obj['kind']!='content':error(400,'请选择内容稿件')
        network.public_url(data['url']);data['version_id']=obj['version'];data['evidence']='用户登记';data['status']='published'
    data={k:v for k,v in data.items() if k not in {'id','kind','owner','check','file','file_hash','file_missing','candidates'}}
    if kind=='content':data['status']='draft'
    obj=s.put(u['id'],kind,data)
    return s.export_object(u['id'],obj)

@app.patch('/api/objects/{id}')
def update(id:str,data:dict,u=Depends(user)):
    old=s.get(u['id'],id)
    if old['kind'] in ['folder','source','knowledge','memory']:library.validate_folder(u['id'],old['kind'],{**old,**data},id)
    if old['kind']=='folder' and data.get('library',old.get('library'))!=old.get('library'):error(400,'文件夹不能切换资料类型')
    if old['kind']=='task' and 'reference_scope' in data:data['reference_scope']=library.normalize_scope(u['id'],data['reference_scope'])
    validate_subscription(data,old)
    if old['kind']=='channel' and data.get('platform',old.get('platform'))!=old.get('platform'):
        error(400,'平台账号创建后不能切换平台，请新增账号以隔离登录资料')
    if old['kind'] not in PUBLIC_KINDS|{'knowledge'}:error(400,'此对象请使用对应工作流程')
    forbidden={'id','kind','owner','check','file','file_hash','role','candidate_kind','file_missing','messages','candidates','last_model','evidence_excerpt','source_hashes','generated_body','entries','topic_key','retrieval'}
    if any(k in data for k in forbidden):error(400,'运行记录、核查与生成结果不能通过普通编辑接口修改')
    if old['kind']=='task' and 'content_id' in data:error(400,'会话与成果关联由任务流程维护')
    clean={k:v for k,v in data.items() if k not in forbidden}
    expected=clean.pop('version',None)
    if old['kind']=='content':
        if any(clean.get(k,old.get(k))!=old.get(k) for k in ['body','source_ids','profile_id']):clean['check']=None;clean['status']='draft'
        if clean.get('status')=='final':
            check=old.get('check') or {}
            if check.get('body_hash')!=s.digest(old.get('body','')) or any(x.get('status')!='有依据' for x in check.get('items',[])):error(409,'请先完成当前稿件的事实核查')
            if check.get('evidence_hash')!=jobs.evidence_hash(u['id'],old):error(409,'引用资料或身份偏好已变化，请重新核查后定稿')
    obj=s.put(u['id'],old['kind'],{**old,**clean},id,expected)
    return s.export_object(u['id'],obj)

@app.get('/api/objects/{id}/versions')
def versions(id:str,u=Depends(user)):return s.versions(u['id'],id)

@app.post('/api/content/{id}/candidate/{index}')
def candidate(id:str,index:int,u=Depends(user)):
    obj=s.get(u['id'],id);items=obj.get('candidates',[])
    if obj['kind']!='content':error(400,'请选择稿件')
    if index<0 or index>=len(items):error(404,'候选版本不存在')
    item=items[index]
    return s.export_object(u['id'],s.put(u['id'],'content',{**obj,'body':item['body'],'title':item['title'],'source_ids':item.get('source_ids',obj.get('source_ids',[])),'profile_id':item.get('profile_id',obj.get('profile_id')),'status':'draft','check':None,'candidates':items[:index]+items[index+1:]},id))

@app.post('/api/content/{id}/restore/{version}')
def restore(id:str,version:int,u=Depends(user)):
    obj=s.get(u['id'],id);old=next((x for x in s.versions(u['id'],id) if x['version']==version),None)
    if obj['kind']!='content':error(400,'请选择稿件')
    if not old:error(404,'版本不存在')
    return s.export_object(u['id'],s.put(u['id'],'content',{**obj,'body':old.get('body',''),'check':None,'status':'draft'},id))

@app.post('/api/import/text')
def import_text(data:dict,u=Depends(user)):
    library.validate_folder(u['id'],'source',data)
    if not data.get('body','').strip():error(400,'请提供正文或文稿')
    body=data['body']
    if len(body)>500000:error(400,'正文超过50万字符，请拆分后导入')
    old=next((x for x in s.list_(u['id'],'source') if not x.get('archived') and x.get('body')==body and x.get('benchmark_id')==data.get('benchmark_id') and x.get('url','')==data.get('url','')),None)
    if old and not old.get('archived'):return old
    obj=s.export_object(u['id'],s.put(u['id'],'source',{'title':data.get('title') or '导入资料','body':body,'folder_id':data.get('folder_id') or None,'url':data.get('url',''),'benchmark_id':data.get('benchmark_id'),'published':data.get('published',''),'source_type':data.get('source_type','用户导入'),'status':'ready','acquisition_origin':data.get('acquisition_origin','manual_import'),'acquisition_provider':data.get('acquisition_provider','local'),'discovery_origin':data.get('discovery_origin',''),'discovered_at':data.get('discovered_at',''),'body_saved_at':s.now()}))
    return obj

def maybe_extract(owner,id):
    return None  # Knowledge is distilled only after the user requests it.

@app.post('/api/import/file')
async def import_file(file:UploadFile=File(...),u=Depends(user)):
    from .documents import extract
    raw=await file.read(10_000_001)
    body=await asyncio.to_thread(extract,file.filename or '',raw)
    return import_text({'title':file.filename,'body':body},u)

@app.post('/api/import/url')
def import_url(data:dict,u=Depends(user)):
    url=data.get('url','');network.public_url(url)
    def run(progress,event):
        progress('获取公开页面正文，不下载视频')
        obj=network.article(url)
        if event.is_set():return {'cancelled':True}
        result=import_text({**obj,'benchmark_id':data.get('benchmark_id'),'source_type':'公开网页','acquisition_origin':'manual_url','acquisition_provider':'public'},u)
        return {'source_id':result['id']}
    return jobs.start(u['id'],'导入网页正文',run,{'action':'import','url':url,'benchmark_id':data.get('benchmark_id'),'trigger':'manual_url'})

from . import radar as radar_service
radar_service.register(app,user,error)

@app.post('/api/radar/refresh')
def radar(u=Depends(user)):
    return radar_service.refresh(u['id'])

@app.post('/api/news/{id}/save')
def save_news(id:str,u=Depends(user)):
    n=s.get(u['id'],id)
    existing=next((x for x in s.list_(u['id'],'source') if x.get('news_id')==id),None)
    return existing or s.export_object(u['id'],s.put(u['id'],'source',{'title':n['title'],'body':n.get('body',''),'url':n['url'],'source_type':n.get('source_type',''),'news_id':id,'status':'summary'}))

@app.post('/api/benchmark/{id}/collect')
def collect(id:str,data:dict,u=Depends(user)):
    account=s.get(u['id'],id)
    if account['kind']!='benchmark':error(400,'请选择对标账号')
    validate_subscription(account)
    since=data.get('since','');until=data.get('until','')
    from datetime import date
    try:
        for value in [since,until]:
            if value:date.fromisoformat(value)
    except (TypeError,ValueError):error(400,'请输入有效日期')
    if since and until and since>until:error(400,'开始日期不能晚于结束日期')
    def run(progress,event):
        progress('读取公开页面；历史覆盖将单独报告')
        if not account.get('feed_url'):raise ValueError('请先编辑对标账号，配置RSS/Atom订阅地址；或使用批量文章链接。代表作品不能用于获取账号历史。')
        raw,base=network.fetch(account['feed_url'])
        try:_,entries=upstream.rss.parse_feed(raw)
        except SystemExit:raise ValueError('订阅地址未返回有效RSS/Atom，请检查订阅服务')
        links=list(dict.fromkeys(x.get('url') or x.get('link') for x in entries if x.get('url') or x.get('link')))
        if not links:raise ValueError('没有发现文章链接。单篇文章地址不是账号历史列表；请使用批量链接或配置账号订阅源。')
        good=[];bad=[];outside=0;unknown=0
        for link in links[:100]:
            if event.is_set():break
            try:
                progress(f'读取正文 {len(good)+len(bad)+1}/{len(links)}')
                article=network.article(link)
                match=network.within_dates(article.get('published',''),since,until)
                if match is False:outside+=1;continue
                if match is None:unknown+=1
                record=import_text({**article,'benchmark_id':id,'source_type':'公开文章','acquisition_origin':'manual_catalog','acquisition_provider':'public','date_scope':'日期未知' if match is None else '范围内'},u);good.append(record['id'])
            except Exception:bad.append(link)
        result={'benchmark_id':id,'since':since,'until':until,'found':len(links),'limit':100,'success':len(good),'failed':len(bad),'outside_range':outside,'unknown_date':unknown,'source_ids':good,'coverage':'公开可读样本，不能认定为所选时间范围全量','note':f'跳过日期范围外 {outside} 条；日期未知 {unknown} 条单独保留，不计入期间统计。视频号动态页面可通过文稿导入继续研究。','at':s.now()}
        s.put(u['id'],'collection',{'title':account['title']+'采集记录',**result})
        if not good:raise ValueError('本次没有采集到范围内正文，请查看采集记录，不代表期间采集完成')
        return result
    return jobs.start(u['id'],'获取对标内容：'+account['title'],run,{'action':'collect','benchmark_id':id,**data})

@app.post('/api/tasks/{id}/send')
def send(id:str,data:dict,u=Depends(user)):
    text=data.get('text','').strip()
    if not text:error(400,'请输入要求')
    return jobs.task_turn(u['id'],id,text,data.get('source_ids'),data.get('profile_id'),data.get('mode','writing'),data.get('model_id'),data.get('reference_scope'))

@app.post('/api/content/{id}/check')
def check(id:str,u=Depends(user)):return jobs.check_content(u['id'],id)

@app.post('/api/knowledge/extract')
def extract(data:dict,u=Depends(user)):return jobs.knowledge_extract(u['id'],data.get('source_ids',[]),data.get('profile_id'))

@app.post('/api/knowledge/sync')
def sync(u=Depends(user)):return {'changed':s.sync_files(u['id']),'maintenance':maintenance.inspect(u['id'])}

@app.post('/api/issues/{id}/resolve')
@jobs.serialized
def resolve(id:str,data:dict,u=Depends(user)):
    owner=u['id'];issue=s.get(owner,id)
    if issue['kind']!='issue' or issue.get('archived') or issue.get('status')!='pending':error(409,'待办已经处理')
    if data.get('version') is not None and data['version']!=issue['version']:error(409,'建议已变化，请重新打开后确认')
    action=data.get('action')
    if action not in ['accept','reject','defer','keep_both','use_external','use_app']:error(400,'无效处理方式')
    if action=='defer':return issue
    if issue.get('type')=='file_conflict' and action not in ['use_external','use_app','reject']:error(400,'请选择文件处理方式')
    if issue.get('type')!='file_conflict' and action in ['use_external','use_app']:error(400,'这不是文件冲突')
    result=None
    if issue.get('type')=='file_conflict' and action in ['use_external','use_app']:
        obj=s.get(owner,issue['target']);p=s.safe_file(s.workspace(owner),issue['file'])
        # Recheck external version: never silently overwrite newer external changes.
        if p.read_text(encoding='utf-8')!=issue['local']:error(409,'外部文件再次变化，请重新检查')
        body=issue['local'] if action=='use_external' else issue['proposed']
        p.write_text(body,encoding='utf-8')
        clean=re.sub(r'^---.*?---\s*','',body,count=1,flags=re.S)
        result=s.put(owner,obj['kind'],{**obj,'body':clean,'file_hash':s.digest(body),'check':None,'status':'draft' if obj['kind']=='content' else obj.get('status','ready')},obj['id'])
    elif issue.get('type')=='knowledge_candidate' and action in ['accept','keep_both']:
        result=s.export_object(owner,s.put(owner,issue.get('candidate_kind','knowledge'),{k:v for k,v in {**issue,**{k:v for k,v in data.items() if k in ['title','body','valid_from','valid_to','region']},'status':'accepted','issue_id':id}.items() if k not in ['id','kind','type','version','conflicts']}))
    issue=s.put(owner,'issue',{**issue,'status':'rejected' if action=='reject' else 'resolved','decision':action,'resolved_at':s.now(),'result_id':result['id'] if result else None},id)
    s.audit(owner,'resolve_knowledge',id)
    return issue

@app.post('/api/jobs/{id}/cancel')
def cancel(id:str,u=Depends(user)):return jobs.cancel(u['id'],id)

@app.post('/api/jobs/{id}/retry')
def retry(id:str,u=Depends(user)):
    j=s.get(u['id'],id)
    if j.get('status') not in ['failed','interrupted','cancelled']:error(409,'该任务不需要重试')
    x=j.get('input',{});action=x.get('action')
    if action=='weread_sync':
        row=wechat.object_(u['id'],x.get('subscription_id'),'weread_subscription')
        if row.get('next_check',0)>time.time() and row.get('failures'):error(400,'免费检查正在退避，请处理登录或网络问题后再试')
        return weread.start(u['id'],row,trigger='manual_subscription_check')
    if action=='hotlists':return refresh_hotlists(x,u)
    if action=='wechat_body':
        if x.get('mode')=='browser':error(400,'请在桌面版通过免费采集按钮继续，以便弹出微信验证窗口')
        if x.get('mode')=='cimidata':error(400,'付费正文补采请回到文章库重新选择并确认费用')
        return wechat.collect(u['id'],x['article_ids'],x['benchmark_id'])
    if action=='batch':return WORKFLOWS['batch'](x,u)
    if x.get('distilled_task'):return WORKFLOWS['distill'](x['distilled_task'],u)
    if action=='prepare_profile':return agent.prepare(u['id'],x['task_id'],x.get('model_id'))
    if action=='artifact':
        task=s.get(u['id'],x['task_id']);content=s.get(u['id'],task['content_id']) if task.get('content_id') else None
        return artifacts.confirm(u['id'],x['task_id'],{'version':content['version'] if content else None,'model_id':x.get('model_id')})
    if action=='chat':return jobs.task_turn(u['id'],x['task_id'],x['text'],mode=x.get('mode','writing'),model_id=x.get('model_id'))
    if action=='check':return jobs.check_content(u['id'],x['content_id'])
    if action=='knowledge':return jobs.knowledge_extract(u['id'],x['source_ids'],x.get('profile_id'))
    if action=='synthesis':return synthesis.start(u['id'],x.get('source_ids') or None,trigger='retry')
    if action=='douyin_scan':return douyin.start(u['id'],x['benchmark_id'],x.get('limit',30))
    if action=='douyin_download':return douyin.start(u['id'],x['benchmark_id'],ids=x.get('ids',[]))
    if action=='radar':return radar_service.refresh(u['id'],x.get('feed_id'))
    if action=='import':return import_url(x,u)
    if action=='collect':return collect(x['benchmark_id'],x,u)
    error(400,'此步骤请从原页面重新发起')

@app.get('/api/content/{id}/export')
def export(id:str,format:str='md',u=Depends(user)):
    obj=s.get(u['id'],id)
    if obj['kind']!='content':error(400,'请选择稿件')
    body=illustrations.expanded(u['id'],obj.get('body',''))
    if format=='html':
        # Upstream converts editorial Markdown; strip active HTML before conversion.
        body=re.sub(r'<[^>]*>','',body)
        html=upstream.wechat.convert_markdown_to_wechat_html(body)
        return Response(html,media_type='text/html',headers={'Content-Disposition':'attachment; filename="article.html"','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"})
    return Response(body,media_type='text/markdown',headers={'Content-Disposition':'attachment; filename="article.md"'})

@app.post('/api/settings')
def settings(data:dict,u=Depends(user)):
    settings=data.get('settings',{});prefs=data.get('preferences',{})
    if 'settings' in data:s.set_config('settings:'+u['id'],{**s.config('settings:'+u['id'],{}),**settings})
    if 'preferences' in data:
        for purpose,id in prefs.items():
            if id:g.select(u['id'],purpose,id)
        s.set_config('prefs:'+u['id'],prefs)
    return {'ok':True}

@app.get('/api/backup')
def backup(u=Depends(user)):
    buf=io.BytesIO();root=s.workspace(u['id'])
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('records.json',json.dumps(s.list_(u['id']),ensure_ascii=False,indent=2))
        bindings={b['id']:s.config('wechat.binding:'+u['id']+':'+b['id']) for b in s.list_(u['id'],'benchmark')}
        z.writestr('wechat-bindings.json',json.dumps({k:v for k,v in bindings.items() if v}))
        for p in root.rglob('*'):
            if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root) and p.name!='.workbench-owner':z.write(p,'workspace/'+p.relative_to(root).as_posix())
    return Response(buf.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="tijian-backup.zip"'})

@app.post('/api/backup/import')
async def import_backup(file:UploadFile=File(...),u=Depends(user)):
    raw=await file.read(100_000_001)
    if len(raw)>100_000_000:error(400,'备份文件上限100MB')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            info=z.getinfo('records.json')
            if info.file_size>150_000_000:error(400,'备份记录超过150MB')
            records=json.loads(z.read(info))
            wechat_bindings={}
            if 'wechat-bindings.json' in z.namelist():
                if z.getinfo('wechat-bindings.json').file_size>1_000_000:error(400,'公众号账号映射超出上限')
                wechat_bindings=json.loads(z.read('wechat-bindings.json'))
    except (zipfile.BadZipFile,KeyError,ValueError):error(400,'不是有效的梯见数据备份')
    if not isinstance(records,list) or len(records)>10000:error(400,'无效备份记录')
    kinds=PUBLIC_KINDS|{'knowledge','news','collection','illustration'}|wechat.BACKUP_KINDS|douyin.KINDS
    records=[x for x in records if isinstance(x,dict) and x.get('kind') in kinds and isinstance(x.get('id'),str)]
    if len({x['id'] for x in records})!=len(records):error(400,'备份含有重复记录ID')
    wechat.validate_backup(records)
    record_kinds={x['id']:x['kind'] for x in records}
    if not isinstance(wechat_bindings,dict) or any(not isinstance(v,str) or record_kinds.get(k)!='benchmark' or record_kinds.get(v)!='wechat_account' for k,v in wechat_bindings.items()):error(400,'公众号账号映射格式无效')
    for x in records:
        if x.get('kind')=='illustration':
            import base64
            uri=x.get('data_uri','')
            try:x['data_uri']=illustrations.image_uri(base64.b64decode(uri.split(',',1)[1],validate=True))
            except Exception:error(400,'备份中存在无效配图')
        if any(k in x and not isinstance(x[k],str) for k in ['title','body']):error(400,'备份标题或正文格式无效')
        if any(k in x and not isinstance(x[k],list) for k in ['messages','source_ids']):error(400,'备份会话或引用格式无效')
        if any(not isinstance(v,str) for v in x.get('source_ids',[])):error(400,'备份引用格式无效')
    ids={x['id']:s.uid() for x in records}
    def remap(value):
        if isinstance(value,str):return illustrations.PATTERN.sub(lambda m:'/api/illustrations/'+ids.get(m[1],m[1])+'/file',ids.get(value,value))
        if isinstance(value,list):return [remap(x) for x in value]
        if isinstance(value,dict):return {k:remap(v) for k,v in value.items()}
        return value
    for old in records:
        data=remap({k:v for k,v in old.items() if k not in ['id','kind','owner','version','file','file_hash','file_missing','check','candidates','last_model','role']})
        data['restored_from']=old['id']
        if old['kind']=='content':data['status']='draft'
        kind=old['kind']
        if kind in ('wechat_subscription','weread_subscription','douyin_subscription'):data.update(enabled=False,next_check=0,error='从备份恢复后，请检查连接并手动重新开启订阅')
        if kind=='douyin_work':data.update(files=[],status='catalogued')
        if kind=='task':data['messages']=[{'role':m['role'],'text':str(m.get('text','')),'at':str(m.get('at',''))} for m in data.get('messages',[]) if isinstance(m,dict) and m.get('role') in ['user','assistant']]
        if kind in ['memory','knowledge']:
            data.update(type='knowledge_candidate',candidate_kind=kind,status='pending',body=str(data.get('body','')),source_type='外部备份，待重新确认')
            kind='issue'
        s.export_object(u['id'],s.put(u['id'],kind,data,ids[old['id']]))
    for bid,aid in wechat_bindings.items():s.set_config('wechat.binding:'+u['id']+':'+ids[bid],ids[aid])
    s.audit(u['id'],'import_backup')
    return {'imported':len(records),'note':'以新记录合并导入，已有数据保留。稿件需重新核查。'}

@app.get('/api/admin/state')
def admin_state(u=Depends(admin)):
    with s.conn() as c:logs=[dict(r) for r in c.execute('SELECT * FROM audit ORDER BY created DESC LIMIT 100')]
    return {'providers':g.public_providers(),'models':s.config('models',[]),'bindings':s.config('bindings',{}),'users':s.all_users(),'audit':logs,'resources':upstream.catalogue(),'editorial':resources.list_()}

@app.post('/api/admin/resources')
def resource_save(data:dict,u=Depends(admin)):
    item=resources.save(data);s.audit(u['id'],'save_resource',item['id']);return item

@app.post('/api/admin/providers')
def provider(data:dict,u=Depends(admin)):
    id=g.save_provider(data);s.audit(u['id'],'save_provider',id);return {'id':id}

@app.post('/api/admin/providers/{id}/discover')
def discover(id:str,u=Depends(admin)):
    result=g.discover(id);s.audit(u['id'],'discover_models',id);return result

@app.post('/api/admin/models/{id}/verify')
def verify(id:str,u=Depends(admin)):
    return jobs.start(u['id'],'验证模型能力',lambda progress,event:g.verify(id),{'action':'probe'})

@app.patch('/api/admin/models/{id}')
def model(id:str,data:dict,u=Depends(admin)):
    models=s.config('models',[]);m=next((x for x in models if x['id']==id),None)
    if not m:error(404,'模型不存在')
    if data.get('published') and not m['verified']:error(409,'请先实际验证模型')
    for key in ['title','published']:
        if key in data:m[key]=data[key]
    s.set_config('models',models);s.audit(u['id'],'update_model',id);return m

@app.post('/api/admin/bindings')
def bindings(data:dict,u=Depends(admin)):
    for purpose,id in data.items():
        if id:g.select(u['id'],purpose,id)
    s.set_config('bindings',data);s.audit(u['id'],'update_bindings');return {'ok':True}

@app.patch('/api/admin/users/{id}')
def manage_user(id:str,data:dict,u=Depends(admin)):
    if id==u['id']:error(400,'不能停用自己的当前会话')
    with s.conn() as c:
        c.execute('UPDATE users SET active=? WHERE id=?',(1 if data.get('active') else 0,id))
        if not data.get('active'):c.execute('DELETE FROM sessions WHERE user_id=?',(id,))
    s.audit(u['id'],'update_user',id);return {'ok':True}

@app.get('/api/search')
def search(q:str,u=Depends(user)):
    words=q.strip().lower()
    return [x for x in s.list_(u['id']) if x['kind'] not in ['job','issue'] and not x.get('archived') and words in (x.get('title','')+' '+x.get('body','')).lower()][:50]

from . import agent
agent.register(app,user,error)
from . import artifacts, illustrations
artifacts.register(app,user,error)
illustrations.register(app,user,error)
from . import workflows
WORKFLOWS=workflows.register(app,user,error)
wechat.register(app,user,error)
weread.register(app,user)
from . import hotlists, discovery
discovery.register(app,user,error)
refresh_hotlists=hotlists.register(app,user,error)

DIST=s.ROOT/'dist'
if (DIST/'assets').exists():app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
@app.get('/{path:path}')
def frontend(path:str):
    if path.startswith('api/'):error(404,'接口不存在')
    if (DIST/'index.html').exists():return FileResponse(DIST/'index.html')
    return HTMLResponse('<h1>梯见服务已运行</h1><p>请先构建前端。</p>')
