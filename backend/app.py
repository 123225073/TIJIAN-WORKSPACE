from __future__ import annotations
import asyncio, csv, io, json, os, re, secrets, sqlite3, time, zipfile
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from urllib.parse import urljoin
from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from . import store as s, gateway as g, jobs, upstream, network, resources, maintenance, wechat, weread, library, synthesis, system_library

def error(status,msg):raise HTTPException(status,msg)

def maintain_user_files(owner):
    if s.config('workspace:'+owner):
        s.sync_files(owner)
        last=s.config('maintenance:'+owner,{}).get('at','')
        if last[:10]!=s.now()[:10]:maintenance.inspect(owner)

async def watcher():
    while True:
        await asyncio.sleep(30)
        try:await asyncio.to_thread(media_studio.tick)
        except Exception:pass
        # All store reads may wait for a writer. Keep them off the ASGI event loop
        # as well as the directory scan, so other requests can keep progressing.
        for u in await asyncio.to_thread(s.all_users):
            try:
                await asyncio.to_thread(maintain_user_files,u['id'])
            except Exception:pass

@asynccontextmanager
async def lifespan(app):
    s.init();system_library.migrate_legacy();jobs.recover();media_studio.recover();task=asyncio.create_task(watcher())
    async def subscriptions():
        while True:
            await asyncio.sleep(30)
            await asyncio.to_thread(wechat.tick)
    async def knowledge_schedule():
        while True:
            await asyncio.sleep(30)
            await asyncio.to_thread(synthesis.tick)
            await asyncio.to_thread(system_library.nightly_tick)
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

@contextmanager
def state_reader():
    # WAL readers can use the last committed snapshot while a background writer
    # holds store.LOCK for filesystem/network work. This connection never writes.
    # DATA/DB are already absolute. Do not resolve a possibly mapped directory on
    # every authentication/state request.
    c=sqlite3.connect(s.DB.as_uri()+'?mode=ro',uri=True,timeout=5)
    c.row_factory=sqlite3.Row
    try:
        c.execute('BEGIN')
        yield c
    finally:c.close()

def user(request:Request):
    token=request.headers.get('authorization','').removeprefix('Bearer ')
    with state_reader() as c:r=c.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND active=1',(s.digest(token),time.time())).fetchone()
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
system_library.register(app,admin)

class Auth(BaseModel):
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=1,max_length=200)
    name:str=Field(default='行业创作者',max_length=80)

ATTEMPTS={}
def limit_auth(request):
    key=request.client.host;now=time.time();a=[t for t in ATTEMPTS.get(key,[]) if now-t<60]
    if len(a)>=12:error(429,'尝试次数过多，请一分钟后重试')
    ATTEMPTS[key]=a+[now]

@app.get('/api/health')
def health():return {'ok':True,'version':'0.23.1','persistence':'sqlite+markdown','configured':bool(s.all_users())}

@app.post('/api/auth/register')
def register(data:Auth,request:Request):
    limit_auth(request)
    if os.environ.get('TIJIAN_ALLOW_SELF_REGISTRATION')!='1':error(403,'请联系管理员创建账号')
    if len(data.password)<10:error(400,'密码至少10个字符')
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
    if not r or not r['active'] or not s.password_ok(data.password,r['password']):error(401,'账号或密码不正确')
    token=secrets.token_urlsafe(40)
    with s.conn() as c:c.execute('INSERT INTO sessions VALUES (?,?,?)',(s.digest(token),r['id'],time.time()+86400*7))
    return {'token':token,'user':{k:r[k] for k in ['id','email','name','role']}}

@app.post('/api/auth/password')
def change_password(data:dict,u=Depends(user)):
    old=str(data.get('old_password',''))
    new=str(data.get('new_password',''))
    if len(new)<10 or len(new)>200:error(400,'新密码需要10至200个字符')
    with s.conn() as c:
        current=c.execute('SELECT password FROM users WHERE id=?',(u['id'],)).fetchone()
        if not current or not s.password_ok(old,current['password']):error(401,'当前密码不正确')
        c.execute('UPDATE users SET password=? WHERE id=?',(s.password_hash(new),u['id']))
    s.audit(u['id'],'change_password')
    return {'ok':True}

