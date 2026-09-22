"""Offline integration contracts: no credentials or billable requests are used."""
import io
import json
import wave
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from PIL import Image

from backend import gateway as g, media_studio as m, store as s


class ImmediatePool:
    def submit(self, fn, *args):
        fn(*args)


@pytest.fixture
def studio(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'test.sqlite')
    monkeypatch.setattr(g, 'KEYFILE', tmp_path / 'provider.key')
    monkeypatch.setattr(m.jobs, 'POOL', ImmediatePool())
    monkeypatch.setattr(m.network, 'public_url', lambda url: url)
    s.init()
    app = FastAPI()

    def user(request: Request):
        owner = request.headers.get('authorization', '').removeprefix('Bearer ')
        if owner not in ('alice', 'bob', 'admin'):
            raise HTTPException(401, '登录')
        return {'id': owner, 'role': 'admin' if owner == 'admin' else 'user'}

    def admin(u=Depends(user)):
        if u['role'] != 'admin':
            raise HTTPException(403, '管理员')
        return u

    def error(status, text):
        raise HTTPException(status, text)

    m.register(app, user, admin, error)
    client = TestClient(app)
    client.headers['authorization'] = 'Bearer alice'
    yield client
    client.close()


def configure(client, provider='aliyun'):
    result = client.post('/api/studio/settings', headers={'authorization': 'Bearer admin'},
                         json={'provider': provider, 'api_key': 'test-secret-do-not-leak'})
    assert result.status_code == 200, result.text
    return m._service(provider)


def png():
    value = io.BytesIO()
    Image.new('RGB', (256, 256), 'green').save(value, format='PNG')
    return value.getvalue()


def asset(client, name='test.png'):
    result = client.post('/api/studio/upload', files={'file': (name, png(), 'image/png')})
    assert result.status_code == 200, result.text
    return result.json()


def draft(client, tool='text_image', inputs=None, options=None):
    result = client.post('/api/studio/drafts', json={'tool': tool, 'title': '测试作品', 'input': inputs or {'prompt': '电梯场景'}, 'options': options or {}})
    assert result.status_code == 200, result.text
    return result.json()


def submit(client, d, request_id='test-request'):
    return client.post('/api/studio/generate', json={'draft_id': d['id'], 'version': d['version'], 'confirmed': True, 'request_id': request_id})


def resource(kind, service, owner='alice'):
    return s.put(owner, 'studio_asset', {'title': '资源', 'asset_type': kind, 'status': 'ready', 'provider': 'hifly',
                 'provider_resource_id': kind + '-provider-id', 'compat': m.COMPAT[kind], 'service_scope': m._scope('hifly', service)})


def test_registration_and_admin_secret_encryption(studio):
    assert studio.get('/api/studio/catalog', headers={'authorization': ''}).status_code == 401
    assert studio.get('/api/studio/settings').status_code == 403
    assert studio.post('/api/studio/settings', json={'provider': 'hifly', 'api_key': 'key'}).status_code == 403
    configure(studio)
    saved = s.config(m.CONFIG)['aliyun']
    assert 'test-secret' not in saved['secret']
    assert g.cipher().decrypt(saved['secret'].encode()).decode() == 'test-secret-do-not-leak'
    public = studio.get('/api/studio/catalog').text
    assert 'test-secret' not in public and 'secret' not in public
    before = saved['secret']
    studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'}, json={'provider': 'aliyun', 'api_key': '', 'enabled': False})
    assert s.config(m.CONFIG)['aliyun']['secret'] == before
    assert not next(t for t in studio.get('/api/studio/catalog').json()['tools'] if t['id'] == 'text_image')['configured']


@pytest.mark.parametrize('base', ['http://hfw-api.hifly.cc', 'https://127.0.0.1', 'https://hfw-api.hifly.cc.evil.com', 'https://hfw-api.hifly.cc/path', 'https://user:pass@hfw-api.hifly.cc', 'https://hfw-api.hifly.cc?api_key=leak'])
def test_credentials_only_sent_to_official_roots(studio, base):
    assert studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'}, json={'provider': 'hifly', 'api_key': 'key', 'base_url': base}).status_code == 400
    assert s.config(m.CONFIG) is None


