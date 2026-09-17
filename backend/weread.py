"""Free, bounded WeRead subscription adapter; protocol reference: we-mp-rss (MIT).
Independent implementation; no upstream server, shelf mutations or Cimi calls.
"""
import base64,json,re,time,threading
from datetime import datetime,timezone,timedelta
import httpx
from bs4 import BeautifulSoup
from fastapi import Depends
from . import store as s,gateway as g,wechat as w,jobs,network

LOCKS={};LAST={}
class AuthError(ValueError):pass
class ListUnavailable(ValueError):pass

def book_id(biz):
    try:value=base64.b64decode(biz,validate=True).decode('ascii')
    except Exception:raise ValueError('无法从发布账号标识确认微信读书账号') from None
    if not re.fullmatch(r'\d{5,20}',value):raise ValueError('公众号标识不能转换为微信读书账号')
    return 'MP_WXS_'+value

def settings(owner):return {'configured':bool(s.config('weread.cookie:'+owner)), 'error':s.config('weread.auth_error:'+owner,''),'saved_at':s.config('weread.saved:'+owner,'')}
def request(owner,path,params):
    if path not in ['/web/mp/articles','/api/mp/cover','/web/mp/content']:raise ValueError('不支持的微信读书接口')
    if s.config('weread.auth_error:'+owner):raise AuthError('微信读书登录已失效，请重新登录并保存会话')
    encrypted=s.config('weread.cookie:'+owner)
    if not encrypted:raise AuthError('请先登录微信读书并保存本次会话')
    try:cookie=g.cipher().decrypt(encrypted.encode()).decode()
    except Exception:raise AuthError('微信读书会话无法读取，请重新连接') from None
    with s.LOCK:lock=LOCKS.setdefault(owner,threading.Lock())
    with lock:
        time.sleep(max(0,2-(time.monotonic()-LAST.get(owner,0))));LAST[owner]=time.monotonic()
        try:
            with httpx.Client(timeout=20,trust_env=False,follow_redirects=False) as client:
                with client.stream('GET','https://weread.qq.com'+path,params=params,headers={'Cookie':cookie,'Referer':'https://weread.qq.com/','User-Agent':'Mozilla/5.0','Accept':'application/json,text/html'}) as response:
                    raw=bytearray()
                    for part in response.iter_bytes():
                        raw.extend(part)
                        if len(raw)>4_000_000:raise ValueError('微信读书响应过大，已停止')
                    status=response.status_code
        except httpx.HTTPError:raise ValueError('微信读书网络请求失败；已退避，不立即重试') from None
    try:payload=json.loads(raw)
    except ValueError:payload=None
    code=(payload.get('errCode',payload.get('errcode',0)) if isinstance(payload,dict) else 0)
    nested=payload.get('data') if isinstance(payload,dict) else None
    if isinstance(nested,dict):code=nested.get('errcode',code)
    if status in (401,403) or str(code) in ('-2010','-2012'):
        s.set_config('weread.auth_error:'+owner,'登录失效或访问受限，请在微信读书窗口确认后重新保存会话')
        raise AuthError('登录失效或访问受限，免费自动检查已暂停')
    if status==429:raise ValueError('微信读书限制访问频率，已延长检查间隔')
    if path=='/web/mp/articles' and (status in (404,410) or str(code)=='-2041'):raise ListUnavailable('文章列表暂不可用')
    if status!=200 or str(code) not in ('0','None',''):raise ValueError('微信读书未返回有效数据，已停止本次检查')
    if path=='/web/mp/content':return bytes(raw).decode('utf-8',errors='replace')
    if not isinstance(payload,dict):raise ValueError('微信读书数据格式变化，未更新同步位置')
    return payload

def sub(owner,bid):return next((x for x in s.list_(owner,'weread_subscription') if x['benchmark_id']==bid and not x.get('archived')),None)

