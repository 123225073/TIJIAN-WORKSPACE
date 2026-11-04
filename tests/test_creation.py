import json
import time
import pytest
from test_workflows import client, account
from backend import store as s, gateway as g, capabilities

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

def test_prompt_optimize_rules_cover_image_edit_and_video(client,monkeypatch):
    account(client);requests=[]
    def answer(_,messages):
        requests.append(messages)
        kind=json.loads(messages[1]['content'])['类型']
        if kind=='image':
            return '移除左侧广告牌并自然补全背景，保留人物和光线。参考图1仅提供产品外观，其他区域保持原样。'
        return '参考图1确定产品外观，参考视频1仅用于动作，参考音频1控制节奏。主体缓步前行，镜头平稳跟随，前后画面保持连续。'
    fake_model(monkeypatch,answer)
    image=client.post('/api/studio/prompt/optimize',json={
        'type':'image','prompt':'移除左侧广告牌，保留人物和光线。参考图1仅提供产品外观',
        'reference_counts':{'image':1},'has_reference':True}).json()
    assert finish(client,image)['status']=='done'
    video=client.post('/api/studio/prompt/optimize',json={
        'type':'video','prompt':'参考图1确定产品外观，参考视频1仅用于动作，参考音频1控制节奏',
        'reference_counts':{'image':1,'video':1,'audio':1},'has_reference':True,
        'video_mode':'reference','video_ratio':'9:16','duration':5}).json()
    assert finish(client,video)['status']=='done'
    assert '修改对象与区域' in requests[0][0]['content']
    assert capabilities.VIDEO_PROMPT_METHOD not in requests[0][0]['content']
    assert capabilities.VIDEO_PROMPT_METHOD in requests[1][0]['content']
    assert '前后帧一致性' in requests[1][0]['content']
    assert '不重新编号' in requests[1][0]['content']
    context=json.loads(requests[1][1]['content'])
    assert context['创作方式']=='多素材参考'
    assert context['画幅（仅用来安排构图）']=='9:16'
    assert context['时长（仅用来安排镜头节奏）']==5

    role=next(item for item in capabilities.list_() if item['id']==capabilities.VIDEO_PROMPT_ROLE)
    capabilities.save({**role,'body':'管理员视频优化规则：镜头优先平稳。'},'fixture-admin')
    fake_model(monkeypatch,lambda mid,messages: requests.append(messages) or '从首帧自然延续，镜头平稳推进，电梯门缓缓打开。')
    first_frame=client.post('/api/studio/prompt/optimize',json={
        'type':'video','prompt':'电梯门缓缓打开','reference_counts':{'image':1},'video_mode':'first_frame',
        'video_ratio':'9:16','duration':5}).json()
    assert finish(client,first_frame)['status']=='done'
    assert '管理员视频优化规则：镜头优先平稳。' in requests[-1][0]['content']
    assert json.loads(requests[-1][1]['content'])['创作方式']=='首帧生视频'


def test_h3_conversion_uses_bound_text_model_and_reference_template(client, monkeypatch):
    account(client)
    result = ('subject_definitions: Use <Video 1> for movement.\n'
              'summary: Elevator doors open.\nretention_analysis: Reuse camera movement.\n'
              'detailed_description: [Shot 1] The elevator doors slide open.\n'
              'overall_soundscape: Soft mechanical movement.\nnon_diegetic_music: N/A')

    def answer(model_id, messages):
        assert model_id == 'test-model'
        assert 'Ref2VA' in messages[0]['content']
        assert capabilities.VIDEO_PROMPT_METHOD not in messages[0]['content']
        context = json.loads(messages[1]['content'])
        assert context['成片时长'] == 6 and context['素材数量'] == {'video': 1}
        return result

    fake_model(monkeypatch, answer)
    response = client.post('/api/studio/prompt/optimize', json={
        'type': 'video', 'prompt': '电梯门缓缓打开', 'h3_mode': 'reference',
        'duration': 6, 'reference_counts': {'video': 1},
    })
    assert response.status_code == 200, response.text
    done = finish(client, response.json())
    assert done['status'] == 'done'
    assert done['result']['optimized_prompt'] == result

@pytest.mark.parametrize('answer',[
    '',None,'优化完成','以下是优化后的提示词：一台电梯','画面采用16:9构图，主体是一台电梯',
    '参考图1展示一台电梯','一台电梯'+('，细节' * 450),
])
def test_prompt_optimize_invalid_model_output_fails_job(client,monkeypatch,answer):
    account(client);fake_model(monkeypatch,lambda *a:answer)
    job=client.post('/api/studio/prompt/optimize',json={'prompt':'一台电梯','type':'image'})
    assert job.status_code==200
    done=finish(client,job.json())
    assert done['status']=='failed' and 'optimized_prompt' not in done.get('result',{})

def test_prompt_optimize_reference_numbers_and_source_parameters(client,monkeypatch):
    account(client)
    fake_model(monkeypatch,lambda *a:'参考图2用于外观，采用16:9构图。')
    body={'prompt':'参考图1用于外观，采用16:9构图','type':'image','reference_counts':{'image':1}}
    assert client.post('/api/studio/prompt/optimize',json={**body,'prompt':'参考图2用于外观'}).status_code==400
    assert finish(client,client.post('/api/studio/prompt/optimize',json=body).json())['status']=='failed'
    monkeypatch.setattr(g,'generate',lambda *a:'参考图1用于外观，采用16:9构图。')
    assert finish(client,client.post('/api/studio/prompt/optimize',json=body).json())['status']=='done'

def test_prompt_optimize_cannot_claim_unseen_reference_or_unbound_model(client,monkeypatch):
    account(client)
    assert client.post('/api/studio/prompt/optimize',json={'prompt':'电梯广告画面'}).status_code==400
    fake_model(monkeypatch,lambda *a:'已查看参考图，图中是一台蓝色电梯。')
    job=client.post('/api/studio/prompt/optimize',json={'prompt':'电梯广告画面','reference_counts':{'image':1},'has_reference':True}).json()
    assert finish(client,job)['status']=='failed'
    monkeypatch.setattr(g,'generate',lambda *a:'参考图中显示一台蓝色电梯。')
    job=client.post('/api/studio/prompt/optimize',json={'prompt':'电梯广告画面','reference_counts':{'image':1},'has_reference':True}).json()
    assert finish(client,job)['status']=='failed'

def test_prompt_optimize_keeps_explicit_original_constraints(client,monkeypatch):
    account(client)
    fake_model(monkeypatch,lambda *a:'电梯产品广告，画面干净，有品牌标志。')
    body={'prompt':'电梯产品广告，不要出现品牌标志','type':'image'}
    assert finish(client,client.post('/api/studio/prompt/optimize',json=body).json())['status']=='failed'
    monkeypatch.setattr(g,'generate',lambda *a:'电梯产品广告，不要出现品牌标志，柔和侧光，主体居中。')
    assert finish(client,client.post('/api/studio/prompt/optimize',json=body).json())['status']=='done'


def test_prompt_optimize_accepts_same_constraint_with_reordered_words(client,monkeypatch):
    account(client)
    fake_model(monkeypatch,lambda *a:'电梯门保持关闭，背景用冷色并提高细节。')
    body={'prompt':'保持电梯门关闭，背景用冷色','type':'image'}
    assert finish(client,client.post('/api/studio/prompt/optimize',json=body).json())['status']=='done'
