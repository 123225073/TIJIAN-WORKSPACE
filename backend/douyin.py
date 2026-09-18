"""Local Douyin catalogue, browser handoff, bounded downloads and update notices."""
import re,time,threading,uuid,hashlib
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime,timezone
from fastapi import Depends
from fastapi.responses import FileResponse
from . import store as s,jobs
from .douyin_provider import collect,detail

PENDING={};LOCK=threading.RLock();CONNECTED={}
KINDS={'douyin_work','douyin_subscription','douyin_notice'}

def profile(url):
    p=urlparse(str(url));match=re.fullmatch(r'/user/([A-Za-z0-9_-]{10,200})/?',p.path)
    if p.scheme!='https' or p.hostname not in ('www.douyin.com','douyin.com') or p.username or p.password or not match:raise ValueError('请填写抖音博主的完整个人主页网址（/user/…），不要填写单个视频或分享短链接')
    return match[1]

def account(owner,bid):
    a=s.get(owner,bid)
    if a['kind']!='benchmark' or a.get('platform') not in ('抖音','douyin') or a.get('archived'):raise ValueError('请选择有效的抖音对标账号')
    return a,profile(a.get('url'))

def subscription(owner,bid):return next((x for x in s.list_(owner,'douyin_subscription') if x.get('benchmark_id')==bid and not x.get('archived')),None)
def works(owner,bid,sec):return [x for x in s.list_(owner,'douyin_work') if x.get('benchmark_id')==bid and x.get('sec_uid')==sec and not x.get('archived')]

def read(owner,request,event,progress):
    ticket={**request,'id':uuid.uuid4().hex,'owner':owner,'event':threading.Event(),'cancel':event}
    with LOCK:PENDING[ticket['id']]=ticket
    deadline=time.monotonic()+(420 if request["action"]=="download" else 180)
    try:
        while not ticket['event'].wait(.25):
            if event.is_set():raise InterruptedError('抖音任务已取消；已保存部分仍保留')
            if time.monotonic()>deadline:raise ValueError('抖音页面未及时返回作品，请在平台窗口完成登录或验证后重试')
            if ticket.get('progress'):progress(ticket.pop('progress'))
        if event.is_set():raise InterruptedError('抖音任务已取消')
        data=ticket.get('result',{})
        if data.get('error'):raise ValueError(str(data['error'])[:300])
        return data
    finally:
        with LOCK:PENDING.pop(ticket['id'],None)

def clean(row,sec):
    if not isinstance(row,dict) or row.get('sec_uid')!=sec or not re.fullmatch(r'\d{5,30}',str(row.get('aweme_id',''))):raise ValueError('作品发布账号不匹配，未保存')
    id=str(row['aweme_id']);stamp=row.get('create_time',0)
    try:stamp=int(stamp or 0)
    except (TypeError,ValueError):stamp=0
    if stamp<0 or stamp>time.time()+86400:stamp=0
    desc=str(row.get('description') or '')[:10000]
    return {'aweme_id':id,'sec_uid':sec,'url':'https://www.douyin.com/'+('note/' if row.get('media_type')=='images' else 'video/')+id,'title':desc[:160] or '抖音作品 '+id,'body':desc,'description':desc,'author':str(row.get('author') or '')[:100],'create_time':stamp,'published':datetime.fromtimestamp(stamp,timezone.utc).isoformat() if stamp else '', 'media_type':'images' if row.get('media_type')=='images' else 'video','media_count':max(0,min(int(row.get('media_count') or 0),100)),'metrics':{k:int(v) for k,v in (row.get('metrics') or {}).items() if k in ('like','comment','share','collect') and isinstance(v,int) and v>=0},'observed_at':s.now()}

def ingest(owner,bid,sec,payload,trigger):
    rows=payload.get('items')
    if not isinstance(rows,list) or not rows:raise ValueError('尚未取得带发布账号标识的作品。请打开抖音窗口检查登录、验证或作品可见性；未采集推荐页')
    normalized=[clean(x,sec) for x in rows[:100]]
    with s.LOCK:
        _,current=account(owner,bid)
        if current!=sec:raise ValueError('主页已变更，本次读取已停止')
        known={x['aweme_id']:x for x in works(owner,bid,sec)};added=[];out=[]
        for row in normalized:
            old=known.get(row['aweme_id']);obj=s.put(owner,'douyin_work',{**(old or {}),**row,'benchmark_id':bid,'status':old.get('status','catalogued') if old else 'catalogued','discovery_origin':old.get('discovery_origin',trigger) if old else trigger},old['id'] if old else None)
            if not old:added.append(obj)
            known[row['aweme_id']]=obj;out.append(obj['id'])
        sub=subscription(owner,bid)
        if sub and sub.get('enabled') and sub.get('sec_uid')==sec:
            if sub.get('baseline_at'):
                existing={x.get('work_id') for x in s.list_(owner,'douyin_notice')}
                for row in added:
                    if row['create_time']>=sub['baseline_at'] and row['id'] not in existing:s.put(owner,'douyin_notice',{'title':row['title'],'benchmark_id':bid,'work_id':row['id'],'url':row['url'],'read':False})
            s.put(owner,'douyin_subscription',{**sub,'baseline_at':sub.get('baseline_at') or time.time(),'last_success':s.now(),'last_added':len(added),'error':'','failures':0,'next_check':time.time()+sub['interval_minutes']*60,'coverage':payload.get('coverage','当前已加载作品，可能不完整')},sub['id'])
        return {'douyin':True,'success':len(out),'failed':0,'items':[],'added':len(added),'work_ids':out,'coverage':payload.get('coverage','当前已加载作品，可能不完整')}

