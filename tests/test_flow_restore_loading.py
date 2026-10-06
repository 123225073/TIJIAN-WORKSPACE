"""Offline restore measurements and contracts; disposable SQLite, no providers."""
import json
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend import store as s, workflows
from test_creation_workflow_isolation import client


def seed_history(owner, count):
    """Large completed works, unrelated sources and tasks, all synthetic."""
    rows = []
    for n in range(count):
        flow_id, draft_id = f'old-flow-{n}', f'old-draft-{n}'
        values = [
            (flow_id, 'studio_flow', {'brief': 'Historical work'}),
            (draft_id, 'studio_text_draft', {'flow_id': flow_id, 'tool': 'text', 'input': {'brief': 'x' * 40000}}),
            (f'content-{n}', 'content', {'flow_id': flow_id, 'body': 'x' * 120000}),
            (f'run-{n}', 'studio_run', {'flow_id': flow_id, 'draft_id': draft_id, 'result': {'data_uri': 'x' * 180000}}),
            (f'source-{n}', 'source', {'body': 'x' * 100000}),
            (f'task-{n}', 'task', {'messages': [{'text': 'x' * 60000}], 'media_outcomes': {}}),
        ]
        rows.extend((ident, owner, kind, json.dumps(data), 1, f'2025-01-{n % 28 + 1:02d}')
                    for ident, kind, data in values)
    with s.conn() as c:
        c.executemany('INSERT INTO objects VALUES (?,?,?,?,?,?)', rows)


@pytest.mark.parametrize('history_count', [0, 200])
def test_measure_restore_history_and_lock_wait(client, monkeypatch, history_count):
    seed_history('alice', history_count)
    row = s.put('alice', 'studio_flow', {'brief': 'Target'})
    draft = s.put('alice', 'studio_text_draft', {'tool': 'text', 'flow_id': row['id'], 'input': {}})
    row = s.put('alice', 'studio_flow', {**row, 'last_draft': draft['id']}, row['id'], row['version'])
    original = s.unpack
    decoded = []
    def counted(record):
        decoded.append(len(record['data']))
        return original(record)
    monkeypatch.setattr(s, 'unpack', counted)
    paths = ['/api/studio/flows', '/api/studio/flow?work_id=' + row['id'],
             f"/api/studio/flows/{row['id']}/drafts?tool=text"]
    metrics = {}
    for path in paths:
        elapsed = []
        decoded.clear()
        for _ in range(7):
            start = time.perf_counter()
            response = client.get(path)
            elapsed.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200
        metrics[path.split('?')[0].replace(row['id'], 'target')] = {
            'median_ms': round(statistics.median(elapsed), 2),
            'max_ms': round(max(elapsed), 2),
            'decoded_objects_per_request': len(decoded) // 7,
            'decoded_bytes_per_request': sum(decoded) // 7,
        }
        if path != '/api/studio/flows':
            assert len(decoded) == 14  # Only the target flow and its draft.
            assert sum(decoded) < 7000
    held = threading.Event()
    def hold_lock():
        with s.LOCK:
            held.set()
            time.sleep(.25)
    writer = threading.Thread(target=hold_lock)
    writer.start()
    assert held.wait(2)
    start = time.perf_counter()
    assert client.get(paths[1]).status_code == 200
    metrics['held_lock_ms'] = round((time.perf_counter() - start) * 1000, 2)
    writer.join()
    print(json.dumps({'history_works': history_count, 'rounds': 7, 'metrics': metrics}))


def test_restore_keeps_writer_lock_and_owned_validation(client):
    row = s.put('alice', 'studio_flow', {'brief': 'Owned'})
    with ThreadPoolExecutor(max_workers=1) as pool:
        with s.LOCK:
            request = pool.submit(client.get, '/api/studio/flow', params={'work_id': row['id']})
            time.sleep(.05)
            assert not request.done()
        assert request.result(timeout=3).status_code == 200
    assert client.get('/api/studio/flow', params={'work_id': row['id']}, headers={'authorization': 'bob'}).status_code == 404
    for flag in ('archived', 'deleted'):
        bad = s.put('alice', 'studio_flow', {flag: True})
        assert client.get('/api/studio/flow', params={'work_id': bad['id']}).status_code == 404


