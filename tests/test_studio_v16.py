"""Offline contracts for selectable models, reference edits and prompt assistance."""
import base64
import json
from test_media_studio import studio, png, asset, submit
from test_workflows import client, account
from test_creation import fake_model, finish
from backend import store as s, gateway as g, media_studio as media, illustrations


def models():
    s.set_config('providers',[{'id':'cpa','base_url':'https://example.test/v1','secret':'opaque'}])
    s.set_config('models',[{'id':id,'provider':'cpa','capability':'image','model':name,'title':name,'verified':True,'published':True}
                           for id,name in [('default','gpt-image-1'),('selected','gpt-image-2.5')]])
    s.set_config('bindings',{'text_image':'default','image_edit':'default'})


def test_selected_model_reference_quality_survive_draft_and_reach_worker(studio,monkeypatch):
    models();pic=asset(studio);calls=[]
    monkeypatch.setattr(illustrations,'generate',lambda *args,**kw: (calls.append((args,kw)) or illustrations.image_uri(png())))
    d=studio.post('/api/studio/drafts',json={'tool':'text_image','title':'Reference test','model_id':'selected',
        'input':{'prompt':'Keep the leaf, use ivory background','image_id':pic['id']},'options':{'size':'2048x2048','quality':'high'}})
    assert d.status_code==200,d.text
    assert d.json()['model_id']=='selected'
    r=submit(studio,d.json());assert r.status_code==200,r.text
    run=studio.get('/api/studio/runs').json()['items'][0]
    assert run['status']=='succeeded',run
    assert calls[0][0][0]=='selected' and calls[0][0][2]=='2048x2048'
    assert calls[0][1]=={'reference':png(),'quality':'high'}
    output=studio.get('/api/studio/assets').json()['items'][0]
    assert output['requested_size']=='2048x2048' and output['width']==256
    assert s.get('alice',run['id'])['snapshot']['model_id']=='selected'
    catalog=studio.get('/api/studio/catalog').json()
    assert 'opaque' not in json.dumps(catalog)
    choices=next(t for t in catalog['tools'] if t['id']=='image_edit')['models']
    assert {'default','selected'}.issubset({x['id'] for x in choices})


def test_wrong_model_params_and_cross_owner_reference_blocked(studio):
    models();pic=asset(studio)
    body={'tool':'image_edit','title':'test','model_id':'default','input':{'prompt':'edit','image_id':pic['id']},'options':{'size':'2048x2048'}}
    assert studio.post('/api/studio/drafts',json=body).status_code==400
    body['model_id']='selected';body['options']={'quality':'invented'}
    assert studio.post('/api/studio/drafts',json=body).status_code==400
    body['model_id']=[];assert studio.post('/api/studio/drafts',json=body).status_code==400
    body['model_id']='selected';body['options']={}
    assert studio.post('/api/studio/drafts',json=body,headers={'authorization':'Bearer bob'}).status_code in (400,404)
    body['model_id']='service:hifly';assert studio.post('/api/studio/drafts',json=body).status_code==400


def test_image_edit_uses_multipart_and_normal_generation_json(studio,monkeypatch):
    models();calls=[]
    monkeypatch.setattr(media.network,'public_target',lambda url:(url,{},{}))
    monkeypatch.setattr(g,'headers',lambda p:{'Content-Type':'application/json'})
    class Response:
        status_code=200
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def iter_bytes(self):yield json.dumps({'data':[{'b64_json':base64.b64encode(png()).decode()}]}).encode()
    class Client:
        def __init__(self,**kw):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def stream(self,method,url,**kw):calls.append((url,kw));return Response()
    monkeypatch.setattr(illustrations.httpx,'Client',Client)
    illustrations.generate('selected','edit','2048x2048',reference=png(),quality='high')
    url,req=calls[0]
    assert url.endswith('/images/edits') and 'Content-Type' not in req['headers']
    assert req['files']['image'][1]==png() and req['data']['size']=='2048x2048'
    assert req['data']['quality']=='high' and 'json' not in req
    illustrations.generate('selected','draw','1024x1024')
    assert calls[1][0].endswith('/images/generations') and calls[1][1]['json']['model']=='gpt-image-2.5'


def test_prompt_optimization_is_candidate_and_empty_rejected(client,monkeypatch):
    owner=account(client)['user']['id'];fake_model(monkeypatch,lambda *a:'一片绿叶，象牙白背景，柔和侧光。')
    before=len(s.list_(owner,'studio_draft'))
    assert client.post('/api/studio/prompt/optimize',json={'prompt':''}).status_code==400
    r=client.post('/api/studio/prompt/optimize',json={'prompt':'green leaf','type':'image'})
    r.raise_for_status();j=finish(client,r.json())
    assert j['status']=='done',j
    assert j['result']['original_prompt']=='green leaf' and '绿叶' in j['result']['optimized_prompt']
    assert len(s.list_(owner,'studio_draft'))==before


def test_prompt_direction_and_preferences_reach_model_as_user_data(client,monkeypatch):
    account(client);calls=[]
    fake_model(monkeypatch,lambda mid,messages:(calls.append(messages) or '保留主体，背景简洁，缓慢推进镜头。'))
    body={'prompt':'产品视频','type':'video','requirement':'缓慢推进','rule':'保持产品颜色','has_reference':True}
    job=client.post('/api/studio/prompt/optimize',json=body)
    assert finish(client,job.json())['status']=='done'
    payload=json.loads(calls[0][1]['content'])
    assert payload['优化方向']=='缓慢推进' and payload['用户补充偏好']=='保持产品颜色'
    assert payload['已选择参考图'] is True and '不添加尺寸' in calls[0][0]['content']
    assert client.post('/api/studio/prompt/optimize',json={**body,'rule':'a'*3001}).status_code==400
