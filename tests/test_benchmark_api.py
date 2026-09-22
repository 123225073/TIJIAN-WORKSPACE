"""Isolated contract tests: never call paid services or modify application fixtures."""
import json
import pytest
import httpx
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from backend import benchmark_api as b, store as s, gateway as g, capabilities


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DB', tmp_path / 'benchmark.sqlite')
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(g, 'KEYFILE', tmp_path / 'provider.key')
    s.init()
    app = FastAPI()

    def user(authorization: str = Header('')):
        if authorization not in ('admin', 'alice', 'bob'):
            raise HTTPException(401, '请登录')
        return {'id': authorization, 'role': 'admin' if authorization == 'admin' else 'user'}

    def admin(u=Depends(user)):
        if u['role'] != 'admin':
            raise HTTPException(403, '仅管理员可操作')
        return u

    def error(status, msg):
        raise HTTPException(status, msg)

    @app.exception_handler(ValueError)
    async def value_error(request, e):
        return JSONResponse({'detail': str(e)}, 400)

    @app.exception_handler(s.Missing)
    async def missing(request, e):
        return JSONResponse({'detail': 'missing'}, 404)

    @app.exception_handler(s.Conflict)
    async def conflict(request, e):
        return JSONResponse({'detail': str(e)}, 409)

    b.register(app, user, admin, error)
    with TestClient(app, headers={'Authorization': 'admin'}) as c:
        yield c


def post(c, route, data):
    return c.post(b.PREFIX + route, json=data)


def setup(c, platform='douyin', provider='tikhub'):
    assert post(c, '/settings', {'provider': provider, 'api_key': 'secret-value', 'app_id': 'app', 'app_secret': 'app-secret'}).status_code == 200
    c.headers['Authorization'] = 'alice'
    r = post(c, '/accounts', {'platform': platform, 'provider': provider, 'account_key': 'acct', 'ghid': 'gh_test', 'title': '真实标识待校验'})
    assert r.status_code == 200, r.text
    return r.json()


def request(account, **kw):
    return dict(account_id=account['id'], limit=3, max_calls=3, confirmed=True,
                request_id='test-request-0001', **kw)


def video(id='123', account='acct', desc='发布文案', published=1704067200):
    return {'aweme_id': id, 'author': {'sec_uid': account}, 'desc': desc, 'create_time': published,
            'video': {'play_addr': {'url_list': ['https://example.test/never-download.mp4']}}}


def test_admin_encryption_no_key_leak_and_owner_boundaries(client):
    account = setup(client)
    encrypted = s.config(b.SETTINGS)['tikhub']
    assert 'secret-value' not in encrypted
    assert json.loads(g.cipher().decrypt(encrypted.encode()))['api_key'] == 'secret-value'
    assert 'secret-value' not in client.get(b.PREFIX + '/status').text
    assert client.get(b.PREFIX + '/settings').status_code == 403
    assert post(client, '/settings', {'provider': 'tikhub', 'api_key': 'stolen'}).status_code == 403
    client.headers['Authorization'] = 'bob'
    assert client.get(b.PREFIX + '/accounts').json()['items'] == []
    assert post(client, '/fetch', request(account)).status_code == 404
    assert client.get(b.PREFIX + '/items?account_id=' + account['id']).status_code == 404
    client.headers.clear()
    assert client.get(b.PREFIX + '/status').status_code == 401


def test_missing_credentials_and_confirmation_make_no_requests(client, monkeypatch):
    monkeypatch.setattr(b, 'tikhub', lambda *a, **k: pytest.fail('network must not be called'))
    account = post(client, '/accounts', {'platform': 'douyin', 'account_key': 'acct'}).json()
    r = post(client, '/fetch', request(account))
    assert r.status_code == 400 and '未配置' in r.text
    account = setup(client)
    data = request(account);data['confirmed'] = False
    assert post(client, '/fetch', data).status_code == 400
    for key, val in [('limit', 501), ('max_calls', 51), ('date_from', 'tomorrow')]:
        data = request(account);data[key] = val
        assert post(client, '/fetch', data).status_code == 400


