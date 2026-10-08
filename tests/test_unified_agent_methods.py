"""Capture actual request composition in isolated DBs; never call paid models."""
import json
from test_workflows import client,account
from test_creation import finish,fake_model
from test_assistant_workspace import setup,send
from backend import store as s,capabilities as c,jobs,gateway as g
from backend.writing_methods import word_requirement

def test_word_requirement_uses_requested_revision_not_old_draft_length():
    assert word_requirement('把500字压到300字')==(300,'approximate')
    assert word_requirement('电梯结构，最多600字')==(600,'maximum')
    assert word_requirement('标题20字，正文600字以内')==(600,'maximum')
    assert word_requirement('请自然改写，不设篇幅')==(None,'unspecified')

def update(owner,purpose,body):
    old=next(x for x in c.list_() if x['id']=='role:'+purpose)
    return c.save({**old,'body':body},owner)

def test_reading_new_defaults_preserves_custom_writing_v2(client):
    owner=account(client)['user']['id']
    original=update(owner,'writing','用户自定义多平台写作要求，必须保留。')
    assert original['version']==2
    before=s.config('system_capabilities')
    data=client.get('/api/admin/capabilities').json()
    assert next(x for x in data['items'] if x['id']=='role:writing')==original
    method=c.snapshot('writing',owner)
    assert '用户自定义多平台写作要求' in method['text']
    assert {'id':'role:writing','version':2} in method['metadata']['items']
    assert s.config('system_capabilities')==before

def test_base_applies_to_every_method_and_published_skills_only(client):
    owner=account(client)['user']['id']
    update(owner,'agent','UNIFIED_BASE_MARKER')
    global_skill=c.save({'title':'通用方法','body':'GLOBAL_METHOD_MARKER','purpose':'agent','status':'published'},owner)
    writing_skill=c.save({'title':'写作专用','body':'WRITER_ONLY_MARKER','purpose':'writing','status':'published'},owner)
    c.save({'title':'未发布','body':'UNPUBLISHED_MARKER','purpose':'all','status':'draft'},owner)
    for purpose in c.PURPOSES:
        frozen=c.snapshot(purpose,owner)
        assert 'UNIFIED_BASE_MARKER' in frozen['text'] and 'GLOBAL_METHOD_MARKER' in frozen['text']
        assert ('WRITER_ONLY_MARKER' in frozen['text'])==(purpose=='writing')
        assert 'UNPUBLISHED_MARKER' not in frozen['text']
        assert frozen['metadata']['skills_mode']=='text-guidance'
        assert sum(x['id']=='role:agent' for x in frozen['metadata']['items'])==1
    c.save({**global_skill,'status':'disabled'},owner)
    c.save({**writing_skill,'status':'deleted'},owner)
    assert 'GLOBAL_METHOD_MARKER' not in c.snapshot('qa',owner)['text']
    assert 'WRITER_ONLY_MARKER' not in c.snapshot('writing',owner)['text']

