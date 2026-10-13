"""Real SQLite/API regressions; model output is an explicit local fixture only."""
import json
import pytest
from test_workflows import client, account
from test_interaction_revision import wait
from backend import store as s, gateway as g, assistant_workspace as aw

FIELDS = {'title':'风沙讲电梯','position':'项目合作与销售获客','audience':'同行与物业',
          'style':'通俗务实','views':'先讲清项目','body':'延续小沙说电梯的定位，建立独立的新 IP。'}

def setup(client, monkeypatch):
    auth = client.post('/api/auth/register',json={'email':'ip-outcome@example.test','password':'isolated-ip-password','name':'隔离 IP 验收'}).json()
    client.headers['Authorization']='Bearer '+auth['token']
    owner = auth['user']['id']
    old = s.put(owner, 'profile', {**FIELDS, 'title':'小沙说电梯', 'body':'旧档案'})
    task = client.post('/api/tasks/open', json={'title':'IP 沟通','mode':'auto','profile_id':old['id']}).json()
    monkeypatch.setattr(g, 'select', lambda *a, **k:'isolated-ip-fixture')
    requests = []
    def generate(model, messages):
        requests.append(messages)
        if '需求识别器' in messages[0]['content']:
            return json.dumps({'action':'profile','platforms':[],'brief':'整理本次 IP 请求'})
        return json.dumps({'reply':'已整理候选，请核对。','action':'profile','ready':True,'fields':FIELDS,'notes':[]}, ensure_ascii=False)
    monkeypatch.setattr(g, 'generate', generate)
    return owner, old, task, requests

def send(client, owner, task, text):
    response = client.post('/api/tasks/'+task['id']+'/send', json={'text':text,'mode':'auto'})
    assert response.status_code == 200, response.text
    result = wait(owner, response.json())
    assert result['status'] == 'done', result
    return s.get(owner, task['id'])

def apply(client, task, **data):
    return client.post('/api/tasks/'+task['id']+'/agent/apply', json={'proposal_id':task['agent_proposal']['id'], **data})

@pytest.mark.parametrize('edited', [False, True])
def test_new_ip_reuses_positioning_without_updating_old_after_file_sync(client, monkeypatch, edited):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '请创建一个新 IP，叫风沙讲电梯，延续小沙说电梯的定位')
    # The UI state request runs workspace file synchronization before confirmation.
    before_sync = task['messages']
    assert s.sync_files(owner) == 0
    task = s.get(owner, task['id'])
    assert task['messages'] == before_sync
    p = task['agent_proposal']
    assert p['operation'] == 'create' and p['target_id'] is None
    assert p['reference_profile_id'] == old['id']
    assert p['task_version'] == task['version']
    response = apply(client, task, **({'fields':{'style':'简洁、具体'}} if edited else {}))
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['id'] != old['id'] and saved['title'] == '风沙讲电梯'
    assert saved['id'] == p['new_profile_id']
    assert s.get(owner, old['id']) == old
    assert len(s.list_(owner, 'profile')) == 2
    assert s.get(owner, task['id'])['profile_id'] == saved['id']
    assert s.get(owner, task['id'])['agent_proposal']['status'] == 'applied'
    assert apply(client, task, **({'fields':{'style':'简洁、具体'}} if edited else {})).json()['id'] == saved['id']
    assert s.get(owner, saved['id'])['version'] == saved['version']
    with s.conn() as c:
        row = c.execute('SELECT data FROM objects WHERE id=? AND owner=?', (saved['id'],owner)).fetchone()
    assert json.loads(row['data'])['body'] == FIELDS['body']

def test_create_binding_survives_followup_and_reprepare(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '请新建一个 IP，名叫风沙讲电梯')
    first = task['agent_proposal']['id']
    task = send(client, owner, task, '目标受众选 B，表达再简洁一些')
    assert task['agent_proposal']['id'] != first
    assert task['agent_proposal']['operation'] == 'create'
    job = client.post('/api/tasks/'+task['id']+'/agent/prepare-profile', json={})
    assert wait(owner, job.json())['status'] == 'done'
    task = s.get(owner, task['id'])
    assert task['agent_proposal']['operation'] == 'create'
    assert apply(client, task).json()['id'] != old['id']

def test_explicit_update_and_changed_target_protection(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '把当前小沙说电梯改名为风沙讲电梯，更新原 IP')
    p = task['agent_proposal']
    assert p['operation'] == 'update' and p['target_id'] == old['id']
    changed = s.put(owner, 'profile', {**old,'style':'另一个窗口的修改'}, old['id'])
    assert apply(client, task).status_code == 409
    assert s.get(owner, old['id']) == changed