@app.post('/api/auth/logout')
def logout(request:Request,u=Depends(user)):
    with s.conn() as c:c.execute('DELETE FROM sessions WHERE token=?',(s.digest(request.headers.get('authorization','').removeprefix('Bearer ')),))
    return {'ok':True}

@app.get('/api/auth/me')
def current_user(u=Depends(user)):
    return {'user':u}

def state_config(c,u):
    keys=['providers','models','bindings','workspace:'+u['id'],'settings:'+u['id'],'prefs:'+u['id']]
    values={r['key']:json.loads(r['value']) for r in c.execute('SELECT key,value FROM config WHERE key IN ('+','.join('?' for _ in keys)+')',keys)}
    providers=values.get('providers',[])
    names={p['id']:p['title'] for p in providers}
    active={p['id'] for p in providers if p.get('published',True)}
    return {'user':u,'workspace':values.get('workspace:'+u['id']),
            'settings':values.get('settings:'+u['id'],{'auto_memory':False,'retention':0}),
            'preferences':values.get('prefs:'+u['id'],{}),
            'models':[{**m,'provider_title':names.get(m['provider'],'')} for m in values.get('models',[]) if m['published'] and m['provider'] in active],
            'skills':upstream.catalogue(),'bindings':values.get('bindings',{})},values.get('models',[])

def public_state_object(x,models):
    if x['kind']=='news':return radar_service.public_news(x)
    if x['kind']=='illustration':return {k:v for k,v in x.items() if k!='data_uri'}
    if x['kind'] not in {'studio_asset','studio_run'}:return x
    # _public looks up model titles once per run. Supply the identical generation
    # metadata from this request's configuration snapshot, with no N+1 reads.
    snap=x.get('snapshot')
    out=media_studio._public({**x,'snapshot':None}) if snap else media_studio._public(x)
    if snap:
        mid=snap.get('model_id','')
        out['generation']={k:snap.get(k) for k in ('input','options','model_id','brand_id','profile_id')}
        out['generation']['model_title']=next((m.get('title',mid) for m in models if m.get('id')==mid),mid)
        if x.get('prompt_original') is not None:out['generation']['prompt_original']=x['prompt_original']
    return out

# These blobs never enter public state, but reading them before filtering used
# to copy/sort/decode tens of MB per refresh. Preserve only the result's presence
# marker used by _public to calculate result_count; the stored JSON is untouched.
STATE_COLUMNS="""id,kind,version,updated,CASE
    WHEN kind='illustration' THEN json_remove(data,'$.data_uri')
    WHEN kind='studio_run' THEN json_replace(data,'$.result.data_uri',length(json_extract(data,'$.result.data_uri'))>0)
    ELSE data END AS data"""

@app.get('/api/bootstrap')
def bootstrap(u=Depends(user)):
    # Only identities/folders and a small conversation index are needed to open
    # navigation and the composer. No history, asset files, or directory traversal.
    with state_reader() as c:
        base,_=state_config(c,u)
        rows=c.execute("SELECT * FROM objects WHERE owner=? AND (kind IN ('profile','folder','studio_brand') OR (kind='job' AND json_extract(data,'$.status') IN ('queued','running'))) ORDER BY updated DESC",(u['id'],)).fetchall()
        tasks=c.execute("SELECT id,kind,version,updated,json_extract(data,'$.title') AS title,json_extract(data,'$.mode') AS mode FROM objects WHERE owner=? AND kind='task' AND COALESCE(json_extract(data,'$.archived'),0)=0 ORDER BY updated DESC LIMIT 8",(u['id'],)).fetchall()
    return JSONResponse({**base,'objects':[s.unpack(r) for r in rows]+[{**dict(r),'summary_only':True} for r in tasks],'complete':False})