def test_draft_version_and_reference_ownership(studio):
    d = draft(studio)
    url = '/api/studio/drafts/' + d['id']
    assert studio.patch(url, json={'title': '缺版本'}).status_code == 400
    assert studio.patch(url, json={'version': 1, 'title': '新版'}).json()['version'] == 2
    assert studio.patch(url, json={'version': 1, 'title': '过期'}).status_code == 409
    assert len(s.versions('alice', d['id'])) == 1
    assert studio.patch(url, headers={'authorization': 'Bearer bob'}, json={'version': 2, 'title': '越权'}).status_code == 404
    brand = s.put('bob', 'studio_brand', {'title': '他人品牌'})
    for field, value in [('brand_id', brand['id']), ('profile_id', brand['id']), ('source_ids', [brand['id']])]:
        assert studio.post('/api/studio/drafts', json={'tool': 'text_image', 'input': {}, field: value}).status_code == 404
    assert studio.post('/api/studio/drafts', json={'tool': 'text_image', 'input': {}, 'owner': 'bob'}).status_code == 400


def test_local_upload_owner_and_path_boundary(studio):
    a = asset(studio, '../../outside.png')
    assert a['title'] == 'outside.png' and a['provider'] == 'local'
    assert 'local_file' not in a and 'image_video' in a['compat']
    assert studio.get(a['file_url']).content == png()
    assert studio.get(a['file_url'], headers={'authorization': 'Bearer bob'}).status_code == 404
    assert studio.get('/api/studio/assets', headers={'authorization': 'Bearer bob'}).json()['items'] == []
    assert studio.post('/api/studio/drafts', headers={'authorization': 'Bearer bob'}, json={'tool': 'image_edit', 'input': {'image_id': a['id']}}).status_code == 404
    with pytest.raises(m.StudioError):
        m._path('alice', '../provider.key')
    bad = studio.post('/api/studio/upload', files={'file': ('fake.png', b'<html>not image</html>', 'image/png')})
    assert bad.status_code == 400
    assert len(s.list_('alice', 'studio_asset')) == 1


def test_upload_size_and_cloud_confirmation(studio, monkeypatch):
    monkeypatch.setattr(m, 'MAX_FILE', 10)
    assert studio.post('/api/studio/upload', files={'file': ('big.png', png(), 'image/png')}).status_code == 400
    assert studio.post('/api/studio/upload?provider=hifly', files={'file': ('test.png', png(), 'image/png')}).status_code == 400
    assert not s.list_('alice', 'studio_asset')


def test_no_configuration_or_confirmation_is_never_success(studio):
    d = draft(studio)
    assert submit(studio, d).status_code == 400
    for confirmed in [False, 'true', 1, None]:
        assert studio.post('/api/studio/generate', json={'draft_id': d['id'], 'version': 1, 'confirmed': confirmed, 'request_id': 'x'}).status_code == 400
    assert s.list_('alice', 'studio_run') == []


def test_real_image_adapter_archive_and_idempotency(studio, monkeypatch):
    configure(studio)
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        assert kwargs['headers']['Authorization'] == 'Bearer test-secret-do-not-leak'
        assert kwargs['payload']['model'] == 'qwen-image-2.0-pro'
        assert kwargs['payload']['input']['messages'][0]['content'] == [{'text': '电梯场景'}]
        return {'request_id': 'provider-request', 'output': {'choices': [{'message': {'content': [{'image': 'https://cdn.example/result.png?token=private'}]}}]}}

    monkeypatch.setattr(m, '_request', request)
    downloads = []

    def download(owner, id, url, kind):
        downloads.append(url)
        path = m._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, m._metadata(path, '.png')

    monkeypatch.setattr(m, '_download', download)
    d = draft(studio)
    run = submit(studio, d).json()
    assert run['status'] == 'succeeded' and len(run['asset_ids']) == 1
    assert 'result' not in run and 'snapshot' not in run
    assert submit(studio, d).json()['id'] == run['id']
    studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert len(calls) == len(downloads) == 1
    a = studio.get('/api/studio/assets').json()['items'][0]
    assert a['draft_version'] == 1 and studio.get(a['file_url']).content == png()
    assert 'private' not in studio.get('/api/studio/runs').text
    assert submit(studio, {**d, 'version': 2}).status_code == 409


