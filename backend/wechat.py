"""WeChat catalogue adapters. Paid requests are explicit, bounded and recorded first.

Provider protocol: https://www.showdoc.com.cn/2265380957870963
Bodies use the existing public downloader; credentials never enter objects/backups.
"""
import csv
import io
import json
import re
import threading
import time
import zipfile
from datetime import date, datetime, timezone, timedelta
from urllib.parse import urlsplit, parse_qs, urlencode

import httpx
from fastapi import Depends
from fastapi.responses import Response
from . import store as s, gateway as g, network, jobs

SERVICE = 'https://www.cimidata.com/api-service'
DOCS = 'https://www.showdoc.com.cn/2265380957870963'
PRICES = DOCS + '/11559023150418150'
TOKENS = {}
LOCKS = {}
CONVERSIONS = {}


def lock(owner):
    with s.LOCK:
        return LOCKS.setdefault(owner, threading.RLock())


def integer(value, minimum, maximum, label):
    try:
        n = int(value)
        if isinstance(value, bool) or str(n) != str(value): raise ValueError()
        if not minimum <= n <= maximum: raise ValueError()
        return n
    except (ValueError, TypeError):
        raise ValueError(f'{label}须为 {minimum} 至 {maximum} 的整数')


def canonical(value):
    from html import unescape
    p = urlsplit(unescape(str(value)).strip())
    if p.scheme not in ('https', 'http') or p.hostname != 'mp.weixin.qq.com' or p.username or p.password or p.port not in (None,443,80) or not (p.path == '/s' or p.path.startswith('/s/')):
        raise ValueError('请提供 mp.weixin.qq.com 的公众号原文链接')
    q = parse_qs(p.query)
    keys = ['__biz', 'mid', 'idx', 'sn']
    if p.path == '/s' and not all(q.get(k) for k in keys[:3]):
        raise ValueError('公众号长链接缺少文章标识')
    # sn is required to open some articles, but not part of the article identity.
    query = urlencode({k:q[k][0] for k in keys if q.get(k)})
    url = 'https://mp.weixin.qq.com' + p.path + ('?' + query if query else '')
    key = '|'.join(q[k][0] for k in keys[:3]) if p.path == '/s' else p.path
    return url, key, q.get('__biz', [''])[0]


def credentials(owner):
    record = s.config('wechat.credentials:' + owner)
    if not record: raise ValueError('请先在公众号服务设置中填写次幂 AppID 和 Secret')
    try: return json.loads(g.cipher().decrypt(record.encode()))
    except Exception: raise ValueError('次幂凭据无法解密，请重新保存') from None


def settings(owner):
    return {'configured':bool(s.config('wechat.credentials:' + owner)), 'service_url':SERVICE,
            'docs_url':DOCS, 'prices_url':PRICES,
            'usage':s.config('wechat.usage:' + owner, {}),
            'tested_at':s.config('wechat.tested:' + owner, '')}


def request(path, body, token=''):
    # Fixed HTTPS provider, no redirects or configurable credential destinations.
    try:
        with httpx.Client(timeout=25, trust_env=False, follow_redirects=False) as c:
            with c.stream('POST', 'https://api.cimidata.com' + path,
                          params={'access_token':token} if token else {}, json=body) as r:
                raw = bytearray()
                for chunk in r.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 4_000_000: raise ValueError('次幂响应超过读取上限')
                if r.status_code!=200:
                    detail=''
                    try:
                        err=json.loads(raw);detail=str(err.get('msg') or err.get('message') or '') if isinstance(err,dict) else ''
                    except (ValueError,TypeError):pass
                    for secret in [token,body.get('app_id'),body.get('app_secret')]:
                        if secret:detail=detail.replace(str(secret),'[已隐藏]')
                    detail=re.sub(r'https?://\S+','[服务地址]',detail)[:180]
                    raise ValueError(f'次幂返回 HTTP {r.status_code}'+('：'+detail if detail else '；请核对接口权限、额度及文章可用性')+'。本次不自动重试')
                payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get('code') != 200:
            raise ValueError('次幂未成功返回数据，请核对凭据、余额及接口权限；本次不自动重试')
        if not isinstance(payload.get('data'), dict): raise ValueError('次幂数据格式变化，请核对接口文档')
        return payload['data']
    except (httpx.HTTPError, OSError, json.JSONDecodeError):
        raise ValueError('次幂连接失败或响应无效；请求可能已计费，本次不自动重试') from None


