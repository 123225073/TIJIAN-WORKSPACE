"""Publication orchestration contracts; every provider write is mocked locally."""
import io
from uuid import uuid4

import pytest
from PIL import Image

from backend import content_matrix, matrix_publish, media_studio, store, wechat_publish
from test_creation import finish
from test_workflows import account, client

PREFIX = '/api/studio/matrix-publication'


def prepared(client, monkeypatch, platforms=('website', 'zhihu')):
    owner = account(client)['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯报价比较'}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    content_matrix.save_master(owner, flow, {'topic_id': topic['id'], 'version': 0,
        'body': '核对项目条件与服务范围。', 'platforms': list(platforms)})
    items = []
    for platform in platforms:
        content = store.put(owner, 'content', {'title': '报价先核对范围', 'body': '先核对条件，再比较服务范围。',
            'flow_id': flow['id'], 'topic_id': topic['id'], 'creation_channel': platform,
            'format': content_matrix.CHANNELS[platform][0]})
        items.append({'platform': platform, 'content_id': content['id'], 'content_version': content['version']})
        if platform != 'wechat':
            # No DNS or network I/O is required to configure these isolated fixtures.
            store.set_config(matrix_publish.config_key(owner, platform), {'endpoint': 'https://publisher.test/' + platform,
                'enabled': True, 'secret': 'fixture-encrypted-placeholder', 'revision': 1})
    sent = []

    def send(config, payload, key):
        sent.append(payload['platform'])
        return {'status': 'published', 'external_id': key, 'url': 'https://publisher.test/read/' + key}

    monkeypatch.setattr(matrix_publish, 'send', send)
    return owner, flow, items, sent


def preview(client, flow, items):
    response = client.post(PREFIX + '/preview', json={'flow_id': flow['id'], 'items': items})
    assert response.status_code == 200, response.text
    return response.json()['items']


def test_preview_has_no_writes_and_batch_is_explicit_idempotent_and_version_bound(client, monkeypatch):
    owner, flow, items, sent = prepared(client, monkeypatch)
    rows = preview(client, flow, items)
    assert all(row['ready'] for row in rows) and sent == []
    assert 'fixture-token' not in str(rows)
    payload = {'flow_id': flow['id'], 'items': rows, 'request_id': str(uuid4()), 'confirmed': False}
    assert client.post(PREFIX + '/publish', json=payload).status_code == 400
    payload['confirmed'] = True
    first = client.post(PREFIX + '/publish', json=payload)
    assert first.status_code == 200, first.text
    done = finish(client, first.json())
    assert done['status'] == 'done' and done['result']['submitted'] == 2, done
    assert sent == ['website', 'zhihu']
    assert client.post(PREFIX + '/publish', json=payload).json()['id'] == done['id']
    assert len(sent) == 2
    assert all(not row['ready'] and row.get('receipt') for row in preview(client, flow, items))
    assert client.post(PREFIX + '/publish', json={**payload, 'request_id': str(uuid4())}).status_code == 409


def test_single_publish_does_not_submit_other_selected_platform(client, monkeypatch):
    _, flow, items, sent = prepared(client, monkeypatch)
    row = preview(client, flow, items[:1])[0]
    response = client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': [row],
        'request_id': str(uuid4()), 'confirmed': True})
    assert response.status_code == 200, response.text
    assert finish(client, response.json())['result']['submitted'] == 1
    assert sent == ['website'] and preview(client, flow, items[1:])[0]['ready']


def test_changed_document_or_destination_invalidates_preview_before_write(client, monkeypatch):
    owner, flow, items, sent = prepared(client, monkeypatch)
    rows = preview(client, flow, items)
    config_key = matrix_publish.config_key(owner, 'website')
    config = store.config(config_key, {})
    store.set_config(config_key, {**config, 'endpoint': 'https://publisher.test/changed', 'revision': 2})
    payload = {'flow_id': flow['id'], 'items': rows, 'request_id': str(uuid4()), 'confirmed': True}
    assert client.post(PREFIX + '/publish', json=payload).status_code == 409 and sent == []
    rows = preview(client, flow, items)
    content = store.get(owner, items[0]['content_id'])
    store.put(owner, 'content', {**content, 'body': '修改后的正文'}, content['id'], expected=content['version'])
    assert client.post(PREFIX + '/publish', json={**payload, 'items': rows}).status_code == 409 and sent == []


def test_foreign_flow_and_mismatched_platform_cannot_publish(client, monkeypatch):
    _, flow, items, sent = prepared(client, monkeypatch)
    invalid = {**items[0], 'platform': 'zhihu'}
    assert client.post(PREFIX + '/preview', json={'flow_id': flow['id'], 'items': [invalid]}).status_code == 400
    rows = preview(client, flow, items)
    account(client, 'matrix-publish-other@example.test')
    assert client.post(PREFIX + '/preview', json={'flow_id': flow['id'], 'items': rows}).status_code == 404
    assert client.get(PREFIX + '/jobs', params={'flow_id': flow['id']}).status_code == 404
    assert client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': rows,
        'request_id': str(uuid4()), 'confirmed': True}).status_code == 404
    assert sent == []