def test_timeout_is_unknown_no_resubmit_on_new_request_or_refresh(studio, monkeypatch):
    configure(studio)
    calls = []

    def timeout(*args, **kwargs):
        calls.append(args)
        raise httpx.ReadTimeout('https://secret.example/?key=must-not-leak')

    monkeypatch.setattr(m, '_request', timeout)
    d = draft(studio, 'text_video')
    run = submit(studio, d).json()
    assert run['status'] == 'unknown'
    assert 'must-not-leak' not in json.dumps(run)
    assert submit(studio, d, 'another-click').json()['id'] == run['id']
    for _ in range(2):
        studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert len(calls) == 1
    assert studio.get('/api/studio/runs').json()['items'][0]['status'] == 'unknown'


def test_archive_failure_retries_download_only(studio, monkeypatch):
    configure(studio)
    calls = []

    def request(method, url, **kwargs):
        calls.append(method)
        if method == 'POST':
            return {'output': {'task_id': 'persistent-task-id'}}
        return {'output': {'task_status': 'SUCCEEDED', 'video_url': 'https://cdn.example/out.mp4'}}

    monkeypatch.setattr(m, '_request', request)
    monkeypatch.setattr(m, '_download', lambda *a: (_ for _ in ()).throw(m.StudioError('下载失败')))
    d = draft(studio, 'text_video')
    run = submit(studio, d).json()
    assert run['task_id'] == 'persistent-task-id' and run['status'] == 'running'
    url = '/api/studio/runs/' + run['id'] + '/refresh'
    assert studio.post(url).json()['status'] == 'archive_failed'
    assert studio.post(url).json()['status'] == 'archive_failed'
    assert calls == ['POST', 'GET']
    assert studio.post(url, headers={'authorization': 'Bearer bob'}).status_code == 404
    assert studio.get('/api/studio/runs', headers={'authorization': 'Bearer bob'}).json()['items'] == []


def test_concurrent_request_claim_is_single_and_version_snapshot(studio, monkeypatch):
    configure(studio)
    queue = []
    monkeypatch.setattr(m.jobs, 'POOL', SimpleNamespace(submit=lambda *args: queue.append(args)))
    d = draft(studio, 'text_video')
    body = {'draft_id': d['id'], 'version': 1, 'confirmed': True, 'request_id': 'concurrent'}
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: m.generate('alice', body), range(8)))
    assert len({r['id'] for r in results}) == len(queue) == 1
    assert len(s.list_('alice', 'studio_run')) == 1
    studio.patch('/api/studio/drafts/' + d['id'], json={'version': 1, 'input': {'prompt': 'new'}})
    run = s.get('alice', results[0]['id'])
    assert run['snapshot']['input']['prompt'] == '电梯场景'
    assert m.generate('alice', body)['id'] == run['id']


def test_hifly_public_library_never_imports_private_resources(studio, monkeypatch):
    configure(studio, 'hifly')

    def request(method, url, **kwargs):
        assert 'kind=2' in url
        return {'code': 0, 'data': [{'voice': 'public', 'type': 10, 'title': '公版'}, {'voice': 'another-customer', 'type': 8, 'title': '秘密'}]}

    monkeypatch.setattr(m, '_request', request)
    result = studio.get('/api/studio/assets?asset_type=voice&refresh=true').json()
    assert len(result['items']) == 1 and result['items'][0]['title'] == '公版'
    assert 'provider_resource_id' not in result['items'][0]
    assert studio.get('/api/studio/assets', headers={'authorization': 'Bearer bob'}).json()['items'] == []


