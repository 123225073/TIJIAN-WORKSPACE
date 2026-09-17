"""Public trend adapters based on Easel's reviewed hotlist-apis.md.
Only fixed public endpoints; no platform credentials or upstream agent execution.
"""
import json,time,threading
from fastapi import Depends
from . import store as s,network,jobs

PLATFORMS={'weibo':'微博','zhihu':'知乎','toutiao':'今日头条','douyin':'抖音','rednote':'小红书','baidu/hot':'百度'}
LOCK=threading.Lock()

def normalize(raw):
    payload=json.loads(raw)
    if payload.get('code')!=200:raise ValueError('热点服务暂不可用')
    rows=payload.get('data')
    if isinstance(rows,dict):rows=rows.get('data')
    if not isinstance(rows,list):raise ValueError('热点服务返回格式发生变化')
    result=[]
    for rank,row in enumerate(rows[:60],1):
        if not isinstance(row,dict):continue
        url=row.get('link') or row.get('url') or ''
        # Unsafe external links never reach the renderer or stored source.
        from urllib.parse import urlparse
        parsed=urlparse(url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:continue
        title=str(row.get('title','')).strip()[:500]
        if not title:continue
        result.append({'rank':rank,'title':title,'url':url,'body':str(row.get('detail',''))[:2000],'heat':str(row.get('hot_value_desc') or row.get('hot_value') or row.get('hot') or '未提供')[:80]})
    if not result:raise ValueError('本次热榜未返回有效条目')
    return result

def snapshot(platform):
    with LOCK:
        key='public-hotlist:'+platform;cached=s.config(key,{})
        if time.time()-cached.get('attempt',0)<300:return cached
        try:
            raw,_=network.fetch('https://60s.viki.moe/v2/'+platform)
            cached={'items':normalize(raw),'fetched_at':s.now(),'error':''}
        except Exception:
            cached={**cached,'error':'此平台热榜暂时无法更新；已有数据保留，请稍后再试'}
        cached['attempt']=time.time();s.set_config(key,cached);return cached

def register(app,user,error):
    @app.post('/api/hotlists/refresh')
    @jobs.serialized
    def refresh(data:dict,u=Depends(user)):
        requested=data.get('platforms',list(PLATFORMS))
        if not isinstance(requested,list) or not requested or any(p not in PLATFORMS for p in requested):error(400,'请选择支持的平台')
        owner=u['id']
        active=next((x for x in s.list_(owner,'job') if x.get('input',{}).get('action')=='hotlists' and x.get('status') in ['queued','running']),None)
        if active:return active
        def run(progress,event):
            success=0;failed=[]
            for platform in dict.fromkeys(requested):
                if event.is_set():break
                progress('正在更新'+PLATFORMS[platform]+'热榜')
                data=snapshot(platform)
                old=next((x for x in s.list_(owner,'hotlist') if x.get('platform')==platform),None)
                s.put(owner,'hotlist',{'title':PLATFORMS[platform],'platform':platform,'provider':'60s公开热榜服务','provider_url':'https://60s.viki.moe','items':data.get('items',[]),'fetched_at':data.get('fetched_at'),'error':data.get('error','')},old['id'] if old else None)
                if data.get('error'):failed.append(PLATFORMS[platform])
                else:success+=1
            if not success and failed:raise ValueError('热榜服务暂不可用，已保留上次数据')
            return {'success':success,'failed':len(failed),'failed_platforms':failed}
        return jobs.start(owner,'更新平台热榜',run,{'action':'hotlists','platforms':requested})

    @app.post('/api/hotlists/{id}/save')
    def save(id:str,data:dict,u=Depends(user)):
        obj=s.get(u['id'],id)
        if obj['kind']!='hotlist':error(400,'请选择平台热榜')
        entry=next((x for x in obj.get('items',[]) if x['url']==data.get('url')),None)
        if not entry:error(409,'榜单已更新，请重新选择')
        old=next((x for x in s.list_(u['id'],'source') if x.get('url')==entry['url'] and not x.get('archived')),None)
        return old or s.export_object(u['id'],s.put(u['id'],'source',{**entry,'status':'summary','source_type':obj['title']+'热榜线索','fetched_at':obj.get('fetched_at'),'body':entry['body'] or '热榜标题：'+entry['title']+'。此条仅为发现线索，尚未读取原文。'}))
    return refresh
