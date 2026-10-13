"""Independent contract repros; disposable fixture only, no production app lifespan.

Failing tests are proposed acceptance contracts, not product changes.
"""
import concurrent.futures
import json
import os
import sqlite3
import subprocess

import pytest

from test_creation_workflow_isolation import account, client
from test_outcome_handoff import source
from backend import media_studio, store as s, topics


def handoff(client, content, url):
    response = client.post(url, json={'version': content['version']})
    assert response.status_code == 200, response.text
    return response.json()['flow']


def run_source_node_test(pattern, fixture_name, fixture):
    environment = {**os.environ, fixture_name: json.dumps(fixture, ensure_ascii=True)}
    run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern,
                          'tests/outcome_handoff_adversarial.test.mjs'], env=environment,
                         capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert run.returncode == 0, run.stdout + run.stderr


@pytest.mark.parametrize('platform', ['wechat', 'channels', 'douyin'])
def test_real_topic_delivery_can_select_handoff_delivery(client, platform):
    account(client)
    task, content, url = source(platform)
    flow = handoff(client, content, url)
    items = client.get('/api/studio/deliveries', params={'flow_id': flow['id']}).json()['items']
    # TopicDelivery.tsx:82 uses exactly topic_id/platform/flow_id to pick the row.
    selected = next((x for x in items if x.get('topic_id') == flow['topic_id']
                     and x.get('platform') == platform and x.get('flow_id') == flow['id']), None)
    assert selected is not None, 'The real UI cannot select the committed delivery: platform is absent'


def test_existing_handoff_delivery_can_be_saved_through_real_api(client):
    account(client)
    task, content, url = source()
    flow = handoff(client, content, url)
    row = s.get('alice', flow['delivery_id'])
    response = client.patch('/api/studio/deliveries/' + row['id'],
                            json={'version': row['version'], 'summary': '人工修改摘要'})
    assert response.status_code == 200, response.text


def test_actual_topic_delivery_source_component_uses_api_result(client):
    account(client)
    task, content, url = source()
    result = client.post(url, json={'version': content['version']}).json()
    flow = result['flow']
    row = s.get('alice', flow['delivery_id'])
    edited = s.put('alice', 'studio_delivery', {**row, 'body': 'Edited delivery body',
                   'summary': 'Edited summary', 'cover_brief': 'Edited cover brief'}, row['id'])
    items = client.get('/api/studio/deliveries', params={'flow_id': flow['id']}).json()['items']
    fixture = {'flow': flow, 'route': result['route'], 'topic': s.get('alice', flow['topic_id']),
               'copy': s.get('alice', flow['content_id']), 'items': items, 'edited': edited}
    run_source_node_test('real TopicDelivery render', 'HANDOFF_REVIEW_FIXTURE', fixture)


def test_inline_media_survives_original_asset_trash(client):
    account(client)
    task, content, url = source()
    filename = s.uid() + '.png'
    media_studio._path('alice', filename).write_bytes(b'isolated image bytes')
    asset = s.put('alice', 'studio_asset', {'title': '正文图片', 'asset_type': 'image',
                  'status': 'ready', 'local_file': filename, 'mime_type': 'image/png'})
    content = s.put('alice', 'content', {**content, 'body': '正文\n\n![配图](/api/studio/assets/' + asset['id'] + '/file)'}, content['id'])
    flow = handoff(client, content, url)
    assert client.get('/api/studio/assets/' + asset['id'] + '/file').status_code == 200
    assert client.post('/api/objects/' + asset['id'] + '/trash').status_code == 200
    body = s.get('alice', flow['delivery_id'])['body']
    image_id = body.split('/api/studio/assets/')[1].split('/file')[0]
    result = client.get('/api/studio/assets/' + image_id + '/file')
    assert result.status_code == 200, 'Independent delivery still points to trashed source asset: ' + result.text


def test_handoff_topic_uses_snapshot_after_source_article_trash(client):
    account(client)
    task, content, url = source()
    flow = handoff(client, content, url)
    assert client.post('/api/objects/' + content['id'] + '/trash').status_code == 200
    topic = s.get('alice', flow['topic_id'])
    # The real optimize/generate routes resolve this list before any model call.
    sources = topics._sources('alice', topic['source_ids'])
    assert sources[0]['id'] == flow['content_id']


def test_explicit_generic_identity_survives_handoff(client):
    account(client)
    s.put('alice', 'profile', {'title': 'Another existing IP'})
    task, content, url = source()
    s.put('alice', 'task', {**task, 'identity_skipped': True, 'profile_id': ''}, task['id'])
    flow = handoff(client, content, url)
    # flowProfileInitial sees '' as unchosen unless the explicit skip marker survives.
    assert flow.get('identity_skipped') is True, 'Explicit no-IP becomes latest-IP fallback in the real UI'
    run_source_node_test('explicit no-IP handoff', 'HANDOFF_IDENTITY_FIXTURE',
                         {'flow': flow, 'profiles': s.list_('alice', 'profile')})


