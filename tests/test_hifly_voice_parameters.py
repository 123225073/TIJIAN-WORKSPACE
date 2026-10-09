"""Documented voice/edit contracts; isolated SQLite and intercepted HTTP only."""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest

from backend import media_studio as m, store as s
from test_hifly_v2 import hifly_draft
from test_media_studio import configure, resource, studio


@pytest.fixture
def voice_http(studio, monkeypatch):
    calls, behavior = [], {}
    service = configure(studio, 'hifly')
    voice = resource('voice', service)
    real_client = httpx.Client

    def handle(request):
        body = json.loads(request.content) if request.method == 'POST' else None
        calls.append((request.method, str(request.url), body))
        assert request.url.path in ('/api/v2/hifly/voice/list', '/api/v2/hifly/voice/edit')
        if behavior.get('handler'):
            response = behavior['handler'](request, body)
            if response is not None:
                return response
        if request.method == 'GET':
            assert request.url.params['kind'] == '1'
            return httpx.Response(200, json={'code': 0, 'data': [
                {'voice': 'unrelated-private-id', 'type': 8, 'title': '不应暴露的账号资源',
                 'rate': '1.1', 'volume': '1.0', 'pitch': '1.0'},
                {'voice': voice['provider_resource_id'], 'type': 8,
                 'rate': '1.0', 'volume': '0.7', 'pitch': '0.9'}]})
        assert set(body) == {'voice', 'rate', 'volume', 'pitch'}
        assert all(isinstance(body[key], str) for key in ('rate', 'volume', 'pitch'))
        return httpx.Response(200, json={'code': 0, 'message': '', 'request_id': 'synthetic-edit'})

    monkeypatch.setattr(m.httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw))
    monkeypatch.setattr(m.network, 'public_target', lambda url: (httpx.URL(url), {}, {}))
    return voice, calls, behavior


def endpoint(voice):
    return '/api/studio/assets/' + voice['id'] + '/voice-parameters'


def update(studio, voice_asset, **parameters):
    return studio.post(endpoint(voice_asset), json={'version': voice_asset['version'], 'confirmed': True, **parameters})


def test_read_voice_parameters_is_current_read_only_and_does_not_expose_private_ids(studio, voice_http):
    voice, calls, _ = voice_http
    before = s.get('alice', voice['id'])
    response = studio.get(endpoint(voice))
    assert response.status_code == 200, response.text
    assert response.json() == {'asset_id': voice['id'], 'version': voice['version'],
        'parameters': {'rate': 1.0, 'volume': .7, 'pitch': .9},
        'scope': 'voice_asset', 'affects_future_generations': True}
    assert s.get('alice', voice['id']) == before
    assert len(s.list_('alice', 'studio_asset')) == 1
    assert len(calls) == 1 and calls[0][0] == 'GET'
    assert 'unrelated-private-id' not in response.text and 'voice-provider-id' not in response.text


@pytest.mark.parametrize('value,wire', [(.5, '0.5'), (2, '2'), ('1.20', '1.2'), ('2.0', '2'), (1.25, '1.25')])
def test_rate_uses_voice_edit_and_preserves_current_volume_pitch(studio, voice_http, value, wire):
    voice, calls, _ = voice_http
    response = update(studio, voice, rate=value)
    assert response.status_code == 200, response.text
    assert [call[0] for call in calls] == ['GET', 'POST']
    assert calls[-1][2] == {'voice': voice['provider_resource_id'], 'rate': wire, 'volume': '0.7', 'pitch': '0.9'}
    result = response.json()
    assert result['parameters']['rate'] == float(value) and result['scope'] == 'voice_asset'
    saved = s.get('alice', voice['id'])
    assert saved['voice_parameters'] == result['parameters'] and saved['voice_parameters_status'] == 'confirmed'
    assert saved['voice_edit_until'] == 0 and result['version'] == saved['version']
    assert not s.list_('alice', 'studio_run')
    assert update(studio, voice, rate=1.5).status_code == 409  # Stale edits never touch provider.
    assert len(calls) == 2


def test_explicit_all_parameters_forward_only_documented_strings(studio, voice_http):
    voice, calls, _ = voice_http
    response = update(studio, voice, rate=1.2, volume=.1, pitch=2)
    assert response.status_code == 200
    assert len(calls) == 1 and calls[0][2] == {'voice': voice['provider_resource_id'],
        'rate': '1.2', 'volume': '0.1', 'pitch': '2'}