def test_stale_candidate_id_and_changed_conversation_cannot_write(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '新建一个 IP 风沙讲电梯')
    original = task
    task = s.put(owner, 'task', {**task,'messages':task['messages']+[{'role':'user','text':'先别保存，我要改定位'}]},task['id'])
    assert apply(client, original).status_code == 409
    assert s.list_(owner, 'profile') == [old]
    task = send(client, owner, task, '改为面向物业')
    assert apply(client, original).status_code == 409
    assert len(s.list_(owner, 'profile')) == 1

def test_metadata_version_does_not_silently_rebind_candidate(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '更新当前 IP 的定位')
    s.put(owner, 'task', {**task,'profile_id':''},task['id'])
    assert apply(client, task).status_code == 409
    assert s.list_(owner, 'profile') == [old]

def test_old_wrongly_bound_new_ip_candidate_requires_reprepare(client, monkeypatch):
    from backend import agent
    owner, old, task, _ = setup(client, monkeypatch)
    task = s.put(owner, 'task', {**task,'messages':[{'role':'user','text':'创建新 IP 风沙讲电梯，参考小沙说电梯'}]},task['id'])
    # Reproduce an already persisted candidate from the old application.
    task = agent.attach(owner, task, {'id':s.uid(),'kind':'profile','fields':FIELDS,'status':'pending',
                                   'target_id':old['id'],'target_version':old['version']})
    assert apply(client, task).status_code == 409
    assert s.list_(owner, 'profile') == [old]

def test_classifier_routes_topics_to_reviewed_candidates(client, monkeypatch):
    owner, _, task, _ = setup(client, monkeypatch)
    monkeypatch.setattr(g,'generate',lambda *a:json.dumps({'action':'topics','platforms':[],'brief':'给选题'}))
    assert aw.identify('isolated-ip-fixture', task, '帮我生成选题')['action'] == 'topics'