def test_one_platform_failure_preserves_others_and_unknown_receipt_is_never_resent(client, monkeypatch):
    _, flow, items, sent = prepared(client, monkeypatch)

    def send(config, payload, key):
        sent.append(payload['platform'])
        if payload['platform'] == 'website':
            raise TimeoutError('fixture-only ambiguous timeout')
        return {'status': 'published', 'external_id': 'fixture-id'}

    monkeypatch.setattr(matrix_publish, 'send', send)
    rows = preview(client, flow, items)
    response = client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': rows,
        'request_id': str(uuid4()), 'confirmed': True})
    assert response.status_code == 200, response.text
    job = finish(client, response.json())
    assert [row['receipt']['status'] for row in job['result']['items']] == ['unknown', 'published'], job
    assert sent == ['website', 'zhihu']
    assert all(not row['ready'] for row in preview(client, flow, items))


@pytest.mark.parametrize(('provider_status', 'expected'), [(0, 'published'), (2, 'failed')])
def test_wechat_batch_reuses_draft_publish_and_owned_status_without_resubmitting(client, monkeypatch, provider_status, expected):
    owner, flow, items, sent = prepared(client, monkeypatch, ('wechat',))
    raw = io.BytesIO()
    Image.new('RGB', (48, 48), '#217252').save(raw, format='PNG')
    name = 'b' * 32 + '.png'
    (media_studio._root(owner) / name).write_bytes(raw.getvalue())
    cover = store.put(owner, 'studio_asset', {'title': '封面', 'asset_type': 'image', 'status': 'ready', 'local_file': name})
    response = client.post('/api/wechat-publish/accounts', json={'name': '隔离公众号',
        'app_id': 'wx' + 'a' * 16, 'app_secret': 'fixture-only-secret'})
    assert response.status_code == 200, response.text
    account_id = response.json()['id']
    calls = []

    def provider(method, path, **kwargs):
        calls.append(path)
        return {'/material/add_material': {'media_id': 'cover-id'}, '/draft/add': {'media_id': 'draft-id'},
            '/freepublish/submit': {'publish_id': 'publish-id'}, '/freepublish/get': {'publish_status': provider_status,
                'article_detail': {'item': [{'article_url': 'https://mp.weixin.qq.com/fixture-article'}]}}}[path]

    monkeypatch.setattr(wechat_publish, '_request', provider)
    rows = preview(client, flow, [{**items[0], 'cover_asset_id': cover['id'], 'account_id': account_id}])
    assert rows[0]['ready'], rows
    assert calls == []
    response = client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': rows,
        'request_id': str(uuid4()), 'confirmed': True})
    assert response.status_code == 200, response.text
    job = finish(client, response.json())
    assert job['result']['items'][0]['receipt']['status'] == 'publishing', job
    assert calls == ['/material/add_material', '/draft/add', '/freepublish/submit'] and sent == []
    assert not preview(client, flow, [{**items[0], 'cover_asset_id': cover['id'], 'account_id': account_id}])[0]['ready']
    query = {'flow_id': flow['id'], 'items': [{**items[0], 'cover_asset_id': cover['id'], 'account_id': account_id}]}
    checked = client.post(PREFIX + '/status', json=query)
    assert checked.status_code == 200, checked.text
    row = checked.json()['items'][0]
    assert row['receipt']['status'] == expected and not row['ready']
    assert calls == ['/material/add_material', '/draft/add', '/freepublish/submit', '/freepublish/get']
    # A terminal receipt is read from the database, without querying or writing again.
    assert client.post(PREFIX + '/status', json=query).status_code == 200
    assert len(calls) == 4
    account(client, 'foreign-status@example.test')
    assert client.post(PREFIX + '/status', json=query).status_code == 404
    assert len(calls) == 4


def test_validation_failure_on_one_platform_does_not_stop_next_platform(client, monkeypatch):
    _, flow, items, sent = prepared(client, monkeypatch)
    dispatch = matrix_publish.dispatch

    def reject_first(owner, data):
        if data['platform'] == 'website':
            raise ValueError('隔离测试：此平台拒绝提交')
        return dispatch(owner, data)

    monkeypatch.setattr(matrix_publish, 'dispatch', reject_first)
    rows = preview(client, flow, items)
    response = client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': rows,
        'request_id': str(uuid4()), 'confirmed': True})
    assert response.status_code == 200, response.text
    result = finish(client, response.json())['result']
    assert result['failed'] == 1 and result['submitted'] == 1
    assert '拒绝提交' in result['items'][0]['error']
    assert result['items'][1]['receipt']['status'] == 'published' and sent == ['zhihu']


def test_all_platforms_rejected_marks_job_failed_and_reports_submission_counts(client, monkeypatch):
    _, flow, items, sent = prepared(client, monkeypatch)

    def reject_all(*_):
        raise ValueError('隔离测试：平台拒绝提交')

    monkeypatch.setattr(matrix_publish, 'dispatch', reject_all)
    rows = preview(client, flow, items)
    response = client.post(PREFIX + '/publish', json={'flow_id': flow['id'], 'items': rows,
        'request_id': str(uuid4()), 'confirmed': True})
    assert response.status_code == 200, response.text
    job = finish(client, response.json())
    assert job['status'] == 'failed', job
    assert job['result']['submitted'] == 0 and job['result']['failed'] == 2
    assert '已提交 0' in job['progress'] and '未提交 2' in job['progress']
    assert sent == []