def token(owner, force=False):
    cache = TOKENS.get((str(s.DB),owner))
    if cache and not force and cache[1] > time.time(): return cache[0]
    data = request('/api/v2/token', credentials(owner))
    value = data.get('access_token')
    if not isinstance(value,str) or not value: raise ValueError('次幂未返回有效访问令牌')
    TOKENS[(str(s.DB),owner)] = (value, time.time()+6*86400)
    return value


def paid(owner, path, body, daily_limit=None):
    auth = token(owner)
    # Reserve before sending. Timeouts/restarts cannot accidentally refund uncertain calls.
    with s.LOCK:
        today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
        usage = s.config('wechat.usage:' + owner, {})
        if usage.get('day') != today: usage = {'day':today,'calls':0,'automatic_calls':0}
        if daily_limit is not None and usage['automatic_calls'] >= daily_limit:
            raise ValueError('已达到今日自动查询次数上限，明日继续；可暂停订阅或调整上限')
        usage['calls'] += 1
        if daily_limit is not None: usage['automatic_calls'] += 1
        s.set_config('wechat.usage:' + owner, usage)
    try: return request(path, body, auth)
    except ValueError:
        TOKENS.pop((str(s.DB),owner),None)
        raise


def object_(owner, id, kind):
    obj = s.get(owner,id)
    if obj['kind'] != kind or obj.get('archived'): raise ValueError('请选择有效的公众号记录')
    return obj


def resolve(owner, url, benchmark_id, confirmed):
    if confirmed is not True: raise ValueError('请先确认次幂账号识别会产生接口费用')
    object_(owner, benchmark_id, 'benchmark')
    url, _, biz = canonical(url)
    data = paid(owner, '/api/v2/articles/info', {'url':url})
    a = data.get('account',{})
    if not isinstance(a,dict) or not re.fullmatch(r'gh_[A-Za-z0-9_-]+', str(a.get('wxid',''))) or not re.fullmatch(r'[A-Za-z0-9_+/=-]{3,128}', str(a.get('biz',''))):
        raise ValueError('次幂未返回可核对的公众号 wxid / biz，未绑定账号')
    if biz and a['biz'] != biz: raise ValueError('返回的发布账号与原文链接不一致，未绑定')
    with s.LOCK:
        old = next((x for x in s.list_(owner,'wechat_account') if x['biz']==a['biz']),None)
        obj = s.put(owner,'wechat_account',{'title':str(a.get('nickname') or a['wxid'])[:200],
                    'biz':a['biz'],'wxid':a['wxid'],'article_url':url,'provider':'cimidata',
                    'verified_at':s.now()}, old['id'] if old else None)
        s.set_config('wechat.binding:' + owner + ':' + benchmark_id, obj['id'])
    return obj


def normalize(raw, account):
    if not isinstance(raw,dict): raise ValueError('目录条目格式变化，已保留断点')
    url, key, biz = canonical(raw.get('content_url') or raw.get('url',''))
    if biz != account['biz']: raise ValueError('目录文章缺少或不符合所选发布账号标识，已停止此页')
    published = str(raw.get('published_at') or '')
    try: day = date.fromisoformat(published[:10]).isoformat()
    except ValueError: day = ''
    return {'url':url,'article_key':key,'title':str(raw.get('title') or url)[:500],
            'published':day,'summary':str(raw.get('digest') or '')[:4000],
            'account_id':account['id'],'biz':account['biz'],'provider':'cimidata'}


def history(owner, account, cursor='', daily_limit=None):
    if not account.get('wxid'):raise ValueError('此账号由免费方式识别，请先通过次幂识别后再查询付费目录')
    data = paid(owner,'/api/v2/articles/history',{'wxid':account['wxid'],**({'last_id':cursor} if cursor else {})},daily_limit)
    if not isinstance(data.get('items'),list) or 'last_id' not in data:
        raise ValueError('次幂目录格式变化或缺少分页标记，不能判断覆盖范围')
    items = [normalize(x,account) for x in data['items']]
    if data['last_id'] is not None and not isinstance(data['last_id'],(str,int)):
        raise ValueError('次幂分页标记格式变化，已保留断点')
    next_ = str(data['last_id']) if data['last_id'] is not None else ''
    if next_ and (next_ == cursor or not items): raise ValueError('来源重复分页或提前返回空页，已保留断点')
    return items, next_


