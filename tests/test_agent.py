import json
from test_workflows import client,account
from test_interaction_revision import wait
from backend import agent,store as s,gateway,jobs

FIELDS={'title':'小沙说电梯','position':'电梯项目合作与销售获客','audience':'同行与物业','style':'通俗务实','views':'先讲清项目再谈报价','body':'面向同行与物业，分享项目合作和销售经验。'}
def fixture(client,monkeypatch,action='profile'):
 auth=client.post('/api/auth/register',json={'email':'agent@example.test','password':'test-password-381','name':'测试创作者'}).json();client.headers['Authorization']='Bearer '+auth['token'];owner=auth['user']['id'];monkeypatch.setattr(gateway,'select',lambda *a,**k:'fixture')
 def generate(model,messages):
  if '操作规划器' in messages[0]['content']:
   return json.dumps({'reply':'已梳理，请核对待写入结果。','action':action,'ready':True,'fields':FIELDS if action=='profile' else {'title':'表达偏好','body':'默认用简洁中文'},'notes':['风格为本次讨论建议']},ensure_ascii=False)
  return '完整定位建议'
 monkeypatch.setattr(gateway,'generate',generate)
 task=s.put(owner,'task',{'title':'定位沟通','mode':'profile','messages':[{'role':'user','text':'我叫小沙，做电梯项目销售'},{'role':'assistant','text':'A 同行 B 物业 C 学生'},{'role':'user','text':'A、B'}]})
 return owner,task

def test_full_history_proposal_and_idempotent_apply(client,monkeypatch):
 owner,task=fixture(client,monkeypatch);seen=[];original=gateway.generate
 monkeypatch.setattr(gateway,'generate',lambda m,req:(seen.append(req),original(m,req))[1])
 j=client.post('/api/tasks/'+task['id']+'/agent/prepare-profile',json={}).json();assert wait(owner,j)['status']=='done'
 assert 'A 同行 B 物业 C 学生' in seen[0][1]['content']
 assert not s.list_(owner,'profile')
 p=s.get(owner,task['id'])['agent_proposal'];assert p['fields']['audience']=='同行与物业'
 url='/api/tasks/'+task['id']+'/agent/apply';data={'proposal_id':p['id']}
 r=client.post(url,json=data);assert r.status_code==200,r.text
 saved=r.json();assert saved['position']==FIELDS['position']
 assert client.post(url,json=data).json()['id']==saved['id']
 assert len(s.list_(owner,'profile'))==1
 assert s.get(owner,task['id'])['profile_id']==saved['id']
 account(client,'other-agent@example.test');assert client.post(url,json=data).status_code==404

def test_daily_memory_and_normal_chat_no_ip(client,monkeypatch):
 owner,task=fixture(client,monkeypatch,'memory')
 j=jobs.task_turn(owner,task['id'],'请记住默认用简洁中文',mode='daily');assert wait(owner,j)['status']=='done'
 task=s.get(owner,task['id']);p=task['agent_proposal'];assert p['kind']=='memory';assert not s.list_(owner,'memory')
 assert client.post('/api/tasks/'+task['id']+'/agent/apply',json={'proposal_id':p['id']}).status_code==200
 assert len(s.list_(owner,'memory'))==1 and not s.list_(owner,'profile')
 monkeypatch.setattr(gateway,'generate',lambda *a:json.dumps({'reply':'你好','action':None,'ready':False}))
 assert wait(owner,jobs.task_turn(owner,task['id'],'你好',mode='daily'))['status']=='done'
 assert s.get(owner,task['id'])['agent_proposal'] is None

def test_conflict_stale_and_unsupported_action(client,monkeypatch):
 owner,task=fixture(client,monkeypatch)
 profile=s.put(owner,'profile',{'title':'已有','body':'原内容','style':'原风格'})
 task=s.put(owner,'task',{**task,'profile_id':profile['id']},task['id'])
 assert wait(owner,agent.prepare(owner,task['id']))['status']=='done'
 p=s.get(owner,task['id'])['agent_proposal'];s.put(owner,'profile',{**profile,'body':'其他窗口编辑'},profile['id'])
 assert client.post('/api/tasks/'+task['id']+'/agent/apply',json={'proposal_id':p['id']}).status_code==409
 assert s.get(owner,profile['id'])['body']=='其他窗口编辑'
 assert wait(owner,agent.prepare(owner,task['id']))['status']=='done'
 task=s.get(owner,task['id']);p=task['agent_proposal'];s.put(owner,'task',{**task,'messages':task['messages']+[{'role':'user','text':'我改主意了'}]},task['id'])
 assert client.post('/api/tasks/'+task['id']+'/agent/apply',json={'proposal_id':p['id']}).status_code==409
 monkeypatch.setattr(gateway,'generate',lambda *a:json.dumps({'reply':'执行','action':'delete_all','ready':True}))
 assert wait(owner,agent.prepare(owner,task['id']))['status']=='failed'
 assert len(s.list_(owner,'profile'))==1

def test_profile_turn_auto_prepares(client,monkeypatch):
 owner,task=fixture(client,monkeypatch)
 assert wait(owner,jobs.task_turn(owner,task['id'],'请总结定位',mode='profile'))['status']=='done'
 assert s.get(owner,task['id'])['agent_proposal']['fields']['title']=='小沙说电梯'
 assert not s.list_(owner,'profile')
