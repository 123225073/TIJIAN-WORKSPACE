"""Loading contracts use isolated SQLite only; no schedulers or providers."""
import json
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from backend import app as backend, gateway as g, media_registry as registry, media_studio as media, store as s


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'loading.sqlite')
    monkeypatch.setattr(g, 'KEYFILE', tmp_path / 'provider.key')
    s.init()
    owner = s.all_users()[0]['id']
    with s.conn() as c:
        c.execute('INSERT INTO sessions VALUES (?,?,?)', (s.digest('loading-test'), owner, 9999999999))
    def forbidden(*args, **kwargs):
        raise AssertionError('Loading must not access files or a provider')
    monkeypatch.setattr(g, 'generate', forbidden)
    monkeypatch.setattr(s, 'workspace', forbidden)
    monkeypatch.setattr(s, 'sync_files', forbidden)
    client = TestClient(backend.app, base_url='http://127.0.0.1', headers={'Authorization': 'Bearer loading-test'})
    yield client, owner
    client.close()


def test_bootstrap_omits_unrelated_history_and_stays_owner_scoped(isolated):
    client, owner = isolated
    source = s.put(owner, 'source', {'title': 'Long source', 'body': 'history ' * 50000})
    s.put(owner, 'studio_asset', {'title': 'Private file', 'local_file': 'unreachable.png'})
    profile = s.put(owner, 'profile', {'title': 'Identity'})
    s.put('another-owner', 'profile', {'title': 'Must not appear'})
    for n in range(12):
        s.put(owner, 'task', {'title': str(n), 'mode': 'qa', 'messages': [{'role': 'user', 'text': 'long ' * 1000}]})
    response = client.get('/api/bootstrap')
    assert response.status_code == 200
    payload = response.json()
    assert payload['complete'] is False
    assert profile['id'] in {x['id'] for x in payload['objects']}
    assert source['id'] not in {x['id'] for x in payload['objects']}
    assert len([x for x in payload['objects'] if x['kind'] == 'task']) == 8
    assert all('messages' not in x for x in payload['objects'] if x['kind'] == 'task')
    assert 'Must not appear' not in response.text
    assert len(response.content) < len(client.get('/api/state').content) / 10


@pytest.mark.parametrize('path', ['/api/auth/me', '/api/bootstrap', '/api/state'])
def test_readers_and_auth_do_not_wait_for_background_store_lock(isolated, path):
    client, owner = isolated
    s.put(owner, 'profile', {'title': 'Committed before lock'})
    # Future.result() is called while the writer lock is held. An endpoint using
    # store.conn() for auth/config would deadlock until this timeout.
    with ThreadPoolExecutor(max_workers=1) as pool:
        with s.LOCK:
            response = pool.submit(client.get, path).result(timeout=2)
            assert response.status_code == 200


def test_full_state_retains_public_contract_without_n_plus_one_reads(isolated, monkeypatch):
    client, owner = isolated
    s.set_config('providers', [{'id': 'offline', 'title': 'Offline', 'secret': 'do-not-expose'}])
    s.set_config('models', [{'id': 'text', 'title': 'Known title', 'provider': 'offline', 'published': True}])
    run = s.put(owner, 'studio_run', {'title': 'Run', 'snapshot': {'model_id': 'text', 'input': {'prompt': 'Hello'}, 'options': {}}, 'local_file': 'hidden', 'service_scope': 'private', 'result': {'data_uri': 'data:image/png;base64,'+'a'*500000}, 'prompt_original': 'Original'})
    expected = media._public(run)
    def forbid_config(*args, **kwargs):
        raise AssertionError('State should batch config reads')
    monkeypatch.setattr(s, 'config', forbid_config)
    response = client.get('/api/state')
    assert response.status_code == 200
    actual = next(x for x in response.json()['objects'] if x['id'] == run['id'])
    assert actual == expected
    assert actual['result_count'] == 1
    assert s.get(owner,run['id'])['result']['data_uri'] == run['result']['data_uri']
    assert client.get('/api/state/updates',params={'ids':run['id']}).json()['items'][0] == expected
    assert 'do-not-expose' not in response.text
    assert client.get('/api/bootstrap', headers={'Authorization': ''}).status_code == 401