def ingest(owner, items):
    added=[]
    with s.LOCK:
        known = {x['article_key']:x for x in s.list_(owner,'wechat_article')}
        for item in items:
            old = known.get(item['article_key'])
            if old: continue
            obj = s.put(owner,'wechat_article',{**item,'status':'discovered','discovered_at':s.now()})
            known[item['article_key']] = obj; added.append(obj)
    return added


def filters(data):
    since,until = str(data.get('since') or ''),str(data.get('until') or '')
    try:
        for value in (since,until):
            if value: date.fromisoformat(value)
    except ValueError: raise ValueError('请输入有效日期')
    if since and until and since>until: raise ValueError('开始日期不能晚于结束日期')
    return {'since':since,'until':until,'keyword':str(data.get('keyword') or '')[:200],
            'limit':integer(data.get('limit') or 30,1,2000,'最多篇数')}


def matching(items, f):
    return [x for x in items if (not f['since'] and not f['until'] or x.get('published') and
            (not f['since'] or x['published']>=f['since']) and (not f['until'] or x['published']<=f['until']))
            and (not f['keyword'] or f['keyword'].lower() in x['title'].lower())][:f['limit']]


def page(owner, run_id, version, confirmed):
    if confirmed is not True: raise ValueError('请确认本次目录查询费用')
    with lock(owner):
        run=object_(owner,run_id,'wechat_sync')
        if run['version'] != version: raise s.Conflict('此页已更新，请刷新目录后继续，避免重复计费')
        if run.get('done'): raise ValueError('此轮已结束，请调整范围后新建查询')
        account=object_(owner,run['account_id'],'wechat_account')
        if s.config('wechat.binding:'+owner+':'+run['benchmark_id'])!=account['id']:
            raise ValueError('账号已重新绑定，请为当前账号新建目录查询')
        run=s.put(owner,'wechat_sync',{**run,'attempts':run.get('attempts',0)+1,'error':''},run_id)
        try:
            items,cursor=history(owner,account,run.get('cursor',''))
            keys=[x['article_key'] for x in items]
            if keys and (not set(keys)-set(run.get('keys',[])) or cursor and cursor in run.get('cursors',[])):
                raise ValueError('来源返回重复文章页或循环断点，已停止，不能声明完整')
            ingest(owner,items)
            keys=list(dict.fromkeys(run.get('keys',[])+keys))
            all_=[x for x in s.list_(owner,'wechat_article') if x['account_id']==account['id'] and x['article_key'] in keys]
            count=len(matching(all_,run['filters']))
            end=not cursor
            done=end or count>=run['filters']['limit']
            return s.put(owner,'wechat_sync',{**run,'keys':keys,'cursor':cursor,'done':done,
                         'cursors':run.get('cursors',[])+([cursor] if cursor else []),
                         'pages':run.get('pages',0)+1,'coverage':'来源已到末页（不代表公众号完整历史）' if end else '达到篇数上限，仍为部分目录' if done else '部分目录，可继续读取下一页'},run_id)
        except ValueError as e:
            s.put(owner,'wechat_sync',{**run,'error':str(e),'coverage':'读取失败，已保留目录及断点'},run_id)
            raise


