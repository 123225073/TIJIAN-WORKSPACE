import time
from test_workflows import client,account
from backend import store as s,gateway,jobs,network

def wait(owner,j):
    for _ in range(200):
        row=s.get(owner,j['id'])
        if row['status'] not in ['queued','running']:return row
        time.sleep(.02)
    raise AssertionError('job timeout')

def test_task_reuse_trash_and_owner_boundary(client):
    owner=account(client)['user']['id']
    data={'title':'研究电梯改造','mode':'auto'}
    a=client.post('/api/tasks/open',json=data).json()
    assert a['mode']=='research'
    assert client.post('/api/tasks/open',json=data).json()['id']==a['id']
    assert client.post('/api/objects/'+a['id']+'/trash').status_code==200
    assert client.post('/api/tasks/'+a['id']+'/send',json={'text':'不能继续'}).status_code==400
    assert client.post('/api/tasks/open',json=data).json()['id']!=a['id']
    assert client.post('/api/objects/'+a['id']+'/restore').json()['archived'] is False
    account(client,'another@example.test')
    assert client.post('/api/objects/'+a['id']+'/trash').status_code==404

def test_manual_summary_and_custom_prompt(client,monkeypatch):
    owner=account(client)['user']['id'];seen=[]
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'test')
    def generate(model,messages):seen.append(messages);return '本次测试摘要'
    monkeypatch.setattr(gateway,'generate',generate)
    assert client.put('/api/prompts',json={'research':'按证据顺序组织'}).status_code==200
    source=client.post('/api/import/text',json={'title':'资料','body':'测试'}).json()
    assert not s.list_(owner,'job')
    task=client.post('/api/tasks/open',json={'title':'研究','mode':'research','source_ids':[source['id']]}).json()
    assert wait(owner,jobs.task_turn(owner,task['id'],'研究',mode='research'))['status']=='done'
    assert '按证据顺序组织' in seen[0][0]['content']
    assert not s.list_(owner,'issue')
    ids=[]
    for _ in range(2):
        result=wait(owner,client.post('/api/tasks/'+task['id']+'/distill').json())
        assert result['status']=='done';ids.append(result['result']['source_id'])
    assert ids[0]==ids[1]
    assert s.get(owner,ids[0])['file'].split('/')[1]==s.now()[:10]
    client.patch('/api/objects/'+ids[0],json={'body':'手动编辑保留'})
    assert wait(owner,client.post('/api/tasks/'+task['id']+'/distill').json())['status']=='failed'
    assert s.get(owner,ids[0])['body']=='手动编辑保留'

def test_batch_reports_partial_failure_and_period_requires_feed(client,monkeypatch):
    owner=account(client)['user']['id']
    def article(url):
        if 'bad' in url:raise ValueError('平台未提供正文')
        return {'title':'测试正文','body':'原始正文','url':url}
    monkeypatch.setattr(network,'article',article)
    result=wait(owner,client.post('/api/import/batch',json={'urls':'https://example.com/good\nhttps://example.com/bad\nhttps://example.com/good'}).json())
    assert result['result']['success']==1 and result['result']['failed']==1
    assert len(s.list_(owner,'source'))==1
    benchmark=client.post('/api/objects/benchmark',json={'title':'测试账号','url':'https://example.com/good'}).json()
    j=client.post('/api/benchmark/'+benchmark['id']+'/collect',json={}).json()
    assert wait(owner,j)['status']=='failed'

def test_feed_period_filters_body_dates(client,monkeypatch):
    owner=account(client)['user']['id']
    feed='<rss><channel><title>测试订阅</title><item><link>https://example.com/old</link></item><item><link>https://example.com/new</link></item></channel></rss>'
    monkeypatch.setattr(network,'fetch',lambda url:(feed,url))
    monkeypatch.setattr(network,'article',lambda url:{'title':url,'url':url,'body':'真实流程测试正文','published':'2026-08-01' if url.endswith('old') else '2026-09-10'})
    b=client.post('/api/objects/benchmark',json={'title':'订阅','feed_url':'https://example.com/rss'}).json()
    j=client.post('/api/benchmark/'+b['id']+'/collect',json={'since':'2026-09-01','until':'2026-09-16'}).json()
    result=wait(owner,j)
    assert result['status']=='done'
    assert result['result']['outside_range']==1 and result['result']['success']==1

def test_article_is_not_subscription_and_sessions_revoked(client):
    login=account(client)
    article='https://mp.weixin.qq.com/s/example'
    assert client.post('/api/objects/benchmark',json={'title':'对标','url':article,'feed_url':article}).status_code==400
    b=client.post('/api/objects/benchmark',json={'title':'对标','url':article}).json()
    assert client.patch('/api/objects/'+b['id'],json={'feed_url':article}).status_code==400
    assert client.post('/api/objects/feed',json={'title':'错误RSS','type':'rss','url':article}).status_code==400
    assert client.get('/api/state',headers={'Authorization':'Bearer '+login['token']}).status_code==200
    client.post('/api/auth/logout')
    assert client.get('/api/state',headers={'Authorization':'Bearer '+login['token']}).status_code==401