@pytest.mark.parametrize('parameters', [
    {'rate': .49}, {'rate': 2.01}, {'rate': True}, {'rate': None}, {'rate': []}, {'rate': {}},
    {'rate': 'NaN'}, {'rate': 'inf'}, {'rate': '1e0'}, {'rate': ' 1.2'}, {'rate': '-1'},
    {'rate': '1.234567890123456789'}, {'rate': 1, 'volume': .09}, {'rate': 1, 'pitch': 2.1},
    {'rate': 1, 'volume': False}, {'voice': 'spoofed'}, {'owner': 'bob'}, {},
])
def test_invalid_parameters_are_rejected_without_http_or_storage_changes(studio, voice_http, parameters):
    voice, calls, _ = voice_http
    before = s.get('alice', voice['id'])
    assert update(studio, voice, **parameters).status_code == 400
    assert calls == [] and s.get('alice', voice['id']) == before


@pytest.mark.parametrize('value', [float('nan'), float('inf'), float('-inf')])
def test_non_json_finite_values_are_rejected_at_backend_boundary(studio, voice_http, value):
    voice, calls, _ = voice_http
    with pytest.raises(m.StudioError):
        m.voice_parameters('alice', voice['id'], {'version': voice['version'], 'confirmed': True, 'rate': value})
    assert not calls


@pytest.mark.parametrize('changes,headers,status', [
    ({'visibility': 'public'}, {}, 400), ({'archived': True}, {}, 404),
    ({'deleted': True}, {}, 404), ({'status': 'creating'}, {}, 400),
    ({'service_scope': 'other-account'}, {}, 400), ({'asset_type': 'avatar'}, {}, 400),
    ({}, {'Authorization': 'Bearer bob'}, 404), ({}, {'Authorization': ''}, 401),
])
def test_edit_and_read_only_authorize_own_current_ready_voices(studio, voice_http, changes, headers, status):
    voice, calls, _ = voice_http
    current = s.put('alice', 'studio_asset', {**voice, **changes}, voice['id'])
    assert studio.get(endpoint(voice), headers=headers).status_code == status
    assert studio.post(endpoint(voice), headers=headers, json={'version': current['version'], 'confirmed': True, 'rate': 1.2}).status_code == status
    assert not calls


def test_edit_requires_confirmation_and_version_before_http(studio, voice_http):
    voice, calls, _ = voice_http
    for data in ({'rate': 1.2}, {'rate': 1.2, 'confirmed': True},
                 {'rate': 1.2, 'version': voice['version'], 'confirmed': 1}):
        assert studio.post(endpoint(voice), json=data).status_code == 400
    assert not calls


@pytest.mark.parametrize('state', ['queued', 'preparing', 'submitting', 'running', 'unknown'])
def test_voice_edit_does_not_change_voice_of_an_existing_unfinished_generation(studio, voice_http, state):
    voice, calls, _ = voice_http
    run = s.put('alice', 'studio_run', {'status': state, 'snapshot': {'input': {'voice_id': voice['id']}}})
    assert update(studio, voice, rate=1.2).status_code == 400
    assert not calls and s.get('alice', run['id']) == run and s.get('alice', voice['id']) == voice


@pytest.mark.parametrize('state', ['failed', 'succeeded', 'interrupted', 'archive_failed', 'cancelled'])
def test_finished_or_unsubmitted_history_does_not_block_explicit_voice_edits(studio, voice_http, state):
    voice, _, _ = voice_http
    run = s.put('alice', 'studio_run', {'status': state, 'snapshot': {'input': {'voice_id': voice['id']}}})
    assert update(studio, voice, rate=1.2).status_code == 200
    assert s.get('alice', run['id']) == run


def test_voice_lookup_pages_do_not_import_or_return_other_account_resources(studio, voice_http):
    voice, calls, behavior = voice_http
    def page(request, body):
        if request.url.params['page'] == '1':
            return httpx.Response(200, json={'code': 0, 'data': [
                {'voice': 'unrelated-private-id-' + str(i), 'type': 8} for i in range(300)]})
        return httpx.Response(200, json={'code': 0, 'data': [
            {'voice': voice['provider_resource_id'], 'type': 22, 'rate': '1.25', 'volume': '1', 'pitch': '1'}]})
    behavior['handler'] = page
    result = studio.get(endpoint(voice))
    assert result.status_code == 200 and result.json()['parameters']['rate'] == 1.25
    assert len(calls) == 2 and len(s.list_('alice', 'studio_asset')) == 1
    assert 'unrelated-private-id' not in result.text


def test_voice_edit_does_not_block_unrelated_asset_reads_or_accept_simultaneous_edit(studio, voice_http):
    voice, calls, behavior = voice_http
    started, release = Event(), Event()
    def slow(request, body):
        if request.method == 'POST':
            started.set()
            assert release.wait(5)
    behavior['handler'] = slow
    with ThreadPoolExecutor(max_workers=1) as workers:
        pending = workers.submit(update, studio, voice, rate=1.2, volume=.7, pitch=.9)
        try:
            assert started.wait(2)
            items = studio.get('/api/studio/assets?asset_type=voice').json()['items']
            assert items[0]['resource_selectable'] is False and 'voice_edit_until' not in items[0]
            assert update(studio, voice, rate=1.5).status_code == 400
            assert studio.post('/api/studio/drafts', json={'tool': 'tts', 'input': {'text': '正在编辑', 'voice_id': voice['id']}, 'options': {}}).status_code == 400
            assert len(calls) == 1
        finally:
            release.set()
        assert pending.result(timeout=3).status_code == 200
    assert studio.get('/api/studio/assets?asset_type=voice').json()['items'][0]['resource_selectable'] is True