def provider_body(owner,item,confirmed_conversion=False,event=None):
    """Explicit paid URL retrieval. This is supplier content, not browser-verified HTML."""
    from bs4 import BeautifulSoup
    url=item.get('short_url') or item['url']
    url,_,_=canonical(url)
    if urlsplit(url).path=='/s':
        if not confirmed_conversion:raise ValueError('长链接需要先转换再获取正文，最多两次付费调用；请重新确认整批费用')
        delay=max(0,1-(time.monotonic()-CONVERSIONS.get(owner,0)))
        if event and event.wait(delay):raise InterruptedError()
        elif not event and delay:time.sleep(delay)
        CONVERSIONS[owner]=time.monotonic()
        converted=paid(owner,'/api/v2/articles/long2short',{'url':url})
        url,_,_=canonical(converted.get('url',''))
        if not re.fullmatch(r'/s/[A-Za-z0-9_-]+',urlsplit(url).path):raise ValueError('次幂未返回有效的微信短链接，已停止正文请求；本次不自动重试')
        s.put(owner,'wechat_article',{**s.get(owner,item['id']),'short_url':url},item['id'])
    if event and event.is_set():raise InterruptedError()
    data=paid(owner,'/api/v3/articles/detail',{'url':url,'need_text':True})
    html=data.get('html')
    if not isinstance(html,str) or not html.strip():raise ValueError('次幂未返回正文HTML，本次可能已扣费；不会自动重试')
    soup=BeautifulSoup(html,'html.parser')
    network.reject_blocked(soup,item['url'])
    from .discovery import wechat_identity
    try:identity=wechat_identity(html,'https://mp.weixin.qq.com/s/provider-content')
    except ValueError:identity={}
    if identity.get('biz') and identity['biz']!=item['biz']:raise ValueError('次幂正文中的发布账号与目录不一致，未保存')
    for node in soup(['script','style','noscript','iframe','nav','footer']):node.decompose()
    content=soup.select_one('#js_content') or soup
    body=content.get_text('\n',strip=True)
    if len(body)<100 or any(x in body[:500] for x in ['环境异常','访问过于频繁','该内容已被发布者删除','此内容因违规无法查看']):
        raise ValueError('次幂返回的正文无效、过短或不可访问，本次可能已扣费；未保存')
    return {'title':item['title'],'body':body[:100000],'url':item['url'],'published':item.get('published',''),
            'publisher_biz':item['biz'],'source_type':'次幂正文API（按目录原文链接获取）'}


def collect(owner, ids, benchmark_id, mode='public', confirmed=False, confirmed_conversion=False):
    if mode not in ['public','browser','cimidata']:raise ValueError('不支持的正文获取方式')
    if mode=='cimidata' and confirmed is not True:raise ValueError('请在本次弹窗中确认次幂正文接口扣费')
    with lock(owner):
        if not isinstance(ids,list) or not 1<=len(ids)<=100: raise ValueError('每批请选择1至100篇文章')
        object_(owner,benchmark_id,'benchmark')
        items=[object_(owner,id,'wechat_article') for id in dict.fromkeys(ids)]
        bound=s.config('wechat.binding:'+owner+':'+benchmark_id)
        if any(x['account_id']!=bound for x in items): raise ValueError('所选文章不属于此对标账号')
        if any(j.get('input',{}).get('action')=='wechat_body' and j['input'].get('benchmark_id')==benchmark_id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):
            raise ValueError('此账号正文正在采集中，请等待结束，避免重复采集或扣费')
        def run(progress,event):
            from .app import import_text
            results=[];blocked=''
            def summary():
                success=sum(x['status']=='done' for x in results)
                return {'items':list(results),'success':success,'failed':len(results)-success,'total':len(items),'processed':len(results),'mode':mode}
            for n,item in enumerate(items):
                if event.is_set(): break
                progress(f'正在采集 {n+1}/{len(items)}：'+item['title'],summary())
                try:
                    current=s.get(owner,item['id'])
                    if current.get('archived'):raise ValueError('文章已移入回收站，跳过采集')
                    source=None
                    if current.get('source_id'):
                        try: source=s.get(owner,current['source_id'])
                        except s.Missing: pass
                    if not source or source.get('archived'):
                        if blocked:raise ValueError('未请求：本批次已遇到平台验证。请使用其他获取方式')
                        if mode=='browser':
                            from . import wechat_browser
                            article=wechat_browser.read(owner,item,event,progress)
                        elif mode=='cimidata':
                            with lock(owner):article=provider_body(owner,item,confirmed_conversion is True,event)
                        else:
                            article=network.article(item['url'])
                            if article.get('publisher_biz')!=item['biz']: raise ValueError('正文发布账号不一致或无法核实，未保存')
                        if event.is_set(): break
                        source=import_text({**article,'benchmark_id':benchmark_id,'source_type':article.get('source_type','公众号公开正文')}, {'id':owner})
                    s.put(owner,'wechat_article',{**s.get(owner,item['id']),'source_id':source['id'],'status':'body_saved','error':'','body_method':mode},item['id'])
                    results.append({'url':item['url'],'title':item['title'],'status':'done','source_id':source['id']})
                except InterruptedError:
                    break
                except Exception as e:
                    if isinstance(e,network.ArticleBlocked):blocked=str(e)
                    msg=str(e) if isinstance(e,ValueError) else '正文获取失败，请检查网络或平台限制'
                    s.put(owner,'wechat_article',{**s.get(owner,item['id']),'status':'failed','error':msg},item['id'])
                    results.append({'url':item['url'],'title':item['title'],'status':'failed','reason':msg})
                progress(f'已处理 {n+1}/{len(items)} 篇',summary())
            return summary()
        return jobs.start(owner,'公众号正文归档'+('（次幂付费）' if mode=='cimidata' else ''),run,{'action':'wechat_body','benchmark_id':benchmark_id,'article_ids':ids,'mode':mode})


