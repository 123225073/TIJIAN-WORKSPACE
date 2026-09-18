import threading,time
from test_workflows import client,account
from backend import store as s,capabilities as c,jobs,gateway

def test_admin_crud_versions_and_permissions(client):
    account(client)
    data=client.get('/api/admin/capabilities').json()
    role=next(x for x in data['items'] if x['id']=='role:profile')
    changed=client.post('/api/admin/capabilities',json={**role,'body':'先问一个明确的问题。'}).json()
    assert changed['version']==2
    assert client.post('/api/admin/capabilities',json=role).status_code==409
    restored=client.post('/api/admin/capabilities/role:profile/restore',json={'version':2,'target':1}).json()
    assert restored['body']==role['body'] and restored['version']==3
    skill=client.post('/api/admin/capabilities',json={'title':'测试方法','body':'PRIVATE_SKILL_BODY','purpose':'profile','status':'published'}).json()
    assert 'PRIVATE_SKILL_BODY' in c.snapshot('profile')['text']
    deleted=client.post('/api/admin/capabilities',json={**skill,'status':'deleted'}).json()
    assert 'PRIVATE_SKILL_BODY' not in c.snapshot('profile')['text']
    assert client.post('/api/admin/capabilities/'+skill['id']+'/restore',json={'version':deleted['version'],'target':1}).status_code==200
    assert 'PRIVATE_SKILL_BODY' in c.snapshot('profile')['text']
    builtin=next(x for x in data['items'] if x['id']=='skill:profile')
    client.post('/api/admin/capabilities',json={**builtin,'status':'deleted'})
    assert not any(x['id']==builtin['id'] for x in c.snapshot('profile')['metadata']['items'])
    assert client.post('/api/admin/capabilities/role:profile/restore',json={'version':3,'target':'default'}).status_code==200
    account(client,'ordinary@example.test')
    for method,path,body in [('GET','',None),('GET','/preview/profile',None),('POST','',skill),('POST','/role:profile/restore',{'version':4,'target':1})]:
        assert client.request(method,'/api/admin/capabilities'+path,json=body).status_code==403
    assert 'PRIVATE_SKILL_BODY' not in client.get('/api/state').text

def test_actual_request_frozen_and_future_requests_change(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'isolated-model')
    held=[];requests=[]
    monkeypatch.setattr(jobs.POOL,'submit',lambda fn:held.append(fn))
    monkeypatch.setattr(gateway,'generate',lambda model,request:requests.append(request) or '测试回复，不是真实模型')
    role=next(x for x in c.list_() if x['id']=='role:profile')
    old=c.save({**role,'body':'ROLE_FIRST'},owner)
    skill=c.save({'title':'访谈方法','purpose':'profile','body':'METHOD_ONE','status':'published'},owner)
    s.set_config('prompts:'+owner,{'profile':'MY_PERSONAL_PREFERENCE'})
    task=s.put(owner,'task',{'title':'访谈','messages':[]})
    job=jobs.task_turn(owner,task['id'],'开始',mode='profile')
    c.save({**old,'body':'ROLE_SECOND'},owner)
    c.save({**skill,'status':'deleted'},owner)
    held.pop()()
    chat_requests=lambda:[r for r in requests if r[1]['content'].startswith('本次上下文：')]
    system=chat_requests()[-1][0]['content']
    assert all(x in system for x in ['ROLE_FIRST','METHOD_ONE','MY_PERSONAL_PREFERENCE',jobs.POLICY])
    assert 'ROLE_SECOND' not in system
    stored=s.get(owner,job['id'])
    assert 'text' not in stored['input']['configuration']
    assert stored['input']['configuration']['hash']==s.digest(system.removeprefix(jobs.POLICY+'\n'))
    jobs.task_turn(owner,task['id'],'继续',mode='profile');held.pop()()
    assert 'ROLE_SECOND' in chat_requests()[-1][0]['content'] and 'METHOD_ONE' not in chat_requests()[-1][0]['content']
    profile=s.put(owner,'profile',{'title':'指定身份','body':'IDENTITY_MARKER'})
    jobs.task_turn(owner,task['id'],'指定身份',profile_id=profile['id'],mode='profile');held.pop()()
    assert 'IDENTITY_MARKER' in chat_requests()[-1][1]['content']
    jobs.task_turn(owner,task['id'],'取消限定身份',profile_id='',mode='profile');held.pop()()
    assert 'IDENTITY_MARKER' not in chat_requests()[-1][1]['content']
    assert not s.get(owner,task['id']).get('profile_id')

def test_check_and_knowledge_use_admin_roles(client,monkeypatch):
    owner=account(client)['user']['id'];held=[];requests=[]
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'isolated-model')
    monkeypatch.setattr(jobs.POOL,'submit',lambda fn:held.append(fn))
    monkeypatch.setattr(gateway,'generate',lambda model,request:requests.append(request) or '{"items":[],"summary":"isolated"}')
    for purpose in ['check','knowledge']:
        role=next(x for x in c.list_() if x['id']=='role:'+purpose)
        c.save({**role,'body':'ADMIN_'+purpose},owner)
    source=s.put(owner,'source',{'title':'资料','body':'仅用于测试'})
    jobs.knowledge_extract(owner,[source['id']]);held.pop()()
    assert 'ADMIN_knowledge' in requests[-1][0]['content']
    content=s.put(owner,'content',{'title':'稿件','body':'仅用于测试','source_ids':[source['id']]})
    jobs.check_content(owner,content['id']);held.pop()()
    assert 'ADMIN_check' in requests[-1][0]['content']