@app.get('/api/state')
def state(u=Depends(user)):
    with state_reader() as c:
        base,models=state_config(c,u)
        rows=c.execute('SELECT '+STATE_COLUMNS+' FROM objects WHERE owner=? ORDER BY updated DESC',(u['id'],)).fetchall()
    data=[public_state_object(s.unpack(r),models) for r in rows]
    catalogue={x['id']:x for x in data}
    data=[{**x,'freshness_warning':library.freshness(x,catalogue)} if x['kind'] in ['knowledge','memory'] else x for x in data]
    # Objects/config were already decoded from JSON. Avoid FastAPI recursively
    # walking large historical messages a second time before JSON serialization.
    return JSONResponse({**base,'objects':data,'complete':True})

@app.get('/api/state/updates')
def state_updates(ids:str,u=Depends(user)):
    selected=list(dict.fromkeys(x for x in ids.split(',') if x))
    if len(selected)>100 or any(not re.fullmatch(r'[a-f0-9]{32,64}',x) for x in selected):error(400,'每次最多查询100条有效记录')
    if not selected:return {'items':[]}
    with state_reader() as c:
        _,models=state_config(c,u)
        rows=c.execute('SELECT '+STATE_COLUMNS+' FROM objects WHERE owner=? AND id IN ('+','.join('?' for _ in selected)+')',[u['id'],*selected]).fetchall()
        objects={r['id']:s.unpack(r) for r in rows}
        # A restored workflow also needs unselected document candidates. Read
        # only documents in explicitly requested, owned flows after scope repair.
        flow_ids=[x['id'] for x in objects.values() if x['kind']=='studio_flow']
        if flow_ids:
            for row in c.execute('SELECT '+STATE_COLUMNS+' FROM objects WHERE owner=? AND kind=? '
                                 "AND json_extract(data,'$.flow_id') IN ("+','.join('?' for _ in flow_ids)+')',
                                 [u['id'],'content',*flow_ids]):objects[row['id']]=s.unpack(row)
        # Follow explicit task/result/asset links, always within the same owner's
        # committed snapshot. A completed multi-platform job is applied atomically.
        for _ in range(3):
            linked=set()
            for obj in objects.values():
                for key in ('content_id','profile_id','result_id','cover_asset_id','draft_id'):
                    if isinstance(obj.get(key),str):linked.add(obj[key])
                for key in ('platform_outcomes','media_outcomes','media_runs'):
                    linked.update(x for x in (obj.get(key) or {}).values() if isinstance(x,str))
                linked.update(x for x in (obj.get('asset_ids') or []) if isinstance(x,str))
            linked-=objects.keys()
            if not linked:break
            linked=list(linked)
            for row in c.execute('SELECT '+STATE_COLUMNS+' FROM objects WHERE owner=? AND id IN ('+','.join('?' for _ in linked)+')',[u['id'],*linked]):objects[row['id']]=s.unpack(row)
    return JSONResponse({'items':[public_state_object(x,models) for x in objects.values()]})

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
    if kind=='profile' and data.get('brand_id'):creation.owned(u['id'],data['brand_id'],'studio_brand')
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
    if old['kind']=='profile' and data.get('brand_id'):creation.owned(u['id'],data['brand_id'],'studio_brand')
    if old['kind'] in ['folder','source','knowledge','memory']:library.validate_folder(u['id'],old['kind'],{**old,**data},id)
    if old['kind']=='folder' and data.get('library',old.get('library'))!=old.get('library'):error(400,'文件夹不能切换资料类型')
    if old['kind']=='task' and 'reference_scope' in data:data['reference_scope']=library.normalize_scope(u['id'],data['reference_scope'])
    validate_subscription(data,old)
    if old['kind']=='channel' and data.get('platform',old.get('platform'))!=old.get('platform'):
        error(400,'平台账号创建后不能切换平台，请新增账号以隔离登录资料')
    if old['kind'] not in PUBLIC_KINDS|{'knowledge'}:error(400,'此对象请使用对应工作流程')
    forbidden={'id','kind','owner','check','file','file_hash','role','candidate_kind','file_missing','messages','candidates','last_model','evidence_excerpt','source_hashes','generated_body','entries','topic_key','retrieval'}
    if any(k in data for k in forbidden):error(400,'运行记录、核查与生成结果不能通过普通编辑接口修改')
    if old['kind']=='task' and set(data)&{'content_id','platform_outcomes','media_outcomes','media_runs','pending_creation','identity_skipped','identity_required','active_outcome'}:error(400,'会话与成果关联由任务流程维护')
    clean={k:v for k,v in data.items() if k not in forbidden}
    expected=clean.pop('version',None)
    if old['kind']=='content':
        if any(clean.get(k,old.get(k))!=old.get(k) for k in ['body','source_ids','profile_id']):clean['check']=None;clean['status']='draft'
        if clean.get('status')=='final' and not clean.get('body',old.get('body','')).strip():error(400,'请先填写工作成果，再确认定稿')
    obj=s.put(u['id'],old['kind'],{**old,**clean},id,expected)
    return s.export_object(u['id'],obj)

