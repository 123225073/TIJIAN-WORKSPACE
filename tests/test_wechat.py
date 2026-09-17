"""Contract fixtures, not evidence of live paid-provider availability."""
import io
import json
import zipfile
from datetime import datetime, timezone, timedelta
import pytest
from backend import wechat as w, store as s, network
from test_workflows import client, account
from test_interaction_revision import wait

TODAY=datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def article(n, biz='TARGET_BIZ', day=TODAY):
    return {'content_url':f'https://mp.weixin.qq.com/s?__biz={biz}&mid={n}&idx=1&sn=test&scene=1',
            'title':f'电梯观察 {n}','published_at':day+'T10:00:00' if day else '', 'digest':'测试摘要'}


@pytest.fixture
def setup(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[];pages=[]
    def request(path,body,token=''):
        calls.append((path,body))
        if path.endswith('/token'): return {'access_token':'test-access-token'}
        if path.endswith('/info'): return {'account':{'biz':'TARGET_BIZ','wxid':'gh_fixture','nickname':'测试号'}}
        assert path.endswith('/history')
        value=pages.pop(0)
        if isinstance(value,Exception): raise value
        return value
    monkeypatch.setattr(w,'request',request)
    assert client.put('/api/wechat/settings',json={'app_id':'test-app-id','app_secret':'test-private-secret'}).status_code==200
    b=client.post('/api/objects/benchmark',json={'title':'测试号','platform':'公众号'}).json()
    r=client.post('/api/wechat/resolve',json={'url':'https://mp.weixin.qq.com/s/fixture','benchmark_id':b['id'],'confirmed':True})
    assert r.status_code==200,r.text
    return owner,b,r.json(),calls,pages


def start(client,b,**kwargs):
    r=client.post('/api/wechat/runs',json={'benchmark_id':b['id'],**kwargs})
    assert r.status_code==200,r.text
    return r.json()


def next_(client,run):
    return client.post('/api/wechat/runs/'+run['id']+'/next',json={'confirmed':True,'version':run['version']})


def subscribe(client,b,**kwargs):
    r=client.put('/api/wechat/subscription/'+b['id'],json={'enabled':True,'confirmed':True,**kwargs})
    assert r.status_code==200,r.text
    return r.json()


def test_encryption_auth_and_no_secret_in_state_backup(client,setup):
    owner,b,a,calls,pages=setup
    encrypted=s.config('wechat.credentials:'+owner)
    assert 'test-private-secret' not in encrypted
    assert w.credentials(owner)['app_secret']=='test-private-secret'
    text=client.get('/api/wechat/settings').text+client.get('/api/state').text
    assert all(secret not in text for secret in ('test-private-secret','test-app-id','test-access-token'))
    with zipfile.ZipFile(io.BytesIO(client.get('/api/backup').content)) as z:
        assert b'test-private-secret' not in z.read('records.json')
    count=len(calls)
    r=client.post('/api/wechat/resolve',json={'url':'https://mp.weixin.qq.com/s/x','benchmark_id':b['id']})
    assert r.status_code==400 and len(calls)==count
    account(client,'other@example.test')
    assert client.get('/api/wechat/settings').json()['configured'] is False
    assert client.get('/api/wechat/library/'+b['id']).status_code==404
    assert client.post('/api/wechat/runs',json={'benchmark_id':b['id']}).status_code==404


def test_all_body_failures_are_failed_and_retry_has_no_paid_calls(client,setup,monkeypatch):
    owner,b,a,calls,pages=setup
    pages.append({'items':[article(1),article(2)],'last_id':None})
    next_(client,start(client,b))
    ids=[x['id'] for x in s.list_(owner,'wechat_article')]
    def blocked(url):raise ValueError('平台验证，未读取正文')
    monkeypatch.setattr(network,'article',blocked)
    count=len(calls)
    job=client.post('/api/wechat/collect',json={'ids':ids,'benchmark_id':b['id']}).json()
    result=wait(owner,job)
    assert result['status']=='failed' and result['result']['success']==0 and result['result']['failed']==2
    assert '成功 0 篇' in result['progress']
    assert not s.list_(owner,'source') and len(calls)==count
    monkeypatch.setattr(network,'article',lambda url:{'url':url,'title':'恢复后正文','body':'有效正文'*80+url,'publisher_biz':'TARGET_BIZ'})
    retry=client.post('/api/jobs/'+job['id']+'/retry',json={})
    assert retry.status_code==200
    result=wait(owner,retry.json())
    assert result['status']=='done' and result['result']['success']==2
    assert len(calls)==count and len(s.list_(owner,'source'))==2


def test_catalogue_resume_dedupe_and_filters(client,setup):
    owner,b,a,calls,pages=setup
    pages.extend([{'items':[article(1),article(2,day='')],'last_id':'NEXT'},
                  {'items':[article(1),article(3)],'last_id':None}])
    run=start(client,b,since=TODAY,keyword='电梯',limit=30)
    r=next_(client,run);assert r.status_code==200,r.text
    run=r.json();assert run['pages']==1 and run['cursor']=='NEXT'
    # A stale double click must never issue another paid call.
    count=len(calls);assert next_(client,{**run,'version':1}).status_code==409
    assert len(calls)==count
    w.TOKENS.clear();s.init()  # restart: database, cursor and auth credentials persist
    restored=client.get('/api/wechat/library/'+b['id']).json()['runs'][0]
    r=next_(client,restored);assert r.status_code==200,r.text
    assert r.json()['done'] and '不代表' in r.json()['coverage']
    assert calls[-1][1]['last_id']=='NEXT'
    items=s.list_(owner,'wechat_article');assert len(items)==3
    assert len(w.matching(items,run['filters']))==2
    assert all('scene=' not in x['url'] for x in items)


@pytest.mark.parametrize('payload',[
    {'items':[article(1,'WRONG_BIZ')],'last_id':None},
    {'items':[article(1)]},
    {'items':[],'last_id':'NEXT'},
    {'items':[article(1)],'last_id':{'changed':'format'}},
    ValueError('连接超时，结果不明')
])
def test_failed_page_preserves_cursor_and_reserves_call(client,setup,payload):
    owner,b,a,calls,pages=setup;pages.append(payload)
    run=start(client,b)
    before=w.settings(owner)['usage']['calls']
    assert next_(client,run).status_code==400
    stored=s.get(owner,run['id'])
    assert stored['cursor']=='' and stored['pages']==0 and stored['error']
    assert not s.list_(owner,'wechat_article')
    assert w.settings(owner)['usage']['calls']==before+1


def test_large_scope_and_invalid_dates(client,setup):
    _,b,_,calls,_=setup
    for values in ({'limit':31},{'since':'2026-02-30'},{'since':'2026-09-01','until':'2026-08-01'},{'limit':1.5}):
        assert client.post('/api/wechat/runs',json={'benchmark_id':b['id'],**values}).status_code==400
    assert start(client,b,limit=31,confirm_large=True)['filters']['limit']==31


def test_subscription_baseline_new_notice_and_restart_idempotence(client,setup):
    owner,b,a,calls,pages=setup
    sub=subscribe(client,b)
    pages.extend([{'items':[article(1)],'last_id':'older'},
                  {'items':[article(2),article(1)],'last_id':'older'},
                  {'items':[article(2),article(1)],'last_id':'older'}])
    w.poll(owner,sub['id']);assert not s.list_(owner,'wechat_notice')
    # Manual history may discover the new item before the subscription does.
    w.ingest(owner,[w.normalize(article(2),a)])
    w.TOKENS.clear();w.poll(owner,sub['id'])
    notices=s.list_(owner,'wechat_notice');assert len(notices)==1
    assert notices[0]['title']=='电梯观察 2'
    assert client.post('/api/wechat/notices/'+notices[0]['id']+'/read',json={}).status_code==200
    w.poll(owner,sub['id'])
    assert len(s.list_(owner,'wechat_notice'))==1 and s.list_(owner,'wechat_notice')[0]['read']
    assert not s.get(owner,sub['id'])['cursor']


def test_subscription_gap_checkpoint_and_daily_cap(client,setup):
    owner,b,a,calls,pages=setup
    sub=subscribe(client,b,pages_per_check=1,daily_limit=2)
    pages.extend([{'items':[article(1)],'last_id':'old'},
                  {'items':[article(4),article(3)],'last_id':'gap'},
                  {'items':[article(2),article(1)],'last_id':'old'}])
    w.poll(owner,sub['id']);w.poll(owner,sub['id'])
    assert s.get(owner,sub['id'])['cursor']=='gap'
    count=len(calls);w.poll(owner,sub['id'])
    assert len(calls)==count and '上限' in s.get(owner,sub['id'])['error']
    assert s.get(owner,sub['id'])['cursor']=='gap'
    s.set_config('wechat.usage:'+owner,{'day':'2000-01-01','calls':999,'automatic_calls':999})
    w.poll(owner,sub['id'])
    assert calls[-1][1]['last_id']=='gap'
    assert len(s.list_(owner,'wechat_notice'))==3
    assert not s.get(owner,sub['id'])['cursor']


def test_subscription_requires_explicit_consent_and_stops_when_paused(client,setup):
    owner,b,a,calls,pages=setup
    assert client.put('/api/wechat/subscription/'+b['id'],json={'enabled':True}).status_code==400
    sub=subscribe(client,b)
    client.put('/api/wechat/subscription/'+b['id'],json={'enabled':False})
    n=len(calls);w.poll(owner,sub['id']);assert len(calls)==n


def test_collect_reuses_body_checks_publisher_and_exports_manifest(client,setup,monkeypatch):
    owner,b,a,calls,pages=setup
    rows=w.ingest(owner,[w.normalize(article(1),a),w.normalize(article(2),a)])
    seen=[]
    def body(url):
        seen.append(url)
        return {'title':'归档正文','body':'测试正文'*80,'url':url,'publisher_biz':'TARGET_BIZ' if 'mid=1&' in url else 'WRONG_BIZ'}
    monkeypatch.setattr(network,'article',body)
    payload={'ids':[x['id'] for x in rows],'benchmark_id':b['id']}
    r=client.post('/api/wechat/collect',json=payload);assert r.status_code==200
    job=wait(owner,r.json());assert job['result']['success']==1 and job['result']['failed']==1
    assert len(s.list_(owner,'source'))==1
    job=client.post('/api/wechat/collect',json={'ids':[rows[0]['id']],'benchmark_id':b['id']}).json()
    assert wait(owner,job)['result']['success']==1 and len(seen)==2
    export=client.post('/api/wechat/export',json={'ids':payload['ids']});assert export.status_code==200
    with zipfile.ZipFile(io.BytesIO(export.content)) as z:
        assert len(z.namelist())==2
        assert '仅目录，正文未保存' in z.read('目录.csv').decode('utf8')


def test_rebinding_blocks_stale_paid_query(client,setup):
    owner,b,a,calls,pages=setup
    run=start(client,b);s.set_config('wechat.binding:'+owner+':'+b['id'],'changed-account')
    count=len(calls);assert next_(client,run).status_code==400 and len(calls)==count


def test_errors_never_expose_token(monkeypatch):
    import httpx
    class Failing:
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def stream(self,*a,**k):raise httpx.ConnectError('https://api.cimidata.com?access_token=private-token')
    monkeypatch.setattr(w.httpx,'Client',lambda **kw:Failing())
    with pytest.raises(ValueError) as e:w.request('/api/v2/articles/history',{},'private-token')
    assert 'private-token' not in str(e.value)


def test_backup_restores_library_binding_but_not_payment_consent(client,setup):
    owner,b,a,calls,pages=setup
    w.ingest(owner,[w.normalize(article(1),a)])
    subscribe(client,b)
    raw=client.get('/api/backup').content
    other=account(client,'restore@example.test')['user']['id']
    r=client.post('/api/backup/import',files={'file':('backup.zip',raw,'application/zip')})
    assert r.status_code==200,r.text
    restored=next(x for x in s.list_(other,'benchmark') if x.get('restored_from')==b['id'])
    lib=client.get('/api/wechat/library/'+restored['id']).json()
    assert len(lib['items'])==1 and lib['account']['biz']==a['biz']
    assert lib['subscription']['enabled'] is False
    assert not w.settings(other)['configured']