@pytest.mark.parametrize('tool,expected', [('text_avatar', '/video/create_by_tts'), ('audio_avatar', '/video/create_by_audio'), ('photo_talk', '/video/create_by_image'), ('avatar_create', '/avatar/create_by_image'), ('voice_create', '/voice/create'), ('tts', '/audio/create_by_tts')])
def test_hifly_documented_payloads_and_separate_resource_types(studio, monkeypatch, tool, expected):
    service = configure(studio, 'hifly')
    voice, avatar = resource('voice', service), resource('avatar', service)
    picture = asset(studio)
    audio_path = m._path('alice', s.uid() + '.wav')
    audio_path.write_bytes(b'RIFF' + b'\0' * 4 + b'WAVE' + b'\0' * 20)
    audio = s.put('alice', 'studio_asset', {'title': '录音', 'asset_type': 'audio', 'status': 'ready', 'provider': 'local', 'compat': m.COMPAT['audio'], 'local_file': audio_path.name, 'size': 32, 'duration': 8})
    values = {'text': '用户手稿', 'voice_id': voice['id'], 'avatar_id': avatar['id'], 'image_id': picture['id'], 'audio_id': audio['id']}
    keys = ['image_id'] if tool == 'avatar_create' else m.TOOLS[tool][3]
    inputs = {k: values[k] for k in keys}
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if url.endswith('/tool/create_upload_url'):
            return {'upload_url': 'https://upload.example/file', 'content_type': 'application/octet-stream', 'file_id': 'uploaded-file'}
        if method == 'PUT':
            assert 'Authorization' not in kwargs.get('headers', {})
            return {}
        assert url.endswith(expected)
        p = kwargs['payload']
        if tool == 'audio_avatar':
            assert p['file_id'] == 'uploaded-file' and p['avatar'] == 'avatar-provider-id'
            assert 'text' not in p and 'voice' not in p
        if tool == 'photo_talk':
            assert p['image_file_id'] == 'uploaded-file' and 'title' not in p
        if tool == 'voice_create':
            assert p['voice_type'] == 8 and p['file_id'] == 'uploaded-file'
        return {'code': 0, 'task_id': 'vendor-task'}

    monkeypatch.setattr(m, '_request', request)
    run = submit(studio, draft(studio, tool, inputs)).json()
    assert run['status'] == 'running' and run['task_id'] == 'vendor-task'
    assert not any('/voice/edit' in c[1] for c in calls)


def test_resource_compat_and_settings_account_change(studio):
    service = configure(studio, 'hifly')
    voice = resource('voice', service)
    assert studio.post('/api/studio/drafts', json={'tool': 'audio_avatar', 'input': {'avatar_id': voice['id']}}).status_code == 400
    studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'}, json={'provider': 'hifly', 'api_key': 'different-account'})
    assert studio.post('/api/studio/drafts', json={'tool': 'tts', 'input': {'voice_id': voice['id']}}).status_code == 400


def test_aliyun_image_edit_and_i2v_payload(studio, monkeypatch):
    service = configure(studio)
    picture = asset(studio)
    for tool in ('image_edit', 'image_video'):
        d = draft(studio, tool, {'prompt': '保持产品结构', 'image_id': picture['id']})
        path, payload, asynchronous = m._build('alice', d, service)
        if tool == 'image_edit':
            assert path.endswith('/multimodal-generation/generation') and not asynchronous
            assert payload['input']['messages'][0]['content'][0]['image'].startswith('data:image/png;base64,')
        else:
            assert path.endswith('/video-generation/video-synthesis') and asynchronous
            assert payload['model'] == 'wan2.2-i2v-flash' and payload['input']['img_url'].startswith('data:image/png;base64,')
    assert studio.post('/api/studio/drafts', json={'tool': 'image_video', 'input': {}, 'options': {'duration': 15}}).status_code == 400


