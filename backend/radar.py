"""Source-specific, bounded collection of public leads (never paywalled full text)."""
import re
import threading
from urllib.parse import urlparse
from datetime import date
import httpx
from bs4 import BeautifulSoup
from . import network, store as s, jobs

LOCK = threading.RLock()
TENDER_HOST = 'xcc.bidizhaobiao.com'
TENDER_API = 'https://api.xqzhaobiao.com/webchat/api/searchListWeb'

def input_url(value):
    match = re.search(r'https?://[^\s<>]+', str(value).strip())
    if not match: raise ValueError('请粘贴完整网址或包含网址的分享文字')
    url = match[0].rstrip('。，；）)')
    p = urlparse(url)
    if not p.hostname or p.username or p.password: raise ValueError('请使用不含账号密码的公开网址')
    return url

def is_douyin(url):
    host = urlparse(url).hostname or ''
    return host == 'douyin.com' or host.endswith('.douyin.com') or host.endswith('.iesdouyin.com')

def tender_request(payload):
    # Fixed public read-only endpoint used by the site's own search page. No login or paid detail APIs.
    target, headers, extensions = network.public_target(TENDER_API)
    headers.update({'channel':'20', 'x-bidimember-device':'50'})
    with httpx.Client(timeout=25, trust_env=False, follow_redirects=False) as client:
        with client.stream('POST', target, json=payload, headers=headers, extensions=extensions) as response:
            response.raise_for_status()
            raw = bytearray()
            for chunk in response.iter_bytes():
                raw.extend(chunk)
                if len(raw)>2_000_000: raise ValueError('来源搜索结果超过读取上限')
    import json
    result = json.loads(raw)
    if str(result.get('code'))!='200': raise ValueError('招标站暂未开放本次搜索；请到原网站查看，不会读取登录后的受限正文')
    data = result.get('data')
    if not isinstance(data,dict) or not isinstance(data.get('list'),list): raise ValueError('招标站搜索结构已变化，请到原网站查看')
    return data['list']

def tender(url, keywords):
    words = list(dict.fromkeys(x for x in re.split(r'[,，\s]+',keywords) if x))
    if len(words)>5: raise ValueError('招标信源一次最多设置5个关键词，以控制请求次数')
    items = {}; counts = []
    for word in words or ['']:
        rows = tender_request({'area':'全国','areaList':[{'area':'全国','city':''}], 'beginTime':'','endTime':'','channelName':'','keyword':word,'pattern':'10','searchType':'10','channel':'20','page':1,'pageSize':15,'type':'10'})
        counts.append(len(rows))
        for row in rows[:15]:
            title = BeautifulSoup(str(row.get('title','')),'html.parser').get_text(' ',strip=True)
            id = str(row.get('docId',''))
            if not id.isdigit() or not title or (word and word.casefold() not in title.casefold()): continue
            label = str(row.get('publishTime') or '')
            published = ''
            # Relative labels say updated, not published. Preserve them verbatim, never invent a publication date.
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}',label):
                try: published = date.fromisoformat(label).isoformat()
                except ValueError: pass
            region = str(row.get('area') or row.get('province') or '')
            category = str(row.get('chnldesc') or '招标线索')
            body = '\n'.join(x for x in [title, '地区：'+region, '类型：'+category, '采购单位：'+str(row.get('tenderee') or '未公开'), '网站时间标注：'+label, '项目编号（平台）：'+id, '以上为公开搜索线索，完整公告及联系方式需在来源网站查看。'] if x)
            items[id] = {'external_id':id,'title':title,'url':url,'body':body,'published':published,'date_label':label,'region':region,'category':category,'link_scope':'source_search'}
    return {'title':'喜鹊招标 · 公开项目线索','url':url,'type':'tender','items':list(items.values()),'status':'ready' if items else 'no_match','note':'按关键词分别搜索首屏，每词最多15条；仅公开线索，不代表全部公告。完整公告需在来源网站登录查看。','query_counts':counts}

def friendly_error(error):
    if isinstance(error,ValueError): return str(error)[:300]
    if isinstance(error,httpx.HTTPStatusError): return f'来源网站返回 {error.response.status_code}，可打开网站检查访问状态'
    return '连接被中断或超时；请打开网站检查网络、登录或验证状态'