def test_restore_backfills_all_completed_scopes_without_provider_ids_becoming_tasks(client):
    rows = [s.put('alice', 'studio_flow', {'brief': str(n)}) for n in range(2)]
    for row in rows:
        draft = s.put('alice', 'studio_text_draft', {'flow_id': row['id'], 'tool': 'text'})
        content = s.put('alice', 'content', {'body': 'Synthetic result'})
        job = s.put('alice', 'job', {'input': {'draft_id': draft['id']}, 'status': 'done', 'result': {'content_id': content['id']}})
        run = s.put('alice', 'studio_run', {'draft_id': draft['id'], 'task_id': 'opaque-provider-id', 'asset_ids': []})
        asset = s.put('alice', 'studio_asset', {'run_id': run['id']})
        row.update(expected=[content['id'], job['id'], run['id'], asset['id']])
    assert client.get('/api/studio/flow', params={'work_id': rows[0]['id']}).status_code == 200
    for row in rows:
        for ident in row['expected']:
            result = s.get('alice', ident)
            assert result['flow_id'] == row['id']
            assert result['version'] == 2 and len(s.versions('alice', ident)) == 1
    before = [s.get('alice', ident) for row in rows for ident in row['expected']]
    client.get('/api/studio/flow', params={'work_id': rows[0]['id']})
    assert before == [s.get('alice', ident) for row in rows for ident in row['expected']]


def test_target_drafts_filter_before_decode_and_repair_only_the_target(client, monkeypatch):
    first, second = [s.put('alice', 'studio_flow', {'brief': str(n)}) for n in range(2)]
    drafts = [s.put('alice', 'studio_text_draft', {'flow_id': row['id'], 'tool': 'text'})
              for row in (first, second)]
    results = [s.put('alice', 'content', {'body': 'Synthetic output'}) for _ in drafts]
    for draft, result in zip(drafts, results):
        s.put('alice', 'job', {'status': 'done', 'input': {'draft_id': draft['id']}, 'result': {'content_id': result['id']}})
    hidden = s.put('alice', 'studio_text_draft', {'flow_id': first['id'], 'tool': 'text', 'archived': True})
    wrong_tool = s.put('alice', 'studio_draft', {'flow_id': first['id'], 'tool': 'text_image', 'input': {}, 'options': {}})
    foreign = s.put('bob', 'studio_text_draft', {'flow_id': first['id'], 'tool': 'text'})
    original = s.unpack
    seen = []
    def counted(record):
        seen.append(record['id'])
        return original(record)
    monkeypatch.setattr(s, 'unpack', counted)
    response = client.get(f"/api/studio/flows/{first['id']}/drafts", params={'tool': 'text'})
    assert response.status_code == 200
    assert [item['id'] for item in response.json()['items']] == [drafts[0]['id']]
    assert not {drafts[1]['id'], hidden['id'], wrong_tool['id'], foreign['id']} & set(seen)
    assert s.get('alice', results[0]['id'])['flow_id'] == first['id']
    assert s.get('alice', results[1]['id']) == results[1]
    assert client.get(f"/api/studio/flows/{first['id']}/drafts", headers={'authorization': 'bob'}).status_code == 404


def test_task_scope_backfill_keeps_exclusions_and_full_payload(client):
    standalone = s.put('alice', 'studio_draft', {'tool': 'text_image'})
    task = s.put('alice', 'task', {'media_outcomes': {'image': standalone['id']}})
    run = s.put('alice', 'studio_run', {'input': {'draft_id': standalone['id']}, 'task_id': 'provider-id', 'asset_ids': [], 'result': {'data_uri': 'synthetic-inline'}})
    asset = s.put('alice', 'studio_asset', {'run_id': run['id'], 'local_file': 'immutable.png', 'extra': {'keep': True}})
    protected = s.put('alice', 'content', {'task_id': task['id'], 'draft_id': standalone['id'], 'body': 'Task content'})
    other_owner = s.put('bob', 'studio_asset', {'run_id': run['id']})
    row = s.put('alice', 'studio_flow', {'brief': 'Trigger recovery'})
    assert client.get('/api/studio/flow', params={'work_id': row['id']}).status_code == 200
    assert s.get('alice', run['id'])['origin_task_id'] == task['id']
    assert s.get('alice', run['id'])['result'] == run['result']
    current = s.get('alice', asset['id'])
    assert current['origin_task_id'] == task['id']
    assert current['local_file'] == asset['local_file'] and current['extra'] == asset['extra']
    assert s.get('alice', protected['id']) == protected
    assert s.get('bob', other_owner['id']) == other_owner


def test_latest_restore_reads_only_one_flow_and_never_uses_cached_ownership(client, monkeypatch):
    seed_history('alice', 20)
    row = s.put('alice', 'studio_flow', {'brief': 'Latest'})
    def no_listing(*a, **k):
        raise AssertionError('Restore should not decode full object lists')
    monkeypatch.setattr(s, 'list_', no_listing)
    assert client.get('/api/studio/flow').json() == row
    changed = s.put('alice', 'studio_flow', {**row, 'brief': 'New version'}, row['id'], row['version'])
    assert client.get('/api/studio/flow').json() == changed
    assert client.get('/api/studio/flow', params={'work_id': row['id']}, headers={'authorization': 'bob'}).status_code == 404
    assert client.get('/api/studio/flow', headers={'authorization': 'bob'}).json() == {'version': 0}
