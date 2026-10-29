"""Homepage conversation entry: opening is not sending or generating."""
from test_workflows import client, account
from test_interaction_revision import wait
from backend import store as s, gateway


def test_empty_entry_is_a_persisted_blank_conversation_without_model(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(gateway,'generate',lambda *a,**k:(_ for _ in ()).throw(AssertionError('Opening must not call AI')))
    first=client.post('/api/tasks/open',json={'title':'  ','mode':'auto'})
    assert first.status_code==200,first.text
    task=first.json()
    assert task['title']=='新对话' and task['initial_text']=='' and task['messages']==[]
    assert s.get(owner,task['id'])['messages']==[]
    assert s.list_(owner,'job')==[]
    second=client.post('/api/tasks/open',json={'title':'','mode':'auto'}).json()
    assert second['id']!=task['id']
    assert client.post('/api/tasks/'+task['id']+'/send',json={'text':''}).status_code==400
    assert s.get(owner,task['id'])['messages']==[]


def test_fresh_home_entry_does_not_silently_reuse_old_conversation(client):
    account(client)
    data={'title':'重复的提问也要正常开始','mode':'auto'}
    first=client.post('/api/tasks/open',json=data).json()
    assert client.post('/api/tasks/open',json=data).json()['id']==first['id']
    fresh=client.post('/api/tasks/open',json={**data,'new':True}).json()
    assert fresh['id']!=first['id'] and fresh['initial_text']==data['title']


def test_long_initial_input_is_retained_without_becoming_a_sent_message(client):
    account(client)
    text='完整创作要求。'*50
    task=client.post('/api/tasks/open',json={'title':text,'mode':'auto'}).json()
    assert task['initial_text']==text and len(task['title'])==160 and task['messages']==[]
    assert client.post('/api/tasks/open',json={'title':'x'*10001}).status_code==400


def test_first_real_message_names_empty_chat_once(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(gateway,'select',lambda *a,**k:'offline-fixture')
    def answer(model,messages,**kwargs):
        if '需求识别器' in messages[0]['content']:return '{"action":"chat","platforms":[],"brief":"你好"}'
        return '隔离测试回复，不是真实模型输出。'
    monkeypatch.setattr(gateway,'generate',answer)
    task=client.post('/api/tasks/open',json={'title':'','mode':'auto'}).json()
    sent=client.post('/api/tasks/'+task['id']+'/send',json={'text':'你好','mode':'auto'})
    assert sent.status_code==200,sent.text
    assert wait(owner,sent.json())['status']=='done'
    updated=s.get(owner,task['id'])
    assert updated['title']=='你好' and updated['messages'][0]['text']=='你好'
