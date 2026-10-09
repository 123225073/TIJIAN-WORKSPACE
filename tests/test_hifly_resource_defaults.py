"""Owner and service-account scoped defaults; isolated SQLite, no provider calls."""
import pytest

from backend import media_studio as m, store as s
from test_media_studio import configure, resource, studio


EMPTY = {'avatar_id': None, 'voice_id': None}
URL = '/api/studio/resource-defaults'

def test_asset_list_explains_current_service_availability(studio):
    service=configure(studio,'hifly');avatar=resource('avatar',service)
    def current():return next(x for x in studio.get('/api/studio/assets?asset_type=avatar').json()['items'] if x['id']==avatar['id'])
    assert current()['resource_selectable'] is True
    changed=studio.post('/api/studio/settings',headers={'Authorization':'Bearer admin'},json={'provider':'hifly','api_key':'other-isolated-account'})
    assert changed.status_code==200
    unavailable=current()
    assert unavailable['status']=='ready' and unavailable['resource_selectable'] is False
    assert '另一飞影账号' in unavailable['resource_unavailable_reason']
    assert studio.post(URL,json={'avatar_id':avatar['id']}).status_code==400

def test_deleted_default_is_not_retained_or_reassigned(studio):
    service=configure(studio,'hifly');avatar=resource('avatar',service)
    assert studio.post(URL,json={'avatar_id':avatar['id']}).status_code==200
    s.put('alice','studio_asset',{**avatar,'deleted':True},avatar['id'])
    assert studio.get(URL).json()==EMPTY
    assert studio.post(URL,json={'avatar_id':avatar['id']}).status_code==400


def test_defaults_are_flat_nullable_ids_and_reads_do_not_create_data(studio, monkeypatch):
    monkeypatch.setattr(m, '_api', lambda *a, **kw: pytest.fail('Defaults may not call provider'))
    assert studio.get(URL).json() == EMPTY
    assert not s.list_('alice', 'studio_resource_defaults')
    service = configure(studio, 'hifly')
    assert studio.get(URL).json() == EMPTY
    avatar, voice = resource('avatar', service), resource('voice', service)
    assert studio.post(URL, json={'avatar_id': avatar['id'], 'voice_id': voice['id']}).json() == {
        'avatar_id': avatar['id'], 'voice_id': voice['id']}
    assert studio.patch(URL, json={'voice_id': ''}).json() == {'avatar_id': avatar['id'], 'voice_id': None}
    assert studio.post(URL, json={'voice_id': voice['id']}).json() == {'avatar_id': avatar['id'], 'voice_id': voice['id']}
    assert studio.post(URL, json={'avatar_id': None}).json() == {'avatar_id': None, 'voice_id': voice['id']}
    before = s.list_('alice', 'studio_resource_defaults')
    assert studio.get(URL).json() == {'avatar_id': None, 'voice_id': voice['id']}
    assert s.list_('alice', 'studio_resource_defaults') == before


def test_defaults_survive_database_reopen_and_remain_owner_scoped(studio):
    service = configure(studio, 'hifly')
    avatar = resource('avatar', service)
    studio.post(URL, json={'avatar_id': avatar['id']})
    s.init()
    assert studio.get(URL).json()['avatar_id'] == avatar['id']
    assert studio.get(URL, headers={'Authorization': 'Bearer bob'}).json() == EMPTY
    assert studio.post(URL, headers={'Authorization': 'Bearer bob'}, json={'avatar_id': avatar['id']}).status_code == 400
    assert studio.get(URL, headers={'Authorization': ''}).status_code == 401
    assert studio.post(URL, headers={'Authorization': ''}, json={'avatar_id': avatar['id']}).status_code == 401


def test_service_switch_does_not_reuse_or_overwrite_another_accounts_defaults(studio):
    old = configure(studio, 'hifly')
    avatar = resource('avatar', old)
    studio.post(URL, json={'avatar_id': avatar['id']})
    # Re-saving an unchanged key must preserve its encrypted scope and choice.
    configure(studio, 'hifly')
    assert studio.get(URL).json()['avatar_id'] == avatar['id']
    changed = studio.post('/api/studio/settings', headers={'Authorization': 'Bearer admin'},
                         json={'provider': 'hifly', 'api_key': 'different-test-account'})
    assert changed.status_code == 200
    assert studio.get(URL).json() == EMPTY
    assert studio.post(URL, json={'avatar_id': avatar['id']}).status_code == 400
    new = resource('avatar', m._service('hifly'))
    studio.post(URL, json={'avatar_id': new['id']})
    assert len(s.list_('alice', 'studio_resource_defaults')) == 2
    config = s.config(m.CONFIG)
    config['hifly'] = old
    s.set_config(m.CONFIG, config)
    assert studio.get(URL).json()['avatar_id'] == avatar['id']
    config['hifly'] = {**old, 'enabled': False}
    s.set_config(m.CONFIG, config)
    assert studio.get(URL).json() == EMPTY


