import json,threading,time
import httpx,pytest
from backend import gateway as g,streaming,jobs,store as s
from test_workflows import client,account
from test_interaction_revision import wait

def configure(monkeypatch,protocol,payload,kind='text/event-stream'):
    monkeypatch.setattr(g,'model_record',lambda _:({'model':'fixture','verified':True,'published':True},{'protocol':protocol,'base_url':'https://example.test'}))
    monkeypatch.setattr(g,'public_target',lambda url:(url,{},{}))
    monkeypatch.setattr(g,'headers',lambda _: {})
    real=httpx.Client;requests=[]
    def handle(request):
        requests.append(json.loads(request.content));return httpx.Response(200,headers={'Content-Type':kind},content=payload)
    monkeypatch.setattr(g.httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(handle)))
    return requests

@pytest.mark.parametrize('protocol',['chat','responses'])
def test_streamed_text_before_completion_and_no_reasoning(monkeypatch,protocol):
    if protocol=='chat':events=[{'choices':[{'delta':{'reasoning_content':'private-reasoning'}}]},{'choices':[{'delta':{'content':'第一段'}}]},{'choices':[{'delta':{'content':'第二段'},'finish_reason':'stop'}]}]
    else:events=[{'type':'response.reasoning_summary_text.delta','delta':'private-reasoning'},{'type':'response.output_text.delta','delta':'第一段'},{'type':'response.output_text.delta','delta':'第二段'},{'type':'response.completed'}]
    wire=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events)
    requests=configure(monkeypatch,protocol,wire.encode());seen=[]
    with streaming.capture(lambda phase,text:seen.append((phase,text)),threading.Event()):assert g.generate('fixture',[])=='第一段第二段'
    assert requests[0]['stream'] is True
    assert ('delta','第一段') in seen and ('end','第一段第二段') in seen
    assert not any('private-reasoning' in t for _,t in seen)

@pytest.mark.parametrize('ending',['','data: {"error":{"message":"secret"}}\n\n','data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'])
def test_broken_stream_is_not_success(monkeypatch,ending):
    configure(monkeypatch,'chat',('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'+ending).encode())
    with pytest.raises(ValueError):g.generate('fixture',[])

def test_cancel_stops_stream(monkeypatch):
    configure(monkeypatch,'chat',b'data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: [DONE]\n\n')
    event=threading.Event();event.set()
    with streaming.capture(lambda *a:None,event),pytest.raises(InterruptedError):g.generate('fixture',[])

def test_non_streaming_provider_is_explicit_and_not_retried(monkeypatch):
    requests=configure(monkeypatch,'chat',b'{"choices":[{"message":{"content":"full"}}]}','application/json');seen=[]
    with streaming.capture(lambda phase,text:seen.append((phase,text)),threading.Event()):assert g.generate('fixture',[])=='full'
    assert len(requests)==1 and ('buffered','full') in seen

def test_json_stream_only_exposes_user_fields():
    assert streaming.readable('{"reply":"你好\\n世')=='你好\n世'
    assert streaming.readable('{"action":"profile","fields":{"title":"名字","body":"正文')=='名字\n\n正文'
    assert streaming.readable('{"tool_arguments":"secret')==''

def test_runtime_progress_no_token_history_and_access_control(client):
    owner=account(client)['user']['id'];ready=threading.Event();release=threading.Event()
    def work(progress,event):
        streaming.emit('start');streaming.emit('end','可见片段');ready.set();release.wait(5);return {'ok':True}
    job=jobs.start(owner,'流式测试',work,{'action':'artifact'});assert ready.wait(3)
    response=client.get('/api/jobs/'+job['id']);assert response.json()['status']=='running' and response.json()['stream_text']=='可见片段'
    history=s.versions(owner,job['id']);assert len(history)<4
    account(client,'second-stream@example.test');assert client.get('/api/jobs/'+job['id']).status_code==404
    release.set();assert wait(owner,job)['status']=='done'

def test_finalize_without_check_then_edit_returns_draft(client):
    owner=account(client)['user']['id'];obj=s.put(owner,'content',{'title':'稿件','body':'可用正文','status':'draft'})
    r=client.patch('/api/objects/'+obj['id'],json={'version':obj['version'],'status':'final'});assert r.status_code==200 and r.json()['status']=='final'
    result=client.patch('/api/objects/'+obj['id'],json={'version':r.json()['version'],'body':'修订正文'}).json();assert result['status']=='draft'
    empty=s.put(owner,'content',{'title':'空稿','body':''});assert client.patch('/api/objects/'+empty['id'],json={'status':'final'}).status_code==400
