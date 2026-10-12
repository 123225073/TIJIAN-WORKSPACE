"""Legacy speech copies retain independent references; disposable SQLite only."""
import pytest

from test_creation_workflow_isolation import client, flow
from backend import store as s, workflows


def legacy_flow(client, tool='tts', source=None, extra_source=None):
    row = flow(client)
    source = source or s.put('alice', 'content', {
        'title': '旧文稿', 'body': '# 旧标题\n\n完整口播正文。'})
    ids = [source['id']] + ([extra_source['id']] if extra_source else [])
    draft = s.put('alice', 'studio_draft', {
        'tool': tool, 'input': {'text': '用户手改口播 # 保留原话'},
        'options': {}, 'source_ids': ids})
    legacy = s.put('alice', 'studio_flow', {
        **row, 'content_id': source['id'], 'last_draft': draft['id'],
        'last_draft_tool': 'audio/tts' if tool == 'tts' else 'avatar/text'}, row['id'])
    return legacy, source, draft


def upgrade(client, row, route):
    response = (client.get('/api/studio/flow', params={'work_id': row['id']})
                if route == 'read' else client.post('/api/studio/flow', json=row))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize('route', ['read', 'save'])
@pytest.mark.parametrize('tool', ['tts', 'text_avatar'])
def test_legacy_copy_can_edit_after_original_content_archived(client, route, tool):
    reference = s.put('alice', 'source', {'title': '独立参考', 'body': '仍需引用'})
    row, original, old_draft = legacy_flow(client, tool, extra_source=reference)
    copied = upgrade(client, row, route)
    draft = s.get('alice', copied['last_draft'])
    assert copied['content_id'] != original['id']
    assert draft['id'] != old_draft['id']
    assert draft['input'] == old_draft['input']
    assert draft['source_ids'] == [copied['content_id'], reference['id']]
    assert s.get('alice', original['id']) == original
    assert s.get('alice', old_draft['id']) == old_draft
    s.put('alice', 'content', {**original, 'archived': True},
          original['id'], original['version'])
    response = client.patch('/api/studio/flows/' + row['id'] + '/drafts/' + draft['id'],
                            json={'version': draft['version'],
                                  'input': {'text': '用户后续编辑，保留完整结尾。'}})
    assert response.status_code == 200, response.text
    assert response.json()['source_ids'] == [copied['content_id'], reference['id']]
    assert s.get('alice', old_draft['id']) == old_draft
    assert client.get('/api/studio/flow', params={'work_id': row['id']}).json() == copied


def test_shared_legacy_document_maps_only_to_each_flow_copy(client):
    a, original, old_a = legacy_flow(client)
    b, _, old_b = legacy_flow(client, source=original)
    upgraded = [upgrade(client, a, 'read'), upgrade(client, b, 'save')]
    assert upgraded[0]['content_id'] != upgraded[1]['content_id']
    for row in upgraded:
        draft = s.get('alice', row['last_draft'])
        assert draft['source_ids'] == [row['content_id']]
        assert s.get('alice', row['content_id'])['flow_id'] == row['id']
    assert s.get('alice', original['id']) == original
    assert s.get('alice', old_a['id']) == old_a
    assert s.get('alice', old_b['id']) == old_b
    # A draft belonging to one copy cannot be edited through the other flow.
    response = client.patch('/api/studio/flows/' + upgraded[1]['id'] + '/drafts/'
                            + upgraded[0]['last_draft'], json={'version': 1,
                            'input': {'text': '不得串到其他作品'}})
    assert response.status_code == 409, response.text


def test_foreign_source_reference_is_not_remapped_or_allowed(client):
    foreign = s.put('bob', 'content', {'title': '其他用户', 'body': '私密原文'})
    row, _, _ = legacy_flow(client, extra_source=foreign)
    copied = upgrade(client, row, 'read')
    draft = s.get('alice', copied['last_draft'])
    assert draft['source_ids'] == [copied['content_id'], foreign['id']]
    response = client.patch('/api/studio/flows/' + copied['id'] + '/drafts/' + draft['id'],
                            json={'version': draft['version'], 'input': {'text': '编辑'}})
    assert response.status_code == 404, response.text
    assert s.get('bob', foreign['id']) == foreign


def test_foreign_selected_legacy_content_still_rejected(client):
    foreign = s.put('bob', 'content', {'title': '其他用户', 'body': '不能复制'})
    row, _, old_draft = legacy_flow(client, source=foreign)
    response = client.get('/api/studio/flow', params={'work_id': row['id']})
    assert response.status_code == 404, response.text
    assert s.get('alice', old_draft['id']) == old_draft
    assert s.get('alice', row['id']) == row


