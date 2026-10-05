"""Wechat draft/publish state gates without contacting a real public account."""
import io
import base64
import json

import pytest
import httpx
from fastapi.testclient import TestClient
from PIL import Image

from backend import gateway, media_studio, store, wechat_publish
from backend.app import ATTEMPTS, app


def test_inline_upload_url_accepts_wechat_cdn_but_rejects_local_address():
    assert wechat_publish._inline_image_url({'url': 'http://mmbiz.qpic.cn/image/0'}) == 'http://mmbiz.qpic.cn/image/0'
    for url in ('http://127.0.0.1/image', 'http://localhost/image', 'http://10.0.0.1/image'):
        with pytest.raises(ValueError, match='有效'):
            wechat_publish._inline_image_url({'url': url})


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'test.sqlite')
    monkeypatch.setattr(gateway, 'KEYFILE', tmp_path / 'provider.key')
    ATTEMPTS.clear()
    wechat_publish.TOKEN_CACHE.clear()
    with TestClient(app, base_url='http://127.0.0.1') as client:
        login = client.post('/api/auth/login', json={'email': 'admin', 'password': 'admin'})
        assert login.status_code == 200
        client.headers['Authorization'] = 'Bearer ' + login.json()['token']
        yield client


def _prepared(client):
    owner = client.get('/api/state').json()['user']['id']
    source = client.post('/api/studio/topics', json={'title': '电梯选型核对'}).json()
    delivery = client.post('/api/studio/deliveries', json={'topic_id': source['id'], 'platform': 'wechat'}).json()
    picture = Image.new('RGB', (48, 48), '#137351')
    content = io.BytesIO()
    picture.save(content, format='PNG')
    filename = 'a' * 32 + '.png'
    (media_studio._root(owner) / filename).write_bytes(content.getvalue())
    asset = store.put(owner, 'studio_asset', {'title': '封面', 'asset_type': 'image', 'status': 'ready', 'local_file': filename})
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'title': '电梯选型先核对这三件事', 'summary': '供客户初步核对',
        'body': '# 先核对需求\n再看**项目条件**。', 'cover_asset_id': asset['id'],
    }).json()
    account = client.post('/api/wechat-publish/accounts', json={
        'name': '公司公众号', 'app_id': 'wx' + 'a' * 16, 'app_secret': 'private-test-secret',
    })
    assert account.status_code == 200, account.text
    return owner, delivery, account.json()


def test_layout_preview_matches_saved_draft_and_has_single_compact_list_markers(client, monkeypatch):
    _, delivery, account = _prepared(client)
    body = '## 项目核对\n\n{#color:red}{#size:20}先看现场{#/size}{#/color}。\n\n1. 核对尺寸\n\n2. 核对维保\n\n- 记录条件\n\n- 标出疑点'
    settings = {'font_size': '17', 'line_height': '1.6', 'paragraph_gap': '8', 'accent': 'forest'}
    preview = client.post('/api/wechat-publish/preview', json={'body': body, 'wechat_style': settings})
    assert preview.status_code == 200, preview.text
    html = preview.json()['html']
    assert '<ol' not in html and '<ul' not in html and '<li' not in html
    assert html.count('>1.</span>') == 1 and html.count('>2.</span>') == 1
    assert html.count('>●</span>') == 2
    assert 'font-size:17px' in html and 'margin:0 0 8px' in html
    assert html.count('核对尺寸') == 1 and html.count('核对维保') == 1
    assert '<span style="color:#c34539;"><span style="font-size:20px;">先看现场</span></span>' in html
    saved = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'body': body, 'wechat_style': settings,
    })
    assert saved.status_code == 200, saved.text
    item = saved.json()
    assert item['body'] == body
    assert item['wechat_style'] == settings
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs))
        return {'/material/add_material': {'media_id': 'cover-layout'},
                '/draft/add': {'media_id': 'draft-layout'}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    synced = client.post('/api/wechat-publish/drafts/' + item['id'], json={
        'account_id': account['id'], 'version': item['version'],
    })
    assert synced.status_code == 200, synced.text
    assert calls[-1][1]['payload']['articles'][0]['content'] == html


def test_layout_settings_are_validated_and_affect_draft_snapshot(client):
    _, delivery, _ = _prepared(client)
    for invalid in ({'accent': 'url(javascript:bad)'}, {'font_size': '999'}, {'unexpected': 'x'}):
        result = client.patch('/api/studio/deliveries/' + delivery['id'], json={
            'version': delivery['version'], 'wechat_style': invalid,
        })
        assert result.status_code == 400
    before = wechat_publish._snapshot(delivery)
    changed = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'wechat_style': {'accent': 'blue'},
    }).json()
    assert changed['wechat_style']['accent'] == 'blue'
    assert wechat_publish._snapshot(changed) != before


