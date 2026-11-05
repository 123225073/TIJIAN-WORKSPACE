"""Task metadata and timestamps: isolated storage, no model/provider calls."""
import pytest
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.testclient import TestClient
from backend import media_studio as m, store as s


@pytest.fixture
def activity(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'activity.sqlite')
    s.init()
    app = FastAPI()
    def user(request: Request):
        owner = request.headers.get('authorization', '').removeprefix('Bearer ')
        if owner not in ('alice', 'bob'):
            raise HTTPException(401, '登录')
        return {'id': owner}
    def error(status, message):
        raise HTTPException(status, message)
    m.register(app, user, user, error)
    with TestClient(app, headers={'Authorization': 'Bearer alice'}) as client:
        yield client


def test_activity_is_bounded_owner_scoped_metadata_only(activity):
    for index in range(70):
        s.put('alice', 'job', {'title': f'写作 {index}', 'status': 'done', 'result': {'text': 'private output'}, 'input': {'action': 'studio_text', 'prompt': 'private prompt', 'secret': 'private secret'}, 'stream_text': 'private stream', 'secret': 'private secret'})
    own = s.put('alice', 'studio_run', {'title': '进行中图片', 'tool': 'text_image', 'status': 'running', 'started_at': '2026-11-01T00:00:00Z', 'snapshot': {'prompt': 'private prompt'}, 'result': {'data_uri': 'private binary'}})
    foreign = s.put('bob', 'job', {'title': 'bob private', 'status': 'running'})
    response = activity.get('/api/studio/activity')
    assert response.status_code == 200
    items = response.json()['items']
    assert len(items) == 60
    assert items[0]['id'] == own['id']
    assert all(item['id'] != foreign['id'] for item in items)
    assert 'private' not in response.text
    assert all(set(item) <= {'id', 'kind', 'title', 'status', 'created', 'started_at', 'finished_at', 'cancel_requested_at', 'interrupted_at', 'progress', 'error', 'progress_history', 'tool', 'task_id', 'version', 'updated', 'input'} for item in items)
    assert activity.get('/api/studio/activity', headers={'Authorization': 'Bearer bob'}).json()['items'][0]['id'] == foreign['id']


def test_terminal_transition_freezes_without_backfilling_legacy(activity, monkeypatch):
    run = s.put('alice', 'studio_run', {'tool': 'text_image', 'status': 'running', 'started_at': '2026-11-01T00:00:00Z'})
    monkeypatch.setattr(s, 'now', lambda: '2026-11-01T00:00:09Z')
    failed = m._update('alice', run['id'], status='failed')
    assert failed['finished_at'] == '2026-11-01T00:00:09Z'
    monkeypatch.setattr(s, 'now', lambda: '2026-11-02T00:00:00Z')
    assert m._update('alice', run['id'], status='failed', last_checked_at=s.now())['finished_at'] == failed['finished_at']
    legacy = s.put('alice', 'studio_run', {'status': 'succeeded'})
    assert 'finished_at' not in m._update('alice', legacy['id'], last_checked_at=s.now())
    assert 'finished_at' not in m._update('alice', legacy['id'], status='succeeded')


def test_worker_records_actual_start_and_failure(activity, monkeypatch):
    run = s.put('alice', 'studio_run', {'tool': 'text_image', 'provider': 'images', 'model_id': 'offline-only', 'status': 'queued'})
    def reject(*args, **kwargs):
        raise m.StudioError('隔离测试：未配置服务，未调用模型')
    monkeypatch.setattr(m.g, 'model_record', reject)
    m._work('alice', run['id'])
    finished = s.get('alice', run['id'])
    assert finished['status'] == 'failed'
    assert finished['started_at'] <= finished['finished_at']
    assert finished['error'] == '隔离测试：未配置服务，未调用模型'