def subscription(owner, benchmark_id):
    return next((x for x in s.list_(owner,'wechat_subscription') if x['benchmark_id']==benchmark_id and not x.get('archived')),None)


def poll(owner, id):
    """Checkpoint reconciliation. First page establishes a baseline without old alerts."""
    with lock(owner):
        sub=object_(owner,id,'wechat_subscription')
        if not sub.get('enabled'): return
        try:
            benchmark=object_(owner,sub['benchmark_id'],'benchmark')
            account=object_(owner,sub['account_id'],'wechat_account')
            if s.config('wechat.binding:'+owner+':'+benchmark['id'])!=account['id']:
                raise ValueError('对标账号已重新绑定，请重新设置订阅')
            new_ids=[]
            # The target anchor stays fixed until the preceding interval is reconciled.
            for _ in range(sub['pages_per_check']):
                items,cursor=history(owner,account,sub.get('cursor',''),sub['daily_limit'])
                keys=[x['article_key'] for x in items]
                if not sub.get('baseline'):
                    ingest(owner,items)
                    sub={**sub,'baseline':True,'anchor':keys[0] if keys else '', 'cursor':'', 'pending_anchor':'',
                         'baseline_day':datetime.now(timezone(timedelta(hours=8))).date().isoformat(),
                         'coverage':'已建立订阅基线，旧文章不提醒'}
                    break
                if cursor and cursor in sub.get('cursors',[]): raise ValueError('订阅目录出现重复断点，请暂停并重新建立基线')
                anchor=sub.get('anchor','')
                reached=bool(anchor and anchor in keys)
                fresh=items[:keys.index(anchor)] if reached else items
                ingest(owner,items)
                fresh_keys={x['article_key'] for x in fresh}
                for item in s.list_(owner,'wechat_article'):
                    if item['article_key'] not in fresh_keys: continue
                    if item.get('published') and item['published']<sub.get('baseline_day',''): continue
                    notice_id=s.digest(owner+'|wechat_notice|'+id+'|'+item['article_key'])[:32]
                    try: s.get(owner,notice_id);continue
                    except s.Missing: pass
                    new_ids.append(item['id'])
                    s.put(owner,'wechat_notice',{'title':item['title'],'article_id':item['id'],'account_id':account['id'],
                          'benchmark_id':benchmark['id'],'url':item['url'],'published':item['published'],'read':False},notice_id)
                target=sub.get('pending_anchor') or (keys[0] if keys else anchor)
                done=reached or not cursor
                sub={**sub,'cursor':'' if done else cursor,'pending_anchor':'' if done else target,
                     'anchor':target if done else anchor,'cursors':[] if done else sub.get('cursors',[])+[cursor],
                     'coverage':'本轮已核对至上次位置；以来源收录为准' if reached else '来源已到末页，历史覆盖仍受来源限制' if done else '补漏尚未结束，下次从断点继续'}
                sub=s.put(owner,'wechat_subscription',sub,id)
                if done: break
            sub=s.put(owner,'wechat_subscription',{**sub,'error':'','last_success':s.now(),
                      'next_check':time.time()+sub['interval_minutes']*60,'last_added':len(new_ids)},id)
            if sub.get('auto_body') and new_ids: collect(owner,new_ids[:100],sub['benchmark_id'])
        except Exception as e:
            sub=s.get(owner,id)
            s.put(owner,'wechat_subscription',{**sub,'error':str(e) if isinstance(e,ValueError) else '订阅检查失败，请检查服务配置',
                  'next_check':time.time()+sub['interval_minutes']*60,'last_attempt':s.now()},id)


def tick():
    from . import weread
    weread.tick()
    for user in s.all_users():
        if not user['active']: continue
        owner=user['id']
        for sub in s.list_(owner,'wechat_subscription'):
            if sub.get('enabled') and not sub.get('archived') and sub.get('next_check',0)<=time.time():
                try: poll(owner,sub['id'])
                except (s.Missing, ValueError): continue


