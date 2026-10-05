"""Offline official-API contracts; no live keys, cloud writes, or paid requests."""
import io
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
import pytest
from PIL import Image
from backend import ark_video as ark, media_registry as registry, media_studio as m, store as s, gateway as g
from test_media_studio import studio, submit


def model(family='seedance-2.5'):
    return next(dict(v) for v in registry.PRESET_MODELS if v['provider_id']=='ark' and v['family']==family)


def picture(client):
    data=io.BytesIO();Image.new('RGB',(640,640),'green').save(data,format='PNG')
    r=client.post('/api/studio/upload',files={'file':('reference.png',data.getvalue(),'image/png')})
    assert r.status_code==200,r.text
    return r.json()


def save(client,inputs=None,options=None,mid=ark.DEFAULT_MODEL):
    r=client.post('/api/studio/drafts',json={'tool':'text_video','title':'Official API contract test','model_id':mid,'input':inputs or {'prompt':'电梯门缓缓开启'},'options':options or {}})
    assert r.status_code==200,r.text
    return r.json()


def configured():
    return registry.save_provider({'id':'ark','api_key':'isolated-ark-test-key'})


def test_default_binding_shelves_but_retains_legacy_configuration(studio):
    registry.save_provider({'id':'wavespeed','api_key':'isolated-legacy-key'})
    secret=s.config(registry.PROVIDER_KEY)['wavespeed']['secret']
    s.set_config(registry.MODEL_KEY,{'wavespeed-seedance-25':{'published':True}})
    s.set_config('bindings',{'text_video':'media:wavespeed-seedance-25','image_edit':'media:wavespeed-gpt-image-25-flare-edit','writing':'custom-text'})
    catalog=studio.get('/api/studio/catalog').json()
    assert next(t for t in catalog['tools'] if t['id']=='text_video')['binding']==ark.DEFAULT_MODEL
    assert all(x['provider']=='ark' for x in next(t for t in catalog['tools'] if t['id']=='text_video')['models'])
    assert not next(v for v in registry.models() if v['id']=='wavespeed-seedance-25')['published']
    assert s.config(registry.PROVIDER_KEY)['wavespeed']['secret']==secret
    assert s.config('bindings')['image_edit']=='media:wavespeed-gpt-image-25-flare-edit'
    assert s.config('bindings')['writing']=='custom-text'
    assert registry.choice('text_video','wavespeed-seedance-25',active=False)[0]['api_model_id']
    registry.save_model({'id':'wavespeed-seedance-25','published':True})
    assert registry.choice('text_video','wavespeed-seedance-25')[0]['published']


def test_official_connection_probe_and_tos_encryption(studio,monkeypatch):
    calls=[]
    monkeypatch.setattr(registry,'_request',lambda url,headers:calls.append((url,headers)) or {'items':[]})
    configured()
    registry.save_provider({'id':'ark','tos_bucket':'tijian-private','tos_region':'cn-beijing','tos_access_key':'test-access-key','tos_secret_key':'test-storage-secret'})
    out=registry.discover_provider('ark')
    assert out['connected'] and calls[0][0]==ark.BASE_URL+ark.TASKS+'?page_size=1'
    assert calls[0][1]['Authorization']=='Bearer isolated-ark-test-key'
    public=registry.catalogue()
    assert 'test-storage-secret' not in str(public) and 'test-access-key' not in str(public)
    assert next(p for p in public['providers'] if p['id']=='ark')['storage_ready']
    before=s.config(registry.PROVIDER_KEY)['ark']['tos_secret']
    registry.save_provider({'id':'ark','api_key':'','tos_secret_key':''})
    assert s.config(registry.PROVIDER_KEY)['ark']['tos_secret']==before
    with pytest.raises(registry.RegistryError):registry.save_provider({'id':'ark','base_url':'https://example.com'})
    with pytest.raises(registry.RegistryError):registry.save_model({'id':'ark-seedance-25','api_model_id':'doubao-seedance-2-0-260128'})


@pytest.mark.parametrize('family,resolution,seconds',[
    ('seedance-2.5','1080p',30),('seedance-2.0','4k',15),('seedance-2.0-fast','720p',15),('seedance-2.0-mini','480p',15)])
def test_version_specific_parameters(family,resolution,seconds):
    mdl=model(family);opts={'resolution':resolution,'duration':seconds,'ratio':'21:9','generate_audio':True,'priority':9}
    ark.validate(mdl,{'prompt':'test'},opts,None,complete=True)
    with pytest.raises(ark.ArkError):ark.validate(mdl,{'prompt':'test'},{'duration':seconds+1},None,complete=True)
    with pytest.raises(ark.ArkError):ark.validate(mdl,{'prompt':'test'},{'generate_audio':1},None)
    if family!='seedance-2.0':
        with pytest.raises(ark.ArkError):ark.validate(mdl,{'prompt':'test'},{'resolution':'4k'},None)