@pytest.mark.parametrize('failure', ['rejected', 'timeout', 'invalid_ack', 'missing_voice', 'bad_parameters', 'changed_account'])
def test_failure_never_reports_saved_rate_or_leaves_voice_locked(studio, voice_http, failure):
    voice, calls, behavior = voice_http
    def fail(request, body):
        if request.method == 'GET':
            if failure == 'missing_voice':return httpx.Response(200, json={'code': 0, 'data': []})
            if failure == 'bad_parameters':return httpx.Response(200, json={'code': 0, 'data': [
                {'voice': voice['provider_resource_id'], 'type': 8, 'rate': '1', 'volume': 'private-bad-value', 'pitch': '1'}]})
            if failure == 'changed_account':
                config = s.config(m.CONFIG);config['hifly']['secret'] = 'changed-test-scope';s.set_config(m.CONFIG, config)
        if request.method == 'POST':
            if failure == 'rejected':return httpx.Response(200, json={'code': 11, 'message': 'private-provider-error'})
            if failure == 'invalid_ack':return httpx.Response(200, json={'message': 'private-provider-error'})
            if failure == 'timeout':raise httpx.ReadTimeout('private-key-must-not-leak', request=request)
    behavior['handler'] = fail
    response = update(studio, voice, rate=1.2)
    assert response.status_code == 400
    assert 'private-' not in response.text
    saved = s.get('alice', voice['id'])
    assert saved['voice_edit_until'] == 0 and saved['voice_parameters_status'] == 'unverified'
    assert 'voice_parameters' not in saved
    if failure in ('missing_voice', 'bad_parameters', 'changed_account'):
        assert not any(call[0] == 'POST' for call in calls)


def test_recovery_marks_interrupted_voice_edit_unverified_without_provider_or_deleting_data(studio, voice_http):
    voice, calls, _ = voice_http
    saved = s.put('alice', 'studio_asset', {**voice, 'voice_edit_until': 9999999999,
        'voice_parameters': {'rate': 1.1, 'volume': 1, 'pitch': 1}}, voice['id'])
    m.recover()
    recovered = s.get('alice', voice['id'])
    assert recovered['voice_edit_until'] == 0 and recovered['voice_parameters_status'] == 'unverified'
    assert recovered['voice_parameters'] == saved['voice_parameters']
    assert not calls


@pytest.mark.parametrize('tool,video', [('text_avatar', False), ('text_avatar', True),
    ('audio_avatar', False), ('audio_avatar', True), ('photo_talk', False), ('tts', False)])
def test_generation_speed_options_are_not_silently_forwarded_or_applied_to_voice(studio, voice_http, tool, video):
    _, calls, _ = voice_http
    item = hifly_draft(studio, tool, video)
    before = s.get('alice', item['id'])
    for key in ('rate', 'speech_rate'):
        response = studio.patch('/api/studio/drafts/' + item['id'], json={
            'version': item['version'], 'options': {**item['options'], key: 1.2}})
        assert response.status_code == 400 and '不支持单次语速' in response.text
    assert calls == [] and s.get('alice', item['id']) == before


def test_catalog_distinguishes_voice_asset_setting_from_original_audio_video_speed(studio, voice_http):
    _, calls, _ = voice_http
    tools = {item['id']: item for item in studio.get('/api/studio/catalog').json()['tools']}
    for name in ('text_avatar', 'photo_talk', 'tts'):
        speed = tools[name]['speech_speed']
        assert speed['per_generation'] is False and speed['mode'] == 'voice_asset'
        assert speed['voice_edit']['parameters']['rate'] == {'min': .5, 'max': 2.0, 'default': 1.0, 'wire_type': 'string'}
        assert speed['voice_edit']['own_only'] is True
        assert 'rate' not in tools[name]['options']
    assert tools['text_avatar']['speech_speed']['source_video']['supported'] is False
    assert tools['audio_avatar']['speech_speed']['mode'] == 'original_audio'
    assert 'voice_edit' not in tools['audio_avatar']['speech_speed']
    assert tools['avatar_create']['speech_speed']['mode'] == 'not_applicable'
    assert tools['text_avatar']['resource_libraries'] == {
        'avatar': {'public_enabled': False, 'own_only': True}, 'voice': {'public_enabled': True, 'own_only': False}}
    assert not calls