BACKUP_KINDS={'wechat_account','wechat_article','wechat_sync','wechat_subscription','wechat_notice','weread_subscription'}


def validate_backup(records):
    """Reject malformed catalogue records before the first write, never restore consent."""
    kinds={x['id']:x['kind'] for x in records}
    for x in records:
        kind=x['kind']
        if kind not in BACKUP_KINDS: continue
        if kind=='wechat_account':
            if not re.fullmatch(r'[A-Za-z0-9_+/=-]{3,128}',str(x.get('biz',''))) or (not re.fullmatch(r'gh_[A-Za-z0-9_-]+',str(x.get('wxid',''))) and not (x.get('provider')=='weread' and not x.get('wxid'))):
                raise ValueError('公众号备份缺少有效账号标识')
        else:
            if kinds.get(x.get('account_id'))!='wechat_account': raise ValueError('公众号备份缺少对应账号')
            if kind=='wechat_article':
                _,key,biz=canonical(x.get('url',''))
                account=next(a for a in records if a['id']==x['account_id'])
                if key!=x.get('article_key') or (biz or x.get('biz'))!=account['biz']: raise ValueError('备份文章标识与发布账号不一致')
            elif kind=='weread_subscription':
                integer(x.get('interval_minutes'),30,1440,'免费检查间隔')
            elif kind=='wechat_sync':
                filters(x.get('filters',{}))
                if not isinstance(x.get('keys'),list): raise ValueError('备份目录断点格式无效')
            elif kind=='wechat_subscription':
                integer(x.get('interval_minutes'),30,10080,'检查间隔')
                integer(x.get('daily_limit'),1,200,'每日上限')
                integer(x.get('pages_per_check'),1,10,'每轮页数')