def entry(review,account,group_time=0):
    book=book_id(account['biz']);rid=str(review.get('reviewId') or '')
    if not rid.startswith(book+'_'):raise ValueError('文章所属微信读书账号与当前公众号不一致')
    token=rid[len(book)+1:]
    if not re.fullmatch(r'[A-Za-z0-9_~=-]{4,300}',token):raise ValueError('微信读书文章标识无效')
    info=review.get('mpInfo') or {};url='https://mp.weixin.qq.com/s/'+token
    if info.get('originalId') and info['originalId']!=token:raise ValueError('微信读书原文标识不一致')
    stamp=info.get('time') or review.get('createTime') or group_time
    try:published=datetime.fromtimestamp(float(stamp),timezone(timedelta(hours=8))).date().isoformat() if stamp else ''
    except (ValueError,TypeError,OverflowError,OSError):published=''
    return {'title':str(info.get('title') or review.get('title') or '公众号文章')[:500],'url':url,'article_key':w.canonical(url)[1],'biz':account['biz'],'account_id':account['id'],'published':published,'published_at':datetime.fromtimestamp(float(stamp),timezone.utc).isoformat() if published else '', 'review_id':rid,'provider':'weread','short_url':url}

def check(owner,id,progress,event):
    from .app import import_text
    state=w.object_(owner,id,'weread_subscription');bid=state['benchmark_id'];account=w.object_(owner,state['account_id'],'wechat_account')
    w.object_(owner,bid,'benchmark')
    if s.config('wechat.binding:'+owner+':'+bid)!=account['id']:raise ValueError('公众号绑定已变化，请重新开启免费订阅')
    first=not state.get('baseline_at');offset=int(state.get('cursor') or 0);found=[];seen=set();coverage='本轮页数已达上限，保留补漏位置';partial=True;mode='list'
    try:
        for _ in range(3):
            if event.is_set():raise InterruptedError('已取消免费检查')
            progress('正在免费检查公众号更新')
            try:payload=request(owner,'/web/mp/articles',{'bookId':book_id(account['biz']),'offset':offset})
            except ListUnavailable:
                if offset:raise ValueError('补漏过程中列表失效，已保留位置')
                cover=request(owner,'/api/mp/cover',{'bookId':book_id(account['biz'])})
                found=[entry({'reviewId':cover.get('reviewId'),'title':cover.get('title')},account)]
                coverage='降级：只能发现最新一篇，多篇更新或离线期间可能漏文';mode='latest';offset=0;break
            groups=payload.get('reviews')
            if not isinstance(groups,list):raise ValueError('微信读书列表格式变化，未更新同步位置')
            known={x.get('review_id') for x in s.list_(owner,'wechat_article') if x.get('account_id')==account['id'] and x.get('weread_list_seen')}
            hit=False
            for group in groups:
                if not isinstance(group,dict) or not isinstance(group.get('subReviews',[]),list):raise ValueError('微信读书文章分组无效')
                for row in group.get('subReviews',[]):
                    review=row.get('review') or {};review={**review,'reviewId':review.get('reviewId') or row.get('reviewId')}
                    item=entry(review,account,group.get('createTime'));rid=item['review_id']
                    if rid in seen:continue
                    seen.add(rid);found.append(item);hit=hit or rid in known
            offset+=len(groups)
            if first or not groups or hit:
                coverage='首轮建立当前基线；更早历史未扫描' if first else '已检查至已知文章或来源末页'
                partial=False;offset=0;break
        # Commit catalogue only after all fetched pages validate. Missing bodies are separate.
        if event.is_set():raise InterruptedError('已取消免费检查')
        baseline=state.get('baseline_at') or s.now();rows=[];added=0
        for item in found:
            existing=next((x for x in s.list_(owner,'wechat_article') if x.get('account_id')==account['id'] and (x.get('review_id')==item['review_id'] or x.get('url')==item['url'] or x.get('short_url')==item['url'])),None)
            if existing:
                if existing.get('archived'):continue
                record=s.put(owner,'wechat_article',{**existing,'review_id':item['review_id'],'weread_list_seen':existing.get('weread_list_seen') or mode=='list'},existing['id'])
            else:
                record=s.put(owner,'wechat_article',{**item,'status':'discovered','discovered_at':s.now(),'weread_list_seen':mode=='list'});added+=1
            rows.append(record)
            # Baseline is current visible history, never notify backfill predating it.
            fresh=not first and not existing and (not item['published_at'] or item['published_at']>=baseline)
            if fresh and not any(n.get('article_id')==record['id'] and n.get('benchmark_id')==bid for n in s.list_(owner,'wechat_notice')):
                s.put(owner,'wechat_notice',{'title':record['title'],'url':record['url'],'article_id':record['id'],'account_id':account['id'],'benchmark_id':bid,'read':False,'provider':'weread'})
        current=s.get(owner,id)
        s.put(owner,'weread_subscription',{**current,'baseline_at':baseline,'cursor':offset,'coverage':coverage,'mode':mode,'partial':partial},id)
        failures=0;saved=0
        if state.get('auto_body'):
            # Retry a bounded backlog, including bodies no longer on the first page.
            candidates=[]
            for x in s.list_(owner,'wechat_article'):
                if x.get('account_id')!=account['id'] or x.get('archived') or not x.get('review_id') or x.get('status')=='body_saved' or x.get('body_retry_at',0)>time.time():continue
                candidates.append(x)
            candidates=sorted(candidates,key=lambda x:x.get('body_retry_at',0))[:10]
            for item in candidates:
                if event.is_set():raise InterruptedError('已取消免费检查')
                progress('正在免费保存正文：'+item['title'])
                try:
                    html=request(owner,'/web/mp/content',{'reviewId':item['review_id']});soup=BeautifulSoup(html,'html.parser');network.reject_blocked(soup,item['url']);content=soup.select_one('#js_content, .rich_media_content')
                    if content is None:raise ValueError('微信读书未返回正文，已保留目录，下轮补采')
                    for el in content.select('script,style,iframe'):el.decompose()
                    body=content.get_text('\n',strip=True)
                    if len(body)<100:raise ValueError('正文过短，未保存')
                    if event.is_set():raise InterruptedError('已取消免费检查')
                    source=import_text({'title':item['title'],'url':item['url'],'body':body[:100000],'published':item['published'],'benchmark_id':bid,'source_type':'微信读书免费订阅'}, {'id':owner})
                    s.put(owner,'wechat_article',{**s.get(owner,item['id']),'source_id':source['id'],'status':'body_saved','error':'','body_method':'weread'},item['id']);saved+=1
                except AuthError:raise
                except ValueError as e:
                    failures+=1;s.put(owner,'wechat_article',{**s.get(owner,item['id']),'status':'failed','error':str(e),'body_retry_at':time.time()+3600},item['id'])
        current=s.get(owner,id)
        s.put(owner,'weread_subscription',{**current,'baseline_at':baseline,'cursor':offset,'coverage':coverage,'mode':mode,'partial':partial,'last_success':s.now(),'last_added':added,'error':f'{failures} 篇正文未保存，将在后续检查补采' if failures else '', 'failures':0,'next_check':time.time()+(300 if offset else current['interval_minutes']*60)},id)
        return {'added':added,'saved':saved,'body_failed':failures,'coverage':coverage,'provider':'weread','paid_calls':0}
    except Exception as e:
        current=s.get(owner,id);n=int(current.get('failures',0))+1
        s.put(owner,'weread_subscription',{**current,'error':str(e) if isinstance(e,ValueError) else '免费检查中断，保留同步位置','failures':n,'next_check':time.time()+min(86400,1800*2**min(n-1,5))},id)
        raise

