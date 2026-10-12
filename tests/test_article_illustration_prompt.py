import json
from test_workflows import client, account
from test_writing_improvements import bind_writing, finished
from backend import store as s

def test_insertion_paragraph_and_user_idea_are_prompt_data_only(client,monkeypatch):
    owner=account(client)['user']['id']
    row=s.put(owner,'content',{'title':'文章','body':'已保存正文'})
    calls=[]
    bind_writing(monkeypatch,lambda _,messages:calls.append(messages) or '物业人员核对维保记录，简洁行业插画，墨绿与米白。')
    r=client.post('/api/studio/text/article-illustration-prompt',json={'content_id':row['id'],'body':'📌前段。\n\n插入段落。\n\n末段。','start':7,'end':12,'idea':'突出核对记录，不要文字','style':'墨绿米白行业插画'})
    assert r.status_code==200,r.text
    job=finished(client,r.json());assert job['status']=='done',job
    payload=json.loads(calls[0][1]['content'])
    assert payload['插入段落']=='插入段落。' and payload['用户想法']=='突出核对记录，不要文字'
    assert payload['现有风格']=='墨绿米白行业插画'
    assert s.get(owner,row['id'])['version']==row['version']
    assert not s.list_(owner,'illustration') and not s.list_(owner,'studio_run')

def test_invalid_context_never_calls_provider(client,monkeypatch):
    owner=account(client)['user']['id'];row=s.put(owner,'content',{'title':'文章','body':'正文'})
    bind_writing(monkeypatch,lambda *_:(_ for _ in ()).throw(AssertionError('must not call')))
    for change in [{'start':True},{'end':99},{'idea':'x'*1201},{'content_id':'0'*32},{'extra':'unauthorized'}]:
        data={'content_id':row['id'],'body':'正文','start':0,'end':2,'idea':'现场','style':''}|change
        assert client.post('/api/studio/text/article-illustration-prompt',json=data).status_code in (400,404)