def test_public_ip_requires_login_and_returns_only_validated_egress_ip(client, monkeypatch):
    token = client.headers.pop('Authorization')
    assert client.get('/api/wechat-publish/public-ip').status_code == 401
    client.headers['Authorization'] = token
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append(('options', kwargs))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url):
            calls.append(('url', url))
            return httpx.Response(200, text='8.8.8.8\n')

    monkeypatch.setattr(wechat_publish.httpx, 'Client', FakeClient)
    monkeypatch.setattr(wechat_publish, '_accounts', lambda *_: pytest.fail('IP 检测不应读取账号配置'))
    monkeypatch.setattr(gateway, 'cipher', lambda: pytest.fail('IP 检测不应读取密钥'))
    result = client.get('/api/wechat-publish/public-ip')
    assert result.status_code == 200 and result.json() == {'ip': '8.8.8.8'}
    assert result.headers['Cache-Control'] == 'no-store'
    assert calls == [('options', {'timeout': 5, 'trust_env': False}), ('url', 'https://checkip.amazonaws.com')]


@pytest.mark.parametrize(('status', 'body', 'message'), [
    (503, 'private-test-secret', '暂时不可用'),
    (200, '192.168.1.8', '未返回有效的公网 IPv4'),
    (200, 'not-an-ip private-test-secret', '未返回有效的公网 IPv4'),
    (200, '2001:4860:4860::8888', '未返回有效的公网 IPv4'),
])
def test_public_ip_fails_closed_without_echoing_upstream_body(client, monkeypatch, status, body, message):
    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url):
            return httpx.Response(status, text=body)

    monkeypatch.setattr(wechat_publish.httpx, 'Client', FakeClient)
    result = client.get('/api/wechat-publish/public-ip')
    assert result.status_code == 400 and message in result.json()['detail']
    assert 'private-test-secret' not in result.text and 'ip' not in result.json()


@pytest.mark.parametrize(('error', 'message'), [
    (httpx.ConnectTimeout('late'), '检测超时'),
    (httpx.ConnectError('private-test-secret'), '无法连接公网 IP 检测服务'),
])
def test_public_ip_network_failure_is_explicit_and_scrubbed(client, monkeypatch, error, message):
    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url):
            raise error

    monkeypatch.setattr(wechat_publish.httpx, 'Client', FakeClient)
    result = client.get('/api/wechat-publish/public-ip')
    assert result.status_code == 400 and message in result.json()['detail']
    assert 'private-test-secret' not in result.text


def test_40164_guidance_exposes_only_valid_wechat_seen_ip():
    response = httpx.Response(200, json={'errcode': 40164, 'errmsg': 'invalid ip 8.8.4.4, not in whitelist; private-test-secret'})
    with pytest.raises(ValueError, match='40164.*微信识别的出口 IP：8.8.4.4') as caught:
        wechat_publish._json(response)
    assert 'private-test-secret' not in str(caught.value)


def test_40125_points_to_account_secret_instead_of_ip_or_material():
    response = httpx.Response(200, json={'errcode': 40125, 'errmsg': 'invalid appsecret private-test-secret'})
    with pytest.raises(ValueError, match='40125.*AppSecret 无效.*修改连接') as caught:
        wechat_publish._json(response)
    assert 'private-test-secret' not in str(caught.value)
    assert '素材格式' not in str(caught.value)


def test_connection_test_refreshes_cached_token_and_detects_reset_secret(client, monkeypatch):
    _, _, account = _prepared(client)
    requests = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url, params):
            requests.append(url)
            return httpx.Response(200, json=({'access_token': 'old-token', 'expires_in': 7200}
                                              if len(requests) == 1 else {'errcode': 40125, 'errmsg': 'invalid appsecret private-test-secret'}))

    monkeypatch.setattr(wechat_publish.httpx, 'Client', FakeClient)
    url = '/api/wechat-publish/accounts/' + account['id'] + '/test'
    assert client.post(url).status_code == 200
    second = client.post(url)
    assert second.status_code == 400 and '40125' in second.text
    assert 'private-test-secret' not in second.text
    assert len(requests) == 2


