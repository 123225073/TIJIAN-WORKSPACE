"""Scoped draft identity survives tool saves without widening owner or flow access."""
import pytest

from backend import store as s
from test_creation_workflow_isolation import client, account, flow


@pytest.mark.parametrize('tool', ['text', 'text_image'])
@pytest.mark.parametrize('channel', ['wechat', 'xiaohongshu', 'moments', 'video', 'avatar'])
def test_binding_survives_create_patch_listing_and_topic_rename(client, tool, channel):
    account(client)
    work = flow(client)
    topic = s.put('alice', 'studio_topic', {'title': '主题'})
    base = f"/api/studio/flows/{work['id']}/drafts"
    binding = {'topic_id': topic['id'], 'creation_channel': channel}
    created = client.post(base, json={'tool': tool, 'input': {}, **binding})
    assert created.status_code == 200, created.text
    draft = created.json()
    assert all(draft[k] == v for k, v in binding.items())
    s.put('alice', 'studio_topic', {**topic, 'title': '主题改名'}, topic['id'])
    # Tool saves need not know or resend the immutable identity fields.
    patched = client.patch(base + '/' + draft['id'], json={'version': draft['version'], 'title': '人工改名', 'input': {}})
    assert patched.status_code == 200, patched.text
    saved = patched.json()
    assert all(saved[k] == v for k, v in binding.items())
    assert all(s.get('alice', draft['id'])[k] == v for k, v in binding.items())
    listed = client.get(base, params={'tool': tool}).json()['items']
    assert len(listed) == 1 and all(listed[0][k] == v for k, v in binding.items())
    same = client.patch(base + '/' + draft['id'], json={'version': saved['version'], **binding})
    assert same.status_code == 200
    assert all(same.json()[k] == v for k, v in binding.items())
    standalone = '/api/studio/text/drafts' if tool == 'text' else '/api/studio/drafts'
    assert client.get(standalone).json()['items'] == []
    assert client.patch(standalone + '/' + draft['id'], json={'version': same.json()['version'], 'title': '错误范围'}).status_code == 409


def test_binding_rejects_partial_invalid_foreign_and_inactive_topics_without_creating(client):
    account(client)
    work = flow(client)
    topic = s.put('alice', 'studio_topic', {'title': '合法选题'})
    foreign = s.put('bob', 'studio_topic', {'title': '别人的选题'})
    archived = s.put('alice', 'studio_topic', {'title': '归档选题', 'archived': True})
    deleted = s.put('alice', 'studio_topic', {'title': '删除选题', 'deleted': True})
    wrong_kind = s.put('alice', 'content', {'title': '非选题'})
    base = f"/api/studio/flows/{work['id']}/drafts"
    valid = {'tool': 'text', 'input': {}, 'topic_id': topic['id'], 'creation_channel': 'wechat'}
    bad_inputs = [({k: v for k, v in valid.items() if k != missing}, 400) for missing in ('topic_id', 'creation_channel')]
    bad_inputs += [({**valid, 'creation_channel': bad}, 400) for bad in ('', None, 1, [], 'douyin', 'unknown')]
    bad_inputs += [({**valid, 'topic_id': bad}, 400) for bad in ('', None, 1, [], 'a' * 129)]
    bad_inputs += [({**valid, 'topic_id': row['id']}, 404) for row in (foreign, archived, deleted, wrong_kind)]
    for data, status in bad_inputs:
        response = client.post(base, json=data)
        assert response.status_code == status, response.text
    assert client.get(base).json()['items'] == []


@pytest.mark.parametrize('tool', ['text', 'text_image'])
def test_bound_patch_cannot_clear_reassign_or_cross_owner_flow(client, tool):
    account(client)
    work, other = flow(client), flow(client)
    topic = s.put('alice', 'studio_topic', {'title': '原选题'})
    next_topic = s.put('alice', 'studio_topic', {'title': '新选题'})
    base = f"/api/studio/flows/{work['id']}/drafts"
    draft = client.post(base, json={'tool': tool, 'input': {}, 'topic_id': topic['id'], 'creation_channel': 'wechat'}).json()
    before = s.get('alice', draft['id'])
    for change in ({'topic_id': ''}, {'topic_id': None}, {'topic_id': next_topic['id']},
                   {'creation_channel': ''}, {'creation_channel': 'moments'}):
        assert client.patch(base + '/' + draft['id'], json={'version': draft['version'], **change}).status_code == 409
        assert s.get('alice', draft['id']) == before
    assert client.patch(f"/api/studio/flows/{other['id']}/drafts/{draft['id']}", json={'version': draft['version']}).status_code == 409
    account(client, 'bob@example.test')
    assert client.get(base).status_code == 404
    assert client.patch(base + '/' + draft['id'], json={'version': draft['version']}).status_code == 404
    own = flow(client)
    assert client.post(f"/api/studio/flows/{own['id']}/drafts", json={
        'tool': tool, 'input': {}, 'topic_id': topic['id'], 'creation_channel': 'wechat',
    }).status_code == 404


def test_legacy_draft_stays_unbound_unless_explicit_valid_pair_is_supplied(client):
    account(client)
    work = flow(client, '与选题同名')
    topic = s.put('alice', 'studio_topic', {'title': '与选题同名'})
    base = f"/api/studio/flows/{work['id']}/drafts"
    draft = client.post(base, json={'tool': 'text', 'title': topic['title'], 'input': {}}).json()
    saved = client.patch(base + '/' + draft['id'], json={'version': draft['version'], 'title': topic['title']}).json()
    assert 'topic_id' not in saved and 'creation_channel' not in saved
    assert 'topic_id' not in client.get(base).json()['items'][0]
    assert client.patch(base + '/' + draft['id'], json={'version': saved['version'], 'topic_id': topic['id']}).status_code == 400
    bound = client.patch(base + '/' + draft['id'], json={
        'version': saved['version'], 'topic_id': topic['id'], 'creation_channel': 'wechat',
    })
    assert bound.status_code == 200 and bound.json()['topic_id'] == topic['id']
    standalone = client.post('/api/studio/text/drafts', json={'input': {}}).json()
    assert client.patch('/api/studio/text/drafts/' + standalone['id'], json={
        'version': standalone['version'], 'topic_id': topic['id'], 'creation_channel': 'wechat',
    }).status_code == 400
    assert client.post('/api/studio/text/drafts', json={
        'input': {}, 'topic_id': topic['id'], 'creation_channel': 'wechat',
    }).status_code == 400
