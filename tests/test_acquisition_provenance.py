"""Origin and timestamp regression tests, entirely isolated from external providers."""
import threading
from backend import store as s,weread as r,wechat as w,network
from test_workflows import client,account
from test_weread_subscription import free,group
from test_wechat import setup,article,start,next_
from test_interaction_revision import wait

def test_manual_import_dedupe_keeps_time_and_account(client):
    account(client)
    b=client.post('/api/objects/benchmark',json={'title':'A'}).json()
    c=client.post('/api/objects/benchmark',json={'title':'B'}).json()
    data={'title':'same','body':'实际正文','benchmark_id':b['id']}
    first=client.post('/api/import/text',json=data).json()
    again=client.post('/api/import/text',json=data).json()
    assert first['acquisition_origin']=='manual_import' and first['body_saved_at']
    assert first['id']==again['id'] and first['body_saved_at']==again['body_saved_at']
    other=client.post('/api/import/text',json={**data,'benchmark_id':c['id']}).json()
    assert other['id']!=first['id'] and other['benchmark_id']==c['id']

def test_manual_and_automatic_subscription_are_distinct(client,free,monkeypatch):
    owner,b,a,sub=free;groups=[group(1)]
    monkeypatch.setattr(r,'request',lambda owner,path,p:{'reviews':groups} if path.endswith('/articles') else '<div id="js_content">'+'正文'*100+p['reviewId']+'</div>')
    manual=wait(owner,r.start(owner,sub,trigger='manual_subscription_check'))
    assert manual['input']['trigger']=='manual_subscription_check'
    assert manual['started_at']<=manual['finished_at']
    first=s.list_(owner,'source')[0];item=s.list_(owner,'wechat_article')[0]
    assert first['acquisition_origin']=='manual_subscription_check'
    assert item['discovery_origin']=='manual_subscription_check'
    assert first['discovered_at']==item['discovered_at'] and first['body_saved_at']==item['body_saved_at']
    groups[:]=[group(2),group(1)]
    auto=wait(owner,r.start(owner,s.get(owner,sub['id'])))
    assert auto['input']['trigger']=='automatic_subscription'
    new=next(x for x in s.list_(owner,'source') if x['id']!=first['id'])
    assert new['acquisition_origin']=='automatic_subscription'
    assert s.get(owner,first['id'])['body_saved_at']==first['body_saved_at']
    assert s.get(owner,item['id'])['discovery_origin']=='manual_subscription_check'

def test_catalog_body_reuse_preserves_original_acquisition(client,setup,monkeypatch):
    owner,b,a,calls,pages=setup
    pages.append({'items':[article(1)],'last_id':None});next_(client,start(client,b))
    row=s.list_(owner,'wechat_article')[0]
    assert row['discovery_origin']=='manual_catalog' and row['discovered_at']
    monkeypatch.setattr(network,'article',lambda url:{'url':url,'title':'fixture','body':'正文'*100,'publisher_biz':'TARGET_BIZ'})
    job=wait(owner,w.collect(owner,[row['id']],b['id']))
    source=s.get(owner,job['result']['items'][0]['source_id'])
    assert source['acquisition_origin']=='manual_catalog' and source['acquisition_provider']=='public'
    assert source['discovered_at']==row['discovered_at']
    monkeypatch.setattr(network,'article',lambda _:(_ for _ in ()).throw(AssertionError('must reuse body')))
    wait(owner,w.collect(owner,[row['id']],b['id']))
    assert s.get(owner,source['id'])['body_saved_at']==source['body_saved_at']
    assert s.get(owner,row['id'])['last_attempt_at']