def test_topic_outcome_confirm_is_reviewed_owned_atomic_and_idempotent(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    def generate(model,messages):
        if '需求识别器' in messages[0]['content']:
            return json.dumps({'action':'topics','platforms':[],'brief':'电梯更新沟通选题'})
        return json.dumps({'topics':[{'title':'物业如何准备电梯更新资料','angle':'从资料清单讲起','rationale':'方向建议，待查证','audience':'物业经理'},
                                     {'title':'电梯报价应先明确哪些条件','angle':'范围与口径','rationale':'方向建议，待查证','audience':'同行'}]},ensure_ascii=False)
    monkeypatch.setattr(g,'generate',generate)
    task=send(client,owner,task,'帮我生成两个物业电梯更新选题')
    assert not s.list_(owner,'studio_topic') and not s.list_(owner,'content')
    assert s.sync_files(owner)==0
    p=task['topic_proposal'];assert p['kind']=='studio_topic' and p['task_version']==task['version']
    url='/api/tasks/'+task['id']+'/topics/confirm'
    data={'proposal_id':p['id'],'task_version':p['task_version'],'items':[{'candidate_id':p['candidates'][0]['id'],'fields':{'title':'用户核对后的物业更新资料清单'}}]}
    assert client.post(url,json={**data,'items':[{'candidate_id':'not-this-task'}]}).status_code==400
    response=client.post(url,json=data);assert response.status_code==200,response.text
    saved=response.json()['items'];assert len(saved)==1
    assert saved[0]['title']=='用户核对后的物业更新资料清单' and saved[0]['profile_id']==old['id']
    assert saved[0]['origin_ref']==f"task:{task['id']}:{p['id']}:{p['candidates'][0]['id']}"
    assert saved[0]['confirmed_task_version']==p['task_version']
    assert client.post(url,json=data).json()['items'][0]['id']==saved[0]['id']
    assert len(s.list_(owner,'studio_topic'))==1
    assert client.post(url,json={**data,'items':[{'candidate_id':p['candidates'][1]['id']}]}).status_code==409
    account(client,'other-topic-owner@example.test')
    assert client.post(url,json=data).status_code==404

def test_topic_candidate_from_older_conversation_cannot_write(client,monkeypatch):
    owner, _, task, _=setup(client,monkeypatch)
    monkeypatch.setattr(g,'generate',lambda model,messages:json.dumps({'action':'topics','platforms':[],'brief':'电梯选题'}) if '需求识别器' in messages[0]['content'] else json.dumps({'topics':[{'title':'电梯更新准备','angle':'现场条件','rationale':'待核实','audience':'物业'}]}))
    task=send(client,owner,task,'帮我生成电梯选题')
    p=task['topic_proposal'];data={'proposal_id':p['id'],'task_version':p['task_version'],'items':[{'candidate_id':p['candidates'][0]['id']}]}
    s.put(owner,'task',{**task,'messages':task['messages']+[{'role':'user','text':'先改为维保方向'}]},task['id'])
    assert client.post('/api/tasks/'+task['id']+'/topics/confirm',json=data).status_code==409
    assert not s.list_(owner,'studio_topic')

@pytest.mark.parametrize('recovery',['prepare','prepare_inferred','send'])
def test_readonly_demo_copy_recovers_real_historical_candidate(client,monkeypatch,recovery):
    """Optional local acceptance: copy only the requested task/profile, never users or keys."""
    import os,sqlite3,hashlib
    from pathlib import Path
    source_path=os.environ.get('IP_DEMO_READONLY_DB')
    if not source_path:pytest.skip('历史本机验收须显式提供只读快照；普通回归不读取用户当前数据库')
    source=Path(source_path)
    if not source.exists():pytest.skip('指定的本机 demo 数据库不存在')
    assert source.resolve()!=s.DB.resolve()
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    ids=('abc1c5dbe1754b04b1540d5fa573feea','23e64ff3057c43e485c6ec6d5959dddd')
    reader=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True);reader.row_factory=sqlite3.Row
    try:rows=[reader.execute('SELECT id,kind,data,version FROM objects WHERE id=?',(id,)).fetchone() for id in ids]
    finally:reader.close()
    if any(row is None for row in rows):pytest.skip('指定 demo 记录不存在')
    owner=account(client,'copied-demo@example.test')['user']['id']
    # Copy business state/version exactly. File metadata alone is detached so
    # isolated exports cannot refer to a user's original workspace or files.
    with s.conn() as c:
        for row in rows:
            data=json.loads(row['data'])
            data={k:v for k,v in data.items() if k not in {'file','file_hash','file_missing'}}
            c.execute('INSERT INTO objects VALUES (?,?,?,?,?,?)',(row['id'],owner,row['kind'],json.dumps(data,ensure_ascii=False),row['version'],s.now()))
    task=s.get(owner,ids[0]);old=s.get(owner,ids[1]);p=task['agent_proposal']
    assert p['status']=='pending' and p['target_id']==old['id'] and not p.get('task_version')
    old_count=len(s.list_(owner,'profile'))
    monkeypatch.setattr(g,'select',lambda *a,**k:'local-demo-fixture')
    def generate(model,messages):
        if '需求识别器' in messages[0]['content']:return json.dumps({'action':'profile','platforms':[],'brief':'新建风沙讲电梯'})
        return json.dumps({'reply':'已重新整理新增候选。','action':'profile','ready':True,'fields':FIELDS,'notes':['隔离测试结果，不代表付费模型质量']},ensure_ascii=False)
    monkeypatch.setattr(g,'generate',generate)
    assert apply(client,task).status_code==409
    if recovery.startswith('prepare'):
        response=client.post('/api/tasks/'+task['id']+'/agent/prepare-profile',json={'operation':'create'} if recovery=='prepare' else {})
        assert response.status_code==200,response.text
        assert wait(owner,response.json())['status']=='done'
        task=s.get(owner,task['id'])
    else:task=send(client,owner,task,'请创建一个新的 IP 风沙讲电梯，延续小沙说电梯的定位')
    assert task['agent_proposal']['operation']=='create' and task['agent_proposal']['target_id'] is None
    assert task['agent_proposal']['task_version']==task['version']
    assert s.sync_files(owner)==0
    response=apply(client,task);assert response.status_code==200,response.text
    saved=response.json();assert saved['id']!=old['id'] and saved['title']=='风沙讲电梯'
    assert s.get(owner,old['id'])==old and len(s.list_(owner,'profile'))==old_count+1
    assert apply(client,task).json()['id']==saved['id']
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before

def test_topics_receive_saved_hotlist_leads_without_claiming_live_search(client,monkeypatch):
    owner, _, task, requests=setup(client,monkeypatch)
    board=s.put(owner,'hotlist',{'title':'抖音热榜','platform':'douyin','fetched_at':'2026-10-10T08:00:00+00:00','items':[{'title':'电梯更新讨论','url':'https://example.test/source','rank':1}]})
    def generate(model,messages):
        requests.append(messages)
        if '需求识别器' in messages[0]['content']:return json.dumps({'action':'topics','platforms':[],'brief':'根据已保存热榜整理近期电梯选题'})
        payload=json.loads(messages[1]['content']);assert payload['saved_hotlist_leads'][0]['id']==board['id']
        assert '未执行网页搜索' in messages[0]['content']
        return json.dumps({'topics':[{'title':'电梯更新准备','rationale':'热榜标题线索，未核实原文'}]})
    monkeypatch.setattr(g,'generate',generate)
    task=send(client,owner,task,'根据已保存热榜生成近期电梯选题')
    p=task['topic_proposal'];assert p['hotlist_snapshot'][0]['fetched_at']==board['fetched_at']
    assert '未执行网页搜索' in p['tool_boundary']
