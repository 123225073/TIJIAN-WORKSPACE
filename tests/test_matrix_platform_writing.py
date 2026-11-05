"""Offline transport contracts; fixtures do not claim real-model prose quality."""
import json
from uuid import uuid4

from test_workflows import client, account
from test_creation import fake_model, finish
from backend import capabilities, content_matrix, jobs, store as s
from backend.writing_methods import writing_request


def test_all_matrix_channels_reach_the_actual_model_with_scoped_admin_methods(client, monkeypatch):
    owner = account(client)['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯报价核对'}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    path = '/api/studio/flows/' + flow['id'] + '/matrix'
    master = '已确认井道净宽1600毫米。报价包含设备和安装，土建范围需要按合同核对。'
    platforms = list(content_matrix.CHANNELS)
    saved = client.put(path, json={'topic_id': topic['id'], 'version': 0, 'body': master, 'platforms': platforms})
    assert saved.status_code == 200, saved.text
    calls = []
    fake_model(monkeypatch, lambda _, messages: calls.append(messages) or '标题：离线契约示例\n\n应核对合同范围。')
    for platform in platforms:
        response = client.post(path + '/generate', json={'platform': platform, 'master_version': 1,
            'topic_id': topic['id'], 'request_id': str(uuid4())})
        assert response.status_code == 200, response.text
        complete = finish(client, response.json())
        assert complete['status'] == 'done', complete
        # The existing matrix reconciliation binds completed content to its
        # draft/channel when refreshing the matrix overview.
        assert client.get(path).status_code == 200
        content = s.get(owner, complete['result']['content_id'])
        assert content['title'] == '离线契约示例'
        assert content['body'] == '应核对合同范围。'
        trace = content['request_snapshot']
        assert trace['platform'] == platform
        ids = {item['id'] for item in trace['configuration']['items']}
        native = {ident for ident in ids if ident.startswith('skill:platform-native-')}
        assert native == {'skill:platform-native-' + platform}
        assert ('skill:wechat-narrative' in ids) == (platform == 'wechat')
        assert ('skill:xiaohongshu-writing' in ids) == (platform == 'xiaohongshu')
        payload = json.loads(calls[-1][1]['content'])
        assert payload['发布平台'] == platform
        assert master in payload['要求'] and '1600' in payload['要求']
        assert content['creation_channel'] == platform
        preview = client.get('/api/admin/capabilities/preview/writing', params={'platform': platform})
        assert preview.status_code == 200, preview.text
        assert 'skill:platform-native-' + platform in {item['id'] for item in preview.json()['metadata']['items']}
    xhs = calls[platforms.index('xiaohongshu')][0]['content']
    assert '3至6个有意义的emoji' in xhs and '3至5个与本文场景紧密相关的#话题' in xhs
    assert '公众号文章缩写' in xhs
    assert len(calls) == 8


def test_platform_admin_overrides_are_preserved_frozen_and_can_be_disabled(client):
    owner = account(client)['user']['id']
    original = next(item for item in capabilities.list_() if item['id'] == 'skill:platform-native-xiaohongshu')
    customized = capabilities.save({**original, 'body': 'ADMIN_CUSTOM_NATIVE_ONE'}, owner)
    frozen = capabilities.snapshot('writing', owner)
    changed = capabilities.save({**customized, 'body': 'ADMIN_CUSTOM_NATIVE_TWO'}, owner)
    prepared = writing_request(frozen, policy=jobs.POLICY, brief='核对报价', format_name='小红书文案')
    assert 'ADMIN_CUSTOM_NATIVE_ONE' in prepared['messages'][0]['content']
    assert 'ADMIN_CUSTOM_NATIVE_TWO' not in prepared['messages'][0]['content']
    assert next(item for item in capabilities.list_() if item['id'] == original['id'])['body'] == 'ADMIN_CUSTOM_NATIVE_TWO'
    capabilities.save({**changed, 'status': 'disabled'}, owner)
    future = writing_request(capabilities.snapshot('writing', owner), policy=jobs.POLICY,
        brief='核对报价', format_name='小红书文案')
    assert original['id'] not in {item['id'] for item in future['snapshot']['configuration']['items']}
    assert 'ADMIN_CUSTOM_NATIVE_' not in future['messages'][0]['content']
    assert '3至6个有意义的emoji' not in future['messages'][0]['content']
