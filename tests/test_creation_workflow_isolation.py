"""Flow isolation contracts against disposable SQLite; no app lifespan or services."""
import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend import creation, gateway, interviews, media_studio, store as s, topics, workflows


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'isolation.sqlite')
    monkeypatch.setattr(gateway, 'KEYFILE', tmp_path / 'unused.key')
    def offline(*args, **kwargs):
        raise AssertionError('Isolation tests must not call external services')
    monkeypatch.setattr(gateway, 'generate', offline)
    monkeypatch.setattr(media_studio, '_request', offline)
    monkeypatch.setattr(workflows.network, 'article', offline)
    s.init()
    app = FastAPI()
    def user(request: Request):
        return {'id': request.headers.get('authorization', 'alice')}
    def error(status, message):
        raise HTTPException(status, message)
    @app.get('/api/state')
    def state(u=Depends(user)):
        # Mirror production's committed, read-only snapshot without store.LOCK.
        import sqlite3
        with sqlite3.connect(s.DB) as connection:
            connection.row_factory = sqlite3.Row
            records = connection.execute('SELECT * FROM objects WHERE owner=?', (u['id'],)).fetchall()
        return {'objects': [s.unpack(record) for record in records]}
    @app.get('/api/state/updates')
    def updates(ids: str, u=Depends(user)):
        objects = {obj['id']: obj for obj in state(u)['objects']}
        return {'items': [objects[ident] for ident in ids.split(',') if ident in objects]}
    @app.post('/api/objects/{kind}')
    def object_create(kind: str, data: dict, u=Depends(user)):
        return s.put(u['id'], kind, data)
    @app.patch('/api/objects/{id}')
    def object_patch(id: str, data: dict, u=Depends(user)):
        old = s.get(u['id'], id)
        return s.put(u['id'], old['kind'], {**old, **data}, id, data.get('version'))
    for exception, status in [(s.Missing, 404), (s.Conflict, 409), (ValueError, 400)]:
        async def handle(request, exc, _status=status):
            return JSONResponse({'detail': str(exc)}, status_code=_status)
        app.add_exception_handler(exception, handle)
    creation.register(app, user, user, error)
    topics.register(app, user, error)
    interviews.register(app, user)
    media_studio.register(app, user, user, error)
    workflows.register(app, user, error)
    with TestClient(app) as c:
        yield c


def account(client, email='creator@example.test'):
    owner = 'alice' if email == 'creator@example.test' else 'bob'
    client.headers['authorization'] = owner
    return {'user': {'id': owner}}


def flow(client, title='作品'):
    response = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'brief': title})
    assert response.status_code == 200, response.text
    return response.json()


def draft(client, row, tool='text'):
    response = client.post(f"/api/studio/flows/{row['id']}/drafts", json={
        'tool': tool, 'title': '草稿', 'input': {'brief': '正文'} if tool == 'text' else {'prompt': '电梯'},
        **({} if tool == 'text' else {'options': {}})})
    assert response.status_code == 200, response.text
    return response.json()


def test_scoped_drafts_survive_save_refresh_and_standalone_remains_independent(client):
    account(client)
    first, second = flow(client, '甲'), flow(client, '乙')
    for tool, legacy in [('text', '/api/studio/text/drafts'), ('text_image', '/api/studio/drafts')]:
        a, b = draft(client, first, tool), draft(client, second, tool)
        standalone = client.post(legacy, json={'tool': tool, 'title': '独立稿', 'input': {}, 'options': {}}).json()
        ai = s.put('alice', a['kind'], {'tool': tool, 'title': 'AI 草稿', 'input': {}, 'options': {}})
        s.put('alice', 'task', {'media_outcomes': {tool: ai['id']}})
        assert {x['id'] for x in client.get(legacy).json()['items']} == {standalone['id']}
        assert client.patch(legacy + '/' + a['id'], json={'version': a['version'], 'title': '串稿'}).status_code == 409
        assert client.patch(f"/api/studio/flows/{second['id']}/drafts/{a['id']}", json={'version': a['version']}).status_code == 409
        updated = client.patch(f"/api/studio/flows/{first['id']}/drafts/{a['id']}", json={'version': a['version'], 'title': '已改'}).json()
        assert updated['flow_id'] == first['id'] and s.get('alice', a['id'])['flow_id'] == first['id']
        assert client.patch(f"/api/studio/flows/{first['id']}/drafts/{a['id']}", json={'version': a['version'], 'title': '旧页面'}).status_code == 409
        assert client.patch(legacy + '/' + standalone['id'], json={'version': standalone['version'], 'title': '独立稿已改'}).status_code == 200
        assert {x['id'] for x in client.get(f"/api/studio/flows/{first['id']}/drafts", params={'tool': tool}).json()['items']} == {a['id']}
        assert s.get('alice', b['id'])['title'] == '草稿'


