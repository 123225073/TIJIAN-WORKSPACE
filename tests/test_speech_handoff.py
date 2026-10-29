"""Actual workflow/model-boundary regressions, disposable DB and offline transport."""
import json
import time
import pytest
from test_creation_workflow_isolation import client, flow
from backend import store as s, gateway as g, capabilities

ARTICLE = '# 老旧电梯更新，先问什么？\n\n## 先看记录\n物业要核对**检验记录**，不能只看报价。\n\n![示意图](/api/image/file)\n详情见[公开说明](https://example.invalid/info)。\n\n【画面：电梯门特写】\n\n最后保留完整的结论。'
READING = '物业要核对检验记录，不能只看报价。\n\n详情见公开说明。\n\n最后保留完整的结论。'

def source_flow(client, **fields):
    row = flow(client)
    topic = client.post('/api/studio/topics', json={'title':'历史文章选题','source_ids':[]}).json()
    content = s.put('alice', 'content', {'flow_id':row['id'], 'title':'创作要求作为历史标题', 'body':ARTICLE, **fields})
    saved = client.post('/api/studio/flow', json={**row,'topic_id':topic['id'],'content_id':content['id']})
    assert saved.status_code == 200, saved.text
    return saved.json(), content

def resolve(client, row):
    response = client.get('/api/studio/flows/'+row['id']+'/speech')
    assert response.status_code == 200, response.text
    return response.json()

def test_existing_avatar_draft_endpoint_reproduces_raw_article_symptom(client):
    row, original = source_flow(client)
    response = client.post('/api/studio/flows/'+row['id']+'/drafts', json={
        'tool':'text_avatar','input':{'text':original['body']},'source_ids':[original['id']],'options':{}})
    assert response.status_code == 200, response.text
    assert response.json()['input']['text'] == READING

def test_historical_article_title_and_markdown_are_not_read(client):
    row, original = source_flow(client)
    result = resolve(client, row)
    assert result['text'] == READING
    assert result['source_field'] == 'body' and result['needs_conversion'] is True
    assert s.get('alice', original['id']) == original

@pytest.mark.parametrize('field', ['spoken','script'])
def test_explicit_speech_wins_and_plain_custom_text_is_preserved(client, field):
    plain = '标题这个词也是我要读的。\n\n先问一句：你核对了吗？\n完整结尾。'
    row, original = source_flow(client, **{field:plain})
    result = resolve(client, row)
    assert result['text'] == plain and result['source_field'] == field
    assert result['needs_conversion'] is False
    assert s.get('alice', original['id']) == original

def test_real_generation_route_structured_output_handoff_contract(client, monkeypatch):
    row = flow(client)
    calls = []
    s.set_config('bindings', {'writing':'offline-contract'})
    role = next(x for x in capabilities.list_() if x['id']=='role:writing')
    capabilities.save({**role,'body':'管理员自定义写作提示词：事实准确，保留表达。'},'alice')
    s.set_config('prompts:alice',{'writing':'用户个人提示词：不要虚构经历。'})
    admin_config = s.config('system_capabilities')
    monkeypatch.setattr(g, 'select', lambda *a, **k:'offline-contract')
    monkeypatch.setattr(g, 'generate', lambda model, messages: calls.append(messages) or json.dumps({
        'title':'只作展示的标题','body':'文章正文另存','script':'**你好**，先核对记录。\n【画面：门口】\n这才是完整结尾。','shotlist':'镜头1：门口'}, ensure_ascii=False))
    draft = client.post('/api/studio/flows/'+row['id']+'/drafts', json={'tool':'text','input':{'brief':'用户自定义要求：保留结尾，不编造经历','format':'口播脚本'}}).json()
    response = client.post('/api/studio/text/generate', json={'flow_id':row['id'],'draft_id':draft['id'],'brief':draft['input']['brief'],'format':'口播脚本','request_id':'speech-contract'})
    assert response.status_code == 200, response.text
    for _ in range(200):
        job = s.get('alice', response.json()['id'])
        if job['status'] not in {'queued','running'}: break
        time.sleep(.01)
    assert job['status'] == 'done', job
    generated = s.get('alice',job['result']['content_id'])
    row = client.post('/api/studio/flow',json={**row,'content_id':generated['id']}).json()
    speech = resolve(client,row)
    assert speech['text'] == '你好，先核对记录。\n\n这才是完整结尾。'
    assert speech['source_field'] == 'body' and not speech['needs_conversion']
    payload = json.loads(calls[0][1]['content'])
    assert payload['要求'].startswith(draft['input']['brief']) and payload['内容形式'] == '口播脚本'
    assert '本次口播输出约束' in payload['要求'] and '不输出文稿标题' in payload['要求']
    assert '管理员自定义写作提示词' in calls[0][0]['content']
    assert '用户个人提示词' in calls[0][0]['content']
    assert s.config('system_capabilities') == admin_config
    assert s.config('prompts:alice') == {'writing':'用户个人提示词：不要虚构经历。'}
    assert s.get('alice',draft['id'])['input']['brief'] == draft['input']['brief']
    assert generated['body'] == speech['text']
    assert generated['title'] == '只作展示的标题'
    assert generated['brief'] == draft['input']['brief']
    assert json.loads(generated['generation_raw_body'])['script'].startswith('**你好**')