@app.get('/api/objects/{id}/versions')
def versions(id:str,u=Depends(user)):
    item=s.get(u['id'],id)
    rows=s.versions(u['id'],id)
    if item['kind'] in {'studio_asset','studio_run'}:return [media_studio._public({**x,'id':id,'kind':item['kind']}) for x in rows]
    return rows

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
    import hashlib
    raw=await file.read(20_000_001)
    quota=int(s.config('knowledge_quota:'+u['id'],100_000_000))
    used=sum(int(x.get('original_size') or 0) for x in s.list_(u['id'],'source'))
    if used+len(raw)>quota:error(413,'个人知识库容量不足；当前上限'+str(quota//1_000_000)+'MB，可联系管理员扩容')
    body=await asyncio.to_thread(extract,file.filename or '',raw)
    name=Path(file.filename or '').name
    if not name or len(name)>180:error(400,'文件名无效或过长')
    id=s.uid()
    original=s.DATA/'personal-library'/u['id']/id/name
    original.parent.mkdir(parents=True,exist_ok=True)
    original.write_bytes(raw)
    try:
        obj=s.export_object(u['id'],s.put(u['id'],'source',{'title':name,'body':body,'source_type':'用户上传','status':'ready','original_size':len(raw),'original_sha256':hashlib.sha256(raw).hexdigest(),'original_name':name,'body_saved_at':s.now()} ,id))
    except Exception:
        original.unlink(missing_ok=True)
        raise
    return obj

@app.get('/api/knowledge/quota')
def knowledge_quota(u=Depends(user)):
    return {'limit':int(s.config('knowledge_quota:'+u['id'],100_000_000)),
            'used':sum(int(x.get('original_size') or 0) for x in s.list_(u['id'],'source'))}

@app.get('/api/knowledge/original/{id}')
def personal_original(id:str,u=Depends(user)):
    import hashlib
    obj=s.get(u['id'],id)
    if obj['kind']!='source' or not obj.get('original_name'):error(404,'原始文件不存在')
    path=(s.DATA/'personal-library'/u['id']/id/obj['original_name']).resolve()
    if not path.is_relative_to((s.DATA/'personal-library'/u['id']).resolve()) or not path.is_file():error(404,'原始文件缺失')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=obj['original_sha256']:error(409,'原始文件校验失败')
    return FileResponse(path,filename=obj['original_name'])

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
    return existing or s.export_object(u['id'],s.put(u['id'],'source',{'title':n['title'],'body':n.get('body',''),'url':radar_service.article_reference(n)['article_url'] or n['url'],'source_type':n.get('source_type',''),'news_id':id,'status':'summary'}))

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
    mode=data.get('mode') or s.get(u['id'],id).get('mode','auto')
    if mode=='auto':
        from .assistant_workspace import turn
        return turn(u['id'],id,text,data.get('source_ids'),data.get('profile_id'),data.get('model_id'),data.get('reference_scope'),data.get('skip_profile') is True)
    return jobs.task_turn(u['id'],id,text,data.get('source_ids'),data.get('profile_id'),mode,data.get('model_id'),data.get('reference_scope'))

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

@app.get('/api/jobs/{id}')
def job_state(id:str,u=Depends(user)):
    item=s.get(u['id'],id)
    if item['kind']!='job':error(404,'任务不存在')
    return item

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
        from . import wechat_layout
        html=wechat_layout.render(body,obj.get('wechat_style'))
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
    from . import studio_backup
    buf=io.BytesIO();root=s.workspace(u['id'])
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        records=studio_backup.export(u['id'],s.list_(u['id']),z)
        z.writestr('records.json',json.dumps(records,ensure_ascii=False,indent=2))
        bindings={b['id']:s.config('wechat.binding:'+u['id']+':'+b['id']) for b in s.list_(u['id'],'benchmark')}
        z.writestr('wechat-bindings.json',json.dumps({k:v for k,v in bindings.items() if v}))
        for p in root.rglob('*'):
            if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root) and p.name!='.workbench-owner':z.write(p,'workspace/'+p.relative_to(root).as_posix())
    if buf.tell()>100_000_000:error(400,'便携备份超过100MB，请先单独保存较大的媒体文件')
    return Response(buf.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="tijian-backup.zip"'})

@app.post('/api/backup/import')
async def import_backup(file:UploadFile=File(...),u=Depends(user)):
    from . import studio_backup
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
    kinds=PUBLIC_KINDS|{'knowledge','news','collection','illustration'}|wechat.BACKUP_KINDS|douyin.KINDS|studio_backup.KINDS
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
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        studio_backup.validate(records,archive)
        restored_media=studio_backup.import_assets(u['id'],records,archive,ids)
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
        if kind in studio_backup.KINDS:data=studio_backup.restored_data(kind,data,restored_media.get(old['id']))
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
    users=[{**x,'knowledge_quota_mb':int(s.config('knowledge_quota:'+x['id'],100_000_000))//1_000_000} for x in s.all_users()]
    return {'providers':g.public_providers(),'models':s.config('models',[]),'bindings':s.config('bindings',{}),'users':users,'audit':logs,'resources':upstream.catalogue(),'editorial':resources.list_()}

@app.post('/api/admin/resources')
def resource_save(data:dict,u=Depends(admin)):
    item=resources.save(data);s.audit(u['id'],'save_resource',item['id']);return item

@app.post('/api/admin/providers')
def provider(data:dict,u=Depends(admin)):
    id=g.save_provider(data);s.audit(u['id'],'save_provider',id);return {'id':id}

@app.post('/api/admin/providers/{id}/discover')
def discover(id:str,u=Depends(admin)):
    result=g.discover(id);s.audit(u['id'],'discover_models',id);return result

@app.patch('/api/admin/providers/{id}')
def provider_status(id:str,data:dict,u=Depends(admin)):
    if set(data)!={'published'}:error(400,'只能更改上架状态')
    result=g.set_provider_published(id,data['published']);s.audit(u['id'],'provider_status',id);return result

@app.post('/api/admin/models/{id}/verify')
def verify(id:str,u=Depends(admin)):
    return jobs.start(u['id'],'验证模型能力',lambda progress,event:g.verify(id),{'action':'probe','model_id':id})

@app.patch('/api/admin/models/{id}')
def model(id:str,data:dict,u=Depends(admin)):
    models=s.config('models',[]);m=next((x for x in models if x['id']==id),None)
    if not m:error(404,'模型不存在')
    if set(data)-{'title','published'}:error(400,'模型字段不受支持')
    if 'published' in data and type(data['published']) is not bool:error(400,'上架状态无效')
    if data.get('published'):
        p=next((x for x in g.providers() if x['id']==m['provider']),None)
        if not p or not p.get('published',True):error(409,'请先上架服务平台')
    for key in ['title','published']:
        if key in data:m[key]=data[key]
    s.set_config('models',models);s.audit(u['id'],'update_model',id);return m

@app.post('/api/admin/bindings')
def bindings(data:dict,u=Depends(admin)):
    for purpose,id in data.items():
        if purpose in media_studio.TOOLS:
            media_studio.validate_binding(purpose,id)
        elif id:g.select(u['id'],purpose,id)
    s.set_config('bindings',data);s.audit(u['id'],'update_bindings');return {'ok':True}

@app.patch('/api/admin/users/{id}')
def manage_user(id:str,data:dict,u=Depends(admin)):
    if id==u['id']:error(400,'不能停用自己的当前会话')
    with s.conn() as c:
        c.execute('UPDATE users SET active=? WHERE id=?',(1 if data.get('active') else 0,id))
        if not data.get('active'):c.execute('DELETE FROM sessions WHERE user_id=?',(id,))
    s.audit(u['id'],'update_user',id);return {'ok':True}

@app.patch('/api/admin/users/{id}/knowledge-quota')
def set_knowledge_quota(id:str,data:dict,u=Depends(admin)):
    if id not in {x['id'] for x in s.all_users()}:error(404,'用户不存在')
    value=data.get('limit_mb')
    if type(value) is not int or not 100<=value<=10240:error(400,'知识库容量须在100至10240MB之间')
    s.set_config('knowledge_quota:'+id,value*1_000_000)
    s.audit(u['id'],'knowledge_quota',id)
    return {'user_id':id,'limit':value*1_000_000}

@app.post('/api/admin/users')
def create_user(data:Auth,u=Depends(admin)):
    email=data.email.strip().lower()
    if '@' not in email:error(400,'请输入有效邮箱')
    if len(data.password)<10:error(400,'密码至少10个字符')
    with s.conn() as c:
        if c.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone():error(409,'此邮箱已存在')
        id=s.uid()
        c.execute('INSERT INTO users VALUES (?,?,?,?,?,1)',(id,email,data.name.strip() or '创作者',s.password_hash(data.password),'user'))
    s.audit(u['id'],'create_user',id)
    return {'id':id,'email':email}

@app.get('/api/search')
def search(q:str,u=Depends(user)):
    words=q.strip().lower()
    rows=[x for x in s.list_(u['id']) if x['kind'] not in ['job','issue'] and not x.get('archived') and words in (x.get('title','')+' '+x.get('body','')).lower()][:50]
    return [media_studio._public(x) if x['kind'] in {'studio_asset','studio_run'} else x for x in rows]

from . import agent
agent.register(app,user,error)
from . import artifacts, illustrations
from . import assistant_workspace
assistant_workspace.register(app,user)
artifacts.register(app,user,error)
illustrations.register(app,user,error)
from . import creation
creation.register(app,user,admin,error)
from . import topics
topics.register(app,user,error)
from . import wechat_publish
wechat_publish.register(app,user)
from . import interviews
interviews.register(app,user)
from . import media_studio, benchmark_api
media_studio.register(app,user,admin,error)
benchmark_api.register(app,user,admin,error)
from . import workflows
WORKFLOWS=workflows.register(app,user,error)
wechat.register(app,user,error)
weread.register(app,user)
from . import hotlists, discovery
discovery.register(app,user,error)
refresh_hotlists=hotlists.register(app,user,error)

DIST=s.ROOT/'dist'
if (DIST/'assets').exists():app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
if (DIST/'visuals').exists():app.mount('/visuals',StaticFiles(directory=DIST/'visuals'),name='visuals')
@app.get('/{path:path}')
def frontend(path:str):
    if path.startswith('api/'):error(404,'接口不存在')
    if path in {'admin','admin/','admin.html'} and (DIST/'admin.html').exists():return FileResponse(DIST/'admin.html')
    if (DIST/'index.html').exists():return FileResponse(DIST/'index.html')
    return HTMLResponse('<h1>梯见服务已运行</h1><p>请先构建前端。</p>')
