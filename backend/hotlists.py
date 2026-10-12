"""Fixed public hotlist sources; bounded fallback and honest snapshot timestamps.

60s main now has strict daily limits. Verified public instances are listed at
https://docs.60s-api.viki.moe/7306811m0 (checked 2026-10-12).
They are community aggregators, not authenticated platform APIs.
"""
import json,time,threading
from datetime import datetime,timezone,timedelta
from urllib.parse import urlparse,urljoin
import httpx
from fastapi import Depends
from . import store as s,network,jobs

PLATFORMS={'weibo':'微博','zhihu':'知乎','toutiao':'今日头条','douyin':'抖音','rednote':'小红书','baidu/hot':'百度'}
SOURCES=('https://60s.viki.moe','https://60s.crystelf.top','https://60s.7se.cn')
CACHE_SECONDS=300
SOURCE_SECONDS=10
LOCKS={p:threading.Lock() for p in PLATFORMS}


def _fetch(url):
    """Reuse public-target validation, with a smaller hotlist-specific budget."""
    deadline=time.monotonic()+SOURCE_SECONDS
    with httpx.Client(timeout=httpx.Timeout(4,connect=3),follow_redirects=False,trust_env=False,
                      headers={'User-Agent':'Mozilla/5.0 TijianResearch/0.1'}) as client:
        for _ in range(3):
            if time.monotonic()>=deadline:raise ValueError('请求超时')
            target,headers,extensions=network.public_target(url)
            with client.stream('GET',target,headers=headers,extensions=extensions) as response:
                if response.is_redirect:
                    url=urljoin(url,response.headers['location']);continue
                response.raise_for_status()
                if 'json' not in response.headers.get('content-type',''):raise ValueError('上游未返回榜单JSON')
                data=bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data)>4_000_000:raise ValueError('榜单响应过大')
                    if time.monotonic()>=deadline:raise ValueError('请求超时')
                return bytes(data).decode('utf-8-sig'),url
    raise ValueError('榜单重定向过多')


def _date(value):
    if value in (None,''):return ''
    try:
        if isinstance(value,(int,float)) or str(value).isdigit():
            value=float(value);dt=datetime.fromtimestamp(value/1000 if value>100000000000 else value,timezone.utc)
        else:
            dt=datetime.fromisoformat(str(value).replace('/','-').replace('Z','+00:00'))
            if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone(timedelta(hours=8)))
        if dt.year<2000 or dt.timestamp()>time.time()+600:return ''
        return dt.astimezone(timezone.utc).isoformat()
    except (ValueError,TypeError,OverflowError,OSError):return ''