def register(app,user,error):
    @app.get('/api/wechat/settings')
    def get_settings(u=Depends(user)): return settings(u['id'])

    @app.put('/api/wechat/settings')
    def save_settings(data:dict,u=Depends(user)):
        owner=u['id']
        app_id=str(data.get('app_id') or '').strip(); secret=str(data.get('app_secret') or '').strip()
        if not app_id or not secret or max(len(app_id),len(secret))>500: raise ValueError('请填写 AppID 和 Secret（最多500字符）')
        with lock(owner):
            s.set_config('wechat.credentials:'+owner,g.cipher().encrypt(json.dumps({'app_id':app_id,'app_secret':secret}).encode()).decode())
            TOKENS.pop((str(s.DB),owner),None);s.set_config('wechat.tested:'+owner,'')
        return settings(owner)

    @app.post('/api/wechat/settings/test')
    def test_settings(u=Depends(user)):
        with lock(u['id']): token(u['id'],True);s.set_config('wechat.tested:'+u['id'],s.now())
        return settings(u['id'])

    @app.get('/api/wechat/library/{benchmark_id}')
    def library(benchmark_id:str,u=Depends(user)):
        owner=u['id'];object_(owner,benchmark_id,'benchmark')
        id=s.config('wechat.binding:'+owner+':'+benchmark_id)
        account=object_(owner,id,'wechat_account') if id else None
        articles=[x for x in s.list_(owner,'wechat_article') if x['account_id']==id and not x.get('archived')]
        for i,item in enumerate(articles):
            if item.get('status')=='body_saved':
                try:source=s.get(owner,item.get('source_id',''))
                except s.Missing:source={}
                if not source or source.get('archived'):
                    articles[i]={**item,'status':'discovered','error':'正文资料已删除，可在回收站恢复或重新采集'}
        return {'account':account,'items':sorted(articles,key=lambda x:x.get('published',''),reverse=True),
                'runs':[x for x in s.list_(owner,'wechat_sync') if x['benchmark_id']==benchmark_id and not x.get('archived')],
                'subscription':subscription(owner,benchmark_id),
                'notices':[x for x in s.list_(owner,'wechat_notice') if x['benchmark_id']==benchmark_id and not x.get('read') and not x.get('archived')]}

    @app.post('/api/wechat/resolve')
    def resolve_account(data:dict,u=Depends(user)):
        with lock(u['id']): return resolve(u['id'],data.get('url',''),data.get('benchmark_id',''),data.get('confirmed'))

    @app.post('/api/wechat/runs')
    def start_run(data:dict,u=Depends(user)):
        owner=u['id'];bid=data.get('benchmark_id','');object_(owner,bid,'benchmark')
        id=s.config('wechat.binding:'+owner+':'+bid)
        if not id: raise ValueError('请先识别发布账号')
        object_(owner,id,'wechat_account');f=filters(data)
        if f['limit']>30 and data.get('confirm_large') is not True: raise ValueError('获取超过30篇前，请确认采集范围')
        return s.put(owner,'wechat_sync',{'title':'次幂历史目录','account_id':id,'benchmark_id':bid,'filters':f,
                     'cursor':'','keys':[],'pages':0,'done':False,'coverage':'尚未查询目录'})

    @app.post('/api/wechat/runs/{id}/next')
    def next_page(id:str,data:dict,u=Depends(user)):
        return page(u['id'],id,data.get('version'),data.get('confirmed'))

    @app.get('/api/wechat/browser/pending')
    def browser_pending(u=Depends(user)):
        from . import wechat_browser
        return wechat_browser.pending(u['id'])

    @app.post('/api/wechat/browser/{id}')
    def browser_result(id:str,data:dict,u=Depends(user)):
        from . import wechat_browser
        return wechat_browser.accept(u['id'],id,data)

    @app.post('/api/wechat/collect')
    def collect_articles(data:dict,u=Depends(user)):
        return collect(u['id'],data.get('ids'),data.get('benchmark_id',''),data.get('mode','public'),data.get('confirmed'),data.get('confirmed_conversion'))

    @app.put('/api/wechat/subscription/{benchmark_id}')
    def save_subscription(benchmark_id:str,data:dict,u=Depends(user)):
        owner=u['id'];object_(owner,benchmark_id,'benchmark')
        with lock(owner):
            old=subscription(owner,benchmark_id)
            if data.get('enabled') is not True:
                if old: return s.put(owner,'wechat_subscription',{**old,'enabled':False},old['id'])
                return {'enabled':False}
            if data.get('confirmed') is not True: raise ValueError('请确认开启付费定时查询及每日次数上限')
            credentials(owner)
            id=s.config('wechat.binding:'+owner+':'+benchmark_id)
            if not id: raise ValueError('请先识别公众号')
            object_(owner,id,'wechat_account')
            keep=old if old and old['account_id']==id else {}
            return s.put(owner,'wechat_subscription',{**keep,'title':'公众号订阅','benchmark_id':benchmark_id,'account_id':id,
                      'enabled':True,'interval_minutes':integer(data.get('interval_minutes',120),30,10080,'检查间隔（分钟）'),
                      'daily_limit':integer(data.get('daily_limit',12),1,200,'每日自动调用上限'),
                      'pages_per_check':integer(data.get('pages_per_check',2),1,10,'每轮最多页数'),
                      'auto_body':data.get('auto_body') is True,'next_check':time.time(),'error':''},old['id'] if old else None)

    @app.post('/api/wechat/notices/{id}/read')
    def read_notice(id:str,u=Depends(user)):
        obj=object_(u['id'],id,'wechat_notice')
        return s.put(u['id'],'wechat_notice',{**obj,'read':True},id)

    @app.post('/api/wechat/export')
    def export(data:dict,u=Depends(user)):
        ids=data.get('ids')
        if not isinstance(ids,list) or not 1<=len(ids)<=100: raise ValueError('每次请选择1至100篇导出')
        items=[object_(u['id'],id,'wechat_article') for id in dict.fromkeys(ids)]
        buf=io.BytesIO();manifest=io.StringIO();writer=csv.writer(manifest)
        writer.writerow(['标题','发布时间','原文链接','归档状态','正文文件'])
        with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
            for i,item in enumerate(items):
                name='';source=None
                if item.get('source_id'):
                    try: source=s.get(u['id'],item['source_id'])
                    except s.Missing: pass
                if source and not source.get('archived'):
                    name=f'{i+1:03d}-{item["id"]}.md'
                    z.writestr(name,'# '+item['title']+'\n\n'+source.get('body','')+'\n\n来源：'+item['url'])
                row=[item['title'],item.get('published',''),item['url'],'正文已保存' if name else '仅目录，正文未保存',name]
                writer.writerow(["'"+v if v.startswith(('=','+','-','@')) else v for v in row])
            z.writestr('目录.csv','\ufeff'+manifest.getvalue())
        return Response(buf.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="wechat-articles.zip"'})