def start(owner,bid,limit=30,trigger='manual',ids=None):
    a,sec=account(owner,bid)
    if not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=100:raise ValueError('一次获取数量为1至100条')
    if time.time()-CONNECTED.get(owner,0)>60:raise ValueError('请打开新版桌面软件并登录，抖音需要内置浏览器连接')
    with LOCK:
        if any(x.get('status') in ('queued','running') and x.get('input',{}).get('action','').startswith('douyin_') for x in s.list_(owner,'job')):raise ValueError('已有抖音任务正在执行，请等待或取消')
        selected=[]
        if ids is not None:
            if not isinstance(ids,list) or not 1<=len(ids)<=30:raise ValueError('每次下载请选择1至30个作品')
            for id in dict.fromkeys(ids):
                row=s.get(owner,id)
                if row['kind']!='douyin_work' or row.get('benchmark_id')!=bid or row.get('sec_uid')!=sec or row.get('archived'):raise ValueError('下载项不属于当前博主')
                selected.append(row)
        def run(progress,event):
            try:
                if ids is None:
                    progress('正在读取抖音博主作品；需要验证时请打开抖音窗口')
                    payload=collect(owner,bid,sec,limit,trigger,event,progress,read)
                    return ingest(owner,bid,sec,payload,trigger)
                results=[]
                for row in selected:
                    if event.is_set():break
                    progress('正在下载 '+str(len(results)+1)+'/'+str(len(selected))+'：'+row['title'][:45])
                    try:
                        a,current=account(owner,bid)
                        if current!=sec:raise ValueError('博主主页已变更')
                        folder=(s.workspace(owner)/'09-附件'/'抖音'/bid/row['aweme_id']).resolve()
                        if not folder.is_relative_to(s.workspace(owner)):raise ValueError('附件目录无效')
                        folder.mkdir(parents=True,exist_ok=True)
                        request={'action':'download','url':row['url'],'sec_uid':sec,'aweme_id':row['aweme_id'],'directory':str(folder),'benchmark_id':bid}
                        payload=read(owner,request,event,progress)
                        if payload.get('needs_detail'):
                            detail(owner,bid,sec,row['aweme_id'],event,progress,read)
                            payload=read(owner,request,event,progress)
                        if payload.get('sec_uid')!=sec or payload.get('aweme_id')!=row['aweme_id']:raise ValueError('下载作品身份不一致')
                        files=[]
                        for name in payload.get('files',[]):
                            if not re.fullmatch(r'\d{1,3}\.(mp4|jpg|png|webp)',str(name)):raise ValueError('下载文件名无效')
                            file=folder/name
                            if not file.is_file() or not file.stat().st_size:raise ValueError('下载文件不存在或为空')
                            with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
                            files.append({'name':name,'size':file.stat().st_size,'sha256':digest})
                        if not files:raise ValueError('平台未提供可下载的媒体文件')
                        with s.LOCK:
                            obj=s.get(owner,row['id']);s.put(owner,'douyin_work',{**obj,'files':files,'downloaded_at':s.now(),'status':'downloaded'},obj['id'])
                        results.append({'title':row['title'],'status':'done','work_id':row['id'],'count':len(files)})
                    except Exception as e:results.append({'title':row['title'],'status':'failed','reason':str(e)[:250] if isinstance(e,ValueError) else '下载中断，请检查抖音窗口','work_id':row['id']})
                return {'douyin':True,'success':sum(x['status']=='done' for x in results),'failed':sum(x['status']=='failed' for x in results),'items':results,'coverage':'下载所选作品的可访问媒体；文案另存，未自动转写视频语音'}
            except Exception as e:
                sub=subscription(owner,bid)
                if sub:
                    with s.LOCK:
                        sub=subscription(owner,bid);fails=sub.get('failures',0)+1;s.put(owner,'douyin_subscription',{**sub,'failures':fails,'error':str(e)[:250] if isinstance(e,(ValueError,InterruptedError)) else '检查中断','next_check':time.time()+min(86400,sub['interval_minutes']*60*2**min(fails,4))},sub['id'])
                raise
        return jobs.start(owner,('下载抖音作品：' if ids is not None else '检查抖音作品：')+a['title'],run,{'action':'douyin_download' if ids is not None else 'douyin_scan','benchmark_id':bid,'limit':limit,'ids':ids,'trigger':trigger})