def test_flow_reference_rejects_ai_standalone_other_flow_and_wrong_tool(client):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    da, db = draft(client, a), draft(client, b)
    independent = client.post('/api/studio/text/drafts', json={'input': {}}).json()
    ai_content = s.put('alice', 'content', {'task_id': 'ai-task', 'body': 'AI 成果'})
    for ident in (db['id'], independent['id']):
        assert client.post('/api/studio/flow', json={**a, 'last_draft': ident, 'last_draft_tool': 'text'}).status_code == 409
    assert client.post('/api/studio/flow', json={**a, 'content_id': ai_content['id']}).status_code == 409
    assert client.post('/api/studio/flow', json={**a, 'last_draft': da['id'], 'last_draft_tool': 'image'}).status_code == 400
    saved = client.post('/api/studio/flow', json={**a, 'last_draft': da['id'], 'last_draft_tool': 'text'}).json()
    assert client.get('/api/studio/flow', params={'work_id': a['id']}).json()['last_draft'] == da['id']
    assert client.post('/api/studio/flow', json={**a, 'brief': '旧窗口'}).status_code == 409
    assert s.get('alice', saved['id'])['last_draft'] == da['id']


@pytest.mark.parametrize('kind,field,extra', [
    ('content', 'content_id', {'body': '原稿', 'task_id': 'task', 'file': 'must-not-reuse.md', 'check': {'ready': True}}),
    ('studio_asset', 'cover_id', {'asset_type': 'image', 'status': 'ready', 'local_file': 'immutable-image.png'}),
    ('studio_text_draft', 'last_draft', {'tool': 'text', 'input': {'brief': '原始要求'}, 'job_ids': ['old-job'], 'job_versions': {'old-job': 1}}),
    ('studio_draft', 'last_draft', {'tool': 'text_image', 'input': {'prompt': '原始画面'}, 'options': {}}),
])
def test_import_creates_two_independent_copies_without_touching_source(client, kind, field, extra):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    original = s.put('alice', kind, {'title': '来源', **extra})
    results = []
    for row in (a, b):
        response = client.post(f"/api/studio/flows/{row['id']}/imports", json={'field': field, 'source_id': original['id'], 'version': row['version']})
        assert response.status_code == 200, response.text
        result = response.json()
        copied = next(value for key, value in result.items() if key != 'flow')
        assert copied['id'] != original['id'] and copied['flow_id'] == row['id']
        assert result['flow'][field] == copied['id']
        assert copied.get('task_id') is None and copied.get('file') is None
        if kind == 'studio_text_draft':
            assert copied['job_ids'] == [] and copied['job_versions'] == {}
        results.append(copied)
    assert results[0]['id'] != results[1]['id']
    edited = s.put('alice', kind, {**results[0], 'title': '修改甲副本'}, results[0]['id'], results[0]['version'])
    assert edited['title'] == '修改甲副本'
    assert s.get('alice', results[1]['id'])['title'] == '来源'
    assert s.get('alice', original['id']) == original
    assert client.post(f"/api/studio/flows/{a['id']}/imports", json={'field': field, 'source_id': original['id'], 'version': a['version']}).status_code == 409


