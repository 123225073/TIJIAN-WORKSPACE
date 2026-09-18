import json
from datetime import datetime, timezone
from test_workflows import client, account
from test_knowledge_flow import wait
from backend import store as s, gateway, jobs, library, retrieval, synthesis


def source(client, title='设备原文', body='设备检查记录应保留时间与来源。'):
    r=client.post('/api/import/text',json={'title':title,'body':body});assert r.status_code==200,r.text
    return r.json()


def scope(owner, **kw):
    return library.normalize_scope(owner,{'mode':'selected','modules':[],'folder_ids':[],'item_ids':[],'excluded_ids':[],**kw})


def test_original_needs_no_confirmation_and_long_tail_is_retrieved(client):
    owner=account(client)['user']['id']
    obj=source(client,body='例行保养记录。'*4000+'\n设备密钥编号并非真实凭据，验收代号是紫铜海豚392。')
    result=retrieval.retrieve(owner,'验收代号紫铜海豚是多少',scope(owner,modules=['source']))
    assert any('紫铜海豚392' in x['text'] and x['start']>15000 for x in result['excerpts'])
    assert result['characters']<=result['budget']
    assert not s.list_(owner,'issue')


def test_folder_hierarchy_batch_move_cycle_and_owner(client):
    owner=account(client)['user']['id']
    a=client.post('/api/objects/folder',json={'title':'维护','library':'source'}).json()
    b=client.post('/api/objects/folder',json={'title':'维保案例','library':'source','parent_id':a['id']}).json()
    obj=source(client)
    assert client.post('/api/library/move',json={'ids':[obj['id']],'folder_id':b['id']}).status_code==200
    assert client.patch('/api/objects/'+a['id'],json={'parent_id':b['id']}).status_code==400
    result=retrieval.retrieve(owner,'设备检查',scope(owner,folder_ids=[a['id']]))
    assert [x['id'] for x in result['excerpts']]==[obj['id']]
    assert client.post('/api/objects/'+a['id']+'/trash',json={}).status_code==409
    assert client.post('/api/objects/'+b['id']+'/trash',json={}).status_code==409
    w=client.post('/api/objects/folder',json={'title':'知识','library':'knowledge'}).json()
    assert client.post('/api/library/move',json={'ids':[obj['id']],'folder_id':w['id']}).status_code==400
    account(client,'folder-other@example.test')
    assert client.post('/api/library/move',json={'ids':[obj['id']],'folder_id':None}).status_code==404
    assert client.post('/api/library/preview',json={'scope':{'folder_ids':[a['id']]}}).status_code==404


def test_empty_scope_and_exclusions_never_expand(client):
    owner=account(client)['user']['id'];a=source(client);b=source(client,'第二份','设备检查第二份正文')
    assert retrieval.retrieve(owner,'设备检查',scope(owner))['excerpts']==[]
    selected=scope(owner,item_ids=[a['id']])
    result=retrieval.retrieve(owner,'设备检查',selected)
    assert {x['id'] for x in result['excerpts']}=={a['id']}
    result=retrieval.retrieve(owner,'设备检查',scope(owner,modules=['source'],excluded_ids=[a['id']]))
    assert {x['id'] for x in result['excerpts']}=={b['id']}
    client.patch('/api/objects/'+b['id'],json={'exclude_ai':True})
    assert retrieval.retrieve(owner,'设备检查',scope(owner,modules=['source'],excluded_ids=[a['id']]))['excerpts']==[]


def test_select_more_than_twenty_reports_omissions_and_persists(client):
    owner=account(client)['user']['id']
    ids=[source(client,str(i),'检验原文'+str(i)+'。'*2000)['id'] for i in range(25)]
    selected=scope(owner,item_ids=ids)
    task=client.post('/api/tasks/open',json={'title':'全选总结','source_ids':ids,'reference_scope':selected}).json()
    assert task['reference_scope']['item_ids']==ids
    r=retrieval.retrieve(owner,'总结所选资料',selected)
    assert r['characters']<=r['budget'] and r['omitted_selected']
    empty=scope(owner)
    assert client.post('/api/tasks/'+task['id']+'/references',json={'scope':empty}).status_code==200
    assert s.get(owner,task['id'])['reference_scope']==empty