@pytest.mark.parametrize('changes', [
    {'archived': True}, {'status': 'failed'}, {'status': 'creating'}, {'provider': 'local'},
    {'service_scope': 'another-account'}, {'asset_type': 'voice'}, {'compat': ['avatar_create']},
    {'compat': []}, {'compat': None}, {'compat': 'text_avatar'}, {'provider_resource_id': None},
])
def test_invalid_default_is_rejected_and_existing_default_becomes_empty(studio, changes):
    service = configure(studio, 'hifly')
    avatar, voice = resource('avatar', service), resource('voice', service)
    studio.post(URL, json={'avatar_id': avatar['id'], 'voice_id': voice['id']})
    s.put('alice', 'studio_asset', {**avatar, **changes}, avatar['id'])
    before = s.list_('alice', 'studio_resource_defaults')
    assert studio.get(URL).json() == {'avatar_id': None, 'voice_id': voice['id']}
    assert s.list_('alice', 'studio_resource_defaults') == before
    assert studio.post(URL, json={'avatar_id': avatar['id'], 'voice_id': ''}).status_code == 400
    assert s.list_('alice', 'studio_resource_defaults') == before
    assert studio.get(URL).json()['voice_id'] == voice['id']


@pytest.mark.parametrize('data', [
    {'avatar_id': []}, {'voice_id': True}, {'avatar_id': 1}, {'voice_id': {}},
    {'avatar_id': 'missing'}, {'avatar_id': '../provider.key'}, {'avatar_id': 'x' * 129},
    {'service_scope': 'spoofed'}, {'owner': 'bob'},
])
def test_default_payload_rejects_spoofing_and_invalid_ids(studio, data):
    configure(studio, 'hifly')
    assert studio.post(URL, json=data).status_code == 400
    assert not s.list_('alice', 'studio_resource_defaults')


def test_historical_public_avatar_is_hidden_and_cannot_be_selected_default_or_synced(studio, monkeypatch):
    service = configure(studio, 'hifly')
    own = resource('avatar', service)
    avatar = s.put('alice', 'studio_asset', {**own, 'visibility': 'public'}, s.uid())
    voice = resource('voice', service)
    defaults = s.put('alice', 'studio_resource_defaults',
        {'avatar_id': avatar['id'], 'voice_id': voice['id'], 'service_scope': m._scope('hifly', service)},
        m._resource_defaults_id('alice', m._scope('hifly', service)))
    monkeypatch.setattr(m, '_api', lambda *a, **kw: pytest.fail('Public avatars may not be synced'))
    for url in ('/api/studio/assets', '/api/studio/assets?asset_type=avatar'):
        assert avatar['id'] not in {x['id'] for x in studio.get(url).json()['items']}
    assert studio.get(URL).json() == {'avatar_id': None, 'voice_id': voice['id']}
    assert s.get('alice', defaults['id']) == defaults  # Reads do not rewrite old defaults.
    assert studio.post(URL, json={'avatar_id': avatar['id']}).status_code == 400
    assert studio.get('/api/studio/assets?asset_type=avatar&refresh=true').status_code == 400
    assert studio.get('/api/studio/assets?asset_type=avatar').json()['public_library_status'] == 'disabled'
    with pytest.raises(m.StudioError):m.public_resources('alice', 'avatar')
    assert s.get('alice', avatar['id']) == avatar
    assert not s.list_('alice', 'studio_library')
    history = s.put('alice', 'studio_run', {'status': 'succeeded', 'provider': 'hifly',
        'tool': 'text_avatar', 'snapshot': {'input': {'avatar_id': avatar['id']}, 'options': {}}})
    assert any(x['id'] == history['id'] for x in studio.get('/api/studio/runs').json()['items'])
    assert s.get('alice', history['id']) == history
    for tool in ('text_avatar', 'audio_avatar'):
        response = studio.post('/api/studio/drafts', json={'tool': tool, 'input': {'avatar_id': avatar['id']}, 'options': {}})
        assert response.status_code == 400 and '自己创建' in response.text
    old_draft = s.put('alice', 'studio_draft', {'tool': 'text_avatar', 'title': '旧公模草稿',
        'input': {'text': '旧稿仍保留', 'avatar_id': avatar['id'], 'voice_id': voice['id']}, 'options': {}})
    response = studio.post('/api/studio/generate', json={'draft_id': old_draft['id'], 'version': old_draft['version'],
        'confirmed': True, 'request_id': 'do-not-submit-old-public-avatar'})
    assert response.status_code == 400 and s.get('alice', old_draft['id']) == old_draft
    assert s.list_('alice', 'studio_run') == [history]


def test_public_voice_remains_selectable_and_can_be_default(studio, monkeypatch):
    configure(studio, 'hifly')
    monkeypatch.setattr(m, '_api', lambda *a, **kw: {'data': [
        {'voice': 'public-opaque-id', 'type': 10, 'title': '公共声音'}]})
    listing = studio.get('/api/studio/assets?asset_type=voice&refresh=true').json()
    assert listing['public_library_enabled'] is True
    voice = listing['items'][0]
    assert voice['resource_selectable'] is True and voice['voice_parameter_editable'] is False
    assert studio.post(URL, json={'voice_id': voice['id']}).json()['voice_id'] == voice['id']
    saved = s.get('alice', voice['id'])
    s.put('alice', 'studio_asset', {**saved, 'archived': True}, voice['id'])
    studio.get('/api/studio/assets?asset_type=voice&refresh=true')
    assert s.get('alice', voice['id'])['archived'] is True
    assert studio.get(URL).json() == EMPTY
