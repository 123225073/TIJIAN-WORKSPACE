"""Offline media submission and multi-image contracts; never contact a provider."""
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend import media_registry, media_studio as media, store as s
from test_media_studio import ImmediatePool, asset, configure, draft, png, studio, submit


def test_batch_terminal_status_preserves_pending_and_uncertain_slots():
    status = lambda *states: media._batch_status([{'status': value} for value in states])
    assert status('succeeded', 'running', 'unknown') == 'running'
    assert status('succeeded', 'unknown', 'not_submitted') == 'unknown'
    assert status('succeeded', 'archive_failed', 'failed') == 'archive_failed'
    assert status('succeeded', 'failed', 'not_submitted') == 'partial'
    assert status('failed', 'not_submitted') == 'failed'
    assert status('succeeded', 'succeeded') == 'succeeded'


def test_aliyun_batch_submission_does_not_hold_the_page_or_lose_outputs(studio, monkeypatch):
    configure(studio)
    catalog = studio.get('/api/studio/catalog').json()['tools']
    image = next(tool for tool in catalog if tool['id'] == 'text_image')
    assert image['options']['n'] == [1, 2, 3, 4, 5, 6]
    assert next(model for model in image['models'] if model['id'].startswith('media:'))['options']['n'] == [1, 2, 3, 4]

    started, release = Event(), Event()
    second_started, finish_second = Event(), Event()
    sent = []

    def provider_request(method, url, **kwargs):
        sent.append(kwargs['payload'])
        started.set()
        assert release.wait(5), 'test provider response was not released'
        return {'request_id': 'offline-request', 'output': {'choices': [
            {'message': {'content': [{'image': f'https://cdn.example/{index}.png'}]}}
            for index in range(2)
        ]}}

    def download(owner, id, url, kind):
        if url.endswith('/1.png'):
            second_started.set()
            assert finish_second.wait(5), 'test archive was not released'
        path = media._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, media._metadata(path, '.png')

    monkeypatch.setattr(media, '_request', provider_request)
    monkeypatch.setattr(media, '_download', download)
    item = draft(studio, options={'n': 2})
    with ThreadPoolExecutor(max_workers=2) as background, ThreadPoolExecutor(max_workers=1) as client_pool:
        monkeypatch.setattr(media.jobs, 'POOL', background)
        response = client_pool.submit(submit, studio, item, 'offline-batch')
        try:
            submitted = response.result(timeout=1)
            assert submitted.status_code == 200
            assert submitted.json()['id']
            assert started.wait(1)
            pending = studio.get('/api/studio/runs').json()['items']
            assert pending[0]['status'] == 'submitting'
            assert pending[0]['generation']['options']['n'] == 2
            assert pending[0]['asset_ids'] == []
        finally:
            release.set()
        try:
            assert second_started.wait(2)
            saving = studio.get('/api/studio/runs').json()['items'][0]
            assert saving['status'] == 'running'
            assert saving['result_count'] == 2
            assert [entry['status'] for entry in saving['output_items']] == ['ready', 'saving']
            assert len(saving['asset_ids']) == 1
        finally:
            finish_second.set()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            finished = studio.get('/api/studio/runs').json()['items'][0]
            if finished['status'] == 'succeeded':
                break
            time.sleep(.02)
        assert finished['status'] == 'succeeded', finished
    assert sent[0]['parameters']['n'] == 2
    assert finished['result_count'] == 2
    assert len(finished['asset_ids']) == 2
    assert len(set(finished['asset_ids'])) == 2
    assert len(studio.get('/api/studio/assets').json()['items']) == 2
    assert [item['status'] for item in finished['output_items']] == ['ready', 'ready']
    assert [item['asset_id'] for item in finished['output_items']] == finished['asset_ids']


