"""Exercise the public video workflow against a local OAIREGBOX contract fixture."""
import pytest

from backend import creation, h3_video, media_registry as registry, media_studio as studio_service, store as s
from test_media_studio import asset, studio, submit


def save(client, inputs, model_id=None, options=None):
    result = client.post('/api/studio/drafts', json={
        'tool': 'text_video', 'title': 'H3 integration', 'input': inputs,
        'model_id': model_id, 'options': options or {},
    })
    assert result.status_code == 200, result.text
    return result.json()


def test_standard_retains_incompatible_video_and_blocks_submission(studio, monkeypatch):
    registry.save_provider({'id': 'oairegbox', 'api_key': 'fixture-minimax-token'})
    calls = []
    monkeypatch.setattr(studio_service, '_h3_api', lambda *args: calls.append(args))
    old = s.put('alice', 'studio_draft', {
        'tool': 'text_video', 'title': 'Old draft', 'model_id': 'media:ark-seedance-25',
        'input': {'prompt': '电梯门开启', 'reference_mode': 'reference', 'remote_references': [
            {'kind': 'video', 'url': 'https://media.example.test/clip.mp4', 'duration': 3},
        ]},
        'options': {'duration': 7, 'ratio': '9:16', 'resolution': '1080p'},
    })
    saved = studio.get('/api/studio/drafts').json()['items'][0]
    assert saved['input'] == old['input']
    assert saved['model_id'] == h3_video.DEFAULT_MODEL
    assert saved['options'] == {'duration': 7, 'ratio': '9:16'}
    result = submit(studio, saved)
    assert result.status_code == 400 and '不支持参考视频' in result.json()['detail']
    assert not calls and not s.list_('alice', 'studio_run')


def test_pro_submits_polls_and_archives_once(studio, monkeypatch):
    registry.save_provider({'id': 'oairegbox', 'api_key': 'fixture-minimax-token'})
    image = asset(studio)
    calls = []

    def request(method, url, *, headers, payload):
        calls.append((method, url, payload))
        assert headers == {'Authorization': 'Bearer fixture-minimax-token'}
        if method == 'POST':
            return {'task_id': 'h3-task-123'}
        return {'status': 'completed', 'video_url': 'https://media.example.test/result.mp4'}

    def download(owner, id, url, kind):
        assert url.endswith('/result.mp4') and kind == 'video'
        return 'isolated-result.mp4', {'asset_type': 'video', 'mime_type': 'video/mp4', 'size': 100}

    monkeypatch.setattr(studio_service, '_request', request)
    monkeypatch.setattr(studio_service, '_download', download)
    saved = save(studio, {'prompt': '电梯门开启', 'reference_mode': 'reference',
                          'image_ids': [image['id']], 'remote_references': [
                              {'kind': 'video', 'url': 'https://media.example.test/clip.mp4', 'duration': 3},
                          ]}, 'media:minimax-h3-pro-2k', {'duration': 9, 'ratio': '9:16'})
    first = submit(studio, saved).json()
    assert first['status'] == 'running'
    body = calls[0][2]
    assert calls[0][:2] == ('POST', h3_video.BASE_URL + '/v1/videos')
    assert body['model'] == 'minimax-h3-pro-2k' and body['duration'] == 9 and body['ratio'] == '9:16'
    assert body['referenceImages'][0].startswith('data:image/png;base64,')
    assert body['referenceVideos'] == ['https://media.example.test/clip.mp4']
    assert studio_service.tick() == 1
    assert calls[1][:2] == ('GET', h3_video.BASE_URL + '/v1/videos/h3-task-123')
    final = s.get('alice', first['id'])
    assert final['status'] == 'succeeded' and final['asset_ids']
    assert submit(studio, saved).json()['id'] == first['id']
    assert len(calls) == 2


def test_h3_failed_run_can_retry_original_payload(studio, monkeypatch):
    registry.save_provider({'id': 'oairegbox', 'api_key': 'fixture-minimax-token'})
    posted = []

    def request(method, url, *, headers, payload):
        if method == 'POST':
            posted.append(payload)
            return {'task_id': 'fixture-task-' + str(len(posted))}
        return {'status': 'failed'}

    monkeypatch.setattr(studio_service, '_request', request)
    image = asset(studio)
    saved = save(studio, {'prompt': '保持首帧轿厢主体，电梯门缓慢开启。', 'reference_mode': 'first_frame',
                          'image_ids': [image['id']]}, h3_video.DEFAULT_MODEL, {'ratio': '9:16', 'duration': 6})
    run = submit(studio, saved).json()
    assert run['status'] == 'running'
    assert studio_service.tick() == 1
    assert studio.get('/api/studio/runs').json()['items'][0]['can_retry_failure']
    response = studio.post('/api/studio/runs/' + run['id'] + '/retry', json={'confirmed': True})
    assert response.status_code == 200, response.text
    assert response.json()['task_id'] == 'fixture-task-2'
    assert len(posted) == 2 and posted[0] == posted[1]


def test_h3_template_requires_official_sections_and_real_reference_indices():
    counts = {'image': 1, 'video': 0, 'audio': 0}
    fields, _ = creation._h3_template('reference', counts, 5)
    text = '\n'.join(field + ': N/A' for field in fields)
    assert creation._validate_h3_prompt(text, fields, counts) == text
    with pytest.raises(ValueError, match='不存在'):
        creation._validate_h3_prompt(text + '\nUse <Video 1>.', fields, counts)
    with pytest.raises(ValueError, match='字段'):
        creation._validate_h3_prompt('A single shot', fields, counts)


def test_pro_validates_local_reference_duration_and_frame_roles():
    model = {'api_model_id': 'minimax-h3-pro-768p'}
    clip = {'prompt': '电梯门开启', 'video_ids': ['clip']}
    lookup = lambda _, kind: {'local_file': 'clip.mp4', 'duration': 6, 'size': 500}
    with pytest.raises(ValueError, match='2–5 秒'):
        h3_video.validate(model, clip, {}, lookup, complete=True)
    frames = {
        'prompt': '电梯门开启', 'reference_mode': 'first_last_frame', 'image_ids': ['tail', 'first'],
        'frame_slots': {'first_frame': 'id:first', 'last_frame': 'id:tail'},
    }
    refs = h3_video.validate(model, frames, {}, lambda id, _: {'local_file': id + '.png'}, complete=True)
    payload = h3_video.payload(model, frames, {}, refs, lambda ref: ref['id'])
    assert payload['first_image'] == 'first' and payload['last_image'] == 'tail'
    assert 'referenceImages' not in payload