def test_shotstack_upload_pending_resume_composition(studio, monkeypatch):
    configure(studio, 'shotstack')
    picture = asset(studio)
    calls = []
    polls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if url.endswith('/ingest/stage/upload'):
            return {'data': {'id': 'source-id', 'attributes': {'url': 'https://upload.example/signed'}}}
        if method == 'PUT':
            assert not kwargs.get('headers')
            return {}
        if '/sources/' in url:
            polls.append(url)
            return {'data': {'attributes': {'status': 'processing' if len(polls) == 1 else 'ready', 'source': 'https://cdn.example/source.png'}}}
        assert url.endswith('/edit/stage/render')
        payload = kwargs['payload']
        assert payload['timeline']['tracks'][0]['clips'][0]['asset']['text'] == '电梯安全'
        assert payload['timeline']['tracks'][1]['clips'][0]['asset']['src'] == 'https://cdn.example/source.png'
        assert payload['output']['format'] == 'mp4'
        return {'success': True, 'response': {'id': 'render-id'}}

    monkeypatch.setattr(m, '_request', request)
    run = submit(studio, draft(studio, 'compose', {'scenes': [{'asset_id': picture['id'], 'length': 5, 'caption': '电梯安全'}]})).json()
    assert run['status'] == 'preparing' and run['task_id'] is None
    run = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert run['status'] == 'running' and run['task_id'] == 'render-id'
    assert sum(c[1].endswith('/upload') for c in calls) == 1
    assert sum(c[1].endswith('/render') for c in calls) == 1


def test_pinned_transport_no_redirect_credentials_or_environment_proxy(studio, monkeypatch):
    actual_client = httpx.Client
    seen = []

    def target(url):
        assert url == 'https://hfw-api.hifly.cc/endpoint'
        return httpx.URL('https://93.184.216.34/endpoint'), {'Host': 'hfw-api.hifly.cc'}, {'sni_hostname': 'hfw-api.hifly.cc'}

    def handler(request):
        seen.append(request)
        return httpx.Response(302, headers={'location': 'http://127.0.0.1/private'})

    def client(**kwargs):
        assert kwargs['trust_env'] is False and kwargs['follow_redirects'] is False
        return actual_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(m.network, 'public_target', target)
    monkeypatch.setattr(m.httpx, 'Client', client)
    with pytest.raises(m.StudioError):
        m._request('POST', 'https://hfw-api.hifly.cc/endpoint', headers={'Authorization': 'Bearer secret'})
    assert len(seen) == 1 and seen[0].url.host == '93.184.216.34'
    assert seen[0].headers['Host'] == seen[0].extensions['sni_hostname'] == 'hfw-api.hifly.cc'


def test_download_redirect_revalidates_private_targets(studio, monkeypatch):
    actual_client = httpx.Client
    targets = []

    def target(url):
        targets.append(url)
        if '127.0.0.1' in url:
            raise ValueError('blocked')
        return httpx.URL(url), {}, {}

    def handler(request):
        assert 'authorization' not in request.headers
        return httpx.Response(302, headers={'location': 'https://127.0.0.1/secret'})

    monkeypatch.setattr(m.network, 'public_target', target)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kwargs: actual_client(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ValueError):
        m._download('alice', s.uid(), 'https://cdn.example/image.png', 'image')
    assert targets == ['https://cdn.example/image.png', 'https://127.0.0.1/secret']


def test_download_real_bytes_saved_and_validated(studio, monkeypatch):
    actual_client = httpx.Client
    monkeypatch.setattr(m.network, 'public_target', lambda url: (httpx.URL(url), {}, {}))
    monkeypatch.setattr(m.httpx, 'Client', lambda **kwargs: actual_client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=png())), **kwargs))
    name, info = m._download('alice', s.uid(), 'https://cdn.example/image', 'image')
    assert m._path('alice', name).read_bytes() == png()
    assert info['width'] == info['height'] == 256


