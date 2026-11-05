"""Version, destination and receipt contracts with no external writes."""
import base64
import json

import httpx
import pytest

from backend import gateway, matrix_publish as publish, store


@pytest.fixture
def draft(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path/'workbench.sqlite')
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(gateway, 'KEYFILE', tmp_path/'provider.key')
    store.init()
    topic = store.put('alice', 'studio_topic', {'title': '老楼改造'})
    flow = store.put('alice', 'studio_flow', {'title': '图文', 'topic_id': topic['id']})
    content = store.put('alice', 'content', {'title': '看现场', 'body': '## 核对井道\n\n正文。<script>alert(1)</script>',
        'topic_id': topic['id'], 'flow_id': flow['id'], 'creation_channel':'website', 'format':'官网文章'})
    return flow, content


def data_for(draft):
    flow, content = draft
    return {'flow_id':flow['id'], 'content_id':content['id'], 'content_version':content['version'],
            'platform':'website', 'confirmed':True, 'request_id':'publish-confirmed-01', 'config_revision':1}


def mock_network(monkeypatch, handler):
    real_client = httpx.Client
    calls = []

    def target(url):
        address = httpx.URL(url)
        calls.append(str(address))
        if address.host == 'localhost':
            raise ValueError('blocked')
        return address.copy_with(host='1.1.1.1'), {'Host':address.host}, {'sni_hostname':address.host}

    monkeypatch.setattr(publish.network, 'public_target', target)
    monkeypatch.setattr(publish.httpx, 'Client', lambda **opts: real_client(transport=httpx.MockTransport(handler), **opts))
    return calls


def test_gateway_requires_matching_version_owner_and_one_outbound_submission(draft, monkeypatch):
    sent = []
    def handler(request):
        sent.append(request)
        assert request.headers['host'] == 'publisher.test' and request.url.host == '1.1.1.1'
        assert request.headers['authorization'] == 'Bearer test-gateway-token'
        payload = json.loads(request.content)
        assert payload['request_id'] == request.headers['idempotency-key']
        assert '<h2>核对井道</h2>' in payload['html']
        assert 'alert(1)' not in payload['html'] and 'alert(1)' not in payload['body']
        return httpx.Response(201, json={'status':'published', 'id':'external-1', 'url':'https://publisher.test/read/1'})
    mock_network(monkeypatch, handler)
    cfg = publish.update_config('alice', {'platform':'website', 'endpoint':'https://publisher.test/hook',
                                         'token':'test-gateway-token'})
    assert cfg['configured'] and 'secret' not in cfg and 'token' not in cfg
    with pytest.raises(ValueError, match='对应凭据'):
        publish.update_config('alice', {'platform':'website', 'endpoint':'https://publisher.test/other'})
    with pytest.raises(ValueError, match='blocked'):
        publish.update_config('alice', {'platform':'website', 'endpoint':'https://localhost', 'token':'any'})
    payload = data_for(draft)
    with pytest.raises(ValueError, match='确认'):
        publish.dispatch('alice', {**payload, 'confirmed':False})
    with pytest.raises(store.Conflict, match='文稿已更新'):
        publish.dispatch('alice', {**payload, 'content_version':2})
    with pytest.raises(store.Missing):
        publish.dispatch('bob', payload)
    with pytest.raises(store.Conflict, match='发布连接已变化'):
        publish.dispatch('alice', {**payload, 'config_revision':0})
    assert publish.dispatch('alice', payload)['status'] == 'published'
    repeated = publish.dispatch('alice', {**payload, 'request_id':'publish-confirmed-again'})
    assert repeated['external_id'] == 'external-1' and len(sent) == 1


def test_wordpress_uploads_media_then_publishes_with_native_receipt(draft, monkeypatch):
    flow, content = draft
    image_id = store.uid()
    content = store.put('alice', 'content', {**content, 'body':f'一张图\n\n![现场](/api/illustrations/{image_id}/file)'}, content['id'])
    store.put('alice', 'illustration', {'flow_id':flow['id'], 'data_uri':'data:image/png;base64,'+base64.b64encode(b'fixture-png').decode()}, image_id)
    sent = []
    def handler(request):
        sent.append(request.url.path)
        assert request.headers['authorization'] == 'Basic ' + base64.b64encode(b'editor:appPassword').decode()
        if request.url.path.endswith('/media'):
            assert request.headers['content-type'] == 'image/png'
            assert request.content == b'fixture-png'
            return httpx.Response(201, json={'id':33, 'source_url':'https://cdn.test/photo.png'})
        payload = json.loads(request.content)
        assert payload['featured_media'] == 33 and payload['status'] == 'publish'
        assert 'https://cdn.test/photo.png' in payload['content'] and 'cid:' not in payload['content']
        return httpx.Response(201, json={'id':88, 'status':'publish', 'link':'https://site.test/blog/88'})
    mock_network(monkeypatch, handler)
    publish.update_config('alice', {'platform':'website', 'endpoint':'https://site.test/blog/wp-json/wp/v2/',
        'mode':'wordpress', 'username':'editor', 'token':'app Password'})
    receipt = publish.dispatch('alice', data_for((flow, content)))
    assert receipt['external_id'] == '88' and receipt['status'] == 'published'
    assert sent == ['/blog/wp-json/wp/v2/media', '/blog/wp-json/wp/v2/posts']


def test_ambiguous_redirect_is_not_retried_or_sent_to_redirect_target(draft, monkeypatch):
    seen = []
    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(302, headers={'location':'https://unexpected.test/collect'})
    mock_network(monkeypatch, handler)
    publish.update_config('alice', {'platform':'website', 'endpoint':'https://site.test/hook', 'token':'token'})
    payload = data_for(draft)
    assert publish.dispatch('alice', payload)['status'] == 'unknown'
    assert publish.dispatch('alice', payload)['status'] == 'unknown'
    assert seen == ['/hook']
