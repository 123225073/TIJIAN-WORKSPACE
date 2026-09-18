import time,threading
from pathlib import Path
import pytest
from backend import douyin as d,store as s,jobs
from test_workflows import client,account
from test_interaction_revision import wait

SEC='MS4wLjABAAAA_real_publisher'
def setup(c):
    owner=account(c)['user']['id']
    b=c.post('/api/objects/benchmark',json={'title':'抖音测试账号','platform':'抖音','url':'https://www.douyin.com/user/'+SEC}).json()
    d.CONNECTED[owner]=time.time()
    return owner,b['id']
def row(id='123456',stamp=None,**fields):
    return {'aweme_id':id,'sec_uid':SEC,'description':'发布文案，不是口播','author':'测试账号','create_time':int(time.time()-100) if stamp is None else stamp,'media_type':'video','media_count':1,'metrics':{'like':2},**fields}
def scan(c,b):return c.post('/api/douyin/'+b+'/scan',json={'limit':30}).json()

def test_author_identity_dedupe_empty_and_scope(client,monkeypatch):
    owner,b=setup(client)
    monkeypatch.setattr(d,'collect',lambda *a:{'items':[row(),row()]})
    result=wait(owner,scan(client,b));assert result['status']=='done' and result['result']['added']==1
    result=wait(owner,scan(client,b));assert result['result']['added']==0
    assert len(d.works(owner,b,SEC))==1
    monkeypatch.setattr(d,'collect',lambda *a:{'items':[row('654321',sec_uid='different')]})
    assert wait(owner,scan(client,b))['status']=='failed'
    monkeypatch.setattr(d,'collect',lambda *a:{'items':[]})
    assert wait(owner,scan(client,b))['status']=='failed'
    assert len(d.works(owner,b,SEC))==1
    account(client,'other@example.test')
    assert client.get('/api/douyin/'+b+'/status').status_code==404

def test_subscription_baseline_new_only_dedup_pause(client):
    owner,b=setup(client)
    assert client.put('/api/douyin/'+b+'/subscription',json={'enabled':True,'interval_minutes':30}).status_code==200
    d.ingest(owner,b,SEC,{'items':[row()]},'automatic')
    assert not s.list_(owner,'douyin_notice')
    sub=d.subscription(owner,b);baseline=int(time.time())-10;s.put(owner,sub['kind'],{**sub,'baseline_at':baseline},sub['id'])
    payload={'items':[row('234567',baseline+1),row('345678',baseline-1000)]}
    d.ingest(owner,b,SEC,payload,'automatic');d.ingest(owner,b,SEC,payload,'automatic')
    notices=s.list_(owner,'douyin_notice');assert len(notices)==1
    assert client.post('/api/douyin/notices/'+notices[0]['id']+'/read').json()['read']
    client.put('/api/douyin/'+b+'/subscription',json={'enabled':False})
    d.ingest(owner,b,SEC,{'items':[row('456789',baseline+2)]},'manual')
    assert len(s.list_(owner,'douyin_notice'))==1

def test_media_file_validation_and_text_save(client,monkeypatch):
    owner,b=setup(client);d.ingest(owner,b,SEC,{'items':[row()]},'manual');work=d.works(owner,b,SEC)[0]
    def read(_owner,request,*args):
        Path(request['directory'],'1.mp4').write_bytes(b'fixture-media'*32)
        return {'sec_uid':SEC,'aweme_id':work['aweme_id'],'files':['1.mp4']}
    monkeypatch.setattr(d,'detail',lambda *args:None)
    monkeypatch.setattr(d,'read',read)
    j=client.post('/api/douyin/'+b+'/download',json={'ids':[work['id']]}).json()
    assert wait(owner,j)['result']['success']==1
    saved=s.get(owner,work['id']);assert saved['files'][0]['sha256'] and saved['status']=='downloaded'
    r=client.get('/api/douyin/works/'+work['id']+'/file/0');assert r.status_code==200 and r.content.startswith(b'fixture-media')
    a=client.post('/api/douyin/works/'+work['id']+'/save').json();z=client.post('/api/douyin/works/'+work['id']+'/save').json()
    assert a['id']==z['id'] and '未转写' in a['body']
    monkeypatch.setattr(d,'read',lambda *a:{'sec_uid':SEC,'aweme_id':work['aweme_id'],'files':['../secret']})
    j=client.post('/api/douyin/'+b+'/download',json={'ids':[work['id']]}).json()
    assert wait(owner,j)['status']=='failed'
    assert client.post('/api/import/batch',json={'benchmark_id':b,'urls':'https://www.douyin.com/user/'+SEC}).status_code==400

def test_browser_ticket_cancel_and_ownership(client):
    owner,b=setup(client);j=scan(client,b)
    for _ in range(80):
        q=client.get('/api/douyin/pending').json()['items']
        if q:break
        time.sleep(.05)
    assert q and 'owner' not in q[0] and 'event' not in q[0]
    ticket=q[0]['id'];token=client.headers['Authorization']
    account(client,'outsider@example.test')
    assert client.post('/api/douyin/browser/'+ticket,json={'items':[row()]}).status_code==404
    client.headers['Authorization']=token
    jobs.cancel(owner,j['id'])
    assert client.post('/api/douyin/browser/'+ticket,json={'items':[row()]}).status_code==404
    # Wait until the worker releases its pending ticket before the fixture database is replaced.
    for _ in range(80):
        if j['id'] not in jobs.CANCEL:break
        time.sleep(.05)
    assert j['id'] not in jobs.CANCEL and not d.works(owner,b,SEC)

def test_failed_subscription_backoff_and_no_false_success(client,monkeypatch):
    owner,b=setup(client);client.put('/api/douyin/'+b+'/subscription',json={'enabled':True,'interval_minutes':30})
    monkeypatch.setattr(d,'collect',lambda *args:(_ for _ in ()).throw(ValueError('需要登录验证')))
    result=wait(owner,scan(client,b));sub=d.subscription(owner,b)
    assert result['status']=='failed' and sub['failures']==1 and sub['next_check']>time.time()+3500 and not sub.get('last_success')

def test_profile_and_download_bounds(client):
    owner,b=setup(client)
    for url in ('https://evil.test/user/'+SEC,'https://www.douyin.com/video/123456','https://v.douyin.com/abc','https://x@www.douyin.com/user/'+SEC):
        with pytest.raises(ValueError):d.profile(url)
    assert client.post('/api/douyin/'+b+'/scan',json={'limit':101}).status_code==400
    assert client.post('/api/douyin/'+b+'/download',json={'ids':['x']*31}).status_code==400
    assert client.put('/api/douyin/'+b+'/subscription',json={'enabled':True,'interval_minutes':1}).status_code==400
