"""Asset labels use real isolated SQLite; no live clone/provider calls."""
import copy

import pytest

from backend import media_studio as m, store as s
from test_media_studio import configure, resource, studio


@pytest.mark.parametrize('kind', ['avatar', 'voice'])
def test_rename_persists_and_preserves_references_history_and_default(studio, monkeypatch, kind):
    service = configure(studio, 'hifly')
    asset = resource(kind, service)
    asset = s.put('alice', 'studio_asset', {**asset, 'title': '原名称', 'voice_parameters': {'rate': 1.2}}, asset['id'])
    studio.post('/api/studio/resource-defaults', json={kind+'_id': asset['id']})
    draft = s.put('alice', 'studio_draft', {'tool': 'text_avatar', 'input': {kind+'_id': asset['id'], 'text': '保留文稿'}})
    run = s.put('alice', 'studio_run', {'title': '原创建记录', 'status': 'succeeded', 'asset_ids': [asset['id']]})
    monkeypatch.setattr(m, '_api', lambda *a, **kw: pytest.fail('Rename must not call provider'))
    result = studio.patch('/api/studio/assets/'+asset['id'], json={'version': asset['version'], 'title': '  风沙 · 自然口播  '})
    assert result.status_code == 200, result.text
    assert result.json()['title'] == '风沙 · 自然口播'
    assert result.json()['id'] == asset['id'] and result.json()['resource_renamable'] is True
    stored = s.get('alice', asset['id'])
    for key, value in asset.items():
        if key not in ('title', 'version', 'updated'):
            assert stored[key] == value
    assert 'provider_resource_id' not in result.json() and 'service_scope' not in result.json()
    assert s.get('alice', draft['id']) == draft and s.get('alice', run['id']) == run
    assert studio.get('/api/studio/resource-defaults').json()[kind+'_id'] == asset['id']
    assert next(a for a in studio.get('/api/studio/assets').json()['items'] if a['id'] == asset['id'])['title'] == stored['title']
    assert s.versions('alice', asset['id'])[0]['title'] == '原名称'


@pytest.mark.parametrize('title', ['', '   ', None, 12, 'x'*201, 'name\nline', 'bad\x00name'])
def test_invalid_name_does_not_change_storage(studio, title):
    asset = resource('voice', configure(studio, 'hifly'))
    before = copy.deepcopy(asset)
    result = studio.patch('/api/studio/assets/'+asset['id'], json={'version': asset['version'], 'title': title})
    assert result.status_code == 400
    assert s.get('alice', asset['id']) == before


@pytest.mark.parametrize('extra', [{'status': 'failed'}, {'provider_resource_id': 'other'}, {'asset_type': 'video'}, {'rate': 1.2}])
def test_name_endpoint_rejects_non_name_changes(studio, extra):
    asset = resource('avatar', configure(studio, 'hifly'))
    result = studio.patch('/api/studio/assets/'+asset['id'], json={'version': asset['version'], 'title': '新名称', **extra})
    assert result.status_code == 400
    assert s.get('alice', asset['id']) == asset


def test_rename_requires_owner_and_current_version_and_keeps_a_same_name_read_only(studio):
    asset = resource('voice', configure(studio, 'hifly'))
    url = '/api/studio/assets/'+asset['id']
    assert studio.patch(url, headers={'authorization': 'Bearer bob'}, json={'title': '别人的声音', 'version': asset['version']}).status_code == 404
    assert studio.patch(url, json={'title': '没版本'}).status_code == 400
    assert studio.patch(url, json={'title': '版本布尔值', 'version': True}).status_code == 400
    first = studio.patch(url, json={'title': '新名称', 'version': asset['version']})
    assert first.status_code == 200
    assert studio.patch(url, json={'title': '过期窗口', 'version': asset['version']}).status_code == 409
    current = s.get('alice', asset['id'])
    assert studio.patch(url, json={'title': '新名称', 'version': current['version']}).status_code == 200
    assert s.get('alice', asset['id']) == current


@pytest.mark.parametrize('change,status', [({'visibility': 'public'}, 400), ({'archived': True}, 404), ({'deleted': True}, 404), ({'asset_type': 'audio'}, 400)])
def test_only_own_clone_labels_can_be_renamed(studio, change, status):
    asset = resource('voice', configure(studio, 'hifly'))
    asset = s.put('alice', 'studio_asset', {**asset, **change}, asset['id'])
    result = studio.patch('/api/studio/assets/'+asset['id'], json={'title': '新名称', 'version': asset['version']})
    assert result.status_code == status and s.get('alice', asset['id']) == asset


def test_rename_is_local_even_after_switching_provider_account(studio, monkeypatch):
    asset = resource('voice', configure(studio, 'hifly'))
    studio.post('/api/studio/settings', headers={'authorization': 'Bearer admin'}, json={'provider': 'hifly', 'api_key': 'other-fixture-account'})
    monkeypatch.setattr(m, '_api', lambda *a, **kw: pytest.fail('Local label edit must not use a provider key'))
    result = studio.patch('/api/studio/assets/'+asset['id'], json={'title': '旧账号声音', 'version': asset['version']})
    assert result.status_code == 200 and result.json()['resource_selectable'] is False and result.json()['resource_renamable'] is True


@pytest.mark.parametrize('tool', ['avatar_create', 'voice_create'])
def test_creation_requires_a_name_but_allows_unnamed_draft(studio, tool):
    configure(studio, 'hifly')
    data = {'tool': tool, 'title': '', 'input': {}, 'options': {}, 'model_id': 'service:hifly'}
    assert studio.post('/api/studio/drafts', json=data).status_code == 200
    with pytest.raises(m.StudioError, match='名称'):
        m._validate('alice', data, complete=True)