def test_account_secret_is_encrypted_owner_scoped_and_not_echoed(client, monkeypatch):
    owner, delivery, account = _prepared(client)
    assert account['has_secret'] and 'secret' not in account and 'private-test-secret' not in str(account)
    stored = store.config('wechat_publish_accounts:' + owner)[0]
    assert 'private-test-secret' not in stored['secret']
    assert 'private-test-secret' not in client.get('/api/wechat-publish/accounts').text
    assert client.post('/api/wechat-publish/accounts/' + account['id'] + '/state', json={'enabled': False}).json()['enabled'] is False
    assert client.post('/api/wechat-publish/drafts/' + delivery['id'], json={'account_id': account['id'], 'version': delivery['version']}).status_code == 400
    other = client.post('/api/admin/users', json={'email': 'other@example.test', 'name': '其他人', 'password': 'password-12345'})
    assert other.status_code == 200
    login = client.post('/api/auth/login', json={'email': 'other@example.test', 'password': 'password-12345'}).json()
    client.headers['Authorization'] = 'Bearer ' + login['token']
    assert client.get('/api/wechat-publish/accounts').json()['items'] == []
    assert client.get('/api/wechat-publish/records/' + delivery['id']).status_code == 404


def test_draft_update_explicit_publish_and_status_poll(client, monkeypatch):
    _, delivery, account = _prepared(client)
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs))
        return {'/material/add_material': {'media_id': 'cover-1'}, '/draft/add': {'media_id': 'draft-1'},
                '/draft/update': {}, '/freepublish/submit': {'publish_id': 'publish-1'},
                '/freepublish/get': {'publish_status': 0, 'article_detail': {'item': [{'article_url': 'https://mp.weixin.qq.com/s/test'}]}}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    url = '/api/wechat-publish/drafts/' + delivery['id']
    payload = {'account_id': account['id'], 'version': delivery['version']}
    synced = client.post(url, json=payload)
    assert synced.status_code == 200, synced.text
    assert synced.json()['status'] == 'draft'
    assert [path for path, _ in calls] == ['/material/add_material', '/draft/add']
    article = calls[-1][1]['payload']['articles'][0]
    assert article['thumb_media_id'] == 'cover-1'
    assert '先核对需求' in article['content'] and '<strong' in article['content']
    assert '项目条件' in article['content']
    assert client.post(url, json=payload).json()['id'] == synced.json()['id']
    assert len(calls) == 2  # no duplicate WeChat draft
    assert client.post('/api/wechat-publish/publish/' + delivery['id'], json={'account_id': account['id']}).status_code == 400
    assert client.post('/api/wechat-publish/publish/' + delivery['id'], json={'account_id': account['id'], 'confirmed': True}).json()['status'] == 'publishing'
    assert client.post(url, json=payload).status_code == 400
    polled = client.post('/api/wechat-publish/status/' + delivery['id'], json={'account_id': account['id']})
    assert polled.status_code == 200 and polled.json()['status'] == 'published'
    assert polled.json()['article_url'] == 'https://mp.weixin.qq.com/s/test'


def test_changed_delivery_requires_new_sync_and_remote_draft_is_updated(client, monkeypatch):
    _, delivery, account = _prepared(client)
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append(path)
        return {'/material/add_material': {'media_id': 'cover-2'}, '/draft/add': {'media_id': 'draft-2'}, '/draft/update': {}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    draft_url = '/api/wechat-publish/drafts/' + delivery['id']
    assert client.post(draft_url, json={'account_id': account['id'], 'version': delivery['version']}).status_code == 200
    updated = client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': delivery['version'], 'body': '修改后的正文'}).json()
    assert client.post('/api/wechat-publish/publish/' + delivery['id'], json={'account_id': account['id'], 'confirmed': True}).status_code == 400
    assert client.post(draft_url, json={'account_id': account['id'], 'version': delivery['version']}).status_code == 409
    assert client.post(draft_url, json={'account_id': account['id'], 'version': updated['version']}).status_code == 200
    assert calls.count('/draft/add') == 1 and calls.count('/draft/update') == 1


def test_changing_app_id_keeps_old_history_and_starts_a_new_connection(client, monkeypatch):
    _, delivery, account = _prepared(client)
    calls = []

    def fake_request(method, path, **kwargs):
        app_id = kwargs['account']['app_id']
        calls.append((path, app_id))
        if path == '/material/add_material':
            return {'media_id': 'cover-' + app_id}
        if path == '/draft/add':
            return {'media_id': 'draft-' + app_id}
        if path == '/freepublish/submit':
            return {'publish_id': 'publish-' + app_id}
        pytest.fail('新连接不应更新旧账号草稿或查询旧发布记录')

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    draft_url = '/api/wechat-publish/drafts/' + delivery['id']
    publish_url = '/api/wechat-publish/publish/' + delivery['id']
    old_id = 'wx' + 'a' * 16
    new_id = 'wx' + 'b' * 16
    old = client.post(draft_url, json={'account_id': account['id'], 'version': delivery['version']}).json()
    published = client.post(publish_url, json={'account_id': account['id'], 'confirmed': True})
    assert published.status_code == 200 and published.json()['publish_id'] == 'publish-' + old_id

    changed = client.post('/api/wechat-publish/accounts', json={
        'id': account['id'], 'name': '新公众号', 'app_id': new_id, 'app_secret': 'new-private-secret',
    })
    assert changed.status_code == 200, changed.text
    new_account = changed.json()
    assert new_account['id'] != account['id'] and new_account['app_id'] == new_id
    accounts = {item['id']: item for item in client.get('/api/wechat-publish/accounts').json()['items']}
    assert accounts[account['id']]['app_id'] == old_id and accounts[account['id']]['enabled'] is False
    assert accounts[new_account['id']]['enabled'] is True

    synced = client.post(draft_url, json={'account_id': new_account['id'], 'version': delivery['version']})
    assert synced.status_code == 200, synced.text
    assert synced.json()['id'] != old['id']
    assert synced.json()['draft_media_id'] == 'draft-' + new_id
    assert synced.json()['thumb_media_id'] == 'cover-' + new_id
    assert synced.json()['publish_id'] == ''
    records = {item['account_id']: item for item in client.get('/api/wechat-publish/records/' + delivery['id']).json()['items']}
    assert records[account['id']]['status'] == 'publishing'
    assert records[account['id']]['draft_media_id'] == 'draft-' + old_id
    assert records[account['id']]['publish_id'] == 'publish-' + old_id
    assert records[new_account['id']]['status'] == 'draft'
    assert calls == [('/material/add_material', old_id), ('/draft/add', old_id),
                     ('/freepublish/submit', old_id), ('/material/add_material', new_id), ('/draft/add', new_id)]


def test_inline_images_are_uploaded_into_wechat_body(client, monkeypatch):
    _, delivery, account = _prepared(client)
    asset_id = delivery['cover_asset_id']
    source = '检查现场 ![现场图](/api/studio/assets/' + asset_id + '/file "补充说明") 后续结论'
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'body': source,
    }).json()
    preview = client.post('/api/wechat-publish/preview', json={'body': source})
    assert preview.status_code == 200, preview.text
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs))
        return {'/material/add_material': {'media_id': 'cover-3'},
                '/media/uploadimg': {'url': 'https://mmbiz.qpic.cn/test.jpg'},
                '/draft/add': {'media_id': 'draft-3'}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    synced = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert synced.status_code == 200, synced.text
    assert [path for path, _ in calls] == ['/material/add_material', '/media/uploadimg', '/draft/add']
    body = calls[-1][1]['payload']['articles'][0]['content']
    assert '<img ' in body and 'https://mmbiz.qpic.cn/test.jpg' in body
    assert '/api/studio/assets/' not in body
    assert body == preview.json()['html'].replace('/api/studio/assets/' + asset_id + '/file',
                                                  'https://mmbiz.qpic.cn/test.jpg')


def test_draft_sync_accepts_realistic_http_wechat_inline_url_and_uses_distinct_multipart_uploads(client, monkeypatch):
    _, delivery, account = _prepared(client)
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'],
        'body': '现场照片\n![现场图](/api/studio/assets/' + delivery['cover_asset_id'] + '/file)',
    }).json()
    token = 'private-test-token'
    inline_url = 'http://mmbiz.qpic.cn/mmbiz_jpg/example/0?wx_fmt=jpeg'
    calls = []
    real_client = httpx.Client

    def respond(request):
        path = request.url.path
        calls.append(path)
        assert request.url.params['access_token'] == token
        if path in ('/cgi-bin/material/add_material', '/cgi-bin/media/uploadimg'):
            assert request.method == 'POST'
            assert request.headers['content-type'].startswith('multipart/form-data; boundary=')
            assert b'name="media"' in request.content
            if path.endswith('add_material'):
                assert b'filename="cover.jpg"' in request.content
            else:
                assert b'filename="' in request.content
            assert b'Content-Type: image/jpeg' in request.content
            assert b'\xff\xd8' in request.content
            if path.endswith('add_material'):
                assert request.url.params['type'] == 'image'
                return httpx.Response(200, json={'media_id': 'permanent-cover-id', 'url': 'http://mmbiz.qpic.cn/cover/0'})
            assert 'type' not in request.url.params
            return httpx.Response(200, json={'url': inline_url})
        assert path == '/cgi-bin/draft/add'
        article = json.loads(request.content)['articles'][0]
        assert article['thumb_media_id'] == 'permanent-cover-id'
        assert '<img ' in article['content'] and inline_url in article['content']
        return httpx.Response(200, json={'media_id': 'draft-id'})

    def mock_client(*args, **kwargs):
        assert kwargs['trust_env'] is False
        return real_client(*args, transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(wechat_publish, '_token', lambda *_: token)
    monkeypatch.setattr(wechat_publish.httpx, 'Client', mock_client)
    synced = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert synced.status_code == 200, synced.text
    assert synced.json()['draft_media_id'] == 'draft-id'
    assert calls == ['/cgi-bin/material/add_material', '/cgi-bin/media/uploadimg', '/cgi-bin/draft/add']
    assert token not in synced.text


@pytest.mark.parametrize(('result', 'message'), [
    ({'media_id': 'wrong-endpoint'}, '素材编号而非正文图片 URL'),
    ({'url': ''}, '未返回 url 字段'),
    ({'url': 'javascript:alert(1)'}, '不是有效的 http/https'),
    ({'url': 'http://'}, '不是有效的 http/https'),
    ({'url': 'https://mmbiz.qpic.cn/x)" private-test-token'}, '不是有效的 http/https'),
])
def test_inline_upload_rejects_invalid_response_without_leaking_values(result, message):
    with pytest.raises(ValueError, match=message) as caught:
        wechat_publish._inline_image_url(result)
    assert 'private-test-token' not in str(caught.value)
    assert 'wrong-endpoint' not in str(caught.value)


def test_wechat_upload_errors_identify_stage_without_echoing_upstream_or_token(client, monkeypatch):
    _, delivery, account = _prepared(client)
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'],
        'body': '![现场图](/api/studio/assets/' + delivery['cover_asset_id'] + '/file)',
    }).json()
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append(path)
        if path == '/material/add_material':
            return {'media_id': 'permanent-cover-id'}
        if path == '/media/uploadimg':
            return wechat_publish._json(httpx.Response(200, json={
                'errcode': 48001, 'errmsg': 'api unauthorized private-test-token',
            }))
        pytest.fail('失败时不应创建草稿')

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    response = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert response.status_code == 400
    assert '正文图片上传失败' in response.text and '48001' in response.text
    assert 'private-test-token' not in response.text
    assert calls == ['/material/add_material', '/media/uploadimg']