def test_server_pagination_dedup_persistence_and_no_transcript(client, monkeypatch):
    account = setup(client)
    calls = []
    def supplier(path, params, method='GET'):
        calls.append((path, params))
        if len(calls) == 1:
            return {'aweme_list': [video('1'), video('1')], 'has_more': 1, 'max_cursor': 10}
        return {'aweme_list': [video('1'), video('2')], 'has_more': 0, 'max_cursor': 20}
    monkeypatch.setattr(b, 'tikhub', supplier)
    r = post(client, '/fetch', request(account))
    assert r.status_code == 200, r.text
    result = r.json()
    assert result['count'] == 2 and result['added'] == 2 and result['calls'] == 2
    assert calls[1][1]['max_cursor'] == '10'
    assert calls[0][0] == 'douyin/app/v3/fetch_user_post_videos'
    assert result['coverage'] == 'partial' and result['provider_list_exhausted']
    for item in result['items']:
        assert item['text_kind'] == 'published_caption'
        assert 'transcript' in item['missing'] and 'visual_analysis' in item['missing']
        assert 'never-download' not in json.dumps(item)
    s.init()  # Reopening DB keeps owner records.
    assert len(client.get(b.PREFIX + '/items').json()['items']) == 2
    assert post(client, '/fetch', request(account)).status_code == 409
    assert len(calls) == 2
    assert s.get('alice', account['id'])['last_fetch']['count'] == 2


def test_account_mismatch_rejects_whole_page_preserves_previous(client, monkeypatch):
    account = setup(client)
    pages = iter([{'aweme_list': [video('1')], 'has_more': 1, 'max_cursor': 1},
                  {'aweme_list': [video('2'), video('3', 'other')], 'has_more': 0}])
    monkeypatch.setattr(b, 'tikhub', lambda *a, **k: next(pages))
    result = post(client, '/fetch', request(account)).json()
    assert result['count'] == 1 and result['coverage'] == 'partial'
    assert '校验失败' in result['reason']
    assert len(s.list_('alice', 'benchmark_api_item')) == 1


def test_date_filter_unknown_dates_and_call_budget(client, monkeypatch):
    account = setup(client)
    calls = []
    def supplier(*args):
        calls.append(1)
        return {'aweme_list': [video('1', published=0), video('2', published='unknown'), video('3')], 'has_more': 1, 'max_cursor': 1}
    monkeypatch.setattr(b, 'tikhub', supplier)
    data = request(account, date_from='2024-01-01', date_to='2024-01-01');data['max_calls'] = 1
    result = post(client, '/fetch', data).json()
    assert result['count'] == 1 and result['items'][0]['external_id'] == '3'
    assert len(calls) == 1 and '预算' in result['reason']


@pytest.mark.parametrize('result', [
    {'aweme_list': [video()], 'has_more': 1, 'max_cursor': ''},
    {'aweme_list': [video()]},
    {'aweme_list': [], 'has_more': 1, 'max_cursor': 20},
    {'aweme_list': [{'aweme_id': '1', 'desc': '账号缺失'}], 'has_more': 0},
])
def test_missing_schema_never_claims_complete(client, monkeypatch, result):
    account = setup(client)
    monkeypatch.setattr(b, 'tikhub', lambda *a, **k: result)
    output = post(client, '/fetch', request(account)).json()
    assert output['count'] == 0 and output['coverage'] == 'partial'
    assert not output['provider_list_exhausted']


def test_transport_fixed_host_auth_no_redirects_and_sanitized_error(client, monkeypatch):
    setup(client)
    original = httpx.Client
    captured = []
    def handle(req):
        captured.append(req)
        assert req.url.host == 'api.tikhub.io'
        assert req.headers['authorization'] == 'Bearer secret-value'
        return httpx.Response(401, json={'detail': 'secret-value'})
    monkeypatch.setattr(b.httpx, 'Client', lambda **kw: original(transport=httpx.MockTransport(handle), **kw))
    with pytest.raises(ValueError, match='HTTP 401') as exc:
        b.tikhub('douyin/web/fetch_one_video', {'aweme_id': '123'})
    assert 'secret-value' not in str(exc.value) and len(captured) == 1


def test_channels_actual_post_contract_and_missing_transcript(client, monkeypatch):
    account = setup(client, 'channels')
    def supplier(path, params, method='GET'):
        assert path == 'wechat_channels/fetch_home_page' and method == 'POST'
        assert params == {'username': 'acct', 'last_buffer': ''}
        return {'data': {'object': [{'id': 'channel-item', 'contact': {'username': 'acct'},
            'objectDesc': {'description': '发布文字'}, 'createTime': 1704067200}], 'continueFlag': 0}}
    monkeypatch.setattr(b, 'tikhub', supplier)
    result = post(client, '/fetch', request(account)).json()
    assert result['count'] == 1 and result['items'][0]['body'] == '发布文字'
    assert result['items'][0]['url'] == ''


