import time
from test_workflows import client, account
from backend import store as s, gateway as g

def finish(c,j):
    for _ in range(100):
        item=next(x for x in c.get('/api/state').json()['objects'] if x['id']==j['id'])
        if item['status'] in ['done','failed','cancelled']:return item
        time.sleep(.02)
    raise AssertionError('job did not finish')

def fake_model(monkeypatch,answer):
    s.set_config('bindings',{'writing':'test-model','profile':'test-model'})
    monkeypatch.setattr(g,'select',lambda *args,**kwargs:'test-model')
    monkeypatch.setattr(g,'generate',answer)

def test_explicit_context_and_versioned_writing(client,monkeypatch):
    owner=account(client)['user']['id']
    brand=client.post('/api/studio/brands',json={'title':'品牌甲','facts':'事实甲'}).json()
    s.put(owner,'memory',{'title':'不应引用','body':'旧记忆秘密','status':'accepted'})
    source=client.post('/api/import/text',json={'title':'指定资料','body':'指定事实'}).json()
    captured=[]
    def answer(model,messages):
        captured.append(str(messages));return '已生成文案'
    fake_model(monkeypatch,answer)
    body={'brief':'写介绍','brand_id':brand['id'],'source_ids':[source['id']],'request_id':'unique-test'}
    j=client.post('/api/studio/text/generate',json=body).json();done=finish(client,j)
    assert done['status']=='done',done
    assert '指定事实' in captured[0] and '旧记忆秘密' not in captured[0]
    assert client.post('/api/studio/text/generate',json=body).json()['id']==j['id']
    assert len(captured)==1
    assert client.post('/api/studio/text/generate',json={**body,'brief':'其他'}).status_code==409
    item=s.get(owner,done['result']['content_id'])
    assert item['context_snapshot']['brand']['version']==1 and item['status']=='draft'
    assert client.post('/api/studio/text/generate',json={'brief':'改写','content_id':item['id'],'version':0}).status_code==409

def test_brand_owner_and_version(client):
    account(client)
    brand=client.post('/api/studio/brands',json={'title':'品牌甲'}).json()
    assert client.patch('/api/studio/brands/'+brand['id'],json={'title':'改名','version':1}).status_code==200
    assert client.patch('/api/studio/brands/'+brand['id'],json={'title':'旧请求','version':1}).status_code==409
    account(client,'other@example.test')
    assert client.patch('/api/studio/brands/'+brand['id'],json={'title':'越权','version':2}).status_code==404
    assert client.post('/api/studio/text/generate',json={'brief':'越权引用','brand_id':brand['id']}).status_code==404

def test_ip_requires_review_and_application_is_idempotent(client,monkeypatch):
    owner=account(client)['user']['id'];before=len(s.list_(owner,'profile'))
    fake_model(monkeypatch,lambda *a:'{"title":"技术讲解者","position":"电梯技术科普","audience":"物业","style":"通俗"}')
    j=client.post('/api/studio/profiles/propose',json={'brief':'帮助我定位'}).json();done=finish(client,j)
    assert done['status']=='done',done
    assert len(s.list_(owner,'profile'))==before
    url='/api/studio/profiles/'+done['result']['proposal_id']+'/apply'
    result=client.post(url,json={'fields':{'title':'修改后名称','position':'服务本地物业'}}).json()
    assert result['title']=='修改后名称'
    assert client.post(url,json={}).json()['id']==result['id']
    assert len(s.list_(owner,'profile'))==before+1

def test_no_config_is_not_success(client):
    account(client)
    result=client.post('/api/studio/text/generate',json={'brief':'写一篇文章'})
    assert result.status_code==400 and '模型' in result.json()['detail']