def test_task_updates_include_all_outcomes_and_assets_atomically(isolated):
    client, owner = isolated
    other = s.put('other-owner', 'content', {'title': 'Foreign result'})
    asset = s.put(owner, 'studio_asset', {'title': 'Cover', 'asset_type': 'image', 'local_file': 'private', 'status': 'ready'})
    first = s.put(owner, 'content', {'title': 'Wechat', 'body': 'Complete body', 'cover_asset_id': asset['id']})
    second = s.put(owner, 'content', {'title': 'Moments', 'body': 'Second body'})
    run = s.put(owner, 'studio_run', {'title': 'Media', 'asset_ids': [asset['id']]})
    task = s.put(owner, 'task', {'title': 'Task', 'platform_outcomes': {'wechat': first['id'], 'moments': second['id'], 'foreign': other['id']}, 'media_runs': {'image': run['id']}, 'messages': [{'role': 'assistant', 'text': 'Done'}]})
    response = client.get('/api/state/updates', params={'ids': task['id']})
    assert response.status_code == 200
    objects = {x['id']: x for x in response.json()['items']}
    assert set(objects) == {task['id'], first['id'], second['id'], run['id'], asset['id']}
    assert objects[first['id']]['body'] == 'Complete body'
    assert 'local_file' not in objects[asset['id']]
    assert client.get('/api/state/updates', params={'ids': other['id']}).json() == {'items': []}
    assert client.get('/api/state/updates', params={'ids': 'invalid'}).status_code == 400


def test_registry_choices_reads_each_config_once_and_keeps_visibility(isolated, monkeypatch):
    s.set_config('ark_video_migrated', True)
    s.set_config(registry.PROVIDER_KEY, {'wavespeed': {'published': False}, 'ark': {'secret': 'not-a-real-key'}})
    expected = []
    for m in registry.models():
        try:
            model, provider = registry.choice('text_video', m['id'])
            expected.append('media:' + model['id'])
        except registry.RegistryError:
            pass
    original = s.config
    reads = []
    monkeypatch.setattr(s, 'config', lambda key, default=None: (reads.append(key), original(key, default))[1])
    choices = registry.choices('text_video')
    assert [x['id'] for x in choices] == expected
    assert reads.count(registry.PROVIDER_KEY) == 1
    assert reads.count(registry.MODEL_KEY) == 1
    assert all(x['configured'] for x in choices)
    assert 'not-a-real-key' not in json.dumps(choices)


def test_watcher_keeps_all_locking_reads_off_event_loop(monkeypatch):
    thread = threading.current_thread()
    calls = []
    def off_loop(name, result=None):
        def call(*args):
            assert threading.current_thread() is not thread, name+' blocked the event loop'
            calls.append(name)
            return result
        return call
    monkeypatch.setattr(media, 'tick', off_loop('media'))
    monkeypatch.setattr(s, 'all_users', off_loop('users', [{'id': 'isolated'}]))
    monkeypatch.setattr(s, 'config', off_loop('config', 'already-checked'))
    monkeypatch.setattr(s, 'sync_files', off_loop('files'))
    # Return actual maintenance structure, without touching a directory.
    def config(key, default=None):
        assert threading.current_thread() is not thread
        calls.append('config')
        return {'at': s.now()} if key.startswith('maintenance:') else 'isolated-workspace'
    monkeypatch.setattr(s, 'config', config)
    sleeps=0
    async def one_cycle(seconds):
        nonlocal sleeps
        sleeps+=1
        if sleeps>1:raise asyncio.CancelledError()
    monkeypatch.setattr(backend.asyncio, 'sleep', one_cycle)
    with pytest.raises(asyncio.CancelledError):asyncio.run(backend.watcher())
    assert calls == ['media','users','config','files','config']
