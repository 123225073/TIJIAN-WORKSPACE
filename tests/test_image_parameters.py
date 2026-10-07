import pytest
from backend import image_parameters as p,media_studio as m,media_registry as registry,store as s
from test_media_studio import studio,png,submit

SIZES={'size':['1024x1024','1536x1024','1024x1536','1536x864','864x1536','2048x2048','2560x1440','1440x2560']}

@pytest.mark.parametrize('ratio,size',[('2:3','1024x1536'),('9:16','864x1536'),('2.32:1','1536x864'),('1:1','1024x1024')])
def test_nearest_advertised_geometry(ratio,size):
    out=p.normalize(SIZES,{'requested_ratio':ratio,'requested_resolution':'1K'})
    assert out['size']==size
    assert bool(p.notice(out))==(ratio=='2.32:1')

def test_nearest_resolution_without_claiming_unsupported_4k():
    out=p.normalize(SIZES,{'requested_ratio':'9:16','requested_resolution':'4K'})
    assert out['size']=='1440x2560'
    assert '4K → 2K' in p.notice(out)
    choices={'aspect_ratio':['1:1','16:9','21:9'],'resolution':['1k','2k']}
    out=p.normalize(choices,{'requested_ratio':'2.32:1','requested_resolution':'4K'})
    assert out['aspect_ratio']=='21:9' and out['resolution']=='2k'
    assert '2.32:1 → 21:9' in p.notice(out)

@pytest.mark.parametrize('ratio',['0:1','1:0','-1:2','NaN:1','1e2:1','99999:1','foo',{},1])
def test_bad_ratio_rejected(ratio):
    with pytest.raises(ValueError):p.normalize(SIZES,{'requested_ratio':ratio})

def test_intent_round_trips_and_provider_sees_only_canonical_options(studio,monkeypatch):
    calls=[]
    def fake_request(method,url,**kwargs):
        calls.append((method,url,kwargs))
        if '/predictions/' in url:return {'code':200,'data':{'status':'completed','outputs':['https://example.invalid/result.png']}}
        return {'code':200,'data':{'id':'isolated-prediction','status':'created'}}
    def download(owner,id,url,kind):
        path=m._path(owner,id+'.png');path.write_bytes(png());return path.name,m._metadata(path,'.png')
    monkeypatch.setattr(m,'_request',fake_request);monkeypatch.setattr(m,'_download',download)
    registry.save_provider({'id':'wavespeed','api_key':'isolated-not-a-real-key'})
    body={'tool':'text_image','title':'参数测试','model_id':'media:wavespeed-gpt-image-25-flare-text','input':{'prompt':'示意场景'},'options':{'requested_ratio':'2.32:1','requested_resolution':'2K'}}
    response=studio.post('/api/studio/drafts',json=body);assert response.status_code==200,response.text
    draft=response.json();assert draft['options']['aspect_ratio']=='21:9'
    assert studio.get('/api/studio/drafts').json()['items'][0]['options']['requested_ratio']=='2.32:1'
    run=submit(studio,draft).json();current=studio.post('/api/studio/runs/'+run['id']+'/refresh').json()
    assert current['status']=='succeeded',current
    assert '2.32:1 → 21:9' in current['parameter_adjustment']
    payload=next(c[2]['payload'] for c in calls if 'text-to-image' in c[1])
    assert payload['aspect_ratio']=='21:9' and payload['resolution']=='2k'
    assert not any(k in payload for k in p.META)
    assert studio.post('/api/studio/drafts',json={**body,'options':{'requested_ratio':'0:1'}}).status_code==400
    assert studio.post('/api/studio/drafts',json={**body,'options':{'arbitrary':'tool'}}).status_code==400