@pytest.mark.parametrize('platform', ['channels','douyin'])
def test_platform_handoff_is_clean_and_existing_drafts_are_never_overwritten(client, platform):
    row, original = source_flow(client,script='用户原有纯口播。\n保留全文。')
    response = client.post('/api/studio/deliveries',json={
        'platform':platform,'flow_id':row['id'],'topic_id':row['topic_id'],
        'title':original['title'],'script':resolve(client,row)['text']})
    assert response.status_code == 200, response.text
    delivery = response.json()
    assert delivery['script'] == original['script']
    edited = client.patch('/api/studio/deliveries/'+delivery['id'], json={'version':delivery['version'],'script':'我手工修改的稿件 **保持原样**'}).json()
    resolve(client,row)
    again = client.get('/api/studio/deliveries?flow_id='+row['id']).json()['items']
    assert again == [edited]
    assert s.get('alice',original['id']) == original

def test_handoff_does_not_leak_foreign_flow(client):
    row, _ = source_flow(client)
    client.headers['authorization'] = 'bob'
    assert client.get('/api/studio/flows/'+row['id']+'/speech').status_code == 404

@pytest.mark.parametrize('field', ['spoken','script'])
def test_quoted_speech_is_not_mistaken_for_production_instructions(client, field):
    quoted = '他说：“【画面：这是原话】”，这句话需要读出来。\n\n> ## 标题\n> 【字幕：引用中的原话】\n> 口播脚本\n\n最后完整结尾。'
    expected = '他说：“【画面：这是原话】”，这句话需要读出来。\n\n标题\n【字幕：引用中的原话】\n口播脚本\n\n最后完整结尾。'
    row, _ = source_flow(client, **{field:quoted})
    assert resolve(client,row)['text'] == expected

def test_user_custom_media_text_and_existing_edits_are_authoritative(client):
    row, original = source_flow(client)
    draft = client.post('/api/studio/flows/'+row['id']+'/drafts',json={
        'tool':'tts','input':{'text':'用户自己写的 # 原话'},'source_ids':[original['id']],'options':{}}).json()
    assert draft['input']['text'] == '用户自己写的 # 原话'
    edited = client.patch('/api/studio/flows/'+row['id']+'/drafts/'+draft['id'],json={
        'version':draft['version'],'input':{'text':ARTICLE}}).json()
    assert edited['input']['text'] == ARTICLE

def test_conversion_stays_in_existing_writer_and_retains_source_and_custom_brief(client):
    row, original = source_flow(client,brief='用户自定义提示词：不要增加人物经历。')
    inputs = resolve(client,row)['conversion_input']
    assert inputs['format'] == '口播脚本'
    assert original['body'] in inputs['brief'] and original['brief'] in inputs['brief']
    draft = client.post('/api/studio/flows/'+row['id']+'/drafts',json={
        'tool':'text','input':inputs,'source_ids':[original['id']]}).json()
    assert draft['input'] == inputs
    assert not s.list_('alice','job') and s.get('alice',original['id']) == original