def test_legacy_shared_references_upgrade_to_separate_copies_once(client):
    account(client)
    original = s.put('alice', 'studio_text_draft', {'tool': 'text', 'input': {'brief': '旧草稿'}, 'job_ids': []})
    content = s.put('alice', 'content', {'title': '旧成果', 'body': '正文'})
    rows = [s.put('alice', 'studio_flow', {'brief': name, 'last_draft': original['id'], 'last_draft_tool': 'text', 'content_id': content['id']}) for name in ('旧甲', '旧乙')]
    upgraded = [client.get('/api/studio/flow', params={'work_id': row['id']}).json() for row in rows]
    assert len({row['last_draft'] for row in upgraded}) == 2
    assert len({row['content_id'] for row in upgraded}) == 2
    for row in upgraded:
        assert s.get('alice', row['last_draft'])['flow_id'] == row['id']
        assert client.get('/api/studio/flow', params={'work_id': row['id']}).json() == row
    assert s.get('alice', original['id']) == original
    assert s.get('alice', content['id']) == content
    # No schema marker required for standalone drafts created before ownership.
    assert client.patch('/api/studio/text/drafts/' + original['id'], json={'version': original['version'], 'title': '独立编辑'}).status_code == 200


def test_import_and_scoped_endpoints_enforce_owner_kind_and_asset_type(client):
    account(client)
    a = flow(client)
    da = draft(client, a)
    audio = s.put('alice', 'studio_asset', {'asset_type': 'audio', 'status': 'ready'})
    before = s.get('alice', a['id'])
    assert client.post(f"/api/studio/flows/{a['id']}/imports", json={'field': 'cover_id', 'source_id': audio['id']}).status_code == 400
    assert client.post(f"/api/studio/flows/{a['id']}/imports", json={'field': 'content_id', 'source_id': da['id']}).status_code == 404
    assert s.get('alice', a['id']) == before
    account(client, 'other@example.test')
    own = flow(client)
    assert client.get(f"/api/studio/flows/{a['id']}/drafts").status_code == 404
    assert client.post(f"/api/studio/flows/{a['id']}/drafts", json={'tool': 'text', 'input': {}}).status_code == 404
    assert client.patch(f"/api/studio/flows/{own['id']}/drafts/{da['id']}", json={'version': da['version']}).status_code == 404
    assert client.post(f"/api/studio/flows/{own['id']}/imports", json={'field': 'last_draft', 'source_id': da['id']}).status_code == 404


def test_platform_deliveries_filter_by_flow_copy_and_keep_binding(client):
    account(client)
    topic = client.post('/api/studio/topics', json={'title': '选题'}).json()
    rows = [flow(client, name) for name in ('甲', '乙')]
    rows = [client.post('/api/studio/flow', json={**row, 'topic_id': topic['id']}).json() for row in rows]
    original = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat', 'body': '独立正文'}).json()
    assert [x['id'] for x in client.get('/api/studio/deliveries').json()['items']] == [original['id']]
    copies = []
    for row in rows:
        result = client.post(f"/api/studio/flows/{row['id']}/imports", json={'field': 'delivery_id', 'source_id': original['id']}).json()
        copies.append(result['delivery'])
        assert {x['id'] for x in client.get('/api/studio/deliveries', params={'flow_id': row['id']}).json()['items']} == {result['delivery']['id']}
    assert client.patch('/api/studio/deliveries/' + copies[0]['id'], json={'version': copies[0]['version'], 'flow_id': rows[1]['id'], 'body': '串稿'}).status_code == 409
    changed = client.patch('/api/studio/deliveries/' + copies[0]['id'], json={'version': copies[0]['version'], 'body': '甲改稿'}).json()
    assert changed['flow_id'] == rows[0]['id']
    assert s.get('alice', copies[1]['id'])['body'] == '独立正文'
    assert s.get('alice', original['id']) == original
    account(client, 'other@example.test')
    assert client.get('/api/studio/deliveries', params={'flow_id': rows[0]['id']}).status_code == 404


