import json,time
from test_workflows import client,account
from test_interaction_revision import wait
from backend import hotlists,store as s

def test_hotlist_normalization_rejects_active_urls():
    raw=json.dumps({'code':200,'data':{'data':[{'title':'电梯更新','link':'https://example.com/a','hot_value':123},{'title':'恶意地址','url':'javascript:alert(1)'},{'title':'带凭据地址','url':'https://user:secret@example.com'}]}})
    assert hotlists.normalize(raw)==[{'rank':1,'title':'电梯更新','url':'https://example.com/a','body':'','heat':'123'}]

def test_hotlist_cache_scope_and_save(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[]
    def fetch(url):calls.append(url);return json.dumps({'code':200,'data':[{'title':'电梯更新线索','link':'https://example.com/article','hot_value':12}]}),url
    monkeypatch.setattr(hotlists.network,'fetch',fetch)
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
    monkeypatch.setattr(hotlists.network,'fetch',lambda url:(_ for _ in ()).throw(ValueError('upstream failed')))
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
