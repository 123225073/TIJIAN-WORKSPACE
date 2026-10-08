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


def test_public_ready_resource_can_be_default_and_resync_does_not_unarchive(studio, monkeypatch):
    configure(studio, 'hifly')
    monkeypatch.setattr(m, '_api', lambda *a, **kw: {'data': [
        {'avatar': 'public-opaque-id', 'kind': 2, 'title': '公共形象'}]})
    m.public_resources('alice', 'avatar')
    avatar = s.list_('alice', 'studio_asset')[0]
    assert studio.post(URL, json={'avatar_id': avatar['id']}).json()['avatar_id'] == avatar['id']
    s.put('alice', 'studio_asset', {**avatar, 'archived': True}, avatar['id'])
    m.public_resources('alice', 'avatar')
    assert s.get('alice', avatar['id'])['archived'] is True
    assert studio.get(URL).json() == EMPTY