def test_wavespeed_batch_count_is_local_and_bounded(studio):
    body = {'tool': 'text_image', 'title': '不支持批量的模型',
            'model_id': 'media:wavespeed-gpt-image-25-flare-text',
            'input': {'prompt': '电梯'}, 'options': {'n': 2}}
    assert studio.post('/api/studio/drafts', json=body).status_code == 200
    for count in (0, 5, True, 2.5):
        assert studio.post('/api/studio/drafts', json={**body, 'options': {'n': count}}).status_code == 400
    model = next(item for item in studio.get('/api/studio/catalog').json()['tools']
                 if item['id'] == 'text_image')['models']
    wave = next(item for item in model if item['id'] == body['model_id'])
    assert wave['options']['n'] == [1, 2, 3, 4]
    assert studio.get('/api/studio/runs').json()['items'] == []


def test_video_submission_returns_while_provider_is_still_processing(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    media_registry.save_model({'id': 'wavespeed-seedance-25', 'published': True})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_video', 'title': '视频异步验证',
        'model_id': 'media:wavespeed-seedance-25',
        'input': {'prompt': '电梯开门'}, 'options': {},
    })
    assert created.status_code == 200
    started, release = Event(), Event()

    def provider_request(method, url, **kwargs):
        assert method == 'POST' and url.endswith('/seedance-2.5/text-to-video')
        started.set()
        assert release.wait(5), 'test provider response was not released'
        return {'code': 200, 'data': {'id': 'offline-video-task', 'status': 'created'}}

    monkeypatch.setattr(media, '_request', provider_request)
    with ThreadPoolExecutor(max_workers=1) as background, ThreadPoolExecutor(max_workers=1) as client_pool:
        monkeypatch.setattr(media.jobs, 'POOL', background)
        response = client_pool.submit(submit, studio, created.json(), 'offline-video')
        try:
            submitted = response.result(timeout=1)
            assert submitted.status_code == 200
            assert submitted.json()['id']
            assert started.wait(1)
            assert studio.get('/api/studio/runs').json()['items'][0]['status'] == 'submitting'
        finally:
            release.set()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            run = studio.get('/api/studio/runs').json()['items'][0]
            if run['status'] == 'running':
                break
            time.sleep(.02)
        assert run['status'] == 'running' and run['task_id'] == 'offline-video-task'


def test_each_actual_batch_output_has_a_recoverable_save_status(studio, monkeypatch):
    configure(studio)
    requests = []

    def provider_request(method, url, **kwargs):
        requests.append(kwargs['payload'])
        return {'output': {'choices': [
            {'message': {'content': [{'image': f'https://cdn.example/{index}.png'}]}}
            for index in range(2)
        ]}}

    attempts = []

    def download(owner, id, url, kind):
        attempts.append(url)
        if url.endswith('/1.png') and attempts.count(url) == 1:
            raise media.StudioError('隔离测试：第二张保存失败')
        path = media._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, media._metadata(path, '.png')

    monkeypatch.setattr(media, '_request', provider_request)
    monkeypatch.setattr(media, '_download', download)
    item = draft(studio, options={'n': 3})
    submitted = submit(studio, item, 'offline-partial')
    assert submitted.status_code == 200
    run = submitted.json()
    assert run['status'] == 'archive_failed'
    assert run['result_count'] == 2  # The provider returned two; never invent a third.
    assert [entry['status'] for entry in run['output_items']] == ['ready', 'save_failed']
    assert len(run['asset_ids']) == 1
    assert 'asset_id' not in run['output_items'][1]
    refreshed = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert refreshed['status'] == 'succeeded'
    assert [entry['status'] for entry in refreshed['output_items']] == ['ready', 'ready']
    assert len(refreshed['asset_ids']) == 2
    assert requests[0]['parameters']['n'] == 3 and len(requests) == 1
    assert attempts.count('https://cdn.example/0.png') == 1  # No paid resubmit or repeat download.