def test_wiki_staleness_exclude_delete_and_scope(client):
    owner=account(client)['user']['id'];obj=source(client)
    wiki=s.put(owner,'knowledge',{'title':'设备检查','body':'设备检查记录应保留时间与来源。','status':'auto','source_ids':[obj['id']],'source_hashes':{obj['id']:library.fingerprint(obj)}})
    selected=scope(owner,modules=['wiki','source'])
    r=retrieval.retrieve(owner,'设备检查记录',selected)
    assert r['excerpts'][0]['id']==wiki['id'] and not r['original_fallback']
    r=retrieval.retrieve(owner,'设备检查记录原文',selected)
    assert r['original_fallback'] and obj['id'] in [x['id'] for x in r['excerpts']]
    client.patch('/api/objects/'+obj['id'],json={'body':'新版设备检查记录：需要同时记录天气。'})
    r=retrieval.retrieve(owner,'设备检查记录',selected)
    assert wiki['id'] not in [x['id'] for x in r['excerpts']]
    state=client.get('/api/state').json()
    assert next(x for x in state['objects'] if x['id']==wiki['id'])['freshness_warning']
    client.post('/api/objects/'+obj['id']+'/trash',json={})
    assert not retrieval.retrieve(owner,'设备检查记录',selected)['excerpts']


def mock_compile(monkeypatch, response):
    calls=[]
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'compile-model')
    def generate(model,messages):
        calls.append((model,messages))
        return json.dumps({'items':response},ensure_ascii=False)
    monkeypatch.setattr(gateway,'generate',generate)
    return calls


def test_compilation_auto_saves_incremental_sources_and_history(client,monkeypatch):
    owner=account(client)['user']['id'];obj=source(client)
    calls=mock_compile(monkeypatch,[{'topic':'设备记录','title':'记录方法','body':'检查记录保留时间与来源。','quote':'设备检查记录应保留时间与来源。'}])
    j=wait(owner,synthesis.start(owner,[obj['id']]))
    assert j['status']=='done',j
    wiki=s.get(owner,j['result']['saved_ids'][0]);assert wiki['status']=='auto' and wiki['source_ids']==[obj['id']]
    assert not s.list_(owner,'issue')
    again=wait(owner,synthesis.start(owner,[obj['id']]));assert again['status']=='done' and len(calls)==1
    other=source(client,'另外的材料','设备检查记录应保留时间与来源。另外还需保留负责人。')
    mock_compile(monkeypatch,[{'topic':'设备记录','title':'负责人','body':'同时保留负责人。','quote':'另外还需保留负责人。'}])
    j=wait(owner,synthesis.start(owner,[other['id']]))
    newer=s.get(owner,wiki['id']);assert len(newer['source_ids'])==2 and '负责人' in newer['body']
    assert len(s.list_(owner,'knowledge'))==1 and s.versions(owner,wiki['id'])
    old=next(v for v in s.versions(owner,wiki['id']) if len(v.get('source_ids',[]))==1)
    restored=client.post(f'/api/knowledge/{wiki["id"]}/restore/{old["version"]}',json={})
    assert restored.status_code==200 and len(restored.json()['source_ids'])==1


def test_memory_user_only_and_uncertain_requires_review(client,monkeypatch):
    owner=account(client)['user']['id']
    task=s.put(owner,'task',{'title':'访谈','messages':[{'role':'user','text':'我喜欢用短句，避免夸张宣传。'},{'role':'assistant','text':'你是世界最有钱的人。'}]})
    calls=mock_compile(monkeypatch,[{'topic':'表达偏好','title':'短句表达','body':'喜欢短句、避免夸张宣传。','quote':'我喜欢用短句，避免夸张宣传。','explicit_user_statement':True}])
    j=wait(owner,synthesis.start(owner,[task['id']]))
    assert j['status']=='done' and s.get(owner,j['result']['saved_ids'][0])['kind']=='memory'
    assert '最有钱' not in calls[0][1][-1]['content']
    obj=s.put(owner,'task',{'title':'假设','messages':[{'role':'user','text':'假设我是物业经理，如何写文章？'}]})
    mock_compile(monkeypatch,[{'title':'工作身份','body':'物业经理','quote':'假设我是物业经理','explicit_user_statement':True}])
    j=wait(owner,synthesis.start(owner,[obj['id']]))
    assert j['result']['issue_ids'] and not j['result']['saved_ids']


