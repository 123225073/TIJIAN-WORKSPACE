import json
from test_workflows import client, account
from test_writing_improvements import bind_writing, finished
from backend import store as s

def setup(owner):
    content=s.put(owner,'content',{'title':'核对报价','body':'原始正文'})
    images=[]
    for theme in ['工程师核对井道','业主查看合同','项目交付场景']:
        run=s.put(owner,'studio_run',{'snapshot':{'input':{'prompt':theme}}})
        images.append(s.put(owner,'studio_asset',{'asset_type':'image','status':'ready','run_id':run['id']}))
    data={'content_id':content['id'],'body':'📌报价范围。\n\n核对现场条件。\n\n列清责任。',
        'anchors':[{'id':'p0','text':'📌报价范围。'},{'id':'p1','text':'核对现场条件。'},{'id':'p2','text':'列清责任。'}],
        'asset_ids':[i['id'] for i in images]}
    return content,data

def test_placement_matches_theme_without_writing_article_or_generating_images(client,monkeypatch):
    owner=account(client)['user']['id'];content,data=setup(owner);calls=[]
    places=[{'asset_id':ident,'after':'p'+str(i)} for i,ident in enumerate(data['asset_ids'])]
    bind_writing(monkeypatch,lambda _,messages:calls.append(messages) or json.dumps({'placements':places}))
    r=client.post('/api/content/'+content['id']+'/illustrations/placement',json=data)
    assert r.status_code==200,r.text
    job=finished(client,r.json());assert job['status']=='done',job
    assert job['result']['placements']==places
    payload=json.loads(calls[0][1]['content'])
    assert payload['配图'][0]['画面主题']=='工程师核对井道'
    assert s.get(owner,content['id'])==content
    assert len(s.list_(owner,'studio_run'))==3

def test_invalid_plan_is_not_a_fake_success(client,monkeypatch):
    owner=account(client)['user']['id'];content,data=setup(owner)
    bind_writing(monkeypatch,lambda *_:json.dumps({'placements':[{'asset_id':data['asset_ids'][0],'after':'p999'}]}))
    r=client.post('/api/content/'+content['id']+'/illustrations/placement',json=data)
    assert r.status_code==200
    assert finished(client,r.json())['status']=='failed'
    assert s.get(owner,content['id'])==content

def test_invalid_input_cannot_call_model_or_access_other_owners_images(client,monkeypatch):
    owner=account(client)['user']['id'];content,data=setup(owner)
    bind_writing(monkeypatch,lambda *_:(_ for _ in ()).throw(AssertionError('must not call')))
    other=s.put('another-owner','studio_asset',{'asset_type':'image','status':'ready'})
    for change in [{'asset_ids':[other['id']]},{'asset_ids':[{}]},{'asset_ids':data['asset_ids']*2},{'anchors':[{'id':'p0','text':'not in body'}]},{'body':''},{'extra':True}]:
        assert client.post('/api/content/'+content['id']+'/illustrations/placement',json=data|change).status_code in (400,404)


def test_anchor_order_overlap_and_reuse_are_rejected_before_model_calls(client,monkeypatch):
    owner=account(client)['user']['id'];content,data=setup(owner)
    bind_writing(monkeypatch,lambda *_:(_ for _ in ()).throw(AssertionError('must not call')))
    invalid=[
        # A single source occurrence cannot be copied into many model anchors.
        [{'id':'p0','text':'核对现场条件。'},{'id':'p1','text':'核对现场条件。'}],
        [{'id':'p0','text':'列清责任。'},{'id':'p1','text':'📌报价范围。'}],
        [{'id':'p0','text':'核对现场条件。'},{'id':'p1','text':'现场条件。'}],
    ]
    for anchors in invalid:
        response=client.post('/api/content/'+content['id']+'/illustrations/placement',json=data|{'anchors':anchors})
        assert response.status_code==400,response.text
    assert s.get(owner,content['id'])==content
    assert not s.list_(owner,'job')


def test_repeated_real_paragraphs_and_truncated_long_excerpt_remain_valid(client,monkeypatch):
    owner=account(client)['user']['id'];content,data=setup(owner)
    long='核对范围。'*400
    body='同一提醒。\n\n'+long+'\n\n同一提醒。'
    anchors=[{'id':'p0','text':'同一提醒。'},{'id':'p1','text':long[:1600]},{'id':'p2','text':'同一提醒。'}]
    places=[{'asset_id':ident,'after':'p'+str(i)} for i,ident in enumerate(data['asset_ids'])]
    bind_writing(monkeypatch,lambda *_:json.dumps({'placements':places}))
    response=client.post('/api/content/'+content['id']+'/illustrations/placement',json=data|{'body':body,'anchors':anchors})
    assert response.status_code==200,response.text
    assert finished(client,response.json())['status']=='done'