def test_reference_types_and_profile_brand_relation(studio):
    brand = s.put('alice', 'studio_brand', {'title': '品牌甲'})
    other = s.put('alice', 'studio_brand', {'title': '品牌乙'})
    profile = s.put('alice', 'profile', {'title': 'IP甲', 'brand_id': brand['id']})
    source = s.put('alice', 'source', {'title': '原文'})
    body = {'tool': 'text_image', 'input': {}, 'brand_id': brand['id'], 'profile_id': profile['id'], 'source_ids': [source['id']]}
    assert studio.post('/api/studio/drafts', json=body).status_code == 200
    assert studio.post('/api/studio/drafts', json={**body, 'brand_id': other['id']}).status_code == 400
    assert studio.post('/api/studio/drafts', json={**body, 'brand_id': source['id']}).status_code == 404
    assert studio.post('/api/studio/drafts', json={**body, 'profile_id': brand['id']}).status_code == 404
    assert studio.post('/api/studio/drafts', json={**body, 'source_ids': [profile['id']]}).status_code == 400
    foreign = s.put('bob', 'studio_brand', {'title': '私有品牌'})
    unsafe = s.put('alice', 'profile', {'title': '伪造关联', 'brand_id': foreign['id']})
    assert studio.post('/api/studio/drafts', json={'tool': 'text_image', 'profile_id': unsafe['id']}).status_code == 404


@pytest.mark.parametrize('tool,kind,key', [('avatar_create', 'video', 'video_id'), ('voice_create', 'audio', 'audio_id'), ('audio_avatar', 'audio', 'audio_id')])
def test_missing_duration_keeps_draft_but_never_submits_billable_task(studio, monkeypatch, tool, kind, key):
    service = configure(studio, 'hifly')
    path = m._path('alice', s.uid() + ('.mp4' if kind == 'video' else '.wav'))
    path.write_bytes(b'fixture')
    a = s.put('alice', 'studio_asset', {'title': '未校验时长', 'asset_type': kind, 'status': 'ready', 'compat': m.COMPAT[kind], 'local_file': path.name, 'size': 7})
    inputs = {key: a['id']}
    if tool == 'audio_avatar':
        inputs['avatar_id'] = resource('avatar', service)['id']
    d = draft(studio, tool, inputs)
    monkeypatch.setattr(m, '_request', lambda *a, **kw: pytest.fail('should not reach a provider'))
    result = submit(studio, d)
    assert result.status_code == 400 and '时长尚未验证' in result.json()['detail']
    assert path.is_file() and len(s.list_('alice', 'studio_draft')) == 1
    assert not s.list_('alice', 'studio_run')


def test_recover_preserves_tasks_results_and_blocks_unknown_submissions(studio, monkeypatch):
    configure(studio)
    queue = []
    monkeypatch.setattr(m.jobs, 'POOL', SimpleNamespace(submit=lambda *args: queue.append(args)))
    records = []
    states = [('submitting', None, None, 'unknown'), ('queued', None, None, 'interrupted'),
              ('preparing', None, None, 'interrupted'), ('running', 'task-saved', None, 'running'),
              ('running', 'task-result', {'asset_type': 'video', 'urls': ['https://cdn.example/out.mp4']}, 'archive_failed')]
    for index, (status, task, result, expected) in enumerate(states):
        d = draft(studio, 'text_video')
        run = submit(studio, d, 'recover-' + str(index)).json()
        m._update('alice', run['id'], status=status, task_id=task, result=result, busy_until=9999999999)
        records.append((run['id'], expected))
    queued_before = len(queue)
    assert m.recover() == len(states)
    assert len(queue) == queued_before
    for id, expected in records:
        run = s.get('alice', id)
        assert run['status'] == expected and run['busy_until'] == 0
    monkeypatch.setattr(m, '_request', lambda *a, **kw: pytest.fail('must never resubmit unknown task'))
    m._work('alice', records[0][0])
    assert s.get('alice', records[0][0])['status'] == 'unknown'
    assert s.get('alice', records[3][0])['task_id'] == 'task-saved'