@pytest.mark.parametrize('tool,operation', [('text_image', 'text'), ('image_edit', 'edit')])
def test_wavespeed_one_click_submits_separate_predictions_and_polls_each(studio, monkeypatch, tool, operation):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    inputs = {'prompt': '电梯产品图'}
    if tool == 'image_edit':
        picture = asset(studio)
        inputs.update(image_id=picture['id'], image_ids=[picture['id']])
    draft_response = studio.post('/api/studio/drafts', json={
        'tool': tool, 'title': '三张产品图',
        'model_id': 'media:wavespeed-gpt-image-25-flare-' + operation,
        'input': inputs, 'options': {'n': 3, 'quality': 'medium'},
    })
    assert draft_response.status_code == 200, draft_response.text
    uploads, posts, polls = [], [], {}

    def upload(owner, asset_id, kind, selected_tool, service):
        uploads.append(asset_id)
        return 'https://cdn.example/reference.png'

    def provider_request(method, url, **kwargs):
        if method == 'POST':
            posts.append(kwargs['payload'])
            return {'code': 200, 'data': {'id': 'prediction-' + str(len(posts)), 'status': 'created'}}
        task = url.split('/predictions/')[1].split('/')[0]
        polls[task] = polls.get(task, 0) + 1
        if task == 'prediction-2':
            return {'code': 200, 'data': {'status': 'failed'}}
        if task == 'prediction-3' and polls[task] == 1:
            return {'code': 200, 'data': {'status': 'processing'}}
        return {'code': 200, 'data': {'status': 'completed', 'outputs': ['https://cdn.example/' + task + '.png']}}

    def download(owner, id, url, kind):
        path = media._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, media._metadata(path, '.png')

    monkeypatch.setattr(media, '_wavespeed_upload', upload)
    monkeypatch.setattr(media, '_request', provider_request)
    monkeypatch.setattr(media, '_download', download)
    created = submit(studio, draft_response.json(), 'one-click-three')
    assert created.status_code == 200, created.text
    run = created.json()
    assert run['status'] == 'running' and run['batch_total'] == 3
    assert run['billing_progress']['task_ids'] == 3
    assert [item['task_id'] for item in run['output_items']] == ['prediction-1', 'prediction-2', 'prediction-3']
    assert len(posts) == 3 and all('n' not in body for body in posts)
    assert all(body['quality'] == 'medium' for body in posts)
    assert len(uploads) == (1 if tool == 'image_edit' else 0)
    if tool == 'image_edit':
        assert all(body['images'] == ['https://cdn.example/reference.png'] for body in posts)
    assert submit(studio, draft_response.json(), 'one-click-three').json()['id'] == run['id']
    first = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert first['status'] == 'running'
    assert [item['status'] for item in first['output_items']] == ['succeeded', 'failed', 'running']
    assert first['result_count'] == 1 and len(first['asset_ids']) == 1
    final = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert final['status'] == 'partial'
    assert [item['status'] for item in final['output_items']] == ['succeeded', 'failed', 'succeeded']
    assert final['result_count'] == 2 and len(final['asset_ids']) == 2
    assert len(posts) == 3  # Refresh is GET-only, including a failed prediction.
    assert studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()['status'] == 'partial'
    assert len(posts) == 3  # A terminal partial result remains idempotent.
    assert 'cdn.example' not in studio.get('/api/studio/runs').text


def test_wavespeed_batch_http_returns_id_before_slow_upstream_finishes(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_image', 'title': '两张异步图片',
        'model_id': 'media:wavespeed-gpt-image-25-flare-text',
        'input': {'prompt': '电梯'}, 'options': {'n': 2},
    }).json()
    started, release, response_sent = Event(), Event(), Event()
    posts = []

    class ResponseProbe:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            async def observed_send(message):
                await send(message)
                if scope.get('path') == '/api/studio/generate' and message['type'] == 'http.response.body' and not message.get('more_body'):
                    response_sent.set()

            await self.app(scope, receive, observed_send)

    def provider_request(method, url, **kwargs):
        assert method == 'POST'
        assert response_sent.is_set(), 'upstream POST began before the run ID response was sent'
        posts.append(kwargs['payload'])
        if len(posts) == 1:
            started.set()
            assert release.wait(5)
        return {'code': 200, 'data': {'id': 'slow-' + str(len(posts))}}

    monkeypatch.setattr(media, '_request', provider_request)
    with ThreadPoolExecutor(max_workers=2) as background, ThreadPoolExecutor(max_workers=1) as client_pool, TestClient(ResponseProbe(studio.app)) as client:
        client.headers['authorization'] = 'Bearer alice'
        monkeypatch.setattr(media.jobs, 'POOL', background)
        response = client_pool.submit(submit, client, created, 'slow-batch')
        try:
            submitted = response.result(timeout=1)
            assert submitted.status_code == 200 and submitted.json()['id']
            assert response_sent.is_set()
            assert started.wait(1)
            pending = studio.get('/api/studio/runs').json()['items'][0]
            assert [item['status'] for item in pending['output_items']] == ['submitting', 'queued']
            assert submit(studio, created, 'slow-batch').json()['id'] == pending['id']
            assert submit(studio, created, 'second-click-same-version').json()['id'] == pending['id']
            assert studio.post('/api/studio/runs/' + pending['id'] + '/refresh').status_code == 200
            assert len(posts) == 1
        finally:
            release.set()
    finished = studio.get('/api/studio/runs').json()['items'][0]
    assert finished['status'] == 'running'
    assert [item['task_id'] for item in finished['output_items']] == ['slow-1', 'slow-2']
    assert len(posts) == 2