def normalize(raw):
    payload=json.loads(raw)
    if not isinstance(payload,dict) or payload.get('code')!=200:raise ValueError('热点服务暂不可用')
    rows=payload.get('data')
    if isinstance(rows,dict):rows=rows.get('data')
    if not isinstance(rows,list):raise ValueError('热点服务返回格式发生变化')
    result=[];seen=set()
    for rank,row in enumerate(rows[:60],1):
        if not isinstance(row,dict):continue
        url=row.get('link') or row.get('url') or ''
        if not isinstance(url,str):continue
        parsed=urlparse(url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:continue
        title=str(row.get('title','')).strip()[:500]
        if not title or url in seen:continue
        seen.add(url)
        item={'rank':rank,'title':title,'url':url,'body':str(row.get('detail') or row.get('desc') or '')[:2000],
              'heat':str(next((row[k] for k in ('hot_value_desc','score_desc','hot_value','hot','score') if row.get(k) not in (None,'')),'未提供'))[:80]}
        published=_date(row.get('created_at') or row.get('created') or row.get('event_time_at') or row.get('event_time'))
        active=_date(row.get('active_time_at') or row.get('active_time'))
        if published:item['published_at']=published
        if active:item['active_at']=active
        result.append(item)
    if not result:raise ValueError('本次热榜未返回有效条目')
    return result


def snapshot(platform):
    if platform not in PLATFORMS:raise ValueError('不支持的平台')
    with LOCKS[platform]:
        key='public-hotlist:'+platform;cached=s.config(key,{})
        if time.time()-cached.get('attempt',0)<CACHE_SECONDS:
            return {**cached,'cache_hit':True,'freshness':'stale' if cached.get('error') else 'cached'}
        attempts=[];new=None
        for base in SOURCES:
            url=base+'/v2/'+platform
            try:
                raw,final=_fetch(url);items=normalize(raw);payload=json.loads(raw)
                meta=payload.get('data') if isinstance(payload.get('data'),dict) else payload
                upstream=next((_date(meta[k]) for k in ('updated_at','update_time','last_update') if meta.get(k) and _date(meta[k])), '')
                if not upstream:upstream=max((x.get('active_at','') for x in items),default='')
                if upstream and time.time()-datetime.fromisoformat(upstream).timestamp()>86400:raise ValueError('上游榜单时间超过24小时')
                attempts.append({'url':url,'status':'ok','count':len(items)})
                new={'items':items,'fetched_at':s.now(),'upstream_at':upstream,'error':'',
                     'provider':'60s公开热榜 · '+urlparse(base).hostname,'provider_url':final,
                     'freshness':'retrieved','cache_hit':False,'time_verified':bool(upstream)}
                break
            except Exception as exc:
                code=exc.response.status_code if isinstance(exc,httpx.HTTPStatusError) else None
                reason='HTTP '+str(code) if code else ('请求超时' if isinstance(exc,httpx.TimeoutException) else str(exc) if isinstance(exc,ValueError) else '连接或响应失败')
                attempts.append({'url':url,'status':'failed','error':reason[:120]})
        now=s.now()
        result=new or {**cached,'error':'此平台本次更新失败；保留上次榜单，稍后可单独重试','freshness':'stale','cache_hit':False}
        result.update(attempt=time.time(),last_attempt_at=now,attempts=attempts)
        s.set_config(key,result)
        return result


def register(app,user,error):
    @app.post('/api/hotlists/refresh')
    @jobs.serialized
    def refresh(data:dict,u=Depends(user)):
        requested=data.get('platforms',list(PLATFORMS))
        if not isinstance(requested,list) or not requested or any(not isinstance(p,str) or p not in PLATFORMS for p in requested):error(400,'请选择支持的平台')
        owner=u['id']
        active=next((x for x in s.list_(owner,'job') if x.get('input',{}).get('action')=='hotlists' and x.get('status') in ['queued','running']),None)
        if active:return active
        def run(progress,event):
            outcomes=[]
            for platform in dict.fromkeys(requested):
                if event.is_set():break
                progress('正在更新'+PLATFORMS[platform]+'热榜')
                data=snapshot(platform)
                if event.is_set():break
                old=next((x for x in s.list_(owner,'hotlist') if x.get('platform')==platform),None)
                # An unavailable/missing shared cache must never erase an owner's board.
                preserved=old if data.get('error') and old and old.get('items') and (not data.get('items') or str(old.get('fetched_at',''))>=str(data.get('fetched_at',''))) else data
                value={**(old or {}),**data,'title':PLATFORMS[platform],'platform':platform,
                       'items':preserved.get('items',[]),'fetched_at':preserved.get('fetched_at')}
                if preserved is old:
                    for field in ('provider','provider_url','upstream_at','time_verified'):value[field]=old.get(field)
                s.put(owner,'hotlist',value,old['id'] if old else None)
                outcomes.append({'platform':platform,'title':PLATFORMS[platform],
                    'status':'failed' if data.get('error') else 'cached' if data.get('cache_hit') else 'updated',
                    'error':data.get('error',''),'count':len(value['items']),'fetched_at':value.get('fetched_at'),
                    'upstream_at':value.get('upstream_at'),'provider_url':value.get('provider_url'),
                    'attempts':data.get('attempts',[])})
            failed=[x['title'] for x in outcomes if x['status']=='failed']
            return {'hotlists':True,'success':sum(x['status']!='failed' for x in outcomes),
                    'updated':sum(x['status']=='updated' for x in outcomes),'cached':sum(x['status']=='cached' for x in outcomes),
                    'failed':len(failed),'failed_platforms':failed,'items':outcomes}
        return jobs.start(owner,'更新平台热榜',run,{'action':'hotlists','platforms':requested})

    @app.post('/api/hotlists/{id}/save')
    def save(id:str,data:dict,u=Depends(user)):
        obj=s.get(u['id'],id)
        if obj['kind']!='hotlist':error(400,'请选择平台热榜')
        entry=next((x for x in obj.get('items',[]) if x['url']==data.get('url')),None)
        if not entry:error(409,'榜单已更新，请重新选择')
        old=next((x for x in s.list_(u['id'],'source') if x.get('url')==entry['url'] and not x.get('archived')),None)
        return old or s.export_object(u['id'],s.put(u['id'],'source',{**entry,'status':'summary','source_type':obj['title']+'热榜线索','fetched_at':obj.get('fetched_at'),'body':entry.get('body') or '热榜标题：'+entry['title']+'。此条仅为发现线索，尚未读取原文。'}))
    return refresh