def test_wechat_non_object_json_is_a_sanitized_error():
    with pytest.raises(ValueError, match='JSON 对象'):
        wechat_publish._json(httpx.Response(200, json=['private-test-token']))


def test_cover_upload_requires_permanent_media_id_before_inline_or_draft(client, monkeypatch):
    _, delivery, account = _prepared(client)
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'],
        'body': '![现场图](/api/studio/assets/' + delivery['cover_asset_id'] + '/file)',
    }).json()
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append(path)
        return {'url': 'http://mmbiz.qpic.cn/cover/0'}

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    response = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert response.status_code == 400
    assert '封面上传失败' in response.text and 'media_id' in response.text
    assert calls == ['/material/add_material']


def test_generated_64_char_asset_and_article_illustration_sync_into_wechat(client, monkeypatch):
    owner, delivery, account = _prepared(client)
    content = io.BytesIO()
    Image.new('RGB', (48, 48), '#137351').save(content, format='PNG')
    generated_id = 'b' * 64
    filename = generated_id + '.png'
    (media_studio._root(owner) / filename).write_bytes(content.getvalue())
    store.put(owner, 'studio_asset', {'title': '生成图', 'asset_type': 'image', 'status': 'ready',
                                      'local_file': filename}, generated_id)
    illustration = store.put(owner, 'illustration', {'title': '文章配图',
                              'data_uri': 'data:image/png;base64,' + base64.b64encode(content.getvalue()).decode()})
    body = ('![生成图](/api/studio/assets/' + generated_id + '/file)\n\n'
            '![文章配图](/api/illustrations/' + illustration['id'] + '/file)')
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'body': body,
    }).json()
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs))
        if path == '/material/add_material':
            return {'media_id': 'cover-new'}
        if path == '/media/uploadimg':
            return {'url': 'https://mmbiz.qpic.cn/' + str(len(calls)) + '.jpg'}
        if path == '/draft/add':
            return {'media_id': 'draft-new'}
        pytest.fail(path)

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    result = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert result.status_code == 200, result.text
    assert [path for path, _ in calls] == ['/material/add_material', '/media/uploadimg', '/media/uploadimg', '/draft/add']
    html = calls[-1][1]['payload']['articles'][0]['content']
    assert html.count('https://mmbiz.qpic.cn/') == 2
    assert '/api/studio/assets/' not in html and '/api/illustrations/' not in html


