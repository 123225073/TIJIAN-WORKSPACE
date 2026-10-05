"""Focused checks for writing length and article illustration suggestions."""
import json
import threading
import time

import pytest

from test_workflows import client, account
from backend import gateway as g, store as s


def finished(client, job):
    for _ in range(120):
        current = client.get('/api/jobs/' + job['id']).json()
        if current['status'] in {'done', 'failed', 'cancelled'}:
            return current
        time.sleep(.02)
    raise AssertionError('AI job did not finish')


def bind_writing(monkeypatch, answer):
    s.set_config('bindings', {'writing': 'test-model'})
    monkeypatch.setattr(g, 'select', lambda *args, **kwargs: 'test-model')
    monkeypatch.setattr(g, 'generate', answer)


def test_target_words_are_saved_validated_and_sent_to_writing_model(client, monkeypatch):
    owner = account(client)['user']['id']
    calls = []
    bind_writing(monkeypatch, lambda _model, messages: calls.append(messages) or '可编辑正文')
    draft = client.post('/api/studio/text/drafts', json={
        'title': '公众号稿', 'input': {'brief': '解释维保记录', 'format': '公众号文章', 'target_words': 1200}
    })
    assert draft.status_code == 200, draft.text
    assert draft.json()['input']['target_words'] == 1200
    assert client.get('/api/studio/text/drafts').json()['items'][0]['input']['target_words'] == 1200
    job = client.post('/api/studio/text/generate', json={
        'draft_id': draft.json()['id'], 'brief': '解释维保记录', 'format': '公众号文章',
        'target_words': 1200, 'request_id': 'length-1200'
    })
    assert job.status_code == 200, job.text
    done = finished(client, job.json())
    assert done['status'] == 'done', done
    assert json.loads(calls[0][1]['content'])['目标字数'] == 1200
    assert s.get(owner, done['result']['content_id'])['target_words'] == 1200
    for bad in [99, 10001, 120.5, True, '1200']:
        assert client.post('/api/studio/text/generate', json={'brief': '写文章', 'target_words': bad}).status_code == 400
        assert client.post('/api/studio/text/drafts', json={'input': {'target_words': bad}}).status_code == 400


def test_wechat_length_default_and_explicit_value_survive_draft_and_generation(client, monkeypatch):
    owner = account(client)['user']['id']
    calls = []
    bind_writing(monkeypatch, lambda _model, messages: calls.append(messages) or '短篇测试正文')
    draft = client.post('/api/studio/text/drafts', json={
        'input': {'brief': '写公众号稿', 'format': '公众号文章'}
    }).json()
    assert draft['input']['target_words'] == 1200
    revised = client.patch('/api/studio/text/drafts/' + draft['id'], json={
        'version': draft['version'], 'input': {**draft['input'], 'target_words': 900}
    }).json()
    assert revised['input']['target_words'] == 900
    job = client.post('/api/studio/text/generate', json={
        'draft_id': draft['id'], 'brief': '写公众号稿', 'format': '公众号文章', 'request_id': 'saved-length'
    }).json()
    done = finished(client, job)
    assert done['status'] == 'done'
    assert json.loads(calls[0][1]['content'])['目标字数'] == 900
    assert s.get(owner, done['result']['content_id'])['target_words'] == 900
    direct = finished(client, client.post('/api/studio/text/generate', json={
        'brief': '另一篇公众号稿', 'format': '公众号文章', 'request_id': 'default-length'
    }).json())
    assert direct['status'] == 'done'
    assert json.loads(calls[1][1]['content'])['目标字数'] == 1200
    assert s.get(owner, direct['result']['content_id'])['target_words'] == 1200


def test_selected_text_suggestion_uses_local_context_without_editing_article(client, monkeypatch):
    owner = account(client)['user']['id']
    content = s.put(owner, 'content', {'title': '维保文章', 'body': '原稿正文', 'status': 'draft'})
    calls = []
    bind_writing(monkeypatch, lambda _model, messages: calls.append(messages) or '电梯机房内，维保人员核对记录，纪实摄影，横向构图。')
    edited = '📌上文说明适用范围。\n\n物业经理核对维保记录。\n\n下文解释如何留存凭证。'
    selected = '物业经理核对维保记录。'
    start = len(edited[:edited.index(selected)].encode('utf-16-le')) // 2
    response = client.post('/api/studio/text/illustration-suggestion', json={
        'content_id': content['id'], 'body': edited, 'start': start, 'end': start + len(selected)
    })
    assert response.status_code == 200, response.text
    done = finished(client, response.json())
    assert done['status'] == 'done', done
    assert done['result']['suggested_prompt'].startswith('电梯机房内')
    payload = json.loads(calls[0][1]['content'])
    assert payload['文章全文'] == edited
    assert payload['选中文字'] == selected
    assert payload['选区索引'] == {'start': edited.index(selected), 'end': edited.index(selected) + len(selected)}
    assert '适用范围' in payload['邻近上下文']['上文'] and '留存凭证' in payload['邻近上下文']['下文']
    assert '不要把整篇文章' in calls[0][0]['content']
    assert s.get(owner, content['id'])['body'] == '原稿正文'
    assert s.get(owner, content['id'])['version'] == content['version']
    assert not s.list_(owner, 'illustration')


def test_suggestion_rejects_invalid_selection_and_bad_model_output(client, monkeypatch):
    owner = account(client)['user']['id']
    content = s.put(owner, 'content', {'title': '草稿', 'body': '正文'})
    bind_writing(monkeypatch, lambda *_: '以下是建议：画面')
    url = '/api/studio/text/illustration-suggestion'
    base = {'content_id': content['id'], 'body': 'abc', 'start': 0, 'end': 1}
    for bad in [{**base, 'end': 0}, {**base, 'end': 4}, {**base, 'start': True}, {**base, 'body': '   ', 'end': 3}, {**base, 'body': 'a' * 30001}]:
        assert client.post(url, json=bad).status_code == 400
    assert finished(client, client.post(url, json=base).json())['status'] == 'failed'
    account(client, 'another@example.test')
    assert client.post(url, json=base).status_code == 404


def test_wechat_fill_reports_real_job_phase_and_keeps_draft(client, monkeypatch):
    account(client)
    topic = client.post('/api/studio/topics', json={'title': '物业维保沟通'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '人工写的开头'
    }).json()
    entered, release = threading.Event(), threading.Event()

    calls = []

    def answer(_model, messages):
        calls.append(messages)
        entered.set()
        assert release.wait(5)
        return json.dumps({
            'title': '测试标题', 'summary': '测试摘要', 'body': '完整正文',
            'cover_brief': '封面场景', 'keywords': '维保', 'publishing_notes': '核对资料'
        }, ensure_ascii=False)

    bind_writing(monkeypatch, answer)
    job = client.post('/api/studio/deliveries/' + delivery['id'] + '/generate', json={'version': delivery['version']}).json()
    try:
        assert entered.wait(5)
        running = client.get('/api/jobs/' + job['id']).json()
        assert running['status'] == 'running'
        assert '正在生成公众号交付稿' in running['progress']
        assert not running.get('stream_text')
        assert client.get('/api/studio/deliveries').json()['items'][0]['body'] == '人工写的开头'
    finally:
        release.set()
    assert finished(client, job)['status'] == 'done'
    assert '约1200字' in calls[0][0]['content']
    assert client.get('/api/studio/deliveries').json()['items'][0]['body'] == '完整正文'