def test_hifly_clone_result_becomes_owner_scoped_asset(studio, monkeypatch):
    configure(studio, 'hifly')
    picture = asset(studio)

    def request(method, url, **kwargs):
        if url.endswith('/tool/create_upload_url'):
            return {'upload_url': 'https://upload.example/file', 'content_type': 'image/png', 'file_id': 'file-id'}
        if method == 'PUT':
            return {}
        if method == 'POST':
            return {'code': 0, 'task_id': 'clone-task'}
        assert '/avatar/task?task_id=clone-task' in url
        return {'code': 0, 'status': 3, 'avatar': 'private-created-avatar'}

    monkeypatch.setattr(m, '_request', request)
    run = submit(studio, draft(studio, 'avatar_create', {'image_id': picture['id']})).json()
    run = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert run['status'] == 'succeeded'
    created = s.get('alice', run['asset_ids'][0])
    assert created['provider_resource_id'] == 'private-created-avatar'
    assert studio.get('/api/studio/assets?asset_type=avatar', headers={'authorization': 'Bearer bob'}).json()['items'] == []
    assert 'private-created-avatar' not in studio.get('/api/studio/assets?asset_type=avatar').text


def test_same_api_key_preserves_resource_scope(studio):
    service = configure(studio, 'hifly')
    first = m._scope('hifly', service)
    again = configure(studio, 'hifly')
    assert first == m._scope('hifly', again)


def test_hifly_remote_upload_failure_preserves_local_asset(studio, monkeypatch):
    configure(studio, 'hifly')
    monkeypatch.setattr(m, '_request', lambda *a, **kw: (_ for _ in ()).throw(httpx.ReadTimeout('secret-url')))
    result = studio.post('/api/studio/upload?provider=hifly&confirmed=true', files={'file': ('test.png', png(), 'image/png')})
    assert result.status_code == 200
    assert result.json()['upload_status'] == 'failed' and 'secret-url' not in result.text
    assert studio.get(result.json()['file_url']).content == png()


def test_ffprobe_resolution_priority_is_environment_repo_then_path(studio, tmp_path, monkeypatch):
    root = tmp_path / 'project'
    local = root / '.runtime' / 'media-tools' / 'ffprobe.exe'
    local.parent.mkdir(parents=True)
    local.write_bytes(b'fixture')
    packaged = tmp_path / 'packaged-probe.exe'
    packaged.write_bytes(b'fixture')
    path_probe = tmp_path / 'path-probe.exe'
    path_probe.write_bytes(b'fixture')
    monkeypatch.setattr(s, 'ROOT', root)
    monkeypatch.setattr(m.shutil, 'which', lambda name: str(path_probe))
    monkeypatch.setenv('TIJIAN_FFPROBE', str(packaged))
    assert m._ffprobe() == str(packaged.resolve())
    monkeypatch.setenv('TIJIAN_FFPROBE', str(tmp_path / 'missing.exe'))
    assert m._ffprobe() == str(local.resolve())
    monkeypatch.setattr(s, 'ROOT', tmp_path / 'different-project-root')
    assert m._ffprobe() == str(path_probe.resolve())
    monkeypatch.setattr(m.shutil, 'which', lambda name: None)
    assert m._ffprobe() is None


def test_avatar_video_rejects_unverified_codec_before_upload(studio, monkeypatch):
    configure(studio, 'hifly')
    path = m._path('alice', s.uid() + '.mp4')
    path.write_bytes(b'fixture')
    a = s.put('alice', 'studio_asset', {'title': '编码待校验', 'asset_type': 'video', 'status': 'ready', 'compat': m.COMPAT['video'], 'local_file': path.name, 'duration': 8, 'size': 7})
    d = draft(studio, 'avatar_create', {'video_id': a['id']})
    monkeypatch.setattr(m, '_request', lambda *a, **kw: pytest.fail('invalid media must not be uploaded'))
    result = submit(studio, d)
    assert result.status_code == 400 and 'H.264' in result.json()['detail']


def test_real_ffprobe_reads_uploaded_audio_duration_when_installed(studio):
    if not m._ffprobe():
        pytest.skip('ffprobe is not installed; missing-duration rejection is tested separately')
    content = io.BytesIO()
    with wave.open(content, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b'\0\0' * 16000 * 6)
    result = studio.post('/api/studio/upload', files={'file': ('six-seconds.wav', content.getvalue(), 'audio/wav')})
    assert result.status_code == 200, result.text
    assert result.json()['duration'] == pytest.approx(6, abs=.01)
    assert result.json()['asset_type'] == 'audio'