def test_generate_checks_flow_context_before_any_model_call(client):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    for tool, path in [('text', '/api/studio/text/generate'), ('text_image', '/api/studio/generate')]:
        da = draft(client, a, tool)
        for context in ('', b['id']):
            assert client.post(path, json={'draft_id': da['id'], 'version': da['version'], 'flow_id': context, 'brief': '请求'}).status_code == 409
    independent = client.post('/api/studio/text/drafts', json={'input': {}}).json()
    assert client.post('/api/studio/text/generate', json={'draft_id': independent['id'], 'flow_id': a['id'], 'brief': '请求'}).status_code == 409


def test_task_map_restore_branch_patch_and_cross_context_isolation(client, monkeypatch):
    account(client)
    original = s.put('alice', 'studio_draft', {'tool': 'text_image', 'title': 'AI方案', 'input': {'prompt': '原始画面'}, 'options': {}})
    task = s.put('alice', 'task', {'media_outcomes': {'image': original['id']}})
    other = s.put('alice', 'task', {'media_outcomes': {}})
    base = f"/api/studio/tasks/{task['id']}/drafts"
    restored = client.get(base).json()['items'][0]
    assert restored['id'] == original['id'] and restored['origin_task_id'] == task['id']
    assert client.get('/api/studio/drafts').json()['items'] == []
    assert client.patch('/api/studio/drafts/' + original['id'], json={'version': original['version'], 'title': '错误上下文'}).status_code == 409
    updated = client.patch(base + '/' + original['id'], json={'version': original['version'], 'title': '合法任务编辑'}).json()
    assert updated['origin_task_id'] == task['id']
    assert s.get('alice', original['id'])['origin_task_id'] == task['id']
    assert client.patch(f"/api/studio/tasks/{other['id']}/drafts/{original['id']}", json={'version': updated['version']}).status_code == 409
    branch = client.post(base, json={'tool': 'text_image', 'title': '新分支', 'input': {'prompt': '新画面'}, 'options': {}}).json()
    assert branch['id'] != original['id'] and branch['origin_task_id'] == task['id']
    assert s.get('alice', task['id']) == task
    assert {obj['id'] for obj in client.get(base).json()['items']} == {original['id'], branch['id']}
    assert client.get('/api/studio/drafts').json()['items'] == []
    # Exercise the actual registered media handler, with only its billable core stubbed.
    seen = []
    def local_generate(owner, data, enqueue=None):
        seen.append(data)
        return s.put(owner, 'studio_run', {'draft_id': data['draft_id'], 'status': 'queued', 'task_id': 'provider-task-opaque', 'asset_ids': []})
    monkeypatch.setattr(media_studio, 'generate', local_generate)
    request = {'draft_id': updated['id'], 'version': updated['version'], 'request_id': 'original-task', 'confirmed': True}
    assert client.post('/api/studio/generate', json=request).status_code == 200
    assert len(seen) == 1 and 'task_id' not in seen[0] and 'origin_task_id' not in seen[0]
    assert client.post('/api/studio/generate', json={**request, 'task_id': other['id']}).status_code == 409
    assert client.post('/api/studio/generate', json={**request, 'draft_id': branch['id'], 'version': branch['version']}).status_code == 409
    assert client.post('/api/studio/generate', json={**request, 'draft_id': branch['id'], 'version': branch['version'], 'origin_task_id': task['id']}).status_code == 200
    assert client.post('/api/studio/generate', json={**request, 'task_id': task['id'], 'origin_task_id': other['id']}).status_code == 400
    account(client, 'other@example.test')
    assert client.get(base).status_code == 404
    assert client.post(base, json={'tool': 'text', 'input': {}}).status_code == 404


