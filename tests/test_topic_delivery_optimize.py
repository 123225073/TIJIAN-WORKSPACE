"""Review-first, scoped AI optimization of WeChat delivery drafts."""
import json
import time

import pytest

from backend import gateway, jobs, store as s, streaming
from test_topics_registry import client


def _finished(owner, job_id):
    for _ in range(200):
        job = s.get(owner, job_id)
        if job['status'] in {'done', 'failed', 'cancelled'}:
            return job
        time.sleep(.01)
    raise AssertionError('AI job did not finish')


def _bind(monkeypatch, answer):
    s.set_config('bindings', {'writing': 'fixture-model'})
    monkeypatch.setattr(gateway, 'select', lambda *args, **kwargs: 'fixture-model')
    monkeypatch.setattr(gateway, 'generate', answer)


def test_long_body_candidate_keeps_images_and_needs_explicit_apply(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    picture = f'![现场图](/api/studio/assets/{"a" * 32}/file)'
    original_body = '原稿开头\n\n' + picture + '\n\n原稿收尾'
    topic = client.post('/api/studio/topics', json={'title': '维保文章'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'title': '原题', 'body': original_body,
    }).json()
    captured = []

    def answer(_model, messages):
        captured.append(messages)
        masked = json.loads(messages[1]['content'])['当前发布稿']['body']
        assert picture not in masked and '[[INLINE_IMAGE_1]]' in masked
        return '新' * 2031 + '\n\n[[INLINE_IMAGE_1]]\n\n' + '结尾' * 200

    _bind(monkeypatch, answer)
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    submitted = client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'body', 'instruction': '写得详细一些，保留现场图',
    })
    assert submitted.status_code == 200, submitted.text
    job = _finished(owner, submitted.json()['id'])
    assert job['status'] == 'done', job
    result = job['result']
    assert result['scope'] == 'body' and result['base_version'] == delivery['version']
    assert result['original']['body'] == original_body
    assert result['proposal']['body'].count(picture) == 1
    assert result['proposal']['body'].startswith('新' * 2031)
    assert result['proposal']['title'] == '原题'
    assert s.get(owner, delivery['id'])['body'] == original_body
    assert s.get(owner, delivery['id'])['version'] == delivery['version']
    assert '写得详细一些' in captured[0][1]['content']
    assert '目标1200' not in captured[0][0]['content']
    assert '超过目标20%' not in captured[0][0]['content']

    applied = client.post(endpoint + f"/optimize/{job['id']}/apply", json={'version': delivery['version']})
    assert applied.status_code == 200, applied.text
    assert applied.json()['body'] == result['proposal']['body']
    assert applied.json()['title'] == '原题'
    assert applied.json()['version'] == delivery['version'] + 1
    assert client.post(endpoint + f"/optimize/{job['id']}/apply", json={'version': delivery['version']}).status_code == 409


@pytest.mark.parametrize('scope,field', [
    ('title', 'title'), ('summary', 'summary'), ('cover_brief', 'cover_brief'),
])
def test_scoped_candidate_changes_only_requested_field(client, monkeypatch, scope, field):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'title': '旧标题',
        'summary': '旧摘要', 'body': '原正文', 'cover_brief': '旧封面建议',
    }).json()

    def answer(_model, messages):
        assert json.loads(messages[1]['content'])['优化范围'] == scope
        return json.dumps({field: '优化后的' + field}, ensure_ascii=False)

    _bind(monkeypatch, answer)
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    job_id = client.post(endpoint + '/optimize', json={'version': delivery['version'], 'scope': scope}).json()['id']
    job = _finished(owner, job_id)
    assert job['status'] == 'done', job
    assert job['result']['changed_fields'] == [field]
    assert job['result']['proposal']['body'] == '原正文'
    assert s.get(owner, delivery['id'])[field] == delivery[field]
    applied = client.post(endpoint + f'/optimize/{job_id}/apply', json={
        'version': delivery['version'], 'changes': {field: '人工调整后的' + field},
    })
    assert applied.status_code == 200, applied.text
    assert applied.json()[field] == '人工调整后的' + field
    assert applied.json()['body'] == '原正文'


