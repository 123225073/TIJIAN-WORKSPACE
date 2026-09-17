import time
import pytest
from backend import wechat as w,wechat_browser as browser,network,store as s
from test_wechat import setup,article
from test_workflows import client,account
from test_interaction_revision import wait

def ticket(client):
    for _ in range(100):
        rows=client.get('/api/wechat/browser/pending').json()['items']
        if rows:return rows[0]
        time.sleep(.02)
    raise AssertionError('No browser ticket')

def test_browser_wait_verify_continue_and_delete(client,setup):
    owner,b,a,calls,pages=setup
    rows=w.ingest(owner,[w.normalize(article(1),a),w.normalize(article(2),a)])
    count=len(calls)
    job=client.post('/api/wechat/collect',json={'benchmark_id':b['id'],'ids':[x['id'] for x in rows],'mode':'browser'}).json()
    first=ticket(client)
    assert client.post('/api/objects/'+job['id']+'/trash',json={}).status_code==409
    assert client.post('/api/wechat/collect',json={'benchmark_id':b['id'],'ids':[rows[0]['id']]}).status_code==400
    assert client.post('/api/wechat/browser/'+first['id'],json={'waiting':True}).status_code==200
    for _ in range(60):
        if '等待你完成微信验证' in s.get(owner,job['id'])['progress']:break
        time.sleep(.02)
    assert '等待你完成微信验证' in s.get(owner,job['id'])['progress']
    with pytest.raises(s.Missing):browser.accept('other-user',first['id'],{'cancelled':True})
    for row in rows:
        pending=ticket(client)
        result={'url':row['url'],'body':'这是真实测试正文内容。'*50+row['title'],'title':row['title'],'publisher_name':'测试号','publisher_biz':a['biz'],'article_key':row['article_key']}
        assert client.post('/api/wechat/browser/'+pending['id'],json=result).status_code==200
        for _ in range(50):
            if not any(x['id']==pending['id'] for x in client.get('/api/wechat/browser/pending').json()['items']):break
            time.sleep(.02)
    result=wait(owner,job)
    assert result['status']=='done' and result['result']['success']==2
    assert len(calls)==count and not browser.pending(owner)['items']
    for _ in range(50):
        if client.post('/api/objects/'+job['id']+'/trash',json={}).status_code==200:break
        time.sleep(.02)
    assert s.get(owner,job['id'])['archived']
    assert client.post('/api/objects/'+rows[0]['id']+'/trash',json={}).status_code==200
    assert len(client.get('/api/wechat/library/'+b['id']).json()['items'])==1
    assert client.post('/api/objects/'+rows[0]['id']+'/restore',json={}).status_code==200
    assert len(client.get('/api/wechat/library/'+b['id']).json()['items'])==2

def test_browser_window_close_cancels_whole_batch(client,setup):
    owner,b,a,calls,pages=setup
    rows=w.ingest(owner,[w.normalize(article(1),a),w.normalize(article(2),a)])
    job=client.post('/api/wechat/collect',json={'benchmark_id':b['id'],'ids':[x['id'] for x in rows],'mode':'browser'}).json()
    pending=ticket(client)
    assert client.post('/api/wechat/browser/'+pending['id'],json={'cancelled':True}).status_code==200
    result=wait(owner,job)
    assert result['status']=='cancelled' and result['result']['processed']==0
    assert not browser.pending(owner)['items']
    assert client.post('/api/jobs/'+job['id']+'/retry',json={}).status_code==400

def test_browser_rejects_wrong_article(client,setup):
    owner,b,a,calls,pages=setup
    row=w.ingest(owner,[w.normalize(article(1),a)])[0]
    job=client.post('/api/wechat/collect',json={'benchmark_id':b['id'],'ids':[row['id']],'mode':'browser'}).json()
    pending=ticket(client)
    client.post('/api/wechat/browser/'+pending['id'],json={'url':row['url'],'body':'正文'*100,'publisher_name':'测试','publisher_biz':'OTHER','article_key':'OTHER|1|1'})
    result=wait(owner,job)
    assert result['status']=='failed' and not s.list_(owner,'source')

def test_paid_batch_one_confirmation_cache_and_no_blind_retry(client,setup,monkeypatch):
    owner,b,a,calls,pages=setup
    rows=w.ingest(owner,[w.normalize(article(1),a),w.normalize(article(2),a)])
    paid=[]
    def response(path,body,token=''):
        paid.append((path,body['url']))
        if path=='/api/v2/articles/long2short':return {'url':'https://mp.weixin.qq.com/s/test-'+str(len(paid))}
        assert path=='/api/v3/articles/detail'
        return {'html':'<div id="js_content">'+'付费正文'*100+body['url']+'</div>'}
    # Resolve fixture already acquired a token; assert no other endpoint is used.
    monkeypatch.setattr(w,'request',response)
    payload={'benchmark_id':b['id'],'ids':[x['id'] for x in rows],'mode':'cimidata','confirmed_conversion':True}
    assert client.post('/api/wechat/collect',json=payload).status_code==400 and not paid
    job=client.post('/api/wechat/collect',json={**payload,'confirmed':True}).json()
    assert wait(owner,job)['result']['success']==2 and len(paid)==4
    job=client.post('/api/wechat/collect',json={**payload,'confirmed':True}).json()
    assert wait(owner,job)['result']['success']==2 and len(paid)==4
    # Deleting the stored source makes it unavailable to preview/reuse.
    source=s.list_(owner,'source')[0]
    client.post('/api/objects/'+source['id']+'/trash',json={})
    assert any(x['status']=='discovered' for x in client.get('/api/wechat/library/'+b['id']).json()['items'])

def test_free_challenge_stops_remaining_network_calls(client,setup,monkeypatch):
    owner,b,a,calls,pages=setup
    rows=w.ingest(owner,[w.normalize(article(1),a),w.normalize(article(2),a)])
    requests=[]
    def blocked(url):requests.append(url);raise network.ArticleBlocked('微信返回验证页')
    monkeypatch.setattr(network,'article',blocked)
    job=client.post('/api/wechat/collect',json={'benchmark_id':b['id'],'ids':[x['id'] for x in rows]}).json()
    result=wait(owner,job)
    assert len(requests)==1 and result['result']['failed']==2
    assert result['result']['items'][1]['reason'].startswith('未请求')