def test_bad_evidence_not_checkpointed_and_user_edits_preserved(client,monkeypatch):
    owner=account(client)['user']['id'];obj=source(client)
    mock_compile(monkeypatch,[{'title':'假的','body':'假的','quote':'原文没有这个句子'}])
    j=wait(owner,synthesis.start(owner,[obj['id']]));assert j['status']=='failed'
    assert synthesis.pending(owner,[obj['id']]) and not s.list_(owner,'knowledge')
    mock_compile(monkeypatch,[{'topic':'检查','title':'检查','body':'整理结果','quote':'设备检查记录'}])
    j=wait(owner,synthesis.start(owner,[obj['id']]));wiki=s.get(owner,j['result']['saved_ids'][0])
    client.patch('/api/objects/'+wiki['id'],json={'body':'我亲自编辑的版本'})
    j=wait(owner,synthesis.start(owner,[obj['id']],force=True))
    assert j['result']['issue_ids'] and s.get(owner,wiki['id'])['body']=='我亲自编辑的版本'


def test_disabled_deleted_memory_not_resurrected(client,monkeypatch):
    owner=account(client)['user']['id'];task=s.put(owner,'task',{'title':'偏好','messages':[{'role':'user','text':'我喜欢简短的答案。'}]})
    mock_compile(monkeypatch,[{'topic':'回答长度','title':'短回答','body':'偏好简短答案','quote':'我喜欢简短的答案。','explicit_user_statement':True}])
    j=wait(owner,synthesis.start(owner,[task['id']]))
    client.post('/api/objects/'+j['result']['saved_ids'][0]+'/trash',json={})
    again=wait(owner,synthesis.start(owner,[task['id']],force=True))
    assert not again['result']['saved_ids']


def test_nightly_due_catchup_idempotence_and_disabled(client,monkeypatch):
    owner=account(client)['user']['id'];source(client)
    called=[]
    monkeypatch.setattr(synthesis,'start',lambda *a,**kw:called.append((a,kw)) or {'id':'night-job'})
    stamp=datetime(2026,9,18,20,0,tzinfo=timezone.utc)  # 19th 04:00 CST, missed 02:00
    synthesis.tick(stamp);assert not called
    s.set_config('synthesis:'+owner,{**synthesis.DEFAULTS,'auto_wiki':True,'enabled_at':'2026-09-18T00:00:00+00:00'})
    synthesis.tick(stamp);synthesis.tick(stamp)
    assert len(called)==1 and s.config('synthesis_schedule:'+owner)['day']=='2026-09-19'
    synthesis.tick(datetime(2026,9,19,20,0,tzinfo=timezone.utc));assert len(called)==2


def test_internal_modules_and_actual_request_respect_scope(client,monkeypatch):
    owner=account(client)['user']['id'];a=source(client,'被选中','选择内的设备事实。');source(client,'不选中','不应泄露的珍珠蓝鲸。')
    s.set_config('synthesis:'+owner,{**synthesis.DEFAULTS,'ai_search':False})
    selected=scope(owner,item_ids=[a['id']]);task=client.post('/api/tasks/open',json={'title':'研究设备','reference_scope':selected}).json()
    seen=[]
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'fake-model')
    monkeypatch.setattr(gateway,'generate',lambda model,messages:seen.append(messages) or '基于所选资料回答')
    j=wait(owner,client.post('/api/tasks/'+task['id']+'/send',json={'text':'设备情况','mode':'research','reference_scope':selected}).json())
    assert j['status']=='done'
    actual=json.dumps(seen,ensure_ascii=False);assert '选择内的设备事实' in actual and '珍珠蓝鲸' not in actual
    assert s.get(owner,task['id'])['retrieval']['selected_count']==1
    s.put(owner,'news',{'title':'雷达设备线索','body':'雷达设备测试正文'})
    r=retrieval.retrieve(owner,'设备',scope(owner,modules=['radar']))
    assert {x['kind'] for x in r['excerpts']}=={'news'}