def test_full_optimization_and_version_conflict_do_not_overwrite_edits(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat', 'body': '原正文'}).json()
    fields = {'title': '新标题', 'summary': '新摘要', 'body': '新正文', 'cover_brief': '按正文生成封面建议',
              'keywords': '电梯', 'publishing_notes': '核对事实'}
    _bind(monkeypatch, lambda _model, _messages: json.dumps(fields, ensure_ascii=False))
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    request = {'version': delivery['version'], 'scope': 'all', 'instruction': '整篇变得简洁', 'request_id': 'same-click'}
    first = client.post(endpoint + '/optimize', json=request).json()
    assert client.post(endpoint + '/optimize', json=request).json()['id'] == first['id']
    assert client.post(endpoint + '/optimize', json={**request, 'instruction': '换一个方向'}).status_code == 409
    job = _finished(owner, first['id'])
    assert job['status'] == 'done', job
    assert job['result']['proposal']['title'] == '新标题'
    updated = client.patch(endpoint, json={'version': delivery['version'], 'body': '用户的新正文'}).json()
    response = client.post(endpoint + f"/optimize/{first['id']}/apply", json={'version': updated['version']})
    assert response.status_code == 409
    assert s.get(owner, delivery['id'])['body'] == '用户的新正文'


def test_missing_image_marker_fails_and_keeps_original(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    picture = f'![图](/api/studio/assets/{"b" * 64}/file)'
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '开头\n' + picture + '\n结尾',
    }).json()
    _bind(monkeypatch, lambda _model, _messages: '丢了配图的新正文')
    job_id = client.post(f"/api/studio/deliveries/{delivery['id']}/optimize", json={
        'version': delivery['version'], 'scope': 'body', 'instruction': '调整语气',
    }).json()['id']
    job = _finished(owner, job_id)
    assert job['status'] == 'failed' and '图片位置' in job['error']
    assert s.get(owner, delivery['id'])['body'] == delivery['body']


def test_single_field_plain_text_stream_is_visible(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat'}).json()

    def answer(_model, messages):
        assert '不要 JSON' in messages[0]['content']
        streaming.emit('start')
        streaming.emit('delta', '封面画面：')
        streaming.emit('end', '封面画面：现场工程师核对维保记录')
        return '封面画面：现场工程师核对维保记录'

    _bind(monkeypatch, answer)
    job_id = client.post(f"/api/studio/deliveries/{delivery['id']}/optimize", json={
        'version': delivery['version'], 'scope': 'cover_brief',
    }).json()['id']
    job = _finished(owner, job_id)
    assert job['status'] == 'done', job
    assert job['stream_text'] == '封面画面：现场工程师核对维保记录'
    assert job['result']['proposal']['cover_brief'] == '封面画面：现场工程师核对维保记录'


def test_invalid_optimize_scope_is_rejected(client):
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat'}).json()
    endpoint = f"/api/studio/deliveries/{delivery['id']}/optimize"
    for scope in ([], {}, 'unsupported'):
        assert client.post(endpoint, json={'version': delivery['version'], 'scope': scope}).status_code == 400


def test_multiple_markdown_and_html_images_stay_in_order(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    pictures = [
        f'![图一](/api/studio/assets/{"c" * 32}/file)',
        '![外链](https://example.test/a.png)',
        '<img src="https://example.test/b.png" alt="示意图">',
    ]
    original = '\n\n'.join(['开头', pictures[0], '中间', pictures[1], pictures[2], '结尾'])
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': original,
    }).json()

    def answer(_model, messages):
        masked = json.loads(messages[1]['content'])['当前发布稿']['body']
        assert all(picture not in masked for picture in pictures)
        assert all(f'[[INLINE_IMAGE_{index}]]' in masked for index in range(1, 4))
        return '新版开头\n\n[[INLINE_IMAGE_1]]\n\n中段\n\n[[INLINE_IMAGE_2]]\n\n[[INLINE_IMAGE_3]]\n\n新版结尾'

    _bind(monkeypatch, answer)
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    job = _finished(owner, client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'body', 'instruction': '调整语气',
    }).json()['id'])
    assert job['status'] == 'done', job
    proposed = job['result']['proposal']['body']
    assert [proposed.index(picture) for picture in pictures] == sorted(proposed.index(picture) for picture in pictures)
    assert s.get(owner, delivery['id'])['body'] == original
    assert client.post(endpoint + f"/optimize/{job['id']}/apply", json={
        'version': delivery['version'], 'changes': {'body': proposed.replace(pictures[1], '')},
    }).status_code == 400
    assert s.get(owner, delivery['id'])['body'] == original


