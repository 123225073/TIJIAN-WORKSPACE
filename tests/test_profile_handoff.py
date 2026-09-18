from test_workflows import client,account
from backend import store as s

def test_positioning_save_review_version_and_isolation(client):
    owner=account(client)['user']['id']
    task=s.put(owner,'task',{'title':'定位访谈','mode':'profile','messages':[{'role':'assistant','text':'待用户核对的方案'}]})
    url='/api/tasks/'+task['id']+'/profile'
    data={'title':'我的专业身份','body':'用户编辑后的定位方案','position':'服务物业','task_version':task['version']}
    saved=client.post(url,json=data);assert saved.status_code==200,saved.text
    p=saved.json();assert p['status']=='accepted' and p['body']==data['body']
    assert p['positioning_task_id']==task['id'] and p['positioning_task_version']==task['version']
    assert client.post(url,json=data).status_code==409
    update={**data,'profile_id':p['id'],'profile_version':p['version'],'body':'第二版'}
    p2=client.post(url,json=update).json();assert p2['version']==2
    assert s.versions(owner,p['id'])[0]['body']==data['body']
    assert client.post(url,json=update).status_code==409
    assert client.post(url,json={**update,'profile_version':2,'task_version':0}).status_code==409
    assert client.post(url,json={**update,'profile_version':2,'title':' '}).status_code==400
    account(client,'other-ip@example.test')
    assert client.post(url,json=data).status_code==404

def test_positioning_requires_finished_answer_and_valid_target(client):
    owner=account(client)['user']['id']
    task=s.put(owner,'task',{'title':'定位','messages':[]})
    data={'title':'名字','body':'方案','task_version':task['version']}
    url='/api/tasks/'+task['id']+'/profile'
    assert client.post(url,json=data).status_code==400
    task=s.put(owner,'task',{**task,'messages':[{'role':'assistant','text':'方案'}]},task['id'])
    data['task_version']=task['version']
    wrong=s.put(owner,'source',{'title':'非身份'})
    assert client.post(url,json={**data,'profile_id':wrong['id'],'profile_version':wrong['version']}).status_code==400
    s.put(owner,'job',{'task_id':task['id'],'status':'running'})
    assert client.post(url,json=data).status_code==409
