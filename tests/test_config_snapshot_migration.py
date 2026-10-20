"""Interleaved configuration writes must survive read-side legacy migrations."""
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend import media_registry as registry, store as s, workflows
from test_creation_workflow_isolation import client


@pytest.mark.parametrize('operation', ['catalog', 'display_drafts'])
def test_migration_snapshot_serializes_admin_update_and_keeps_later_values(client, monkeypatch, operation):
    model_id = 'ark-seedance-25'
    s.set_config(registry.MODEL_KEY, {model_id: {'title': 'before'}})
    s.set_config('bindings', {'text_video': 'media:' + model_id, 'tts': 'service:hifly'})
    s.set_config('ark_video_migrated', False)
    s.set_config('hifly_digital_migrated', False)
    draft = s.put('alice', 'studio_draft', {
        'tool': 'text_video', 'model_id': 'media:' + model_id,
        'input': {'prompt': 'Offline migration review'}, 'options': {},
    })
    snapshot_entered = threading.Event()
    admin_attempted = threading.Event()
    admin_finished = threading.Event()
    blocked_during_migration = []
    original_models = registry.models

    def paused_models():
        if not snapshot_entered.is_set():
            # Both tested paths have entered their operation snapshot here.
            assert s.config(registry.MODEL_KEY)[model_id]['title'] == 'before'
            snapshot_entered.set()
            assert admin_attempted.wait(3), 'Administrator thread did not start'
            blocked_during_migration.append(not admin_finished.wait(.25))
        return original_models()

    monkeypatch.setattr(registry, 'models', paused_models)

    def admin_update():
        assert snapshot_entered.wait(3), 'Reader never reached the migration'
        admin_attempted.set()
        with s.LOCK:
            s.set_config(registry.MODEL_KEY, {model_id: {'title': 'admin-after'}})
            s.set_config('bindings', {'text_video': 'media:' + model_id, 'tts': ''})
            s.set_config('ark_video_migrated', True)
            s.set_config('hifly_digital_migrated', True)
        admin_finished.set()

    def read_operation():
        if operation == 'catalog':
            response = client.get('/api/studio/catalog')
            assert response.status_code == 200, response.text
        else:
            result = workflows._display_drafts('alice', [draft])
            assert result[0]['id'] == draft['id']

    with ThreadPoolExecutor(max_workers=2) as pool:
        admin = pool.submit(admin_update)
        reader = pool.submit(read_operation)
        reader.result(timeout=10)
        admin.result(timeout=10)

    assert admin_finished.is_set()
    assert s.config(registry.MODEL_KEY)[model_id]['title'] == 'admin-after'
    assert s.config('bindings')['tts'] == ''
    assert s.config('ark_video_migrated') is True
    assert s.config('hifly_digital_migrated') is True
    assert blocked_during_migration == [True], 'A migration must not reuse a stale pre-admin snapshot'
    # A subsequent request sees the committed admin values, not the old snapshot.
    response = client.get('/api/studio/catalog')
    assert response.status_code == 200, response.text
    tools = {tool['id']: tool for tool in response.json()['tools']}
    assert tools['tts']['binding'] == ''
    assert next(model for model in tools['text_video']['models']
                if model['id'] == 'media:' + model_id)['title'].startswith('admin-after · ')