def test_wavespeed_unknown_submission_stops_remaining_calls_and_refresh_never_posts(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_image', 'title': '部分提交状态未知',
        'model_id': 'media:wavespeed-gpt-image-25-flare-text',
        'input': {'prompt': '电梯'}, 'options': {'n': 3},
    }).json()
    posts = []

    def provider_request(method, url, **kwargs):
        if method == 'POST':
            posts.append(kwargs['payload'])
            if len(posts) == 2:
                raise TimeoutError('provider response lost')
            return {'code': 200, 'data': {'id': 'known-first' if len(posts) == 1 else 'new-' + str(len(posts))}}
        assert method == 'GET' and '/known-first/result' in url
        return {'code': 200, 'data': {'status': 'completed', 'outputs': ['https://cdn.example/first.png']}}

    def download(owner, id, url, kind):
        path = media._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, media._metadata(path, '.png')

    monkeypatch.setattr(media, '_request', provider_request)
    monkeypatch.setattr(media, '_download', download)
    run = submit(studio, created, 'uncertain-batch').json()
    assert [item['status'] for item in run['output_items']] == ['running', 'unknown', 'not_submitted']
    assert run['billing_progress'] == {'task_ids': 1, 'uncertain_submissions': 1, 'not_submitted': 1}
    assert 'asset_ids' not in run['output_items'][1]
    assert submit(studio, created, 'uncertain-batch').json()['id'] == run['id']
    refreshed = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert refreshed['status'] == 'unknown' and len(refreshed['asset_ids']) == 1
    assert [item['status'] for item in refreshed['output_items']] == ['succeeded', 'unknown', 'not_submitted']
    studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert len(posts) == 2
    assert submit(studio, created, 'different-id-same-version').json()['id'] == run['id']
    assert len(posts) == 2  # Same draft version cannot bypass the uncertain run.
    revised = studio.patch('/api/studio/drafts/' + created['id'], json={
        'version': created['version'], 'input': {'prompt': '修改后的新版本'},
    }).json()
    assert revised['version'] > created['version']
    newer = submit(studio, revised, 'confirmed-new-version').json()
    assert newer['id'] != run['id'] and newer['draft_version'] == revised['version']
    assert newer['status'] == 'running' and len(posts) == 5
    assert submit(studio, revised, 'another-id-new-version').json()['id'] == newer['id']
    assert len(posts) == 5  # Even different request IDs share the active version.
    assert next(item for item in studio.get('/api/studio/runs').json()['items'] if item['id'] == run['id'])['status'] == 'unknown'