@pytest.mark.parametrize('field,asset_type', [('visual_id', 'image'), ('cover_id', 'image'), ('video_id', 'video'), ('audio_id', 'audio')])
def test_all_flow_asset_references_reject_foreign_and_copy_existing_legacy(client, field, asset_type):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    foreign = s.put('alice', 'studio_asset', {'asset_type': asset_type, 'status': 'ready', 'flow_id': b['id']})
    assert client.post('/api/studio/flow', json={**a, field: foreign['id']}).status_code == 409
    independent = s.put('alice', 'studio_asset', {'asset_type': asset_type, 'status': 'ready'})
    assert client.post('/api/studio/flow', json={**a, field: independent['id']}).status_code == 409
    legacy = s.put('alice', 'studio_flow', {'brief': '旧作品', field: foreign['id']})
    assert client.get(f"/api/studio/flows/{legacy['id']}/drafts").status_code == 200
    assert s.get('alice', legacy['id']) == legacy  # GET drafts never upgrades flow/version.
    upgraded = client.get('/api/studio/flow', params={'work_id': legacy['id']}).json()
    assert upgraded[field] != foreign['id']
    assert s.get('alice', upgraded[field])['flow_id'] == legacy['id']
    assert client.get('/api/studio/flow', params={'work_id': legacy['id']}).json() == upgraded
    assert s.get('alice', foreign['id']) == foreign


def test_explicit_flow_read_recovers_scope_then_state_refresh_stays_read_only(client):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    da, db = draft(client, a), draft(client, b, 'text_image')
    content = s.put('alice', 'content', {'body': '甲生成稿'})
    job = s.put('alice', 'job', {'status': 'done', 'input': {'draft_id': da['id']}, 'result': {'content_id': content['id']}})
    run = s.put('alice', 'studio_run', {'draft_id': db['id'], 'status': 'succeeded', 'task_id': 'external-provider-id', 'asset_ids': []})
    asset = s.put('alice', 'studio_asset', {'asset_type': 'image', 'status': 'ready', 'run_id': run['id']})
    ai = s.put('alice', 'content', {'task_id': 'workspace-task', 'body': 'AI 成果'})
    # General state polling never repairs records or waits for the writer lock.
    client.get('/api/state')
    assert s.get('alice', content['id']) == content
    assert s.get('alice', asset['id']) == asset
    assert client.get('/api/studio/flow', params={'work_id': a['id']}).status_code == 200
    refreshed = {obj['id']: obj for obj in client.get('/api/state/updates', params={'ids': ','.join([content['id'], asset['id']])}).json()['items']}
    assert refreshed[content['id']]['flow_id'] == a['id']
    assert refreshed[asset['id']]['flow_id'] == b['id']
    assert s.get('alice', run['id'])['flow_id'] == b['id']
    assert s.get('alice', run['id'])['task_id'] == 'external-provider-id'
    assert s.get('alice', job['id'])['flow_id'] == a['id']
    assert s.get('alice', ai['id']) == ai
    after = s.get('alice', content['id'])
    client.get('/api/state')
    assert s.get('alice', content['id']) == after
    assert client.post('/api/studio/flow', json={**a, 'content_id': content['id']}).status_code == 200
    assert client.post('/api/studio/flow', json={**b, 'content_id': content['id']}).status_code == 409


