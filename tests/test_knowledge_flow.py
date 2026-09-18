import json,time,threading
from test_workflows import client,account
from backend import store as s,gateway,jobs

def wait(owner,j):
    for _ in range(150):
        row=s.get(owner,j['id'])
        if row['status'] not in ['queued','running'] and j['id'] not in jobs.CANCEL:return row
        time.sleep(.02)
    raise AssertionError('job did not finish')

def model(monkeypatch,rows):
    monkeypatch.setattr(gateway,'select',lambda *a,**kw:'fixture')
    monkeypatch.setattr(gateway,'generate',lambda *a,**kw:json.dumps({'items':rows},ensure_ascii=False))

def test_extract_review_saved_result_and_duplicates(client,monkeypatch):
    owner=account(client)['user']['id']
    source=client.post('/api/import/text',json={'title':'访谈原文','body':'用户确认自己喜欢简短的行业口语表达，不用夸张宣传。'}).json()
    rows=[{'title':'表达偏好','body':'喜欢简短、口语化的行业表达。','type':'memory','source_ids':[source['id']]}]
    model(monkeypatch,rows)
    def extract():return wait(owner,client.post('/api/knowledge/extract',json={'source_ids':[source['id']]}).json())
    j=extract();assert j['status']=='done' and j['result']['count']==1
    assert '新增 1 条' in j['result']['summary']
    issue=s.get(owner,j['result']['issue_ids'][0]);assert issue['status']=='pending' and not s.list_(owner,'memory')
    assert issue['evidence_excerpt'][source['id']]
    duplicate=extract();assert duplicate['result']['count']==0 and duplicate['result']['existing_issue_ids']==[issue['id']]
    result=client.post('/api/issues/'+issue['id']+'/resolve',json={'action':'accept','version':issue['version'],'title':'我偏好的表达','body':'简短、真实、不夸张'}).json()
    saved=s.get(owner,result['result_id']);assert saved['kind']=='memory' and saved['title']=='我偏好的表达'
    assert '简短、真实、不夸张' in jobs.context(owner,[])
    assert client.post('/api/issues/'+issue['id']+'/resolve',json={'action':'accept'}).status_code==409
    assert client.post('/api/objects/'+saved['id']+'/trash',json={}).status_code==200
    assert '简短、真实、不夸张' not in jobs.context(owner,[])
    assert extract()['result']['count']==1
    assert client.post('/api/objects/'+saved['id']+'/restore',json={}).status_code==200
    assert '简短、真实、不夸张' in jobs.context(owner,[])

def test_empty_invalid_and_deleted_candidates_are_explicit(client,monkeypatch):
    owner=account(client)['user']['id']
    source=client.post('/api/import/text',json={'title':'原文','body':'有正文内容'}).json()
    model(monkeypatch,[])
    def extract():return wait(owner,client.post('/api/knowledge/extract',json={'source_ids':[source['id']]}).json())
    empty=extract();assert empty['result']['count']==0 and '没有提炼出' in empty['result']['summary']
    rows=[{'title':'无依据','body':'不应保存','source_ids':['unknown']},{'title':'有效','body':'有来源的建议','source_ids':[source['id']]}]
    model(monkeypatch,rows);j=extract();assert j['result']['skipped']==1 and j['result']['count']==1
    issue=s.get(owner,j['result']['issue_ids'][0]);client.post('/api/objects/'+issue['id']+'/trash',json={})
    assert client.post('/api/issues/'+issue['id']+'/resolve',json={'action':'accept'}).status_code==409
    assert extract()['result']['count']==1

def test_source_preflight_no_model_call_and_owner_scope(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[]
    monkeypatch.setattr(gateway,'select',lambda *a,**kw:calls.append(a))
    source=client.post('/api/import/text',json={'title':'只有标题','body':'只有标题','url':'https://example.com/article'}).json()
    assert client.post('/api/knowledge/extract',json={'source_ids':[source['id']]}).status_code==400
    assert not calls
    task=client.post('/api/tasks/open',json={'title':'空对话'}).json()
    assert client.post('/api/knowledge/extract',json={'source_ids':[task['id']]}).status_code==400
    assert not calls
    client.post('/api/objects/'+source['id']+'/trash',json={})
    assert client.post('/api/knowledge/extract',json={'source_ids':[source['id']]}).status_code==400
    account(client,'other@example.test')
    assert client.post('/api/knowledge/extract',json={'source_ids':[source['id']]}).status_code==404

def test_conversation_extraction_has_candidate_and_active_guard(client,monkeypatch):
    owner=account(client)['user']['id']
    task=s.put(owner,'task',{'title':'定位访谈','messages':[{'role':'user','text':'确认目标读者是物业经理'}]})
    gate=threading.Event();entered=threading.Event()
    monkeypatch.setattr(gateway,'select',lambda *a,**kw:'fixture')
    def generate(*a,**kw):
        entered.set();gate.wait(3)
        return json.dumps({'items':[{'title':'目标读者','body':'物业经理','type':'memory','source_ids':[task['id']]}]})
    monkeypatch.setattr(gateway,'generate',generate)
    j=client.post('/api/knowledge/extract',json={'source_ids':[task['id']]}).json();assert entered.wait(2)
    try:
        assert client.post('/api/knowledge/extract',json={'source_ids':[task['id']]}).status_code==400
        assert client.post('/api/objects/'+task['id']+'/trash',json={}).status_code==409
    finally:gate.set()
    j=wait(owner,j);assert j['result']['count']==1 and not s.list_(owner,'source')
