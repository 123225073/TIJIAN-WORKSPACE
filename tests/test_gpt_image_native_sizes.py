"""Native GPT Image size contracts; all HTTP responses are isolated fixtures."""
import base64
import json
import math
from pathlib import Path
import subprocess

import pytest

from backend import illustrations, image_parameters, store as s
from test_media_studio import studio, png, submit


RATIOS=['1:1','3:2','2:3','4:3','3:4','5:4','4:5','16:9','9:16',
        '21:9','9:21','2:1','1:2','3:1','1:3','2.35:1']


def catalog(monkeypatch, model='gpt-image-2.5'):
    monkeypatch.setattr(illustrations.g,'model_record',lambda _:({'model':model},{}))
    return {'size':illustrations.sizes('offline-model')}


@pytest.mark.parametrize('model',['gpt-image-2','gpt-image-2.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08'])
def test_native_catalog_covers_common_ratios_with_valid_dimensions(monkeypatch,model):
    choices=catalog(monkeypatch,model)
    assert choices['size'][:3]==['1024x1024','1536x1024','1024x1536']
    for value in choices['size']:
        w,h=map(int,value.split('x'))
        assert w%16==h%16==0
        assert 1/3<=w/h<=3 and max(w,h)<=3840
        assert 655360<=w*h<=8294400
    for ratio in RATIOS:
        for resolution in ('1K','2K','4K'):
            options=image_parameters.normalize(choices,{'requested_ratio':ratio,'requested_resolution':resolution})
            w,h=map(int,options['size'].split('x'))
            assert math.isclose(w/h,image_parameters.ratio(ratio))
            assert image_parameters.notice(options)==''


@pytest.mark.parametrize('model',['gpt-image-1','dall-e-3'])
def test_other_models_keep_existing_size_limits(monkeypatch,model):
    assert catalog(monkeypatch,model)['size']==['1024x1024','1536x1024','1024x1536']


@pytest.mark.parametrize('model',['gpt-image-20','other-gpt-image-2'])
def test_legacy_aliases_keep_prior_sizes_without_native_expansion(monkeypatch,model):
    assert catalog(monkeypatch,model)['size']==['1024x1024','1536x1024','1024x1536',
        '1536x864','864x1536','2048x2048','2560x1440','1440x2560']


def test_real_frontend_plan_matches_backend_native_size_and_notice(monkeypatch):
    choices=catalog(monkeypatch)
    intents=[{'requested_ratio':ratio,'requested_resolution':resolution}
             for ratio in RATIOS for resolution in ('1K','2K','4K')]
    script="""
        import {imagePlan} from './src/image-parameters.ts';
        let input='';for await(const chunk of process.stdin)input+=chunk;
        const {choices,intents}=JSON.parse(input);
        process.stdout.write(JSON.stringify(intents.map(options=>imagePlan(choices,options))));
    """
    result=subprocess.run(['node','--input-type=module','-e',script],
                          input=json.dumps({'choices':choices,'intents':intents}),capture_output=True,
                          text=True,cwd=Path(__file__).resolve().parents[1],check=True)
    plans=json.loads(result.stdout)
    for intent,plan in zip(intents,plans):
        assert plan['options']==image_parameters.normalize(choices,intent)
        assert plan['notice']==image_parameters.notice(plan['options'])==''
    assert plans[RATIOS.index('3:4')*3]['options']['size']=='768x1024'
    assert plans[RATIOS.index('3:4')*3+1]['options']['size']=='1536x2048'


def test_three_four_draft_survives_storage_and_reaches_images_request(studio,monkeypatch):
    s.set_config('providers',[{'id':'offline','base_url':'https://example.test/v1','secret':'opaque'}])
    s.set_config('models',[{'id':'native','provider':'offline','capability':'image','model':'gpt-image-2.5',
                            'title':'Image 2.5','verified':True,'published':True}])
    s.set_config('bindings',{'text_image':'native'})
    monkeypatch.setattr(illustrations.network,'public_target',lambda url:(url,{},{}))
    monkeypatch.setattr(illustrations.g,'headers',lambda _: {})
    calls=[]
    class Response:
        status_code=200
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def iter_bytes(self):yield json.dumps({'data':[{'b64_json':base64.b64encode(png()).decode()}]}).encode()
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def stream(self,method,url,**kwargs):calls.append((method,url,kwargs['json']));return Response()
    monkeypatch.setattr(illustrations.httpx,'Client',Client)
    response=studio.post('/api/studio/drafts',json={'tool':'text_image','title':'3:4契约',
        'input':{'prompt':'电梯行业插图'},'options':{'requested_ratio':'3:4','requested_resolution':'2K'}})
    assert response.status_code==200,response.text
    draft=response.json()
    assert draft['options']['size']=='1536x2048'
    assert studio.get('/api/studio/drafts').json()['items'][0]['options']==draft['options']
    response=submit(studio,draft,'native-three-four')
    assert response.status_code==200,response.text
    run=studio.get('/api/studio/runs').json()['items'][0]
    assert run['status']=='succeeded',run
    assert not run.get('parameter_adjustment')
    assert len(calls)==1
    assert calls[0][1].endswith('/images/generations')
    assert calls[0][2]['size']=='1536x2048'
    assert not set(image_parameters.META)&calls[0][2].keys()