def test_ai_expansion_and_failure_are_explicit(client,monkeypatch):
    owner=account(client)['user']['id'];obj=source(client,'更新项目','老旧电梯更新包括设备更换与安装。')
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'search')
    monkeypatch.setattr(gateway,'generate',lambda *a,**k:'{"queries":["老旧电梯更新"],"need_original":true}')
    words,original,method=retrieval.plan_query(owner,'旧梯换新怎么做')
    r=retrieval.retrieve(owner,'旧梯换新怎么做',scope(owner,modules=['source']),expansions=words,need_original=original,method=method)
    assert obj['id'] in [x['id'] for x in r['excerpts']] and 'AI' in r['method']
    monkeypatch.setattr(gateway,'generate',lambda *a,**k:(_ for _ in ()).throw(RuntimeError('offline')))
    assert '不可用' in retrieval.plan_query(owner,'设备')[2]


def test_date_query_checks_created_time_and_full_evidence_hash(client):
    owner=account(client)['user']['id'];today=source(client,'当天新增','关于安全记录的一段新材料。')
    old=s.put(owner,'source',{'title':'旧文章','body':'旧材料','created':'2025-01-01T00:00:00+00:00'})
    r=retrieval.retrieve(owner,'今天添加的文章讲什么',scope(owner,modules=['source']))
    assert today['id'] in [x['id'] for x in r['excerpts']] and old['id'] not in [x['id'] for x in r['excerpts']]
    long=source(client,'长文','例行检查。'*5000+'\n最终编号海豚392。')
    content=s.put(owner,'content',{'title':'长文事实','body':'最终编号海豚392。','source_ids':[long['id']]})
    ctx=jobs.content_evidence(owner,content);assert '最终编号海豚392' in ctx
    before=jobs.evidence_hash(owner,content)
    client.patch('/api/objects/'+long['id'],json={'body':long['body']+'\n补充的新版本内容'})
    assert jobs.evidence_hash(owner,content)!=before


def test_memory_keeps_valid_user_quote_after_more_conversation(client,monkeypatch):
    owner=account(client)['user']['id'];task=s.put(owner,'task',{'title':'偏好','messages':[{'role':'user','text':'我喜欢短句。'}]})
    mock_compile(monkeypatch,[{'title':'短句','body':'偏好短句','quote':'我喜欢短句。','explicit_user_statement':True}])
    j=wait(owner,synthesis.start(owner,[task['id']]))
    memory=s.get(owner,j['result']['saved_ids'][0])
    s.put(owner,'task',{**task,'messages':task['messages']+[{'role':'assistant','text':'好的'},{'role':'user','text':'现在谈一谈选题。'}]},task['id'])
    assert not library.freshness(memory,{x['id']:x for x in s.list_(owner)})
    assert retrieval.retrieve(owner,'表达偏好',scope(owner,modules=['memory']))['excerpts']


def test_nightly_interrupted_job_resumes_once(client,monkeypatch):
    owner=account(client)['user']['id'];source(client)
    s.set_config('synthesis:'+owner,{**synthesis.DEFAULTS,'auto_wiki':True})
    j=s.put(owner,'job',{'title':'中断整理','status':'interrupted','input':{'action':'synthesis'}})
    s.set_config('synthesis_schedule:'+owner,{'day':'2026-09-19','job_id':j['id']})
    calls=[]
    def submit(*a,**k):
        calls.append(1);return s.put(owner,'job',{'title':'补跑','status':'queued','input':{'action':'synthesis'}})
    monkeypatch.setattr(synthesis,'start',submit)
    stamp=datetime(2026,9,18,20,0,tzinfo=timezone.utc)
    synthesis.tick(stamp);synthesis.tick(stamp);assert len(calls)==1


def test_cancel_and_batch_budget_leave_unprocessed_work(client,monkeypatch):
    owner=account(client)['user']['id'];obj=source(client,'长篇整理','设备记录。'*1600)
    s.set_config('synthesis:'+owner,{**synthesis.DEFAULTS,'max_calls':1})
    mock_compile(monkeypatch,[])
    j=wait(owner,synthesis.start(owner,[obj['id']]))
    assert j['result']['completed']==1 and j['result']['remaining']>0
    assert synthesis.pending(owner,[obj['id']])