def test_form_and_assistant_share_base_custom_method_skills_and_preferences(client,monkeypatch):
    owner,task,requests,answer=setup(client,monkeypatch)
    update(owner,'agent','共同基础 MARKER_BASE')
    update(owner,'writing','用户写作方法 MARKER_WRITING_V2')
    c.save({'title':'写作方法','body':'MARKER_PUBLISHED_SKILL','purpose':'writing','status':'published'},owner)
    s.set_config('prompts:'+owner,{'writing':'MARKER_WRITING_PREFERENCE'})
    profile=s.put(owner,'profile',{'title':'确认身份','position':'MARKER_CONFIRMED_IP','audience':'物业'})
    source=s.put(owner,'source',{'title':'确认资料','body':'MARKER_EXPLICIT_SOURCE'})
    form_requests=[]
    def form_answer(_,messages):form_requests.append(messages);return '完整文案'
    fake_model(monkeypatch,form_answer)
    job=client.post('/api/studio/text/generate',json={'brief':'电梯结构','format':'小红书文案','target_words':350,'profile_id':profile['id'],'source_ids':[source['id']]}).json()
    result=finish(client,job);assert result['status']=='done',result
    content=s.get(owner,result['result']['content_id'])
    monkeypatch.setattr(g,'generate',answer)
    send(client,owner,task,'帮我写350字小红书文案：电梯结构',profile_id=profile['id'],source_ids=[source['id']],reference_scope={'mode':'selected','modules':['source'],'folder_ids':[],'item_ids':[source['id']],'excluded_ids':[]})
    assistant_request=next(r for r in requests if '只返回JSON对象' in r[0]['content'])
    for request in [form_requests[0],assistant_request]:
        assert all(x in request[0]['content'] for x in ('MARKER_BASE','MARKER_WRITING_V2','MARKER_PUBLISHED_SKILL','MARKER_WRITING_PREFERENCE',jobs.POLICY))
        assert all(x in request[1]['content'] for x in ('MARKER_CONFIRMED_IP','MARKER_EXPLICIT_SOURCE'))
        assert json.loads(request[1]['content'])['目标字数']==350
    assert content['request_snapshot']['system_hash']==s.digest(form_requests[0][0]['content'])
    assert content['request_snapshot']['input_hash']==s.digest(form_requests[0][1]['content'])
    assert content['request_snapshot']['platform']=='xiaohongshu'
    outcome=s.get(owner,s.get(owner,task['id'])['platform_outcomes']['xiaohongshu'])
    assert outcome['request_snapshot']['input_hash']==s.digest(assistant_request[1]['content'])
    assert outcome['target_words']==350

def test_queued_unified_request_uses_submitted_versions(client,monkeypatch):
    owner,task,requests,_=setup(client,monkeypatch)
    held=[];monkeypatch.setattr(jobs.POOL,'submit',lambda fn:held.append(fn))
    first=update(owner,'writing','WRITING_BEFORE_QUEUE')
    base=update(owner,'agent','BASE_BEFORE_QUEUE')
    skill=c.save({'title':'冻结方法','body':'SKILL_BEFORE_QUEUE','purpose':'writing','status':'published'},owner)
    job=client.post('/api/tasks/'+task['id']+'/send',json={'text':'帮我写600字以内公众号文章：电梯结构','mode':'auto','skip_profile':True}).json()
    update(owner,'writing','WRITING_AFTER_QUEUE');update(owner,'agent','BASE_AFTER_QUEUE');c.save({**skill,'status':'deleted'},owner)
    held.pop()()
    writer=next(r for r in requests if '只返回JSON对象' in r[0]['content'])
    assert all(x in writer[0]['content'] for x in ('WRITING_BEFORE_QUEUE','BASE_BEFORE_QUEUE','SKILL_BEFORE_QUEUE'))
    assert 'WRITING_AFTER_QUEUE' not in writer[0]['content'] and 'BASE_AFTER_QUEUE' not in writer[0]['content']
    assert 'BASE_BEFORE_QUEUE' in requests[0][0]['content']
    result=s.get(owner,job['id'])
    frozen=result['input']['configurations']['writing']
    assert {'id':first['id'],'version':first['version']} in frozen['items']
    assert {'id':base['id'],'version':base['version']} in frozen['items']
    assert 'text' not in frozen
    outcome=s.get(owner,s.get(owner,task['id'])['platform_outcomes']['wechat'])
    assert outcome['request_snapshot']['word_constraint']=='maximum'
    assert outcome['target_words']==600

