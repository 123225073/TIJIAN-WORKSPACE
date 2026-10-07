"""Hifly v2 contracts against isolated SQLite and HTTP MockTransport only."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event, current_thread
from types import SimpleNamespace

import httpx
import pytest

from backend import media_registry, media_studio as m, store as s
from test_media_studio import asset, configure, draft, png, resource, studio, submit


@pytest.fixture
def provider_http(studio, monkeypatch):
    """Intercept the real HTTP adapter; no DNS, provider keys or live HTTP."""
    calls = []
    behavior = {}
    tasks = {}

    def handle(request):
        body = json.loads(request.content) if request.method == 'POST' else None
        calls.append((request.method, str(request.url), body, dict(request.headers), current_thread().name))
        if behavior.get('handler'):
            response = behavior['handler'](request, body)
            if response is not None:
                return response
        path = request.url.path
        if path.endswith('/tool/create_upload_url'):
            return httpx.Response(200, json={'file_id': 'file-' + body['file_extension'],
                'upload_url': 'https://mock-upload.example/file?Signature=private-signature',
                'content_type': 'application/octet-stream'})
        if request.method == 'PUT':
            assert 'authorization' not in request.headers
            return httpx.Response(204)
        if request.method == 'POST':
            task = 'mock-task-' + str(len(tasks))
            tasks[task] = path
            return httpx.Response(200, json={'code': 0, 'task_id': task})
        if path.endswith('/list'):
            kind = 'avatar' if '/avatar/' in path else 'voice'
            assert request.url.params['kind'] == '2'
            return httpx.Response(200, json={'code': 0, 'data': [
                {kind: 'public-id', 'kind': 2, 'type': 10, 'title': '公版资源'},
                {kind: 'private-account-resource', 'kind': 1, 'type': 8, 'title': '不应导入的账号私有资源'}]})
        if '/avatar/task' in path:
            result = {'avatar': 'created-avatar-private-id'}
        elif '/voice/task' in path:
            result = {'voice': 'created-voice-private-id'}
        else:
            result = {'video_Url': 'https://mock-result.example/output.mp4?Signature=private-result-signature'}
        return httpx.Response(200, json={'code': 0, 'status': 3, **result})

    real_client = httpx.Client
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kwargs: real_client(transport=transport, **kwargs))
    monkeypatch.setattr(m.network, 'public_target', lambda url: (httpx.URL(url), {}, {}))

    def download(owner, id, url, kind):
        assert url.endswith('?Signature=private-result-signature')
        path = m._path(owner, id + ('.wav' if kind == 'audio' else '.mp4'))
        path.write_bytes(b'offline-archive-fixture')
        return path.name, {'asset_type': kind, 'size': path.stat().st_size, 'duration': 8}

    monkeypatch.setattr(m, '_download', download)
    return calls, behavior


def local_media(kind):
    path = m._path('alice', s.uid() + ('.wav' if kind == 'audio' else '.mp4'))
    path.write_bytes(b'isolated-media-fixture')
    return s.put('alice', 'studio_asset', {'title': '本地测试素材', 'asset_type': kind,
        'status': 'ready', 'provider': 'local', 'local_file': path.name, 'compat': m.COMPAT[kind],
        'duration': 8, 'size': path.stat().st_size, 'width': 1280, 'height': 720, 'video_codec': 'h264'})


def hifly_draft(studio, tool='avatar_create', video=False):
    service = configure(studio, 'hifly')
    if tool == 'avatar_create':
        inputs = {'video_id': local_media('video')['id']} if video else {'image_id': asset(studio)['id']}
    elif tool == 'photo_talk':
        inputs = {'image_id': asset(studio)['id'], 'text': '图片驱动测试', 'voice_id': resource('voice', service)['id']}
    elif tool in ('text_avatar', 'tts'):
        inputs = {'text': '文稿测试'}
        if video:
            inputs['video_id'] = local_media('video')['id']
        else:
            inputs['voice_id'] = resource('voice', service)['id']
            if tool == 'text_avatar':
                inputs['avatar_id'] = resource('avatar', service)['id']
    else:
        inputs = {'audio_id': local_media('audio')['id']}
        if tool == 'audio_avatar':
            inputs['video_id' if video else 'avatar_id'] = local_media('video')['id'] if video else resource('avatar', service)['id']
    options = {'model': 2} if tool == 'avatar_create' and not video else {'model': 5} if tool == 'photo_talk' else {}
    return draft(studio, tool, inputs, options)


def wait_status(studio, id, states):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        value = next(x for x in studio.get('/api/studio/runs').json()['items'] if x['id'] == id)
        if value['status'] in states and not s.get('alice', id).get('busy_until'):
            return value
        time.sleep(.01)
    pytest.fail('background did not reach expected state: ' + str(value))


def test_hifly_catalogue_and_reversible_legacy_shelving(studio, provider_http):
    configure(studio, 'hifly')
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'synthetic-legacy-key'})
    before = s.config(media_registry.PROVIDER_KEY)
    s.set_config('bindings', {'audio_avatar': 'media:wavespeed-infinitetalk'})
    history = s.put('alice', 'studio_run', {'status': 'succeeded', 'provider': 'wavespeed', 'model_id': 'media:wavespeed-infinitetalk'})
    catalog = {x['id']: x for x in studio.get('/api/studio/catalog').json()['tools']}
    for tool in media_registry.DIGITAL_TOOLS | {'tts', 'voice_create'}:
        assert catalog[tool]['binding'] == 'service:hifly'
        assert [x['id'] for x in catalog[tool]['models']] == ['service:hifly']
        assert catalog[tool]['async'] is True and catalog[tool]['api_version'] == 'v2'
    assert catalog['audio_avatar']['legacy_binding'] == 'media:wavespeed-infinitetalk'
    assert catalog['audio_avatar']['require_any'] == ['avatar_id', 'video_id']
    create = catalog['avatar_create']
    assert create['require_any'] == create['optional'] == ['image_id', 'video_id']
    assert create['exclusive_inputs'] is True
    assert create['creation_modes'][0]['default_options'] == {'model': 2}
    assert create['creation_modes'][1]['options'] == {}
    assert create['creation_modes'][1]['video_codec'] == 'h264'
    assert catalog['photo_talk']['required'] == ['text', 'image_id', 'voice_id']
    assert catalog['photo_talk']['options']['model'] == [5, 6]
    assert s.config(media_registry.PROVIDER_KEY) == before
    assert s.get('alice', history['id']) == history
    assert s.config('bindings')['audio_avatar'] == 'media:wavespeed-infinitetalk'
    legacy = next(x for x in media_registry.models() if x['id'] == 'wavespeed-infinitetalk')
    assert legacy['published'] is False
    media_registry.save_model({'id': legacy['id'], 'published': True})
    assert next(x for x in media_registry.models() if x['id'] == legacy['id'])['published'] is True
    assert media_registry.choices('audio_avatar') == []
    with pytest.raises(m.StudioError, match='飞影官方'):
        m.validate_binding('audio_avatar', 'media:wavespeed-infinitetalk')
    old_draft = s.put('alice', 'studio_draft', {'tool': 'audio_avatar', 'title': '旧模型草稿',
        'model_id': 'media:wavespeed-infinitetalk', 'input': {'image_id': 'old-picture'}, 'options': {}})
    assert submit(studio, old_draft, 'legacy-must-confirm-migration').status_code == 400
    assert s.get('alice', old_draft['id']) == old_draft
    assert provider_http[0] == []


@pytest.mark.parametrize('tool,video,endpoint', [
    ('avatar_create', False, 'avatar/create_by_image'), ('avatar_create', True, 'avatar/create_by_video'),
    ('text_avatar', False, 'video/create_by_tts'), ('text_avatar', True, 'video/create_by_tts'),
    ('audio_avatar', False, 'video/create_by_audio'), ('audio_avatar', True, 'video/create_by_audio'),
    ('photo_talk', False, 'video/create_by_image'), ('voice_create', False, 'voice/create'),
    ('tts', False, 'audio/create_by_tts')])
def test_v2_payload_task_queries_and_scoped_archiving(studio, provider_http, tool, video, endpoint):
    calls, _ = provider_http
    item = hifly_draft(studio, tool, video)
    run = submit(studio, item).json()
    assert run['status'] == 'running'
    paid = [c for c in calls if c[0] == 'POST' and c[1].endswith('/' + endpoint)]
    assert len(paid) == 1
    payload = paid[0][2]
    if tool in ('text_avatar', 'audio_avatar'):
        if video:
            assert payload['video_file_id'] == 'file-mp4'
            assert 'avatar' not in payload and 'voice' not in payload
        else:
            assert payload['avatar'] == 'avatar-provider-id'
    if tool == 'photo_talk':
        assert payload == {'image_file_id': 'file-png', 'voice': 'voice-provider-id', 'text': '图片驱动测试', 'model': 5}
    if tool == 'avatar_create':
        assert payload['file_id'] == ('file-mp4' if video else 'file-png')
        assert ('model' in payload) is not video
    if tool == 'voice_create':
        assert payload['voice_type'] == 8
    assert submit(studio, item).json()['id'] == run['id']
    assert submit(studio, item, 'duplicate-click-new-request').json()['id'] == run['id']
    assert len([c for c in calls if c[0] == 'POST' and c[1].endswith('/' + endpoint)]) == 1
    finished = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert finished['status'] == 'succeeded'
    task_type = 'avatar' if tool == 'avatar_create' else 'voice' if tool == 'voice_create' else 'video'
    assert calls[-1][0] == 'GET' and '/api/v2/hifly/' + task_type + '/task?task_id=' in calls[-1][1]
    public = studio.get('/api/studio/assets').text + studio.get('/api/studio/runs').text
    for hidden in ('private-signature', 'private-result-signature', 'provider_resource_id', 'service_scope', 'local_file', 'test-secret', 'created-avatar-private-id', 'created-voice-private-id'):
        assert hidden not in public
    assert studio.get('/api/studio/assets', headers={'authorization': 'Bearer bob'}).json()['items'] == []
    assert studio.post('/api/studio/runs/' + run['id'] + '/refresh', headers={'authorization': 'Bearer bob'}).status_code == 404


def test_documented_inputs_reject_photo_audio_and_driver_parameter(studio, provider_http):
    configure(studio, 'hifly')
    picture, video = asset(studio), local_media('video')
    for tool, inputs in [('photo_talk', {'image_id': picture['id'], 'audio_id': local_media('audio')['id']}),
                         ('audio_avatar', {'audio_id': local_media('audio')['id'], 'image_id': picture['id']}),
                         ('avatar_create', {'image_id': picture['id'], 'video_id': video['id']})]:
        response = studio.post('/api/studio/drafts', json={'tool': tool, 'title': '校验', 'input': inputs, 'options': {}})
        if tool == 'avatar_create':
            assert response.status_code == 200
            assert submit(studio, response.json()).status_code == 400
        else:
            assert response.status_code == 400
    item = hifly_draft(studio, 'text_avatar', True)
    assert studio.patch('/api/studio/drafts/' + item['id'], json={'version': item['version'], 'driver': 'video'}).status_code == 400
    image = draft(studio, 'photo_talk', {'image_id': picture['id']})
    assert submit(studio, image).status_code == 400
    video_draft = draft(studio, 'avatar_create', {'video_id': video['id']}, {'model': 2})
    assert submit(studio, video_draft, 'invalid-video-model').status_code == 400
    service = m._service('hifly')
    both = draft(studio, 'audio_avatar', {'audio_id': local_media('audio')['id'],
        'avatar_id': resource('avatar', service)['id'], 'video_id': video['id']})
    assert submit(studio, both, 'invalid-two-human-sources').status_code == 400
    assert studio.post('/api/studio/drafts', json={'tool': 'avatar_create', 'input': {'image_id': picture['id']}, 'options': {'model': True}}).status_code == 400
    assert provider_http[0] == []


@pytest.mark.parametrize('operation', ['generate', 'upload', 'library', 'refresh'])
def test_all_hifly_provider_actions_return_before_slow_http(studio, provider_http, monkeypatch, operation):
    calls, behavior = provider_http
    item = hifly_draft(studio)
    existing = submit(studio, item, 'existing-task').json() if operation == 'refresh' else None
    calls.clear()
    started, release = Event(), Event()

    def slow(request, body):
        assert current_thread().name.startswith('hifly-worker')
        started.set()
        assert release.wait(4), 'test HTTP response was not released'
        if operation == 'refresh':
            return httpx.Response(200, json={'code': 0, 'status': 1})

    behavior['handler'] = slow
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='hifly-worker') as workers, ThreadPoolExecutor(max_workers=1) as callers:
        monkeypatch.setattr(m.jobs, 'POOL', workers)

        def request_ui():
            if operation == 'generate':
                return submit(studio, item, 'async-create')
            if operation == 'upload':
                return studio.post('/api/studio/upload?provider=hifly&confirmed=true', files={'file': ('async.png', png(), 'image/png')})
            if operation == 'library':
                return studio.get('/api/studio/assets?asset_type=avatar&refresh=true')
            return studio.post('/api/studio/runs/' + existing['id'] + '/refresh')

        try:
            response = callers.submit(request_ui).result(timeout=1.5)
            assert response.status_code == 200, response.text
            assert started.wait(1)
            assert studio.get('/api/studio/runs').status_code == 200
            assert studio.get('/api/studio/assets').status_code == 200
            assert studio.post('/api/studio/drafts', json={'tool': 'avatar_create', 'title': 'HTTP等待期间可保存', 'input': {}, 'options': {}}).status_code == 200
            if operation == 'generate':
                assert studio.get('/api/studio/runs').json()['items'][0]['status'] in ('preparing', 'submitting')
            elif operation == 'upload':
                assert response.json()['upload_status'] == 'queued'
                assert studio.get(response.json()['file_url']).content == png()
            elif operation == 'library':
                assert response.json()['public_library_status'] == 'queued'
                assert studio.get('/api/studio/assets?asset_type=avatar').json()['public_library_status'] == 'running'
        finally:
            release.set()
    if operation == 'library':
        library = studio.get('/api/studio/assets?asset_type=avatar').json()
        assert library['public_library_status'] == 'ready'
        assert len(library['items']) == 1 and library['items'][0]['title'] == '公版资源'
        assert 'private-account-resource' not in json.dumps(library)
    if operation == 'upload':
        saved = s.get('alice', response.json()['id'])
        assert saved['upload_status'] == 'uploaded' and saved['upload_until'] == 0
    assert all(c[4].startswith('hifly-worker') for c in calls)


def test_cancellation_during_upload_never_crosses_paid_submission_boundary(studio, provider_http, monkeypatch):
    calls, behavior = provider_http
    item = hifly_draft(studio)
    started, release = Event(), Event()

    def slow_upload(request, body):
        if request.method == 'PUT':
            started.set()
            assert release.wait(4)

    behavior['handler'] = slow_upload
    with ThreadPoolExecutor(max_workers=1) as workers:
        monkeypatch.setattr(m.jobs, 'POOL', workers)
        try:
            run = submit(studio, item).json()
            assert started.wait(1)
            assert s.get('alice', run['id'])['status'] == 'preparing'
            assert studio.post('/api/studio/runs/' + run['id'] + '/cancel').json()['status'] == 'cancelled'
        finally:
            release.set()
    assert s.get('alice', run['id'])['status'] == 'cancelled'
    assert not any('/avatar/create_by_image' in c[1] for c in calls)
    assert studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()['status'] == 'cancelled'


def test_submitted_hifly_cannot_be_cancelled_by_deleting_the_work(studio, provider_http):
    run = submit(studio, hifly_draft(studio)).json()
    before = len(provider_http[0])
    response = studio.post('/api/studio/runs/' + run['id'] + '/cancel')
    assert response.status_code == 400 and '未提供任务取消接口' in response.json()['detail']
    assert len(provider_http[0]) == before
    assert s.get('alice', run['id'])['task_id'] == run['task_id']


def test_concurrent_clicks_are_one_paid_submission(studio, provider_http, monkeypatch):
    calls, behavior = provider_http
    item = hifly_draft(studio, 'photo_talk')
    started, release = Event(), Event()

    def slow_paid(request, body):
        if request.url.path.endswith('/video/create_by_image'):
            started.set()
            assert release.wait(4)

    behavior['handler'] = slow_paid
    with ThreadPoolExecutor(max_workers=2) as workers, ThreadPoolExecutor(max_workers=4) as clicks:
        monkeypatch.setattr(m.jobs, 'POOL', workers)
        try:
            requests = [clicks.submit(submit, studio, item, 'click-' + str(i)) for i in range(4)]
            runs = [request.result(timeout=2).json() for request in requests]
            assert len({run['id'] for run in runs}) == 1
            assert started.wait(1)
            assert studio.post('/api/studio/runs/' + runs[0]['id'] + '/cancel').status_code == 400
            for _ in range(3):
                assert studio.post('/api/studio/runs/' + runs[0]['id'] + '/refresh').status_code == 200
        finally:
            release.set()
    assert len([c for c in calls if c[0] == 'POST' and c[1].endswith('/video/create_by_image')]) == 1
    assert len(s.list_('alice', 'studio_run')) == 1


@pytest.mark.parametrize('failure,expected', [('timeout', 'unknown'), ('rejected', 'failed')])
def test_submission_failure_never_repeats_paid_call(studio, provider_http, failure, expected):
    calls, behavior = provider_http
    item = hifly_draft(studio)

    def fail(request, body):
        if request.url.path.endswith('/avatar/create_by_image'):
            if failure == 'timeout':
                raise httpx.ReadTimeout('private-key-and-signed-url', request=request)
            return httpx.Response(200, json={'code': 1002, 'message': 'private-key-and-signed-url'})

    behavior['handler'] = fail
    run = submit(studio, item).json()
    assert run['status'] == expected and 'private-key' not in json.dumps(run)
    assert submit(studio, item).json()['id'] == run['id']
    if expected == 'unknown':
        assert submit(studio, item, 'new-click').json()['id'] == run['id']
    m.recover()
    studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert s.get('alice', run['id'])['status'] == expected
    assert len([c for c in calls if c[1].endswith('/avatar/create_by_image')]) == 1


def test_failed_task_with_business_error_code_is_terminal_and_safe(studio, provider_http):
    calls, behavior = provider_http
    run = submit(studio, hifly_draft(studio)).json()
    behavior['handler'] = lambda request, body: httpx.Response(200, json={
        'code': 2015, 'status': 4, 'message': 'private-account-and-key'}) if request.method == 'GET' else None
    failed = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert failed['status'] == 'failed' and 'private-account' not in json.dumps(failed)
    before = len(calls)
    assert m.tick() == 0
    assert len(calls) == before


def test_provider_account_scope_is_checked_before_poll_or_resource_use(studio, provider_http):
    configure(studio, 'hifly')
    old_avatar = resource('avatar', m._service('hifly'))
    run = submit(studio, hifly_draft(studio)).json()
    calls = provider_http[0]
    studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'},
                json={'provider': 'hifly', 'api_key': 'synthetic-second-account'})
    before = len(calls)
    refreshed = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert '服务账号或地域已变更' in refreshed['error']
    assert len(calls) == before
    assert studio.post('/api/studio/drafts', json={'tool': 'audio_avatar', 'input': {'avatar_id': old_avatar['id']}}).status_code == 400


def test_recovery_and_watcher_only_query_known_hifly_tasks(studio, provider_http, monkeypatch):
    calls, _ = provider_http
    queued = []
    monkeypatch.setattr(m.jobs, 'POOL', SimpleNamespace(submit=lambda *args: queued.append(args)))
    items = []
    for index, (status, task, expected) in enumerate([
        ('queued', None, 'interrupted'), ('preparing', None, 'interrupted'),
        ('submitting', None, 'unknown'), ('submitting', 'retained-task', 'running')]):
        run = submit(studio, hifly_draft(studio), 'restart-' + str(index)).json()
        m._update('alice', run['id'], status=status, task_id=task, busy_until=time.time() + 600)
        items.append((run['id'], expected))
    assert m.recover() == 4
    assert len(queued) == 4  # Recovery itself cannot enqueue paid submissions.
    assert calls == []
    for id, expected in items:
        assert s.get('alice', id)['status'] == expected
        m._work('alice', id, True)
    assert len(calls) == 1 and calls[0][0] == 'GET'
    assert '/avatar/task?task_id=retained-task' in calls[0][1]
    assert s.get('alice', items[-1][0])['status'] == 'succeeded'


def test_watcher_timeout_preserves_task_for_manual_refresh_without_resubmit(studio, provider_http):
    calls, _ = provider_http
    run = submit(studio, hifly_draft(studio)).json()
    old_time = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    m._update('alice', run['id'], submitted_at=old_time)
    before = len(calls)
    assert m.tick() == 0
    paused = s.get('alice', run['id'])
    assert paused['status'] == 'unknown' and paused['polling_paused'] is True
    assert paused['task_id'] == run['task_id']
    assert len(calls) == before
    assert studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()['status'] == 'succeeded'
    assert all(c[0] == 'GET' for c in calls[before:])


def test_upload_and_library_recovery_preserves_local_files_without_network(studio, provider_http, monkeypatch):
    configure(studio, 'hifly')
    queued = []
    monkeypatch.setattr(m.jobs, 'POOL', SimpleNamespace(submit=lambda *args: queued.append(args)))
    uploaded = studio.post('/api/studio/upload?provider=hifly&confirmed=true',
        files={'file': ('local.png', png(), 'image/png')}).json()
    assert uploaded['upload_status'] == 'queued'
    assert studio.get('/api/studio/assets?asset_type=voice&refresh=true').json()['public_library_status'] == 'queued'
    assert m.recover() == 0
    assert s.get('alice', uploaded['id'])['upload_status'] == 'interrupted'
    assert studio.get(uploaded['file_url']).content == png()
    assert studio.get('/api/studio/assets?asset_type=voice').json()['public_library_status'] == 'interrupted'
    assert len(queued) == 2 and provider_http[0] == []


def test_explicit_upload_failure_does_not_leak_http_exception(studio, provider_http):
    configure(studio, 'hifly')
    provider_http[1]['handler'] = lambda request, body: (_ for _ in ()).throw(httpx.ReadTimeout('secret-signed-url', request=request))
    response = studio.post('/api/studio/upload?provider=hifly&confirmed=true', files={'file': ('failed.png', png(), 'image/png')})
    assert response.status_code == 200
    assert response.json()['upload_status'] == 'failed'
    assert 'secret-signed-url' not in response.text
    assert studio.get(response.json()['file_url']).content == png()
    assert s.get('alice', response.json()['id'])['upload_until'] == 0


def test_public_library_failure_returns_safe_status_and_preserves_resources(studio, provider_http):
    configure(studio, 'hifly')
    service = m._service('hifly')
    saved = resource('voice', service)
    provider_http[1]['handler'] = lambda request, body: httpx.Response(500, json={'message': 'private-provider-key-and-customer'})
    response = studio.get('/api/studio/assets?asset_type=voice&refresh=true')
    assert response.status_code == 200
    assert response.json()['public_library_status'] == 'failed'
    assert [x['id'] for x in response.json()['items']] == [saved['id']]
    assert 'private-provider-key' not in response.text
    assert studio.get('/api/studio/assets?asset_type=voice').json()['public_library_status'] == 'failed'
    assert studio.get('/api/studio/assets?asset_type=voice', headers={'authorization': 'Bearer bob'}).json()['public_library_status'] == 'idle'


def test_same_image_upload_is_cached_per_provider_account_scope(studio, provider_http):
    item = hifly_draft(studio)
    service = m._service('hifly')
    picture = s.get('alice', item['input']['image_id'])
    assert m._hifly_file('alice', picture, service) == 'file-png'
    assert m._hifly_file('alice', picture, service) == 'file-png'
    assert len(provider_http[0]) == 2
    studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'}, json={'provider': 'hifly', 'api_key': 'synthetic-other-key'})
    assert m._hifly_file('alice', picture, m._service('hifly')) == 'file-png'
    assert len(provider_http[0]) == 4
    with pytest.raises(s.Missing):
        m._hifly_file('bob', picture, service)


def test_download_failure_recovery_only_archives_existing_result(studio, provider_http, monkeypatch):
    calls, _ = provider_http
    run = submit(studio, hifly_draft(studio, 'photo_talk')).json()
    download = m._download
    monkeypatch.setattr(m, '_download', lambda *args, **kwargs: (_ for _ in ()).throw(httpx.ReadTimeout('private-result-url')))
    assert studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()['status'] == 'archive_failed'
    retained = s.get('alice', run['id'])['result']
    before = len(calls)
    m.recover()
    assert s.get('alice', run['id'])['result'] == retained
    monkeypatch.setattr(m, '_download', download)
    assert m.tick() == 1
    assert s.get('alice', run['id'])['status'] == 'succeeded'
    assert len(calls) == before