@pytest.mark.parametrize('body,expected', [
    ('标题：用于发布的标题\n\n## 第一部分标题\n完整正文。\n\n### 第二部分标题\n完整结尾。', '完整正文。\n\n完整结尾。'),
    ('发布标题：用于发布\n正文开头。【分镜：门口特写】正文接着说。\n制作说明：需要配乐\n正文结尾。', '正文开头。正文接着说。\n\n正文结尾。'),
    ('## 口播脚本\n正文开头。\n## 分镜脚本\n画面不要朗读。\n### 镜头一\n特写不要朗读。\n## 口播稿\n完整口播结尾。', '正文开头。\n完整口播结尾。'),
    ('## 文章标题\n文章标题的值\n## 正文\n真实正文。\n\n## 制作说明\n制作内容不读。', '真实正文。'),
])
def test_marked_titles_inline_cues_and_nested_production_blocks(client, body, expected):
    row, _ = source_flow(client,body=body)
    assert resolve(client,row)['text'] == expected

def test_spoken_natural_title_and_quoted_inline_cue_are_kept(client):
    spoken = '今天的标题是：先问清楚。\n他说：“【分镜：这是原话】”，正文【分镜：不朗读的特写】继续。\n> # 引用中的标题是原话\n完整结尾。'
    row, _ = source_flow(client,spoken=spoken)
    assert resolve(client,row)['text'] == '今天的标题是：先问清楚。\n他说：“【分镜：这是原话】”，正文继续。\n引用中的标题是原话\n完整结尾。'

def test_explicit_content_id_reads_new_selection_without_waiting_for_flow_autosave(client):
    row, _ = source_flow(client,spoken='旧稿。')
    latest = s.put('alice','content',{'flow_id':row['id'],'title':'新稿','spoken':'当前新选入口播。','body':'新稿正文'})
    response = client.get('/api/studio/flows/'+row['id']+'/speech?content_id='+latest['id'])
    assert response.status_code == 200, response.text
    assert response.json()['text'] == latest['spoken'] and response.json()['content_id'] == latest['id']
    assert response.json()['content_version'] == latest['version']
    assert s.get('alice',row['id'])['content_id'] != latest['id']

def test_request_only_contract_is_scoped_to_speech_format_and_preserves_custom_input():
    from backend.speech_helper import speech_generation_request
    original = {'brief':'用户明确写的提示词。','format':'口播脚本','request_id':'same-request'}
    constrained = speech_generation_request(original)
    assert original['brief'] == '用户明确写的提示词。'
    assert constrained['brief'].startswith(original['brief'])
    article = {**original,'format':'公众号文章'}
    assert speech_generation_request(article) == article


def test_generated_speech_title_excludes_appended_rules(client, monkeypatch):
    row = flow(client)
    s.set_config('bindings', {'writing':'offline-contract'})
    monkeypatch.setattr(g, 'select', lambda *a, **k:'offline-contract')
    monkeypatch.setattr(g, 'generate', lambda model, messages:'这是自然口播开头。\n完整结尾。')
    brief='老旧电梯安全检查'
    draft=client.post('/api/studio/flows/'+row['id']+'/drafts',json={'tool':'text','input':{'brief':brief,'format':'口播脚本'}}).json()
    response=client.post('/api/studio/text/generate',json={'flow_id':row['id'],'draft_id':draft['id'],'brief':brief,'format':'口播脚本','request_id':'plain-speech'})
    assert response.status_code==200
    for _ in range(200):
        job=s.get('alice',response.json()['id'])
        if job['status'] not in {'queued','running'}:break
        time.sleep(.01)
    assert job['status']=='done',job
    generated=s.get('alice',job['result']['content_id'])
    assert generated['title']==brief and generated['brief']==brief
    assert generated['body']=='这是自然口播开头。\n完整结尾。'

@pytest.mark.parametrize('first', ['**标题：** 正文中的标题', '标题：正文中的标题', '# 正文中的标题'])
def test_explicit_first_title_is_saved_once(client, monkeypatch, first):
    s.set_config('bindings', {'writing':'offline-contract'})
    monkeypatch.setattr(g, 'select', lambda *a, **k:'offline-contract')
    monkeypatch.setattr(g, 'generate', lambda model, messages:first+'\n\n实际内容。')
    response=client.post('/api/studio/text/generate',json={'brief':'原始创作要求','format':'公众号文章','request_id':'title-'+str(len(first))})
    assert response.status_code==200
    for _ in range(200):
        job=s.get('alice',response.json()['id'])
        if job['status'] not in {'queued','running'}:break
        time.sleep(.01)
    assert job['status']=='done',job
    generated=s.get('alice',job['result']['content_id'])
    assert generated['title']=='正文中的标题'
    assert generated['body']=='实际内容。'