def test_confirmed_publish_failure_can_be_revised_without_losing_history(client, monkeypatch):
    _, delivery, account = _prepared(client)
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append(path)
        return {'/material/add_material': {'media_id': 'cover-' + str(len(calls))},
                '/draft/add': {'media_id': 'draft-' + str(len(calls))},
                '/freepublish/submit': {'publish_id': 'publish-first'},
                '/freepublish/get': {'publish_status': 2}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    url = '/api/wechat-publish/drafts/' + delivery['id']
    original = client.post(url, json={'account_id': account['id'], 'version': delivery['version']}).json()
    client.post('/api/wechat-publish/publish/' + delivery['id'], json={'account_id': account['id'], 'confirmed': True})
    failed = client.post('/api/wechat-publish/status/' + delivery['id'], json={'account_id': account['id']}).json()
    assert failed['status'] == 'failed'
    assert client.post(url, json={'account_id': account['id'], 'version': delivery['version'], 'confirmed_retry': True}).status_code == 400
    updated = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'body': delivery['body'] + '\n补充核对记录。',
    }).json()
    assert client.post(url, json={'account_id': account['id'], 'version': updated['version']}).status_code == 400
    revised = client.post(url, json={'account_id': account['id'], 'version': updated['version'], 'confirmed_retry': True})
    assert revised.status_code == 200, revised.text
    record = revised.json()
    assert record['status'] == 'draft' and record['draft_media_id'] != original['draft_media_id']
    assert record['publish_id'] == '' and record['publish_history'][-1]['publish_id'] == 'publish-first'
    assert calls.count('/draft/add') == 2 and '/draft/update' not in calls


