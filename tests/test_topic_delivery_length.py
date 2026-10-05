"""Isolated checks for WeChat delivery length and inline image retention."""
import json
import time

import pytest

from backend import gateway, store as s, topics
from test_topics_registry import client


def _finished(owner, job_id):
    for _ in range(200):
        job = s.get(owner, job_id)
        if job['status'] in {'done', 'failed', 'cancelled'}:
            return job
        time.sleep(.01)
    raise AssertionError('AI job did not finish')


def test_wechat_target_words_default_edit_and_strict_validation(client):
    owner = client.get('/api/state').json()['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '维保文章'}).json()
    url = '/api/studio/deliveries'
    default = client.post(url, json={'topic_id': topic['id'], 'platform': 'wechat'}).json()
    assert default['target_words'] == 1200
    chosen = client.post(url, json={'topic_id': topic['id'], 'platform': 'wechat', 'target_words': 900}).json()
    assert chosen['target_words'] == 900
    for bad in (99, 10001, True, 120.5, '900', None):
        assert client.post(url, json={'topic_id': topic['id'], 'platform': 'wechat', 'target_words': bad}).status_code == 400
        assert client.patch(f"{url}/{chosen['id']}", json={'version': chosen['version'], 'target_words': bad}).status_code == 400
        assert client.post(f"{url}/{chosen['id']}/generate", json={'version': chosen['version'], 'target_words': bad}).status_code == 400
    edited = client.patch(f"{url}/{chosen['id']}", json={'version': chosen['version'], 'target_words': 10000}).json()
    assert edited['target_words'] == 10000
    assert next(item for item in client.get(url).json()['items'] if item['id'] == chosen['id'])['target_words'] == 10000
    assert client.post(url, json={'topic_id': topic['id'], 'platform': 'channels', 'target_words': 900}).status_code == 400
    assert s.get(owner, chosen['id'])['version'] == edited['version']
    assert not s.list_(owner, 'job')


@pytest.mark.parametrize('picture', [
    f'![旧图](/api/studio/assets/{"a" * 32}/file)',
    f'![旧图](/api/studio/assets/{"b" * 64}/file)',
    f'![旧图](/api/illustrations/{"c" * 32}/file)',
])
def test_keeps_supported_inline_image_markers_once(picture):
    original = '开头\n\n' + picture + '\n\n旧正文'
    kept = topics._keep_inline_images(original, '新开头\n\n新正文')
    assert kept.count(picture) == 1
    assert topics._keep_inline_images(original, '新正文\n\n' + picture).count(picture) == 1
    assert topics._article_words('甲乙' + picture + 'three words') == 4


def test_does_not_retain_unsupported_image_paths():
    for picture in (
        f'![旧图](/api/illustrations/{"d" * 64}/file)',
        f'![旧图](/api/illustrations/{"e" * 32}/thumbnail)',
        f'![旧图](/api/studio/assets/{"f" * 32}/preview)',
    ):
        assert topics._keep_inline_images(picture, '新正文') == '新正文'


def test_ai_overlength_fails_without_overwriting_and_edited_target_is_used(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    s.set_config('bindings', {'writing': 'fixture-model'})
    monkeypatch.setattr(gateway, 'select', lambda *args, **kwargs: 'fixture-model')
    body = {'value': '新' * 121}
    prompts = []

    def answer(_model, messages):
        prompts.append(messages)
        return json.dumps({'title': '新标题', 'summary': '摘要', 'body': body['value'],
                           'cover_brief': '封面', 'keywords': '维保', 'publishing_notes': '核对'}, ensure_ascii=False)

    monkeypatch.setattr(gateway, 'generate', answer)
    topic = client.post('/api/studio/topics', json={'title': '维保文章'}).json()
    picture = f'![现场图](/api/studio/assets/{"a" * 64}/file)'
    delivery = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'body': '旧稿\n\n' + picture
    }).json()
    endpoint = f"/api/studio/deliveries/{delivery['id']}/generate"
    failed_job = client.post(endpoint, json={'version': delivery['version'], 'target_words': 100}).json()
    failed = _finished(owner, failed_job['id'])
    assert failed['status'] == 'failed'
    assert '超过目标100字' in failed['error'] and '原稿未覆盖' in failed['error']
    assert s.get(owner, delivery['id'])['version'] == delivery['version']
    assert s.get(owner, delivery['id'])['body'] == delivery['body']
    assert json.loads(prompts[0][1]['content'])['目标字数'] == 100
    assert '约100字' in prompts[0][0]['content'] and '约1200字' not in prompts[0][0]['content']

    body['value'] = '新' * 120
    ok_job = client.post(endpoint, json={'version': delivery['version'], 'target_words': 100}).json()
    done = _finished(owner, ok_job['id'])
    assert done['status'] == 'done', done
    saved = s.get(owner, delivery['id'])
    assert saved['target_words'] == 100 and saved['version'] == delivery['version'] + 1
    assert saved['body'].count(picture) == 1
    assert topics._article_words(saved['body']) == 120