@pytest.mark.parametrize('tool,model', [
    ('text_image', 'wavespeed-gpt-image-25-flare-text'),
    ('text_video', 'wavespeed-seedance-25'),
])
def test_single_interrupted_refresh_never_submits_and_explicit_retry_is_deduped(studio, monkeypatch, tool, model):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    media_registry.save_model({'id': model, 'published': True})
    created = studio.post('/api/studio/drafts', json={
        'tool': tool, 'title': '单张任务恢复', 'model_id': 'media:' + model,
        'input': {'prompt': '电梯'}, 'options': {},
    }).json()

    class DeferredPool:
        calls = []

        def submit(self, fn, *args):
            self.calls.append((fn, args))

    pending = DeferredPool()
    monkeypatch.setattr(media.jobs, 'POOL', pending)
    original = submit(studio, created, 'before-restart').json()
    assert original['status'] == 'queued' and len(pending.calls) == 1
    studio.post('/api/studio/runs/' + original['id'] + '/refresh')
    assert len(pending.calls) == 2
    pending.calls[1][0](*pending.calls[1][1])  # A refresh racing the initial worker is inspection-only.
    assert studio.get('/api/studio/runs').json()['items'][0]['status'] == 'queued'

    posts = []

    def provider_request(method, url, **kwargs):
        assert method == 'POST'
        posts.append(kwargs['payload'])
        return {'code': 200, 'data': {'id': 'explicit-single-task'}}

    monkeypatch.setattr(media, '_request', provider_request)
    assert media.recover() == 1
    recovered = studio.get('/api/studio/runs').json()['items'][0]
    assert recovered['status'] == 'interrupted' and '重新生成' in recovered['error']
    pending.calls[0][0](*pending.calls[0][1])  # A delayed original worker cannot resume after recovery.
    monkeypatch.setattr(media.jobs, 'POOL', ImmediatePool())
    assert studio.post('/api/studio/runs/' + original['id'] + '/refresh').json()['status'] == 'interrupted'
    assert submit(studio, created, 'before-restart').json()['id'] == original['id']
    assert posts == []

    continued = submit(studio, created, 'explicit-confirmed-retry').json()
    assert continued['id'] != original['id'] and continued['status'] == 'running'
    assert continued['task_id'] == 'explicit-single-task' and len(posts) == 1
    assert submit(studio, created, 'explicit-confirmed-retry').json()['id'] == continued['id']
    assert submit(studio, created, 'parallel-same-version').json()['id'] == continued['id']
    assert len(posts) == 1


def test_pending_shotstack_upload_requires_explicit_new_request_before_render(studio, monkeypatch):
    configure(studio, 'shotstack')
    picture = asset(studio)
    created = draft(studio, 'compose', {'scenes': [
        {'asset_id': picture['id'], 'length': 5, 'caption': '电梯安全'},
    ]})
    renders, uploads, polls = [], [], []

    def provider_request(method, url, **kwargs):
        if url.endswith('/ingest/stage/upload'):
            uploads.append(url)
            return {'data': {'id': 'source-id', 'attributes': {'url': 'https://upload.example/signed'}}}
        if method == 'PUT':
            return {}
        if '/sources/' in url:
            polls.append(url)
            return {'data': {'attributes': {'status': 'processing' if len(polls) == 1 else 'ready',
                                            'source': 'https://cdn.example/source.png'}}}
        assert method == 'POST' and url.endswith('/edit/stage/render')
        renders.append(kwargs['payload'])
        return {'success': True, 'response': {'id': 'render-id'}}

    monkeypatch.setattr(media, '_request', provider_request)
    first = submit(studio, created, 'waiting-for-upload').json()
    assert first['status'] == 'interrupted' and '重新生成' in first['error']
    assert len(uploads) == len(polls) == 1 and renders == []
    assert studio.post('/api/studio/runs/' + first['id'] + '/refresh').json()['status'] == 'interrupted'
    assert submit(studio, created, 'waiting-for-upload').json()['id'] == first['id']
    assert len(polls) == 1 and renders == []
    continued = submit(studio, created, 'confirmed-after-upload').json()
    assert continued['id'] != first['id'] and continued['status'] == 'running'
    assert continued['task_id'] == 'render-id' and len(renders) == 1
    assert len(uploads) == 1 and len(polls) == 2
    assert submit(studio, created, 'another-id-same-version').json()['id'] == continued['id']
    assert len(renders) == 1