@pytest.mark.parametrize('title', ['"现场照片"', "'现场照片'", '(现场照片)'])
def test_inline_image_with_title_is_uploaded_and_title_is_removed(client, monkeypatch, title):
    _, delivery, account = _prepared(client)
    asset_id = delivery['cover_asset_id']
    source = '/api/studio/assets/' + asset_id + '/file'
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'],
        'body': '![现场图](' + source + ' ' + title + ')\n![复用图](' + source + ')',
    }).json()
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs))
        return {'/material/add_material': {'media_id': 'cover-title'},
                '/media/uploadimg': {'url': 'https://mmbiz.qpic.cn/title.jpg'},
                '/draft/add': {'media_id': 'draft-title'}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    synced = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert synced.status_code == 200, synced.text
    assert [path for path, _ in calls] == ['/material/add_material', '/media/uploadimg', '/draft/add']
    html = calls[-1][1]['payload']['articles'][0]['content']
    assert html.count('https://mmbiz.qpic.cn/title.jpg') == 2
    assert source not in html and '现场照片' not in html


@pytest.mark.parametrize('image', [
    '![现场图](/api/studio/assets/not-an-id/file)',
    '![现场图](/api/studio/assets/{asset_id}/file?download=1)',
    '![现场图](/api/studio/assets/{asset_id}/file "未闭合)',
    '![现场图](/api/studio/assets/{asset_id}/file "图注" extra)',
    '![现场\\]图](/api/studio/assets/{asset_id}/file)',
])
def test_unrecognized_local_image_blocks_draft_creation(client, monkeypatch, image):
    _, delivery, account = _prepared(client)
    delivery = client.patch('/api/studio/deliveries/' + delivery['id'], json={
        'version': delivery['version'], 'body': image.format(asset_id=delivery['cover_asset_id']),
    }).json()
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append(path)
        return {'media_id': 'cover-invalid'}

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    result = client.post('/api/wechat-publish/drafts/' + delivery['id'], json={
        'account_id': account['id'], 'version': delivery['version'],
    })
    assert result.status_code == 400 and '无法识别的本地图片' in result.json()['detail']
    assert '/media/uploadimg' not in calls and '/draft/add' not in calls
