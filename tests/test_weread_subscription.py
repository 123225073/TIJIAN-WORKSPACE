import base64,threading,time,io,zipfile,json
import pytest
from backend import weread as r,wechat as w,store as s
from test_workflows import client,account

@pytest.fixture
def free(client,monkeypatch):
    owner=account(client)['user']['id']
    b=client.post('/api/objects/benchmark',json={'title':'免费测试号','platform':'公众号'}).json()
    a=s.put(owner,'wechat_account',{'title':'免费测试号','biz':base64.b64encode(b'3223096120').decode(),'wxid':'','provider':'weread'})
    s.set_config('wechat.binding:'+owner+':'+b['id'],a['id'])
    assert client.put('/api/weread/session',json={'cookie':'wr_skey=private-test-session; wr_vid=test'}).status_code==200
    state=client.put('/api/weread/subscription/'+b['id'],json={'enabled':True,'auto_body':True}).json()
    monkeypatch.setattr(w,'paid',lambda *a,**k:(_ for _ in ()).throw(AssertionError('No paid fallback allowed')))
    return owner,b,a,state

def group(n,stamp=None):
    token='article_'+str(n)
    return {'createTime':stamp or time.time()+10,'subReviews':[{'review':{'reviewId':'MP_WXS_3223096120_'+token,'mpInfo':{'originalId':token,'title':'文章'+str(n)}}}]}
def check(free):return r.check(free[0],free[3]['id'],lambda *x:None,threading.Event())

def test_baseline_new_multi_articles_dedupe_body_and_no_paid(client,free,monkeypatch):
    owner,b,a,state=free;groups=[group(1)];calls=[]
    def request(owner,path,p):
        calls.append((path,p))
        return {'reviews':groups} if path.endswith('/articles') else '<div id="js_content">'+'这是测试公众号正文。'*40+p['reviewId']+'</div>'
    monkeypatch.setattr(r,'request',request)
    assert check(free)['saved']==1 and not s.list_(owner,'wechat_notice')
    groups[:]=[group(3),group(2),group(1)]
    assert check(free)['added']==2
    assert len(s.list_(owner,'wechat_notice'))==2 and len(s.list_(owner,'source'))==3
    check(free);assert len(s.list_(owner,'wechat_notice'))==2
    assert len([c for c in calls if c[0].endswith('/content')])==3
    raw=client.get('/api/backup').content
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert all(b'private-test-session' not in z.read(n) for n in z.namelist())
    assert 'private-test-session' not in client.get('/api/state').text
    assert 'private-test-session' not in s.config('weread.cookie:'+owner)
    w.validate_backup(s.list_(owner,'wechat_account')+s.list_(owner,'wechat_article')+s.list_(owner,'weread_subscription'))

def test_latest_degradation_explicit_and_auth_no_fallback(client,free,monkeypatch):
    calls=[]
    def request(owner,path,p):
        calls.append(path)
        if path.endswith('/articles'):raise r.ListUnavailable('list unavailable')
        if path.endswith('/cover'):return {'reviewId':'MP_WXS_3223096120_newest','title':'最新一篇'}
        return '<div id="js_content">'+'正文'*100+'</div>'
    monkeypatch.setattr(r,'request',request);assert '降级' in check(free)['coverage']
    calls.clear()
    def expired(*args):calls.append(args[1]);raise r.AuthError('expired')
    monkeypatch.setattr(r,'request',expired)
    with pytest.raises(r.AuthError):check(free)
    assert calls==['/web/mp/articles'] and s.get(free[0],free[3]['id'])['next_check']>time.time()+1000

def test_wrong_publisher_stops_catalogue(client,free,monkeypatch):
    g=group(1);g['subReviews'][0]['review']['reviewId']='MP_WXS_11111_wrong'
    monkeypatch.setattr(r,'request',lambda *args:{'reviews':[g]})
    with pytest.raises(ValueError,match='不一致'):check(free)
    assert not s.list_(free[0],'wechat_article')

def test_missing_body_backlog_retried_not_re_notified(client,free,monkeypatch):
    failed=True
    def request(owner,path,p):
        if path.endswith('/articles'):return {'reviews':[group(1)]}
        return '<html>暂时不可用</html>' if failed else '<div id="js_content">'+'正文'*100+'</div>'
    monkeypatch.setattr(r,'request',request);assert check(free)['body_failed']==1
    row=s.list_(free[0],'wechat_article')[0];s.put(free[0],'wechat_article',{**row,'body_retry_at':0},row['id']);failed=False
    assert check(free)['saved']==1 and not s.list_(free[0],'wechat_notice')

def test_page_budget_checkpoint_and_backup_paused(client,free,monkeypatch):
    owner,b,a,state=free;s.put(owner,'weread_subscription',{**state,'baseline_at':s.now()},state['id']);offsets=[]
    def request(owner,path,p):
        if path.endswith('/articles'):offsets.append(p['offset']);return {'reviews':[group(100+p['offset'])]}
        return '<div id="js_content">'+'正文'*100+'</div>'
    monkeypatch.setattr(r,'request',request);check(free)
    assert offsets==[0,1,2] and s.get(owner,state['id'])['cursor']==3
    raw=client.get('/api/backup').content
    result=client.post('/api/backup/import',files={'file':('backup.zip',raw,'application/zip')})
    assert result.status_code==200,result.text
    restored=[x for x in s.list_(owner,'weread_subscription') if x.get('restored_from')]
    assert restored and all(not x['enabled'] for x in restored)

def test_recovery_from_cover_does_not_stop_at_cover_article(client,free,monkeypatch):
    owner,b,a,state=free
    s.put(owner,'weread_subscription',{**state,'baseline_at':s.now(),'auto_body':False,'mode':'latest'},state['id'])
    item=r.entry(group(3)['subReviews'][0]['review'],a)
    s.put(owner,'wechat_article',{**item,'status':'discovered','weread_list_seen':False})
    offsets=[]
    def response(owner,path,p):
        offsets.append(p['offset']);return {'reviews':{0:[group(3)],1:[group(2)],2:[]}[p['offset']]}
    monkeypatch.setattr(r,'request',response);check(free)
    assert offsets==[0,1,2] and len(s.list_(owner,'wechat_article'))==2