@pytest.mark.parametrize('provider', ['tikhub', 'cimidata'])
def test_wechat_real_endpoints_and_account_validation(client, monkeypatch, provider):
    account = setup(client, 'wechat', provider)
    item = {'title': '文章', 'url': 'https://mp.weixin.qq.com/s?__biz=acct&mid=123&idx=1',
            'content': '<p>取得的文字</p><script>never()</script>', 'published_at': '2024-01-01'}
    calls = []
    def supplier(path, params, *args):
        calls.append(path)
        if provider == 'cimidata':
            if path.endswith('/token'):
                return {'access_token': 'test-token'}
            assert path == '/api/v2/articles/history' and params['wxid'] == 'gh_test'
            return {'items': [item], 'last_id': None}
        assert path == 'wechat_mp/web/fetch_mp_article_list' and params['ghid'] == 'gh_test'
        return {'list': [item], 'has_more': 0}
    monkeypatch.setattr(b, 'tikhub', supplier)
    monkeypatch.setattr(b.wechat, 'request', supplier)
    result = post(client, '/fetch', request(account)).json()
    assert result['count'] == 1 and result['items'][0]['body'] == '取得的文字'
    assert result['items'][0]['text_kind'] == 'article_text'
    assert result['calls'] == 1


def test_link_resolution_checks_identity_and_invalid_url_no_network(client, monkeypatch):
    setup(client)
    seen = []
    def supplier(path, params):
        seen.append((path, params))
        return {'aweme_detail': video('123')}
    monkeypatch.setattr(b, 'tikhub', supplier)
    data = {'platform': 'douyin', 'url': 'https://www.douyin.com/video/123', 'confirmed': True,
            'max_calls': 1, 'request_id': 'resolve-test-123'}
    result = post(client, '/accounts', data)
    assert result.status_code == 200, result.text
    assert result.json()['identity_status'] == 'provider_verified'
    assert len(s.list_('alice', 'benchmark_api_item')) == 1
    assert seen[0][0] == 'douyin/web/fetch_one_video'
    for url in ['http://127.0.0.1/a', 'https://www.douyin.com.evil.test/a', 'https://user@www.douyin.com/video/1']:
        assert post(client, '/accounts', {**data, 'url': url}).status_code == 400
    assert len(seen) == 1
    assert post(client, '/accounts', {**data, 'request_id': 'resolve-mismatch-1', 'account_key': 'wrong'}).status_code == 400


def test_analysis_uses_actual_subset_and_sources_are_owner_scoped(client, monkeypatch):
    account = setup(client)
    item, _ = b.save_item('alice', account, b.normalize(video(), account))
    empty, _ = b.save_item('alice', account, b.normalize(video('empty', desc=''), account))
    captured = []
    monkeypatch.setattr(g, 'select', lambda *a, **k: 'text-model')
    monkeypatch.setattr(g, 'generate', lambda model, messages: captured.append(messages) or '测试模型输出')
    monkeypatch.setattr(capabilities, 'snapshot', lambda *a: {'text': '方法', 'metadata': {'hash': 'snapshot'}})
    result = post(client, '/analyze', {'item_ids': [item['id'], empty['id'], item['id']]}).json()
    assert result['sample_count'] == 1 and result['coverage'] == 'partial'
    assert result['text_counts'] == {'article_text': 0, 'published_caption': 1}
    assert result['transcript_count'] == 0
    sample = json.loads(captured[0][1]['content'].split('\n', 1)[1])[0]
    assert sample['published_caption'] == '发布文案'
    assert 'body' not in sample and 'transcript' not in sample and 'article_text' not in sample
    assert '发布文案' in captured[0][1]['content'] and '口播' in captured[0][0]['content']
    assert 'empty' not in captured[0][1]['content']
    assert post(client, '/analyze', {'item_ids': [empty['id']]}).status_code == 400
    source = post(client, '/items', {'item_id': item['id']}).json()
    assert 'transcript' in source['source']['body'] and source['source']['kind'] == 'source'
    assert post(client, '/items', {'item_id': item['id']}).json()['source_id'] == source['source_id']
    assert post(client, '/items', {'item_id': empty['id']}).status_code == 400
    client.headers['Authorization'] = 'bob'
    assert post(client, '/items', {'item_id': item['id']}).status_code == 404
    assert post(client, '/analyze', {'item_ids': [item['id']]}).status_code == 404


