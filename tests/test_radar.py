import pytest
from backend import radar, discovery, network, store as s
from test_workflows import client, account
from test_interaction_revision import wait

def source(client,url='https://example.com/list',**kwargs):
    return client.post('/api/objects/feed',json={'title':'测试信源','url':url,'enabled':True,'type':'auto','keywords':'电梯',**kwargs}).json()

def test_dynamic_empty_not_success(client,monkeypatch):
    owner=account(client)['user']['id'];f=source(client)
    monkeypatch.setattr(network,'fetch',lambda u:('<title>动态站</title><div id="app"></div><script src="app.js"></script>',u))
    j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();result=wait(owner,j)
    assert result['status']=='failed' and result['result']['sources'][0]['status']=='needs_browser'
    f=s.get(owner,f['id']);assert not f.get('last_success') and f['last_attempt'] and f['error']
    assert not s.list_(owner,'news')

def test_tender_keywords_and_safe_public_fields(monkeypatch):
    calls=[]
    def request(payload):
        calls.append(payload)
        return [{'docId':'123','title':'<font>电梯</font>与扶梯更新','publishTime':'10分钟前更新','area':'广州','tenderee':'示例单位'},{'docId':'456','title':'其他设备','publishTime':'2026-09-18'}]
    monkeypatch.setattr(radar,'tender_request',request)
    r=discovery.identify('https://xcc.bidizhaobiao.com/search','电梯 扶梯')
    assert [c['keyword'] for c in calls]==['电梯','扶梯'] and all(c['pageSize']==15 for c in calls)
    assert len(r['items'])==1 and '<font' not in r['items'][0]['title']
    assert r['items'][0]['published']=='' and r['items'][0]['link_scope']=='source_search'
    assert '10分钟前更新'==r['items'][0]['date_label']

def test_single_source_dedupe_and_failure_retains_news(client,monkeypatch):
    owner=account(client)['user']['id'];f=source(client);other=source(client,url='https://other.test')
    calls=[]
    def fetch(u):calls.append(u);return '<a href="/one">电梯更新记录</a>',u
    monkeypatch.setattr(network,'fetch',fetch)
    for count in (1,0):
        j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();r=wait(owner,j)
        assert r['result']['added']==count and r['result']['sources'][0]['found']==1
    assert calls==[f['url'],f['url']]
    assert not s.get(owner,other['id']).get('last_attempt')
    monkeypatch.setattr(network,'fetch',lambda _:(_ for _ in ()).throw(ValueError('验证受限')))
    j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();assert wait(owner,j)['status']=='failed'
    assert len(s.list_(owner,'news'))==1 and s.get(owner,f['id'])['last_success']

def test_share_text_and_douyin_not_recommendations(monkeypatch):
    monkeypatch.setattr(network,'fetch',lambda _:pytest.fail('No guessed platform requests'))
    r=discovery.identify('复制分享 https://v.douyin.com/abcdef/ $1 abc','')
    assert r['url']=='https://v.douyin.com/abcdef/' and r['status']=='needs_browser' and not r['items']

def test_browser_import_scope_and_owner(client):
    owner=account(client)['user']['id'];f=source(client,url='https://www.douyin.com/user/target',keywords='')
    payload={'url':f['url'],'items':[{'title':'目标主页所选作品','url':'https://www.douyin.com/video/123'}]}
    assert client.post('/api/radar/'+f['id']+'/browser-import',json={**payload,'url':'https://www.douyin.com/user/other'}).status_code==400
    assert client.post('/api/radar/'+f['id']+'/browser-import',json=payload).json()['added']==1
    assert client.post('/api/radar/'+f['id']+'/browser-import',json=payload).json()['added']==0
    account(client,'other-radar@example.test')
    assert client.post('/api/radar/'+f['id']+'/browser-import',json=payload).status_code==404

def test_tender_same_search_url_distinct_ids(client,monkeypatch):
    owner=account(client)['user']['id'];f=source(client,url='https://xcc.bidizhaobiao.com/search')
    monkeypatch.setattr(radar,'tender_request',lambda _: [{'docId':str(i),'title':'电梯项目'+str(i)} for i in (1,2)])
    j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();assert wait(owner,j)['result']['added']==2
    j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();assert wait(owner,j)['result']['added']==0
    assert len(s.list_(owner,'news'))==2

def test_no_match_has_explicit_status(client,monkeypatch):
    owner=account(client)['user']['id'];f=source(client)
    monkeypatch.setattr(network,'fetch',lambda u:('<a href="/a">其他设备资讯</a>',u))
    j=client.post('/api/radar/'+f['id']+'/refresh',json={}).json();r=wait(owner,j)
    assert r['result']['sources'][0]['status']=='no_match' and not s.get(owner,f['id']).get('last_success')

def test_disabled_and_nonfeed_cannot_refresh(client):
    account(client);f=source(client,enabled=False)
    assert client.post('/api/radar/'+f['id']+'/refresh',json={}).status_code==400
    obj=client.post('/api/import/text',json={'title':'普通资料','body':'内容'}).json()
    assert client.post('/api/radar/'+obj['id']+'/refresh',json={}).status_code==400
