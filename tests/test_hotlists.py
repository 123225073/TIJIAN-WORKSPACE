import json,time
from datetime import datetime,timezone
from test_workflows import client,account
from test_interaction_revision import wait
from backend import hotlists,store as s

def test_hotlist_normalization_rejects_active_urls():
    raw=json.dumps({'code':200,'data':{'data':[{'title':'电梯更新','link':'https://example.com/a','hot_value':123},{'title':'恶意地址','url':'javascript:alert(1)'},{'title':'带凭据地址','url':'https://user:secret@example.com'}]}})
    assert hotlists.normalize(raw)==[{'rank':1,'title':'电梯更新','url':'https://example.com/a','body':'','heat':'123'}]

def test_hotlist_cache_scope_and_save(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[]
    def fetch(url):calls.append(url);return json.dumps({'code':200,'data':[{'title':'电梯更新线索','link':'https://example.com/article','hot_value':12}]}),url
    monkeypatch.setattr(hotlists,'_fetch',fetch)
    assert client.post('/api/hotlists/refresh',json={'platforms':['invalid']}).status_code==400
    for _ in range(2):
        j=client.post('/api/hotlists/refresh',json={'platforms':['weibo']}).json()
        assert wait(owner,j)['status']=='done'
    assert len(calls)==1
    board=s.list_(owner,'hotlist')[0]
    assert len(s.list_(owner,'hotlist'))==1
    source=client.post('/api/hotlists/'+board['id']+'/save',json={'url':'https://example.com/article'}).json()
    assert source['status']=='summary' and source['source_type']=='微博热榜线索'
    assert client.post('/api/hotlists/'+board['id']+'/save',json={'url':'https://example.com/article'}).json()['id']==source['id']
    account(client,'other-hotlist@example.test')
    assert client.post('/api/hotlists/'+board['id']+'/save',json={'url':'https://example.com/article'}).status_code==404

def test_hotlist_failure_keeps_previous_snapshot(client,monkeypatch):
    owner=account(client)['user']['id']
    old={'items':[{'title':'历史榜单','url':'https://example.com','rank':1,'body':'','heat':'1'}],'fetched_at':'2026-09-15T12:00:00','attempt':time.time()-1000}
    s.set_config('public-hotlist:weibo',old)
    monkeypatch.setattr(hotlists,'_fetch',lambda url:(_ for _ in ()).throw(ValueError('upstream failed')))
    j=client.post('/api/hotlists/refresh',json={'platforms':['weibo']}).json()
    assert wait(owner,j)['status']=='failed'
    board=s.list_(owner,'hotlist')[0]
    assert board['items']==old['items'] and board['fetched_at']==old['fetched_at'] and board['error']

def test_custom_source_keywords_are_used(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(hotlists.network,'fetch',lambda url:('<a href="https://example.com/1">适老化改造观察</a><a href="https://example.com/2">无关文章内容</a>',url))
    assert client.post('/api/objects/feed',json={'title':'自定义网页','url':'https://example.com','type':'web','keywords':'适老化 物业','enabled':True}).status_code==200
    j=client.post('/api/radar/refresh',json={}).json()
    assert wait(owner,j)['status']=='done'
    assert [x['title'] for x in s.list_(owner,'news')]==['适老化改造观察']

def test_hotlist_fallback_and_cache_are_truthful(client,monkeypatch):
    account(client);calls=[]
    active_at=int(time.time()*1000)
    def fetch(url):
        calls.append(url)
        if '60s.viki.moe' in url:raise ValueError('limited')
        return json.dumps({'code':200,'data':[{'title':'热点','link':'https://example.com/a','active_time_at':active_at}]}),url
    monkeypatch.setattr(hotlists,'_fetch',fetch)
    fresh=hotlists.snapshot('douyin')
    assert not fresh['error'] and len(calls)==2
    assert fresh['provider_url'] != 'https://60s.viki.moe'
    assert fresh['upstream_at']==datetime.fromtimestamp(active_at/1000,timezone.utc).isoformat()
    cached=hotlists.snapshot('douyin')
    assert cached['cache_hit'] is True and cached['fetched_at']==fresh['fetched_at'] and len(calls)==2

def test_failed_refresh_keeps_owner_board_without_shared_cache(client,monkeypatch):
    owner=account(client)['user']['id']
    old=s.put(owner,'hotlist',{'title':'微博','platform':'weibo','items':[{'title':'09/18旧数据','url':'https://example.com/old','rank':1,'heat':'1','body':''}],'fetched_at':'2026-09-18T00:00:00Z'})
    monkeypatch.setattr(hotlists,'_fetch',lambda url:(_ for _ in ()).throw(ValueError('unavailable')))
    j=client.post('/api/hotlists/refresh',json={'platforms':['weibo','douyin']}).json()
    done=wait(owner,j)
    assert done['status']=='failed'
    board=s.get(owner,old['id'])
    assert board['items']==old['items'] and board['fetched_at']==old['fetched_at']
    assert len(done['result']['items'])==2 and done['result']['failed']==2

def test_baidu_heat_and_date_fields_are_preserved():
    rows=hotlists.normalize(json.dumps({'code':200,'data':[{'title':'百度热点','url':'https://www.baidu.com/s?wd=x','score_desc':'780.87w','desc':'摘要','created':'2026/10/11 11:06:28'}]}))
    assert rows[0]['heat']=='780.87w' and rows[0]['body']=='摘要'
    assert rows[0]['published_at'].startswith('2026-10-11')

def test_partial_failure_and_bounded_attempts(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[]
    def fetch(url):
        calls.append(url)
        if url.endswith('/rednote'):raise ValueError('unavailable')
        return json.dumps({'code':200,'data':[{'title':'正常平台','link':'https://example.com/current'}]}),url
    monkeypatch.setattr(hotlists,'_fetch',fetch)
    j=client.post('/api/hotlists/refresh',json={'platforms':['weibo','rednote']}).json()
    result=wait(owner,j)
    assert result['status']=='done' and result['result']['success']==1 and result['result']['failed']==1
    assert len([url for url in calls if url.endswith('/rednote')])==3
    hotlists.snapshot('rednote')
    assert len(calls)==4
    board=next(x for x in s.list_(owner,'hotlist') if x['platform']=='weibo')
    assert board['time_verified'] is False and not board['upstream_at']

def test_stale_upstream_timestamp_cannot_become_a_fresh_snapshot(client,monkeypatch):
    account(client)
    raw=json.dumps({'code':200,'updated_at':'2026-09-18T00:00:00Z','data':[{'title':'旧榜','link':'https://example.com/old'}]})
    monkeypatch.setattr(hotlists,'_fetch',lambda url:(raw,url))
    result=hotlists.snapshot('weibo')
    assert result['error'] and not result.get('fetched_at') and len(result['attempts'])==3