def test_skill_import_literal_text_draft_and_admin_only(client, monkeypatch):
    # Make defaults independent of upstream skill files; save() is exercised for real.
    monkeypatch.setattr(capabilities, 'defaults', lambda: [])
    body = '# 方法\n```python\nraise RuntimeError("must never run")\n```'
    r = client.post(b.PREFIX + '/skills/upload', files={'file': ('../../method.md', body.encode(), 'text/markdown')}, data={'purpose': 'benchmark'})
    assert r.status_code == 200, r.text
    assert r.json()['status'] == 'draft' and r.json()['body'] == body
    assert r.json()['title'] == 'method'
    assert s.config('system_capabilities')[0]['body'] == body
    for filename, content in [('code.py', b'print(1)'), ('bad.md', b'\xff'), ('empty.md', b''), ('binary.md', b'a\x00b'), ('big.md', b'a' * 240001)]:
        assert client.post(b.PREFIX + '/skills/upload', files={'file': (filename, content)}).status_code == 400
    client.headers['Authorization'] = 'alice'
    assert client.post(b.PREFIX + '/skills/upload', files={'file': ('skill.md', b'hello')}).status_code == 403


def test_uncertain_request_is_persisted_and_never_automatically_retried(client, monkeypatch):
    account = setup(client)
    calls = []
    def fail(*args):
        calls.append(1)
        raise ValueError('supplier echoed secret-value')
    monkeypatch.setattr(b, 'tikhub', fail)
    result = post(client, '/fetch', request(account))
    assert result.json()['error_code'] == 'provider_failed_or_uncertain'
    assert 'secret-value' not in result.text
    path = b.PREFIX + '/requests/test-request-0001'
    ledger = client.get(path).json()
    assert ledger['calls'] == 1 and ledger['status'] == 'failed_or_uncertain'
    assert post(client, '/fetch', request(account)).status_code == 409
    assert len(calls) == 1
    client.headers['Authorization'] = 'bob'
    assert client.get(path).status_code == 404


def test_busy_owner_cannot_start_second_paid_operation(client, monkeypatch):
    account = setup(client)
    monkeypatch.setattr(b, 'tikhub', lambda *a: pytest.fail('busy must not call supplier'))
    lock = b.owner_lock('alice')
    lock.acquire()
    try:
        assert post(client, '/fetch', request(account)).status_code == 409
        assert s.config('benchmark_api.request:alice:test-request-0001') is None
    finally:
        lock.release()


def test_newly_obtained_body_upgrades_catalogue_without_duplicate(client):
    account = setup(client)
    first, fresh = b.save_item('alice', account, b.normalize(video(desc=''), account))
    assert fresh and first['text_kind'] == 'catalogue_only'
    upgraded, fresh = b.save_item('alice', account, b.normalize(video(desc='真实取得的文案'), account))
    assert not fresh and upgraded['id'] == first['id'] and upgraded['body'] == '真实取得的文案'
    assert upgraded['version'] == first['version'] + 1
    assert len(s.list_('alice', 'benchmark_api_item')) == 1


def test_analysis_separates_obtained_article_from_caption_and_skips_unknown_types(client, monkeypatch):
    account = setup(client)
    caption, _ = b.save_item('alice', account, b.normalize(video('caption'), account))
    article = s.put('alice', 'benchmark_api_item', {'title': '真实文章', 'body': '取得的正文',
        'text_kind': 'article_text', 'published': '2024-01-01', 'missing': [], 'url': '', 'account_id': account['id']})
    unknown = s.put('alice', 'benchmark_api_item', {'title': '未知采集状态', 'body': '不可作为正文的字段',
        'text_kind': 'catalogue_only', 'published': '', 'missing': ['text']})
    captured = []
    monkeypatch.setattr(g, 'select', lambda *a, **k: 'text-model')
    monkeypatch.setattr(g, 'generate', lambda model, messages: captured.append(messages) or '测试分析')
    monkeypatch.setattr(capabilities, 'snapshot', lambda *a: {'text': '方法', 'metadata': {}})
    result = post(client, '/analyze', {'item_ids': [caption['id'], article['id'], unknown['id']]}).json()
    assert result['sample_count'] == 2 and result['transcript_count'] == 0
    assert result['text_counts'] == {'article_text': 1, 'published_caption': 1}
    samples = json.loads(captured[0][1]['content'].split('\n', 1)[1])
    assert samples[0]['published_caption'] == '发布文案' and 'article_text' not in samples[0]
    assert samples[1]['article_text'] == '取得的正文' and 'published_caption' not in samples[1]
    assert '不可作为正文的字段' not in captured[0][1]['content']
    assert post(client, '/analyze', {'item_ids': [unknown['id']]}).status_code == 400