def test_wavespeed_restart_marks_unacknowledged_slot_unknown_without_resubmitting(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_image', 'title': '中途重启',
        'model_id': 'media:wavespeed-gpt-image-25-flare-text',
        'input': {'prompt': '电梯'}, 'options': {'n': 3},
    }).json()
    posts = []

    def provider_request(method, url, **kwargs):
        if method == 'POST':
            posts.append(1)
            return {'code': 200, 'data': {'id': 'known-' + str(len(posts))}}
        return {'code': 200, 'data': {'status': 'processing'}}

    monkeypatch.setattr(media, '_request', provider_request)
    run = submit(studio, created, 'restart-batch').json()
    record = s.get('alice', run['id'])
    batch = [dict(item) for item in record['batch']]
    batch[1] = {'status': 'submitting'}
    batch[2] = {'status': 'queued'}
    media._update('alice', run['id'], batch=batch, batch_submission_done=False,
                  status='submitting', busy_until=time.time() + 3600)
    assert media.recover() >= 1
    recovered = studio.get('/api/studio/runs').json()['items'][0]
    assert [item['status'] for item in recovered['output_items']] == ['running', 'unknown', 'not_submitted']
    assert recovered['billing_progress']['uncertain_submissions'] == 1
    studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert len(posts) == 3


def test_wavespeed_refresh_only_retries_failed_download(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_image', 'title': '仅补存第二张',
        'model_id': 'media:wavespeed-gpt-image-25-flare-text',
        'input': {'prompt': '电梯'}, 'options': {'n': 2},
    }).json()
    posts, downloads = [], []

    def provider_request(method, url, **kwargs):
        if method == 'POST':
            posts.append(1)
            return {'code': 200, 'data': {'id': 'save-' + str(len(posts))}}
        task = url.split('/predictions/')[1].split('/')[0]
        return {'code': 200, 'data': {'status': 'completed', 'outputs': ['https://cdn.example/' + task + '.png']}}

    def download(owner, id, url, kind):
        downloads.append(url)
        if url.endswith('/save-2.png') and downloads.count(url) == 1:
            raise media.StudioError('隔离测试：第二张下载失败')
        path = media._path(owner, id + '.png')
        path.write_bytes(png())
        return path.name, media._metadata(path, '.png')

    monkeypatch.setattr(media, '_request', provider_request)
    monkeypatch.setattr(media, '_download', download)
    run = submit(studio, created, 'retry-download-only').json()
    first = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert first['status'] == 'archive_failed'
    assert [item['status'] for item in first['output_items']] == ['succeeded', 'archive_failed']
    assert len(first['asset_ids']) == 1
    final = studio.post('/api/studio/runs/' + run['id'] + '/refresh').json()
    assert final['status'] == 'succeeded' and len(final['asset_ids']) == 2
    assert [item['status'] for item in final['output_items']] == ['succeeded', 'succeeded']
    assert len(posts) == 2
    assert downloads.count('https://cdn.example/save-1.png') == 1
    assert downloads.count('https://cdn.example/save-2.png') == 2


def test_wavespeed_revocation_stops_unsubmitted_images(studio, monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    created = studio.post('/api/studio/drafts', json={
        'tool': 'text_image', 'title': '配置中途停用',
        'model_id': 'media:wavespeed-gpt-image-25-flare-text',
        'input': {'prompt': '电梯'}, 'options': {'n': 3},
    }).json()
    posts = []

    def provider_request(method, url, **kwargs):
        if method == 'POST':
            posts.append(1)
            media_registry.save_provider({'id': 'wavespeed', 'published': False})
            return {'code': 200, 'data': {'id': 'already-submitted'}}
        return {'code': 200, 'data': {'status': 'processing'}}

    monkeypatch.setattr(media, '_request', provider_request)
    run = submit(studio, created, 'revoked-batch').json()
    assert [item['status'] for item in run['output_items']] == ['running', 'not_submitted', 'not_submitted']
    assert run['billing_progress'] == {'task_ids': 1, 'uncertain_submissions': 0, 'not_submitted': 2}
    studio.post('/api/studio/runs/' + run['id'] + '/refresh')
    assert len(posts) == 1