def previously_copied_flow(client, extra_source=None):
    row, original, old_draft = legacy_flow(client, extra_source=extra_source)
    # Reproduce 0.24.0: both objects already own this flow, but refs were copied verbatim.
    document = workflows._copy('alice', original, row['id'])
    draft = workflows._copy('alice', old_draft, row['id'])
    row = s.put('alice', 'studio_flow', {**row, 'content_id': document['id'],
                'last_draft': draft['id']}, row['id'], row['version'])
    return row, original, old_draft, document, draft


@pytest.mark.parametrize('route', ['read', 'save'])
def test_already_upgraded_copy_repairs_only_inherited_source_after_archive(client, route):
    other = s.put('alice', 'source', {'title': '保留显式引用', 'body': '用户其他来源'})
    row, original, old_draft, document, draft = previously_copied_flow(client, other)
    s.put('alice', 'content', {**original, 'archived': True}, original['id'], original['version'])
    repaired = upgrade(client, row, route)
    assert repaired['content_id'] == document['id']
    assert repaired['last_draft'] == draft['id']
    current = s.get('alice', draft['id'])
    response = client.patch('/api/studio/flows/' + row['id'] + '/drafts/' + draft['id'],
                            json={'version': current['version'], 'input': {'text': '副本后续编辑'}})
    assert response.status_code == 200, response.text
    assert response.json()['source_ids'] == [document['id'], other['id']]
    assert s.get('alice', old_draft['id']) == old_draft
    assert s.get('alice', document['id']) == document
    before = s.get('alice', draft['id'])
    upgrade(client, repaired, 'read')
    assert s.get('alice', draft['id']) == before, 'Repair must be idempotent'


def test_already_copied_source_added_by_user_is_not_rewritten(client):
    row, original, old_draft, document, draft = previously_copied_flow(client)
    # It ceased to be inherited; a later explicit selection is authoritative.
    removed = s.put('alice', 'studio_draft', {**draft, 'source_ids': []}, draft['id'], draft['version'])
    added = s.put('alice', 'studio_draft', {**removed, 'source_ids': [original['id']]},
                  removed['id'], removed['version'])
    upgrade(client, row, 'read')
    assert s.get('alice', draft['id']) == added


@pytest.mark.parametrize('provenance', ['missing', 'foreign', 'wrong_version', 'unrelated_draft'])
def test_already_copied_unproven_source_mapping_is_not_repaired(client, provenance):
    row, original, old_draft, document, draft = previously_copied_flow(client)
    if provenance == 'missing':
        changed = {**draft, 'imported_from': ''}
    elif provenance == 'foreign':
        foreign = s.put('bob', 'studio_draft', {**old_draft})
        changed = {**draft, 'imported_from': foreign['id']}
    elif provenance == 'wrong_version':
        changed = {**draft, 'imported_version': 999999}
    else:
        unrelated = s.put('alice', 'studio_draft', {**old_draft, 'source_ids': []})
        changed = {**draft, 'imported_from': unrelated['id']}
    altered = s.put('alice', 'studio_draft', changed, draft['id'], draft['version'])
    upgrade(client, row, 'read')
    assert s.get('alice', draft['id']) == altered


def test_existing_copy_uses_original_provenance_versions_and_keeps_later_edits(client):
    row, original, old_draft, document, draft = previously_copied_flow(client)
    reference = s.put('alice', 'source', {'title': '后来明确添加', 'body': '新引用'})
    edited = s.put('alice', 'studio_draft', {**draft,
                   'input': {'text': '已经手工修改的完整口播。'},
                   'source_ids': [reference['id'], original['id']]}, draft['id'], draft['version'])
    # Current originals differ; their exact copied versions still prove inheritance.
    s.put('alice', 'studio_draft', {**old_draft, 'source_ids': []}, old_draft['id'], old_draft['version'])
    s.put('alice', 'content', {**original, 'body': '原文后来已改变', 'archived': True},
          original['id'], original['version'])
    upgrade(client, row, 'read')
    repaired = s.get('alice', draft['id'])
    assert repaired['source_ids'] == [reference['id'], document['id']]
    assert repaired['input'] == edited['input']
    assert repaired['imported_from'] == edited['imported_from']
    assert repaired['version'] == edited['version'] + 1


def test_existing_copy_wrong_document_provenance_does_not_repair(client):
    row, original, old_draft, document, draft = previously_copied_flow(client)
    s.put('alice', 'content', {**document, 'imported_version': 999999},
          document['id'], document['version'])
    upgrade(client, row, 'read')
    assert s.get('alice', draft['id']) == draft
