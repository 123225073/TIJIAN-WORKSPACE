"""Independent counterexamples. Disposable SQLite only; no paid model calls.

Run: python -m pytest tests/test_demo_adversarial.py -q -p no:cacheprovider
Optional free public hotlists: set DEMO_REAL_HOTLIST=1 for the last test.
Failures deliberately describe violated acceptance requirements.
"""
import concurrent.futures
import json
import os

import pytest

from test_workflows import client, account
from test_ip_outcome_chain import setup, send, apply, review
from test_streaming import configure
from test_interaction_revision import wait
from backend import store as s, gateway as g, hotlists, jobs


@pytest.mark.parametrize('user_text', [
    '再帮我做一个 IP，名字叫风沙讲电梯，沿用原来的定位',
    '另建一个 IP，叫风沙讲电梯，参考小沙说电梯',
    '给我做一个新的个人 IP，叫风沙讲电梯，保留原来的小沙说电梯',
])
def test_additional_ip_never_overwrites_selected_reference(client, monkeypatch, user_text):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, user_text)
    candidate = task['profile_binding']
    review(client,owner,task)
    response = apply(client, task)
    assert response.status_code == 200, response.text
    assert s.get(owner, old['id']) == old, (
        user_text, candidate.get('operation'), candidate.get('target_id'),
        '确认新增身份却覆盖了被选择作参考的旧 IP')
    assert response.json()['id'] != old['id']


def test_same_confirmation_is_atomic_and_idempotent(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '新建一个 IP，叫风沙讲电梯')
    review(client,owner,task)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: apply(client, task), range(2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()['id'] == responses[1].json()['id']
    assert len(s.list_(owner, 'profile')) == 2
    assert s.get(owner, old['id']) == old


def test_confirmation_after_target_edit_preserves_external_work(client, monkeypatch):
    owner, old, task, _ = setup(client, monkeypatch)
    task = send(client, owner, task, '更新当前 IP 的表达偏好')
    review(client,owner,task)
    changed = s.put(owner, 'profile', {**old, 'style':'窗口二尚待保留的人工修改'}, old['id'])
    assert apply(client, task).status_code == 409
    assert s.get(owner, old['id']) == changed


@pytest.mark.parametrize('content', [
    '<think>HIDDEN_REVIEW_REASONING</think>公开回复',
    '{"reasoning":{"body":"HIDDEN_REVIEW_REASONING"},"reply":"公开回复"}',
])
def test_hidden_reasoning_never_enters_public_job_stream(client, monkeypatch, content):
    owner = account(client)['user']['id']
    wire = 'data: ' + json.dumps({'choices':[{'delta':{'content':content},'finish_reason':'stop'}]}) + '\n\n'
    configure(monkeypatch, 'chat', wire.encode())
    def work(_progress, _event):
        g.generate('fixture', [])
        return {'ok':True}
    job = wait(owner, jobs.start(owner, '公开流式反例', work, {'action':'review-only'}))
    assert job['status'] == 'done', job
    assert 'HIDDEN_REVIEW_REASONING' not in job.get('stream_text',''), job.get('stream_text')


def test_identical_public_url_across_boards_is_one_search_result(client):
    owner = account(client)['user']['id']
    for platform in ('weibo','zhihu'):
        s.put(owner, 'hotlist', {'title':platform, 'platform':platform, 'items':[
            {'title':'电梯更新资料准备', 'url':'https://example.com/lift-update', 'body':'现场资料'}]})
    rows = client.get('/api/search', params={'q':'电梯更新'}).json()
    assert len(rows) == 1, [(r['title'],r.get('url'),r['id']) for r in rows]


def test_search_never_selects_unmatched_sibling_as_representative(client):
    owner = account(client)['user']['id']
    draft = s.put(owner,'studio_draft',{'title':'婚礼与电梯对比图','tool':'text_image','input':{'prompt':'婚礼现场'}})
    run = s.put(owner,'studio_run',{'title':'两张独立图片','draft_id':draft['id'],'status':'succeeded'})
    unrelated = s.put(owner,'studio_asset',{'title':'电梯检修示意图','asset_type':'image','run_id':run['id']},'0'*32)
    relevant = s.put(owner,'studio_asset',{'title':'婚礼布置示意图','asset_type':'image','run_id':run['id']},'f'*32)
    rows = client.get('/api/search',params={'q':'婚礼'}).json()
    assert rows and rows[0]['id'] == relevant['id'], {
        'rows':rows, 'unmatched_asset':unrelated['id'], 'matched_asset':relevant['id']}


def test_wechat_publishing_draft_can_prepare_its_own_context_image_prompt(client, monkeypatch):
    owner = account(client)['user']['id']
    topic = s.put(owner,'studio_topic',{'title':'公众号发布准备','source_ids':[]})
    delivery = s.put(owner,'studio_delivery',{'topic_id':topic['id'],'platform':'wechat',
                      'title':'公众号发布稿','body':'第一段文章内容。\n\n第二段内容。','status':'draft'})
    monkeypatch.setattr(g,'select',lambda *a,**kw:'local-prompt-review')
    monkeypatch.setattr(g,'generate',lambda *a,**kw:'物业经理核对资料，简洁行业插画，无文字。')
    response = client.post('/api/studio/text/article-illustration-prompt',json={
        'content_id':delivery['id'],'body':delivery['body'],'start':0,'end':8,'idea':'核对资料','style':'简洁插画'})
    assert response.status_code == 200, 'WechatArticleForm 传 studio_delivery.id，但接口拒绝：'+response.text
    assert wait(owner,response.json())['status'] == 'done'


@pytest.mark.skipif(os.environ.get('DEMO_REAL_HOTLIST') != '1', reason='显式启用免费公开网络检查')
def test_real_public_hotlists_report_partial_outcomes_without_faking_cache(client):
    account(client)
    assert 'test.sqlite' in str(s.DB), '真实数据目录不能参与此测试'
    def fetch(platform):
        result = hotlists.snapshot(platform)
        return {'platform':platform, 'count':len(result.get('items',[])),
                'freshness':result.get('freshness'), 'error':result.get('error'),
                'fetched_at':result.get('fetched_at'), 'attempts':result.get('attempts')}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch, hotlists.PLATFORMS))
    print('PUBLIC_NETWORK_RESULTS='+json.dumps(results,ensure_ascii=False))
    for row in results:
        if row['error']:
            assert row['freshness'] == 'stale'
            assert row['count'] == 0, '空隔离缓存不得伪装旧榜单'
        else:
            assert row['count'] > 0 and row['freshness'] == 'retrieved'
            assert any(a['status']=='ok' for a in row['attempts'])
    assert any(not r['error'] for r in results), '真实网络当前无平台成功，不能验收部分成功'
