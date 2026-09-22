import base64
from test_workflows import client, account
from test_creation import fake_model, finish
from test_media_studio import studio, png
from backend import store as s, gateway as g, media_studio as media, illustrations

def test_brand_interview_review_and_conflict(client,monkeypatch):
    owner=account(client)['user']['id'];fake_model(monkeypatch,lambda *a:'请介绍品牌名称和主要业务？')
    row=client.post('/api/studio/interviews',json={'type':'brand'}).json();url='/api/studio/interviews/'+row['id']
    j=client.post(url+'/turn',json={'version':1,'request_id':'first'}).json();assert finish(client,j)['status']=='done'
    assert not s.list_(owner,'studio_brand')
    row=s.get(owner,row['id']);assert len(row['messages'])==1
    assert client.post(url+'/turn',json={'version':row['version'],'request_id':'empty','summarize':True}).status_code==400
    monkeypatch.setattr(g,'generate',lambda *a:'{"title":"测试品牌","products":"维保信息整理","facts":""}')
    j=client.post(url+'/turn',json={'version':row['version'],'request_id':'finish','answer':'品牌叫测试品牌，提供维保信息整理','summarize':True}).json();assert finish(client,j)['status']=='done'
    row=s.get(owner,row['id']);assert not s.list_(owner,'studio_brand')
    r=client.post(url+'/apply',json={'version':row['version'],'fields':{**row['fields'],'title':'人工核对名称'}});assert r.status_code==200
    assert r.json()['title']=='人工核对名称'
    assert client.post(url+'/apply',json={}).json()['id']==r.json()['id']
    account(client,'other@example.test');assert client.post(url+'/apply',json={}).status_code==404

def test_interview_does_not_overwrite_newer_archive(client,monkeypatch):
    owner=account(client)['user']['id'];fake_model(monkeypatch,lambda *a:'{"title":"旧名称","products":"补充"}')
    brand=client.post('/api/studio/brands',json={'title':'原品牌'}).json()
    row=client.post('/api/studio/interviews',json={'type':'brand','target_id':brand['id']}).json();url='/api/studio/interviews/'+row['id']
    j=client.post(url+'/turn',json={'version':1,'answer':'补充业务','summarize':True,'request_id':'sum'}).json();assert finish(client,j)['status']=='done'
    client.patch('/api/studio/brands/'+brand['id'],json={'version':1,'title':'新名称'})
    row=s.get(owner,row['id']);assert client.post(url+'/apply',json={'version':row['version'],'fields':row['fields']}).status_code==409
    assert s.get(owner,brand['id'])['title']=='新名称'

def test_images_binding_generates_local_asset_and_retries_once(studio,monkeypatch):
    s.set_config('providers',[{'id':'cpa','base_url':'https://example.test/v1','secret':'opaque'}])
    s.set_config('models',[{'id':'pic','provider':'cpa','capability':'image','model':'gpt-image-2.5','title':'Image 2.5','verified':True,'published':True}])
    s.set_config('bindings',{'text_image':'pic'})
    calls=[];monkeypatch.setattr(illustrations,'generate',lambda *a:(calls.append(a) or 'data:image/png;base64,'+base64.b64encode(png()).decode()))
    tool=next(x for x in studio.get('/api/studio/catalog').json()['tools'] if x['id']=='text_image')
    assert tool['configured'] and tool['provider']=='images' and 'watermark' not in tool['options']
    draft=studio.post('/api/studio/drafts',json={'tool':'text_image','title':'测试','input':{'prompt':'leaf'},'options':{'size':'1024x1024'}}).json()
    body={'draft_id':draft['id'],'version':draft['version'],'confirmed':True,'request_id':'one'}
    run=studio.post('/api/studio/generate',json=body).json();run=studio.get('/api/studio/runs').json()['items'][0]
    assert run['status']=='succeeded',run
    assert studio.post('/api/studio/generate',json=body).json()['id']==run['id'] and len(calls)==1
    assert 'result' not in run
    asset=s.get('alice',run['asset_ids'][0]);assert media._path('alice',asset['local_file']).read_bytes()==png()
    s.set_config('bindings',{'text_image':''});assert not next(x for x in studio.get('/api/studio/catalog').json()['tools'] if x['id']=='text_image')['configured']

def test_media_binding_rejects_wrong_capability(client,monkeypatch):
    account(client)
    s.set_config('providers',[{'id':'cpa'}]);s.set_config('models',[{'id':'wrong','provider':'cpa','capability':'text','verified':True,'published':True}])
    assert client.post('/api/admin/bindings',json={'text_image':'wrong'}).status_code==400
    assert client.post('/api/admin/bindings',json={'text_avatar':'wrong'}).status_code==400
