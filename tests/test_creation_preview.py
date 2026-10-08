"""Legacy clone previews: scoped local reads, no provider calls or re-cloning."""
import pytest

from backend import media_studio as m, store as s
from test_media_studio import asset, configure, resource, studio


def archived_clone(studio, source, kind='avatar', owner='alice'):
    run = s.put(owner, 'studio_run', {'tool': 'avatar_create' if kind == 'avatar' else 'voice_create',
        'provider': 'hifly', 'status': 'succeeded', 'asset_ids': [],
        'snapshot': {'input': {source['asset_type'] + '_id': source['id']}}})
    clone = s.put(owner, 'studio_asset', {'asset_type': kind, 'provider': 'hifly', 'status': 'ready',
        'provider_resource_id': 'private-provider-id', 'run_id': run['id'], 'title': '已有形象'})
    s.put(owner, 'studio_run', {**run, 'asset_ids': [clone['id']]}, run['id'])
    return clone


@pytest.mark.parametrize('kind', ['image', 'video', 'audio'])
def test_old_clone_preview_is_authenticated_local_read(studio, monkeypatch, kind):
    def forbidden(*args, **kwargs):
        pytest.fail('Preview must not contact provider or create a task')
    monkeypatch.setattr(m, '_api', forbidden)
    if kind == 'image':
        source = s.get('alice', asset(studio)['id'])
    else:
        path = m._path('alice', s.uid() + ('.mp4' if kind == 'video' else '.wav'))
        path.write_bytes(b'local-preview-bytes')
        source = s.put('alice', 'studio_asset', {'asset_type': kind, 'status': 'ready',
            'local_file': path.name, 'mime_type': 'video/mp4' if kind == 'video' else 'audio/wav'})
    clone = archived_clone(studio, source, 'voice' if kind == 'audio' else 'avatar')
    before = s.get('alice', clone['id'])
    items = studio.get('/api/studio/assets').json()['items']
    public = next(x for x in items if x['id'] == clone['id'])
    assert public['clone_status'] == 'succeeded'
    assert public['preview_asset_type'] == kind
    assert public['preview_origin'] == 'creation_source'
    assert 'file_url' not in public
    assert 'private-provider-id' not in str(public)
    response = studio.get(public['preview_url'])
    assert response.status_code == 200
    assert response.content == m._path('alice', source['local_file']).read_bytes()
    assert response.headers['cache-control'] == 'private, no-store'
    assert studio.get(public['preview_url'], headers={'Authorization': 'Bearer bob'}).status_code == 404
    assert studio.get(public['preview_url'], headers={'Authorization': ''}).status_code == 401
    assert s.get('alice', clone['id']) == before
    if kind == 'video':
        ranged = studio.get(public['preview_url'], headers={'Range': 'bytes=0-4'})
        assert ranged.status_code == 206 and ranged.content == response.content[:5]


def test_missing_source_still_confirms_clone_but_has_no_fake_preview(studio):
    source = s.get('alice', asset(studio)['id'])
    clone = archived_clone(studio, source)
    m._path('alice', source['local_file']).unlink()
    public = next(x for x in studio.get('/api/studio/assets').json()['items'] if x['id'] == clone['id'])
    assert public['clone_status'] == 'succeeded'
    assert 'preview_url' not in public
    assert studio.get('/api/studio/assets/' + clone['id'] + '/preview').status_code == 404


def test_missing_source_directory_is_not_recreated(studio):
    source = s.get('alice', asset(studio)['id'])
    clone = archived_clone(studio, source)
    path = m._path('alice', source['local_file'])
    path.unlink(); path.parent.rmdir()
    public = next(x for x in studio.get('/api/studio/assets').json()['items'] if x['id'] == clone['id'])
    assert public['clone_status'] == 'succeeded' and 'preview_url' not in public
    assert studio.get('/api/studio/assets/' + clone['id'] + '/preview').status_code == 404
    assert not path.parent.exists()


def test_unreadable_source_does_not_break_asset_list(studio, monkeypatch):
    from pathlib import Path
    source = s.get('alice', asset(studio)['id'])
    clone = archived_clone(studio, source)
    path = m._path('alice', source['local_file'])
    original = Path.open
    def restricted(self, *args, **kwargs):
        if self == path:raise PermissionError('isolated permission failure')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Path, 'open', restricted)
    public = next(x for x in studio.get('/api/studio/assets').json()['items'] if x['id'] == clone['id'])
    assert public['clone_status'] == 'succeeded' and 'preview_url' not in public
    assert studio.get('/api/studio/assets/' + clone['id'] + '/preview').status_code == 404


@pytest.mark.parametrize('failure', ['foreign_source', 'wrong_tool', 'failed_run', 'unlinked_asset', 'archived_source'])
def test_preview_rejects_invalid_provenance(studio, failure):
    source = s.get('alice', asset(studio)['id'])
    clone = archived_clone(studio, source)
    run = s.get('alice', clone['run_id'])
    if failure == 'foreign_source':
        other = s.put('bob', 'studio_asset', {'asset_type': 'image', 'status': 'ready', 'local_file': source['local_file']})
        run['snapshot']['input']['image_id'] = other['id']
    elif failure == 'wrong_tool':run['tool'] = 'photo_talk'
    elif failure == 'failed_run':run['status'] = 'failed'
    elif failure == 'unlinked_asset':run['asset_ids'] = []
    else:s.put('alice', 'studio_asset', {**source, 'archived': True}, source['id'])
    s.put('alice', 'studio_run', run, run['id'])
    public = next(x for x in studio.get('/api/studio/assets').json()['items'] if x['id'] == clone['id'])
    assert 'preview_url' not in public
    assert studio.get('/api/studio/assets/' + clone['id'] + '/preview').status_code == 404


def test_public_resource_does_not_claim_clone_verification(studio):
    clone = resource('avatar', configure(studio, 'hifly'))
    public = next(x for x in studio.get('/api/studio/assets').json()['items'] if x['id'] == clone['id'])
    assert 'clone_status' not in public and 'preview_url' not in public