def test_long_optimization_body_is_not_cut_to_old_storage_limit(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '长文选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '原文' * 15000,
    }).json()
    full = '新版全文' * 10000
    _bind(monkeypatch, lambda _model, _messages: full)
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    job = _finished(owner, client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'body', 'instruction': '在原稿基础上详细解释',
    }).json()['id'])
    assert job['status'] == 'done', job
    assert job['result']['proposal']['body'] == full
    assert s.get(owner, delivery['id'])['body'] == delivery['body']
    applied = client.post(endpoint + f"/optimize/{job['id']}/apply", json={'version': delivery['version']})
    assert applied.status_code == 200, applied.text
    assert applied.json()['body'] == full


def test_wechat_limits_reject_oversized_ai_title_and_manual_apply(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'title': '原题',
    }).json()
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    _bind(monkeypatch, lambda *_: '过' * 33)
    failed = _finished(owner, client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'title',
    }).json()['id'])
    assert failed['status'] == 'failed' and '32' in failed['error']
    assert s.get(owner, delivery['id'])['title'] == '原题'

    _bind(monkeypatch, lambda *_: '短标题')
    job = _finished(owner, client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'title',
    }).json()['id'])
    assert job['status'] == 'done'
    edited = client.post(endpoint + f"/optimizations/{job['id']}/apply", json={
        'version': delivery['version'], 'changes': {'title': '长' * 33},
    })
    assert edited.status_code == 400 and '32' in edited.text
    assert s.get(owner, delivery['id'])['title'] == '原题'


@pytest.mark.parametrize('article',[ '{"提示": "这个例子是正文的一部分"}\n后续解释', '{"body": "示例字段"}\n后续解释', '{"body": "完整的 JSON 示例"}' ])
def test_single_field_json_like_article_and_request_lookup(client, monkeypatch, article):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '数据文章'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '旧正文',
    }).json()
    _bind(monkeypatch, lambda *_: article)
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    request = {'version': delivery['version'], 'scope': 'body', 'request_id': 'retry-same-request'}
    first = client.post(endpoint + '/optimize', json=request).json()
    lookup = client.get(endpoint + '/optimizations/by-request/retry-same-request')
    assert lookup.status_code == 200 and lookup.json()['id'] == first['id']
    assert client.post(endpoint + '/optimize', json=request).json()['id'] == first['id']
    job = _finished(owner, first['id'])
    assert job['status'] == 'done'
    assert job['result']['proposal']['body'] == article
    assert jobs.cancel(owner, job['id'])['status'] == 'done'


def test_whole_article_with_trailing_text_is_rejected_instead_of_truncated(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选题'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '原稿正文',
    }).json()
    fields = {'title': '新标题', 'summary': '新摘要', 'body': '新正文',
              'cover_brief': '画面', 'keywords': '关键词', 'publishing_notes': '核对'}
    _bind(monkeypatch, lambda *_: json.dumps(fields, ensure_ascii=False) + '\n还有不能丢失的说明')
    endpoint = f"/api/studio/deliveries/{delivery['id']}"
    job = _finished(owner, client.post(endpoint + '/optimize', json={
        'version': delivery['version'], 'scope': 'all',
    }).json()['id'])
    assert job['status'] == 'failed' and '结构化文章' in job['error']
    assert s.get(owner, delivery['id'])['body'] == '原稿正文'


def test_interrupted_optimization_is_discoverable_for_explicit_retry(client):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '中断恢复'}).json()
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '原稿',
    }).json()
    prior = s.put(owner, 'job', {'status': 'running', 'title': 'AI 优化',
        'input': {'action': 'studio_delivery_optimize', 'delivery_id': delivery['id'],
                  'scope': 'body', 'request_id': 'before-restart'}})
    jobs.recover()
    found = client.get(f"/api/studio/deliveries/{delivery['id']}/optimizations/by-request/before-restart")
    assert found.status_code == 200 and found.json()['id'] == prior['id']
    assert found.json()['status'] == 'interrupted'
    assert s.get(owner, delivery['id'])['body'] == '原稿'