@pytest.mark.parametrize('mode,refs,opts,roles',[
 ('text',[],{},[]),
 ('reference',[{'kind':'image','url':'asset://img'},{'kind':'video','url':'asset://vid'},{'kind':'audio','url':'asset://aud'}],{},['reference_image','reference_video','reference_audio']),
 ('first_frame',[{'kind':'image','url':'asset://img'}],{},['first_frame']),
 ('first_last_frame',[{'kind':'image','url':'asset://img'},{'kind':'image','url':'asset://end'}],{},['first_frame','last_frame']),
 ('edit',[{'kind':'video','url':'asset://vid','duration':5}],{'ratio':'adaptive','duration':-1},['reference_video']),
 ('extend',[{'kind':'video','url':'asset://vid'}],{'ratio':'adaptive','duration':12},['reference_video'])])
def test_content_roles_and_defaults(mode,refs,opts,roles):
    inputs={'prompt':'test','reference_mode':mode,'remote_references':refs};mdl=model()
    valid=ark.validate(mdl,inputs,opts,None,complete=True)
    result=ark.payload('alice',mdl,inputs,opts,valid,None)
    assert [v['role'] for v in result['content'] if 'role' in v]==roles
    assert result['resolution']=='720p' and result['generate_audio'] is True
    assert result['ratio']=='adaptive' and result['duration']==opts.get('duration',-1)
    assert len(result['safety_identifier'])==64
    assert result['model']=='doubao-seedance-2-5-260628'


@pytest.mark.parametrize('inputs,opts',[
 ({'prompt':'test','reference_mode':'first_last_frame','remote_references':[{'kind':'image','url':'asset://img'}]},{}),
 ({'prompt':'test','reference_mode':'edit','remote_references':[{'kind':'video','url':'asset://vid'}]},{'duration':5}),
 ({'prompt':'test','reference_mode':'extend','remote_references':[{'kind':'video','url':'asset://vid'}]},{'ratio':'16:9'}),
 ({'prompt':'test'},{'seed':123}),
 ({'prompt':'test'},{'draft':True,'resolution':'720p'}),
 ({'prompt':'test'},{'execution_expires_after':1}),
 ({'prompt':'test'},{'callback_url':False}),
 ({'remote_references':[{'kind':'audio','url':'asset://a','duration':20},{'kind':'audio','url':'asset://b','duration':20}]},{})])
def test_invalid_input_rejected_before_billing(inputs,opts):
    with pytest.raises(ark.ArkError):ark.validate(model(),inputs,opts,None,complete=True)


def test_local_video_requires_tos_and_upload_uses_official_sdk(studio,tmp_path,monkeypatch):
    configured()
    video={'local_file':'v.mp4','asset_type':'video','mime_type':'video/mp4','size':16,'width':1280,'height':720,'fps':30,'duration':5,'video_codec':'h264'}
    inputs={'remote_references':[],'video_ids':['video'],'reference_mode':'edit'}
    with pytest.raises(ark.ArkError,match='TOS'):
        ark.validate(model(),inputs,{},lambda *args:video,complete=True,service={})
    registry.save_provider({'id':'ark','tos_bucket':'test-private','tos_region':'cn-beijing','tos_access_key':'test-ak','tos_secret_key':'test-sk'})
    service=next(v for v in registry.providers() if v['id']=='ark')
    ark.validate(model(),inputs,{},lambda *args:video,complete=True,service=service)
    import tos
    calls=[]
    class Client:
        def __init__(self,ak,sk,**kwargs):assert ak=='test-ak' and sk=='test-sk';assert kwargs['endpoint']=='https://tos-cn-beijing.volces.com'
        def put_object(self,bucket,key,**kwargs):calls.append((bucket,key,kwargs['content'].read()))
        def pre_signed_url(self,method,bucket,key,expires):assert expires==259200;return SimpleNamespace(signed_url='https://test-private.tos-cn-beijing.volces.com/file?signature=fixture')
        def close(self):pass
    monkeypatch.setattr(tos,'TosClientV2',Client)
    path=tmp_path/'test.mp4';path.write_bytes(b'test-file')
    assert ark.media_url('alice',video,service,path).startswith('https://')
    ark.media_url('alice',video,service,path)
    assert calls[0]==calls[1] and calls[0][0]=='test-private'
    assert 'alice' not in calls[0][1]