def register(app,user,error):
    @app.get('/api/douyin/pending')
    def pending(u=Depends(user)):
        owner=u['id'];CONNECTED[owner]=time.time()
        with LOCK:
            active=any(x.get('status') in ('queued','running') and x.get('input',{}).get('action','').startswith('douyin_') for x in s.list_(owner,'job'))
            for sub in ([] if active else s.list_(owner,'douyin_subscription')):
                if sub.get('enabled') and not sub.get('archived') and sub.get('next_check',0)<=time.time():
                    try:
                        _,sec=account(owner,sub['benchmark_id'])
                        if sec!=sub['sec_uid']:raise ValueError('博主主页已变更，请重新设置订阅')
                        start(owner,sub['benchmark_id'],trigger='automatic')
                        break
                    except (ValueError,s.Missing) as e:
                        s.put(owner,'douyin_subscription',{**sub,'error':str(e),'next_check':time.time()+300},sub['id'])
            return {'items':[{k:v for k,v in x.items() if k not in ('owner','event','cancel','result','progress')} for x in PENDING.values() if x['owner']==owner and not x['cancel'].is_set()]}
    @app.post('/api/douyin/browser/{id}')
    def accept(id:str,data:dict,u=Depends(user)):
        with LOCK:
            t=PENDING.get(id)
            if not t or t['owner']!=u['id'] or t['cancel'].is_set():raise s.Missing('抖音任务已结束')
            if data.get('progress'):t['progress']=str(data['progress'])[:200]
            else:t['result']=data;t['event'].set()
        return {'ok':True}
    @app.post('/api/douyin/{bid}/scan')
    def scan(bid:str,data:dict,u=Depends(user)):return start(u['id'],bid,data.get('limit',30))
    @app.post('/api/douyin/{bid}/download')
    def download(bid:str,data:dict,u=Depends(user)):return start(u['id'],bid,ids=data.get('ids',[]))
    @app.get('/api/douyin/{bid}/status')
    def status(bid:str,u=Depends(user)):
        a,sec=account(u['id'],bid)
        return {'sec_uid':sec,'works':works(u['id'],bid,sec),'subscription':subscription(u['id'],bid),'notices':[x for x in s.list_(u['id'],'douyin_notice') if x.get('benchmark_id')==bid and not x.get('read')],'connected':time.time()-CONNECTED.get(u['id'],0)<60}
    @app.put('/api/douyin/{bid}/subscription')
    def subscribe(bid:str,data:dict,u=Depends(user)):
        a,sec=account(u['id'],bid);old=subscription(u['id'],bid);minutes=data.get('interval_minutes',old.get('interval_minutes',360) if old else 360)
        if not isinstance(minutes,int) or not 30<=minutes<=10080:raise ValueError('检查间隔为30至10080分钟')
        if not isinstance(data.get('enabled'),bool):raise ValueError('请选择是否启用订阅')
        return s.put(u['id'],'douyin_subscription',{**(old if old and old.get('sec_uid')==sec else {}),'title':a['title']+'更新订阅','benchmark_id':bid,'sec_uid':sec,'enabled':data['enabled'],'interval_minutes':minutes,'next_check':time.time(),'error':''},old['id'] if old else None)
    @app.post('/api/douyin/notices/{id}/read')
    def notice(id:str,u=Depends(user)):
        n=s.get(u['id'],id)
        if n['kind']!='douyin_notice':raise ValueError('请选择更新通知')
        return s.put(u['id'],n['kind'],{**n,'read':True},id)
    @app.post('/api/douyin/works/{id}/save')
    def save(id:str,u=Depends(user)):
        row=s.get(u['id'],id)
        if row['kind']!='douyin_work' or row.get('archived'):raise ValueError('请选择抖音作品')
        existing=next((x for x in s.list_(u['id'],'source') if x.get('douyin_work_id')==id and not x.get('archived')),None)
        if existing:return existing
        return s.export_object(u['id'],s.put(u['id'],'source',{'title':row['title'],'body':row.get('description','')+'\n\n来源：'+row['url']+'\n作者：'+row.get('author','')+'\n说明：这是作品发布文案，未转写视频内的口播或字幕。','url':row['url'],'benchmark_id':row['benchmark_id'],'douyin_work_id':id,'status':'ready','source_type':'抖音发布文案','published':row.get('published','')}))
    @app.get('/api/douyin/works/{id}/file/{index}')
    def file(id:str,index:int,u=Depends(user)):
        row=s.get(u['id'],id)
        if row['kind']!='douyin_work' or row.get('archived') or not 0<=index<len(row.get('files',[])):raise s.Missing('文件不存在')
        root=s.workspace(u['id']);path=(root/'09-附件'/'抖音'/row['benchmark_id']/row['aweme_id']/row['files'][index]['name']).resolve()
        if not path.is_relative_to(root) or not path.is_file():raise s.Missing('本地媒体文件已移动或不存在')
        return FileResponse(path,filename=row['aweme_id']+'-'+path.name)