def test_control_same_process_concurrent_clicks_reuse_one_work(client):
    account(client)
    task, content, url = source()
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: client.post(url, json={'version': 1}), range(12)))
    assert all(x.status_code == 200 for x in responses)
    assert len({x.json()['flow']['id'] for x in responses}) == 1
    assert len(s.list_('alice', 'studio_flow')) == len(s.list_('alice', 'studio_delivery')) == 1


def test_control_sql_failure_rolls_back_all_new_rows(client):
    account(client)
    task, content, url = source()
    before = {x['id'] for x in s.list_('alice')}
    with s.conn() as connection:
        connection.execute("CREATE TRIGGER handoff_review_fault BEFORE INSERT ON objects "
                           "WHEN NEW.kind='studio_delivery' BEGIN SELECT RAISE(ABORT, 'review failure'); END")
    with pytest.raises(sqlite3.IntegrityError, match='review failure'):
        client.post(url, json={'version': 1})
    assert {x['id'] for x in s.list_('alice')} == before


@pytest.mark.parametrize('full_form', [False, True], ids=['partial-step-save', 'full-step-save'])
def test_step_saves_preserve_handoff_identity_provenance_and_replay(client, full_form):
    account(client)
    task, content, url = source()
    task = s.put('alice', 'task', {**task, 'identity_skipped': True, 'profile_id': ''}, task['id'])
    initial = handoff(client, content, url)
    edited_response = client.patch('/api/studio/deliveries/' + initial['delivery_id'],
                                  json={'version': 1, 'summary': 'Manual delivery summary'})
    assert edited_response.status_code == 200, edited_response.text
    edited_delivery = edited_response.json()
    metadata = {key: initial[key] for key in ('source_outcome_id', 'source_version',
                'source_task_id', 'delivery_id', 'identity_skipped')}
    current = initial
    # Exercise the actual wrapped flow API, both complete UI forms and partial saves.
    for stage in ('0', '1', '2', '3', '4'):
        payload = {**(current if full_form else {}), 'id': current['id'],
                   'version': current['version'], 'stage': stage}
        saved_response = client.post('/api/studio/flow', json=payload)
        assert saved_response.status_code == 200, saved_response.text
        current = client.get('/api/studio/flow', params={'work_id': initial['id']}).json()
        assert current['id'] == initial['id'] and current['stage'] == stage
        assert {key: current.get(key) for key in metadata} == metadata
        assert current['profile_id'] == '' and current['identity_skipped'] is True
        assert current['content_id'] == initial['content_id']
        assert current['topic_id'] == initial['topic_id']
        assert s.get('alice', current['topic_id'])['source_ids'] == [initial['content_id']]
        assert s.get('alice', current['content_id'])['flow_id'] == initial['id']
        assert s.get('alice', current['content_id'])['imported_from'] == content['id']
        assert s.get('alice', current['delivery_id']) == edited_delivery
        before_replay = s.list_('alice')
        replay = client.post(url, json={'version': content['version']})
        assert replay.status_code == 200, replay.text
        assert replay.json()['flow']['id'] == initial['id']
        assert replay.json()['flow']['identity_skipped'] is True
        assert replay.json()['flow']['source_outcome_id'] == content['id']
        assert s.list_('alice') == before_replay
    assert len(s.list_('alice', 'studio_flow')) == len(s.list_('alice', 'studio_delivery')) == 1
    assert client.get(url + 's').json()['items'][0]['id'] == initial['id']
    assert s.get('alice', content['id']) == content and s.get('alice', task['id']) == task


def test_changed_topic_replay_rejects_old_delivery_without_rebinding_or_duplicate(client):
    account(client)
    task, content, url = source()
    initial = handoff(client, content, url)
    old_topic = s.get('alice', initial['topic_id'])
    old_delivery = s.get('alice', initial['delivery_id'])
    new_response = client.post('/api/studio/topics', json={'title': 'A different chosen topic',
                               'source_ids': [], 'profile_id': '', 'origin': 'User manual selection'})
    assert new_response.status_code == 200, new_response.text
    new_topic = new_response.json()
    switched = client.post('/api/studio/flow', json={**initial, 'topic_id': new_topic['id'],
                           'brief': new_topic['title'], 'stage': '4', 'assembled': 'no'})
    assert switched.status_code == 200, switched.text
    current = client.get('/api/studio/flow', params={'work_id': initial['id']}).json()
    assert current['topic_id'] == new_topic['id']
    assert not client.get('/api/studio/deliveries', params={'flow_id': initial['id']}).json()['items']
    before_replay = s.list_('alice')
    replay = client.post(url, json={'version': content['version']})
    # A changed work requires review: do not attach its old delivery to the new topic.
    assert replay.status_code == 409, replay.text
    assert s.list_('alice') == before_replay
    assert s.get('alice', initial['delivery_id']) == old_delivery
    assert s.get('alice', initial['topic_id']) == old_topic
    assert s.get('alice', new_topic['id']) == new_topic
    assert old_topic['source_ids'] == [initial['content_id']]
    assert len(s.list_('alice', 'studio_flow')) == len(s.list_('alice', 'studio_delivery')) == 1