def test_submit_poll_archive_tail_frame_and_draft_to_final(studio,monkeypatch):
    configured();img=picture(studio);calls=[]
    def request(method,url,**kwargs):
        calls.append((method,url,kwargs))
        if method=='POST':return {'id':'official-task-'+str(sum(c[0]=='POST' for c in calls))}
        return {'status':'succeeded','resolution':'480p','ratio':'1:1','duration':5,'draft':True,'usage':{'completion_tokens':120,'total_tokens':120,'private':'hidden'},'content':{'video_url':'https://example.com/result.mov','last_frame_url':'https://example.com/tail.jpg'},'output_format':'mov'}
    def download(owner,id,url,kind,**kwargs):
        ext='.mov' if kind=='video' else '.jpg';path=m._path(owner,id+ext);path.write_bytes(b'offline-fixture-only')
        return path.name,{'asset_type':kind,'mime_type':'video/quicktime' if kind=='video' else 'image/jpeg','width':640,'height':640,'duration':5}
    monkeypatch.setattr(m,'_request',request);monkeypatch.setattr(m,'_download',download)
    d=save(studio,{'prompt':'test','image_ids':[img['id']],'reference_mode':'first_frame'},{'draft':True,'resolution':'480p','return_last_frame':True,'output_format':'mov'})
    r=submit(studio,d,'ark-once').json();assert r['status']=='running' and r['task_id']=='official-task-1'
    assert submit(studio,d,'ark-once').json()['id']==r['id']
    post=calls[0];assert post[1]==ark.BASE_URL+ark.TASKS
    assert post[2]['headers']=={'Authorization':'Bearer isolated-ark-test-key'}
    assert post[2]['payload']['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
    completed=studio.post('/api/studio/runs/'+r['id']+'/refresh').json()
    assert completed['status']=='succeeded' and len(completed['asset_ids'])==1 and completed['last_frame_id']
    assert completed['actual_parameters']['usage']=={'completion_tokens':120,'total_tokens':120}
    m.tick();assert sum(c[0]=='POST' for c in calls)==1
    final=save(studio,{'draft_run':r['id']},{'resolution':'1080p','output_format':'mp4'})
    assert submit(studio,final,'ark-final').status_code==200
    payload=[c for c in calls if c[0]=='POST'][-1][2]['payload']
    assert payload['content']==[{'type':'draft_task','draft_task':{'id':r['task_id']}}]
    assert not set(payload)&{'ratio','duration','generate_audio','draft','tools','omni_reference_task_type'}
    assert studio.post('/api/studio/drafts',headers={'authorization':'Bearer bob'},json={'tool':'text_video','model_id':ark.DEFAULT_MODEL,'input':{'draft_run':r['id']},'options':{}}).status_code==404


def test_unknown_submission_never_reposted_and_queued_cancel(studio,monkeypatch):
    configured();calls=[]
    def timeout(method,url,**kwargs):calls.append(method);raise TimeoutError()
    monkeypatch.setattr(m,'_request',timeout)
    d=save(studio);r=submit(studio,d,'ark-timeout').json();assert r['status']=='unknown' and calls==['POST']
    studio.post('/api/studio/runs/'+r['id']+'/refresh');m.recover();m.tick()
    assert calls==['POST']
    def request(method,url,**kwargs):
        calls.append(method)
        return {'id':'cancel-task'} if method=='POST' else {'status':'queued'} if method=='GET' else {}
    monkeypatch.setattr(m,'_request',request)
    second=save(studio);r2=submit(studio,second,'ark-cancel').json()
    cancel=studio.post('/api/studio/runs/'+r2['id']+'/cancel')
    assert cancel.status_code==200 and cancel.json()['status']=='cancelled'
    studio.post('/api/studio/runs/'+r2['id']+'/cancel');m.tick()
    assert calls.count('DELETE')==1


def test_background_archives_known_task_without_open_page(studio,monkeypatch):
    configured();calls=[]
    def request(method,url,**kwargs):
        calls.append(method)
        return {'id':'background-task'} if method=='POST' else {'status':'failed','error':{'code':'ContentPolicy','message':'untrusted provider error with a secret'}}
    monkeypatch.setattr(m,'_request',request)
    r=submit(studio,save(studio),'ark-bg').json();m.tick()
    current=s.get('alice',r['id']);assert current['status']=='failed'
    assert calls==['POST','GET'] and 'untrusted' not in current['error']


def test_restart_watcher_saves_existing_success_without_resubmitting(studio,monkeypatch):
    configured();calls=[]
    def request(method,url,**kwargs):
        calls.append(method)
        return {'id':'restart-task'} if method=='POST' else {'status':'succeeded','content':{'video_url':'https://example.com/result.mp4'}}
    def download(owner,id,url,kind,**kwargs):
        p=m._path(owner,id+'.mp4');p.write_bytes(b'isolated-test-only');return p.name,{'asset_type':'video','mime_type':'video/mp4','duration':5}
    monkeypatch.setattr(m,'_request',request);monkeypatch.setattr(m,'_download',download)
    r=submit(studio,save(studio),'ark-restart').json();m.recover();m.tick()
    current=s.get('alice',r['id']);assert current['status']=='succeeded' and current['asset_ids']
    assert calls==['POST','GET']


def test_watcher_stops_after_official_task_retention(studio,monkeypatch):
    configured();calls=[]
    monkeypatch.setattr(m,'_request',lambda method,url,**kwargs:calls.append(method) or {'id':'expired-task'})
    r=submit(studio,save(studio),'ark-expired').json()
    m._update('alice',r['id'],submitted_at=(datetime.now(timezone.utc)-timedelta(days=8)).isoformat())
    m.tick();assert s.get('alice',r['id'])['status']=='expired' and calls==['POST']