def test_form_word_limit_and_frozen_profile_sources(client,monkeypatch):
    owner=account(client)['user']['id'];requests=[];held=[]
    monkeypatch.setattr(jobs.POOL,'submit',lambda fn:held.append(fn))
    fake_model(monkeypatch,lambda _,messages:requests.append(messages) or '写作成品')
    profile=s.put(owner,'profile',{'title':'原身份','style':'ORIGINAL_VOICE'})
    source=s.put(owner,'source',{'title':'原资料','body':'ORIGINAL_FACT'})
    job=client.post('/api/studio/text/generate',json={'brief':'电梯结构，600字以内','format':'公众号文章','profile_id':profile['id'],'source_ids':[source['id']]}).json()
    s.put(owner,'profile',{**profile,'style':'LATER_VOICE'},profile['id'])
    s.put(owner,'source',{**source,'body':'LATER_FACT'},source['id'])
    held.pop()()
    assert s.get(owner,job['id'])['status']=='done'
    payload=json.loads(requests[0][1]['content'])
    assert payload['目标字数']==600 and payload['字数约束']=='maximum'
    assert 'ORIGINAL_VOICE' in str(payload) and 'ORIGINAL_FACT' in str(payload)
    assert 'LATER_VOICE' not in str(payload) and 'LATER_FACT' not in str(payload)
    second=client.post('/api/studio/text/generate',json={'brief':'请写600字文章','format':'公众号文章','target_words':400}).json()
    held.pop()()
    assert s.get(owner,second['id'])['status']=='done'
    assert json.loads(requests[-1][1]['content'])['目标字数']==400

def test_unusable_source_never_enters_form_model_request(client,monkeypatch):
    owner=account(client)['user']['id'];requests=[]
    fake_model(monkeypatch,lambda *args:requests.append(args) or '不能生成')
    source=s.put(owner,'source',{'title':'不能用于AI','body':'PRIVATE_EXCLUDED','exclude_ai':True})
    response=client.post('/api/studio/text/generate',json={'brief':'请写文章','source_ids':[source['id']]})
    assert response.status_code==400 and not requests and not s.list_(owner,'content')

def test_admin_preview_covers_active_previously_hidden_methods(client):
    owner=account(client)['user']['id'];data=client.get('/api/admin/capabilities').json()
    assert {'agent','qa','daily','check','knowledge','research'}<=set(data['purposes'])
    assert len(data['items'])>=len(c.PURPOSES)
    preview=client.get('/api/admin/capabilities/preview/writing').json()
    assert jobs.POLICY in preview['text'] and '统一 Agent 基础提示词' in preview['text']
    assert '系统角色' not in preview['text']
    assert not s.list_(owner,'job')

def test_flow_delivery_shares_method_preferences_and_request_trace(client,monkeypatch):
    owner=account(client)['user']['id'];requests=[]
    s.set_config('bindings',{'writing':'fixture-text'})
    monkeypatch.setattr(g,'select',lambda *args,**kwargs:'fixture-text')
    update(owner,'agent','FLOW_BASE_MARKER');update(owner,'writing','FLOW_WRITING_MARKER')
    s.set_config('prompts:'+owner,{'writing':'FLOW_PREFERENCE_MARKER'})
    topic=client.post('/api/studio/topics',json={'title':'维保沟通','angle':'先确认项目条件'}).json()
    draft=client.post('/api/studio/deliveries',json={'topic_id':topic['id'],'platform':'wechat','target_words':300}).json()
    def answer(_,messages):
        requests.append(messages)
        return json.dumps({'title':'维保先看条件','body':'完整稿件。','summary':'核对条件。','cover_brief':'真实现场核对画面','keywords':'维保','publishing_notes':'核实事实'},ensure_ascii=False)
    monkeypatch.setattr(g,'generate',answer)
    job=client.post('/api/studio/deliveries/'+draft['id']+'/generate',json={'version':draft['version']}).json()
    result=finish(client,job);assert result['status']=='done',result
    assert all(x in requests[0][0]['content'] for x in ('FLOW_BASE_MARKER','FLOW_WRITING_MARKER','FLOW_PREFERENCE_MARKER'))
    payload=json.loads(requests[0][1]['content']);assert payload['目标字数']==300
    saved=s.get(owner,draft['id'])
    assert saved['request_snapshot']['system_hash']==s.digest(requests[0][0]['content'])
    assert saved['request_snapshot']['input_hash']==s.digest(requests[0][1]['content'])
    assert saved['request_snapshot']['platform']=='wechat'