def test_general_state_readers_never_take_flow_writer_lock_or_sync(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    account(client)
    content = s.put('alice', 'content', {'body': '已提交版本'})
    def forbidden(*args, **kwargs):
        raise AssertionError('General readers must not run workflow repair')
    monkeypatch.setattr(workflows, '_sync_flow_outputs', forbidden)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with s.LOCK:
            for endpoint in ['/api/state', '/api/state/updates?ids=' + content['id']]:
                response = pool.submit(client.get, endpoint).result(timeout=2)
                assert response.status_code == 200
    assert s.get('alice', content['id']) == content


def test_manual_draft_import_keeps_source_version_and_each_flows_edits(client):
    account(client)
    a, b = flow(client, '第一作品'), flow(client, '第二作品')
    original = client.post('/api/studio/text/drafts', json={
        'title': '独立原稿', 'input': {'brief': '初版', 'format': '通用文案', 'target_words': 750}
    }).json()
    edited = client.patch('/api/studio/text/drafts/' + original['id'], json={
        'version': original['version'], 'input': {'brief': '人工修订版', 'format': '通用文案', 'target_words': 750}
    }).json()
    copies = []
    for row in (a, b):
        imported = client.post(f"/api/studio/flows/{row['id']}/imports", json={
            'field': 'last_draft', 'source_id': edited['id'], 'version': row['version']
        }).json()['draft']
        assert imported['imported_version'] == edited['version']
        assert imported['input'] == edited['input']
        copies.append(imported)
    patch = client.patch(f"/api/studio/flows/{a['id']}/drafts/{copies[0]['id']}", json={
        'version': copies[0]['version'], 'input': {'brief': '仅第一作品改写', 'format': '通用文案', 'target_words': 900}
    })
    assert patch.status_code == 200
    assert s.get('alice', copies[1]['id']) == copies[1]
    assert s.get('alice', edited['id']) == edited
    assert client.patch(f"/api/studio/flows/{a['id']}/drafts/{copies[0]['id']}", json={
        'version': copies[0]['version'], 'title': '旧窗口'
    }).status_code == 409
    assert client.patch(f"/api/studio/flows/{b['id']}/drafts/{copies[0]['id']}", json={
        'version': patch.json()['version'], 'title': '另一个流程'
    }).status_code == 409


def test_scoped_text_save_rejects_other_draft_job_and_generate_returns_owned_result(client, monkeypatch):
    account(client)
    row = flow(client)
    a, b = draft(client, row), draft(client, row)
    other_job = s.put('alice', 'job', {'input': {'draft_id': b['id']}, 'status': 'done'})
    assert client.patch(f"/api/studio/flows/{row['id']}/drafts/{a['id']}", json={'version': a['version'], 'job_ids': [other_job['id']]}).status_code == 409
    class ImmediatePool:
        def submit(self, fn, *args):
            fn(*args)
    monkeypatch.setattr(creation.jobs, 'POOL', ImmediatePool())
    monkeypatch.setattr(gateway, 'select', lambda *args, **kwargs: 'offline-test-model')
    monkeypatch.setattr(gateway, 'generate', lambda *args, **kwargs: '仅用于隔离测试的文案')
    s.set_config('bindings', {'writing': 'offline-test-model'})
    result = client.post('/api/studio/text/generate', json={'draft_id': a['id'], 'flow_id': row['id'], 'brief': '测试文案', 'request_id': 'isolated-text'})
    assert result.status_code == 200, result.text
    finished = s.get('alice', result.json()['id'])
    assert finished['status'] == 'done', finished
    content = s.get('alice', finished['result']['content_id'])
    assert content['flow_id'] == row['id']
    assert content['body'] == '仅用于隔离测试的文案'


def test_generic_object_routes_cannot_forge_or_reassign_scope(client):
    account(client)
    a, b = flow(client, '甲'), flow(client, '乙')
    original = s.put('alice', 'content', {'flow_id': a['id'], 'title': '甲稿', 'body': '原稿'})
    for field, value in [('flow_id', b['id']), ('flow_id', ''), ('task_id', 'pretend-task'), ('origin_task_id', 'pretend-task')]:
        assert client.patch('/api/objects/' + original['id'], json={'version': original['version'], field: value}).status_code == 400
    assert s.get('alice', original['id']) == original
    assert client.post('/api/objects/content', json={'title': '伪造', 'flow_id': a['id']}).status_code == 400
    assert client.post('/api/objects/content', json={'title': '伪造链路', 'studio_draft_id': 'pretend-draft'}).status_code == 400
    saved = client.patch('/api/objects/' + original['id'], json={'version': original['version'], 'body': '甲稿合法编辑'}).json()
    assert saved['flow_id'] == a['id']