def start(owner,state):
    with s.LOCK:
        if any(j.get('input',{}).get('action')=='weread_sync' and j.get('status') in ['queued','running'] and j['input'].get('subscription_id')==state['id'] for j in s.list_(owner,'job')):raise ValueError('免费检查正在进行，请稍候')
        return jobs.start(owner,'公众号免费订阅检查',lambda p,e:check(owner,state['id'],p,e),{'action':'weread_sync','benchmark_id':state['benchmark_id'],'subscription_id':state['id']})
def tick():
    for user in s.all_users():
        owner=user['id']
        if not user['active'] or s.config('weread.auth_error:'+owner):continue
        for row in s.list_(owner,'weread_subscription'):
            if row.get('enabled') and not row.get('archived') and row.get('next_check',0)<=time.time():
                try:start(owner,row)
                except ValueError:pass

def register(app,user):
    @app.get('/api/weread/status/{bid}')
    def status(bid:str,u=Depends(user)):
        w.object_(u['id'],bid,'benchmark');return {**settings(u['id']),'subscription':sub(u['id'],bid),'notices':[x for x in s.list_(u['id'],'wechat_notice') if x.get('benchmark_id')==bid and x.get('provider')=='weread' and not x.get('archived') and not x.get('read')]}
    @app.put('/api/weread/session')
    def session(data:dict,u=Depends(user)):
        cookie=str(data.get('cookie') or '')
        if len(cookie)>16000 or '\r' in cookie or '\n' in cookie or 'wr_' not in cookie:raise ValueError('未发现微信读书登录会话，请先在窗口完成登录')
        owner=u['id'];s.set_config('weread.cookie:'+owner,g.cipher().encrypt(cookie.encode()).decode());s.set_config('weread.auth_error:'+owner,'');s.set_config('weread.saved:'+owner,s.now())
        for row in s.list_(owner,'weread_subscription'):
            if row.get('enabled') and not row.get('archived'):s.put(owner,'weread_subscription',{**row,'failures':0,'next_check':time.time(),'error':''},row['id'])
        return settings(owner)
    @app.post('/api/weread/bind/{bid}')
    def bind(bid:str,data:dict,u=Depends(user)):
        from .discovery import wechat_identity
        owner=u['id'];w.object_(owner,bid,'benchmark');url,_,_=w.canonical(data.get('url',''));raw,final=network.fetch(url);identity=wechat_identity(raw,final);book_id(identity['biz'])
        old=next((x for x in s.list_(owner,'wechat_account') if x['biz']==identity['biz'] and not x.get('archived')),None)
        account=old or s.put(owner,'wechat_account',{'title':identity['name'],'biz':identity['biz'],'wxid':'','article_url':url,'provider':'weread','verified_at':s.now()})
        s.set_config('wechat.binding:'+owner+':'+bid,account['id']);return account
    @app.put('/api/weread/subscription/{bid}')
    def save(bid:str,data:dict,u=Depends(user)):
        owner=u['id'];w.object_(owner,bid,'benchmark');old=sub(owner,bid)
        if data.get('enabled') is not True:
            for job in s.list_(owner,'job'):
                if job.get('input',{}).get('action')=='weread_sync' and job['input'].get('benchmark_id')==bid and job['id'] in jobs.CANCEL:jobs.CANCEL[job['id']].set()
            if old:return s.put(owner,'weread_subscription',{**old,'enabled':False},old['id'])
            return {'enabled':False}
        if not settings(owner)['configured'] or settings(owner)['error']:raise ValueError('请先连接有效的微信读书会话')
        aid=s.config('wechat.binding:'+owner+':'+bid);account=w.object_(owner,aid,'wechat_account');book_id(account['biz'])
        keep=old if old and old['account_id']==aid else {}
        return s.put(owner,'weread_subscription',{**keep,'title':'公众号免费订阅','benchmark_id':bid,'account_id':aid,'enabled':True,'interval_minutes':w.integer(data.get('interval_minutes',60),30,1440,'检查间隔'),'auto_body':data.get('auto_body') is True,'next_check':time.time(),'error':''},old['id'] if old else None)
    @app.post('/api/weread/check/{bid}')
    def manual(bid:str,u=Depends(user)):
        w.object_(u['id'],bid,'benchmark');row=sub(u['id'],bid)
        if not row:raise ValueError('请先开启免费订阅')
        if row.get('failures') and row.get('next_check',0)>time.time():raise ValueError('上次检查失败，正在退避等待；请先处理登录或网络问题')
        return start(u['id'],row)