def persist(owner, feed, detected):
    with LOCK, s.LOCK:
        current = s.get(owner,feed['id'])
        if current.get('archived') or current.get('enabled') is False: raise ValueError('信源已暂停或移除，本次结果未写入')
        if any(current.get(k)!=feed.get(k) for k in ('url','keywords')): raise ValueError('信源配置已变更，请按新配置重新获取')
        rows = detected.get('items',[])[:100]
        existing = {x.get('external_id') or x.get('url') for x in s.list_(owner,'news') if x.get('feed_id')==feed['id'] and not x.get('archived')}
        added = 0
        for row in rows:
            key = row.get('external_id') or row['url']
            if key in existing: continue
            s.put(owner,'news',{**row,'source_type':feed.get('source_type') or feed['title'],'feed_id':feed['id'],'status':'summary','fetched_at':s.now(),'acquisition_method':detected['type']})
            existing.add(key); added+=1
        status = detected.get('status') or ('ready' if rows else 'no_match')
        note = detected.get('note','')
        result = {'feed_id':feed['id'],'title':feed['title'],'status':status,'found':len(rows),'added':added,'duplicates':len(rows)-added,'note':note}
        s.put(owner,'feed',{**current,'last_attempt':s.now(),'last_result':result,'detected_type':detected['type'],'detected_url':detected['url'],'error':note if status in ('needs_browser','failed') else '',**({'last_success':s.now()} if rows else {})},feed['id'])
        return result

def refresh(owner, feed_id=None):
    from .discovery import identify
    with LOCK:
        feeds = [s.get(owner,feed_id)] if feed_id else s.list_(owner,'feed')
        feeds = [f for f in feeds if f['kind']=='feed' and not f.get('archived') and f.get('enabled') is not False]
        if not feeds: raise ValueError('请先添加或启用信源')
        ids = [f['id'] for f in feeds]
        if any(j.get('status') in ('queued','running') and j.get('input',{}).get('action')=='radar' and (not j['input'].get('feed_ids') or set(ids)&set(j['input']['feed_ids'])) for j in s.list_(owner,'job')): raise ValueError('这些信源正在获取中，请等待本次结束')
        def run(progress,event):
            results = []
            for f in feeds:
                if event.is_set(): break
                progress('正在获取：'+f['title'])
                try:
                    value = identify(f['url'],str(f.get('keywords','')))
                    if f.get('type')=='rss' and value['type']!='rss': raise ValueError('订阅地址未返回 RSS / Atom 条目，请编辑信源重新识别')
                    if event.is_set(): break
                    results.append(persist(owner,f,value))
                except Exception as error:
                    note = friendly_error(error)
                    result = {'feed_id':f['id'],'title':f['title'],'status':'failed','found':0,'added':0,'note':note}
                    results.append(result)
                    with s.LOCK:
                        current = s.get(owner,f['id'])
                        if not current.get('archived'): s.put(owner,'feed',{**current,'last_attempt':s.now(),'last_result':result,'error':note},f['id'])
            failed = sum(r['status'] in ('failed','needs_browser') for r in results)
            return {'radar':True,'sources':results,'added':sum(r['added'] for r in results),'failed':failed,'success':len(results)-failed,'items':[], 'coverage':'公开页面当前可读范围；零条不代表已覆盖全部内容'}
        return jobs.start(owner,'获取行业资讯',run,{'action':'radar','feed_ids':ids,'feed_id':feed_id})

def register(app,user,error):
    from fastapi import Depends
    @app.post('/api/radar/{id}/refresh')
    def one(id:str,u=Depends(user)):
        return refresh(u['id'],id)
    @app.post('/api/radar/{id}/browser-import')
    def imported(id:str,data:dict,u=Depends(user)):
        f=s.get(u['id'],id)
        if f['kind']!='feed': error(400,'请选择信源')
        url=input_url(data.get('url',''));target=input_url(f['url'])
        if urlparse(url).hostname!=urlparse(target).hostname and not (is_douyin(url) and is_douyin(target)): error(400,'当前页面与信源网站不同')
        if is_douyin(url):
            if not urlparse(url).path.startswith('/user/'): error(400,'请先打开该博主的个人主页，再读取作品')
            if '/user/' not in urlparse(target).path or urlparse(target).path.rstrip('/')!=urlparse(url).path.rstrip('/'): error(400,'请先编辑信源，识别并保存当前博主主页，避免混入其他账号')
        rows=data.get('items',[])
        if not isinstance(rows,list) or not rows or len(rows)>100:error(400,'请选择1至100条可见链接')
        from .discovery import web_url
        cleaned=[]
        for row in rows:
            link=web_url(row.get('url'),url);title=str(row.get('title','')).strip()[:500]
            if not link or not title or urlparse(link).hostname!=urlparse(url).hostname:continue
            if is_douyin(url) and not re.match(r'^/(video|note)/\d+',urlparse(link).path):continue
            cleaned.append({'url':link,'title':title,'body':'','published':''})
        if not cleaned:error(400,'没有符合当前信源范围的链接')
        return persist(u['id'],f,{'url':url,'type':'browser','items':cleaned,'status':'ready','note':'用户从当前网页勾选的链接，尚未获取正文；不代表账号历史全量'})
