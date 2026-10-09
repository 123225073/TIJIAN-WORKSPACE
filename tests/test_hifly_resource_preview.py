"""Exact-row media contracts, authorized reads and SSRF boundaries; no live media."""
import json

import httpx
import pytest

from backend import hifly_resource_preview as p, media_studio as m, store as s
from test_media_studio import configure, png, studio


AVATAR_VIDEO = 'https://hfcdn.lingverse.co/public/sample.mp4?signature=private-preview-signature'
AVATAR_COVER = 'https://hfcdn.lingverse.co/public/cover.jpg?token=private-cover-token'
VOICE_AUDIO = 'https://shortvideo-cdn.lingverse.co/public/demo.mp3?signature=private-audio-signature'


def import_resource(studio, monkeypatch, kind='avatar', **fields):
    configure(studio, 'hifly')
    # The actual v2 list has only these ID/title/type fields. Optional media are
    # isolated provider-contract fixtures, not a claim that production returns them.
    row = {kind: 'opaque-public-resource-id', 'title': '公共形象' if kind == 'avatar' else '普通话',
           **({'kind': 2} if kind == 'avatar' else {'type': 10}), **fields}
    calls = []
    def api(provider, method, path, **kwargs):
        calls.append((provider, method, path))
        assert provider == 'hifly' and method == 'GET' and '/list?kind=2&' in path
        return {'code': 0, 'data': [row]}
    monkeypatch.setattr(m, '_api', api)
    if kind == 'avatar':
        # Public-avatar synchronization is disabled. Seed a historical record
        # explicitly to retain authorization/proxy tests for existing previews.
        saved = s.put('alice', 'studio_asset', {'title': row['title'], 'asset_type': kind,
            'provider': 'hifly', 'provider_resource_id': row[kind], 'status': 'ready',
            'service_scope': m._scope('hifly', m._service('hifly')), 'visibility': 'public',
            'compat': m.COMPAT[kind], 'provider_preview': p.metadata(row, kind)})
        return m._public(saved, owner='alice'), calls
    result = studio.get('/api/studio/assets?asset_type=' + kind + '&refresh=true')
    assert result.status_code == 200 and result.json()['public_library_status'] == 'ready'
    return result.json()['items'][0], calls


@pytest.fixture
def remote(monkeypatch):
    calls, behavior = [], {}
    real = httpx.Client
    def handle(request):
        calls.append(request)
        assert request.method == 'GET'
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        if behavior.get('handler'):
            return behavior['handler'](request)
        if request.url.path.endswith('.mp3'):
            return httpx.Response(200, content=b'ID3-audio-sample', headers={'Content-Type': 'audio/mpeg'})
        if request.url.path.endswith('.jpg'):
            return httpx.Response(200, content=png(), headers={'Content-Type': 'image/png'})
        data = b'\x00\x00\x00\x20ftypisom' + b'v' * 40
        if request.headers.get('range') == 'bytes=0-9':
            return httpx.Response(206, content=data[:10], headers={'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-9/52'})
        return httpx.Response(200, content=data, headers={'Content-Type': 'video/mp4'})
    monkeypatch.setattr(p.httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(handle), **kw))
    monkeypatch.setattr(p.network, 'public_target', lambda url: (httpx.URL(url), {}, {}))
    return calls, behavior


@pytest.mark.parametrize('kind', ['avatar', 'voice'])
def test_actual_v2_minimal_row_has_honest_official_fallback(studio, monkeypatch, kind):
    item, calls = import_resource(studio, monkeypatch, kind)
    assert len(calls) == (1 if kind == 'voice' else 0)
    assert 'preview_url' not in item and 'clone_status' not in item
    assert '未提供' in item['preview_unavailable_reason']
    assert item['provider_view_url'] == p.OFFICIAL_VIEWS[kind]
    assert studio.get('/api/studio/assets/' + item['id'] + '/preview').status_code == 404
    assert len(calls) == (1 if kind == 'voice' else 0)  # Preview never creates paid work.
    assert 'provider_resource_id' not in item


def test_avatar_video_and_cover_preserved_privately_and_locally_proxied(studio, monkeypatch, remote):
    item, api_calls = import_resource(studio, monkeypatch, video_url=AVATAR_VIDEO,
                                    cover_url=AVATAR_COVER, face_url=AVATAR_COVER)
    saved = s.get('alice', item['id'])
    assert saved['provider_preview']['media']['url'] == AVATAR_VIDEO
    assert item['preview_asset_type'] == 'video' and item['preview_origin'] == 'provider_preview'
    assert 'preview_unavailable_reason' not in item and 'file_url' not in item
    assert item['preview_url'].endswith('/preview') and item['preview_cover_url'].endswith('/preview-cover')
    serialized = json.dumps(item)
    assert 'provider_preview' not in item
    for hidden in ['private-preview-signature', 'private-cover-token', 'hfcdn', 'opaque-public-resource-id']:
        assert hidden not in serialized
    before = saved
    response = studio.get(item['preview_url'])
    assert response.status_code == 200 and response.headers['content-type'] == 'video/mp4'
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.headers['vary'] == 'Authorization'
    assert studio.get(item['preview_cover_url']).content == png()
    ranged = studio.get(item['preview_url'], headers={'Range': 'bytes=0-9'})
    assert ranged.status_code == 206 and len(ranged.content) == 10
    assert ranged.headers['content-range'] == 'bytes 0-9/52'
    assert s.get('alice', item['id']) == before and len(api_calls) == 0


def test_voice_demo_can_be_played_without_tts_or_key_forwarding(studio, monkeypatch, remote):
    item, api_calls = import_resource(studio, monkeypatch, 'voice', demo_url=VOICE_AUDIO, group_cover_url=AVATAR_COVER)
    assert item['preview_asset_type'] == 'audio' and item['preview_origin'] == 'provider_preview'
    assert studio.get(item['preview_url']).content == b'ID3-audio-sample'
    assert studio.get(item['preview_cover_url']).content == png()
    assert len(api_calls) == 1 and len(remote[0]) == 2
    assert 'private-audio-signature' not in studio.get('/api/studio/assets').text


def test_cover_only_is_an_image_preview_not_a_fake_video_or_voice(studio, monkeypatch):
    avatar, _ = import_resource(studio, monkeypatch, cover_url=AVATAR_COVER)
    assert avatar['preview_asset_type'] == 'image' and avatar['preview_url'].endswith('/preview-cover')
    assert '未提供视频' in avatar['preview_unavailable_reason']
    voice, _ = import_resource(studio, monkeypatch, 'voice', cover_url=AVATAR_COVER)
    assert 'preview_url' not in voice and 'preview_asset_type' not in voice
    assert voice['preview_cover_url'].endswith('/preview-cover') and '未提供试听' in voice['preview_unavailable_reason']


@pytest.mark.parametrize('failure', ['foreign_owner', 'archived', 'wrong_account', 'disabled', 'failed', 'local'])
def test_preview_reauthorizes_before_any_remote_read(studio, monkeypatch, remote, failure):
    item, _ = import_resource(studio, monkeypatch, video_url=AVATAR_VIDEO, cover_url=AVATAR_COVER)
    headers = {'Authorization': 'Bearer bob'} if failure == 'foreign_owner' else {}
    asset = s.get('alice', item['id'])
    if failure == 'archived':asset['archived'] = True
    elif failure == 'wrong_account':asset['service_scope'] = 'other-account'
    elif failure == 'disabled':
        config = s.config(m.CONFIG);config['hifly']['enabled'] = False;s.set_config(m.CONFIG, config)
    elif failure == 'failed':asset['status'] = 'failed'
    elif failure == 'local':asset['provider'] = 'local'
    if failure not in ('foreign_owner', 'disabled'):s.put('alice', 'studio_asset', asset, asset['id'])
    assert studio.get(item['preview_url'], headers=headers).status_code == 404
    assert studio.get(item['preview_cover_url'], headers=headers).status_code == 404
    assert not remote[0]
    assert studio.get(item['preview_url'], headers={'Authorization': ''}).status_code == 401


@pytest.mark.parametrize('url', [
    'http://hfcdn.lingverse.co/a.mp4', 'https://127.0.0.1/a.mp4', 'https://localhost/a.mp4',
    'https://hfcdn.lingverse.co.evil.example/a.mp4', 'https://evil.example/a.mp4',
    'https://user:secret@hfcdn.lingverse.co/a.mp4', 'https://hfcdn.lingverse.co:8443/a.mp4',
    'file:///provider.key', 'data:video/mp4;base64,AA==', 'https://hfcdn.lingverse.co/a.mp4#secret',
    'https://hfcdn.lingverse.co/a.mp4%0d%0aCookie:secret', 'https://hfcdn.lingverse.co/\\evil',
    'https://hfcdn.lingverse.co:invalid/a.mp4',
])
def test_untrusted_urls_never_enter_preview_metadata(url):
    assert p.metadata({'video_url': url, 'cover_url': url, 'demo_url': url}, 'avatar') == {}
    assert p.metadata({'demo_url': url, 'cover_url': url}, 'voice') == {}


def test_resource_ids_and_generic_urls_are_not_media_addresses():
    assert p.metadata({'avatar': AVATAR_VIDEO, 'url': AVATAR_VIDEO}, 'avatar') == {}
    assert p.metadata({'voice': VOICE_AUDIO, 'url': VOICE_AUDIO}, 'voice') == {}
    assert p.metadata({'video_url': AVATAR_VIDEO, 'video_url_v2': AVATAR_VIDEO + '&version=2'}, 'avatar')['media']['url'].endswith('&version=2')


@pytest.mark.parametrize('failure', ['internal_redirect', 'foreign_redirect', 'html', 'fake_video', 'size', 'range', 'wrong_range', 'network'])
def test_bad_preview_responses_are_safe_failures(studio, monkeypatch, remote, failure):
    item, _ = import_resource(studio, monkeypatch, video_url=AVATAR_VIDEO)
    def handle(request):
        if failure == 'internal_redirect':return httpx.Response(302, headers={'Location': 'https://127.0.0.1/provider.key'})
        if failure == 'foreign_redirect':return httpx.Response(302, headers={'Location': 'https://unrelated.example/a.mp4?private=secret'})
        if failure == 'html':return httpx.Response(200, content=b'<html>private</html>', headers={'Content-Type': 'text/html'})
        if failure == 'fake_video':return httpx.Response(200, content=b'<html>private</html>', headers={'Content-Type': 'video/mp4'})
        if failure == 'size':return httpx.Response(200, content=b'oversized-fixture', headers={'Content-Type': 'video/mp4'})
        if failure == 'range':return httpx.Response(206, content=b'v', headers={'Content-Type': 'video/mp4', 'Content-Range': 'bytes 8-2/1'})
        if failure == 'wrong_range':return httpx.Response(206, content=b'v' * 10, headers={'Content-Type': 'video/mp4', 'Content-Range': 'bytes 10-19/30'})
        raise httpx.ConnectError('secret-api-key-and-private-preview-signature', request=request)
    remote[1]['handler'] = handle
    if failure == 'size':monkeypatch.setattr(p, 'MAX_PREVIEW', 4)
    response = studio.get(item['preview_url'], headers={'Range': 'bytes=0-9'} if failure in ('range', 'wrong_range') else {})
    assert response.status_code == 400
    for hidden in ['secret-api-key', 'private-preview-signature', '127.0.0.1', 'provider.key']:
        assert hidden not in response.text
    assert len(remote[0]) == 1


@pytest.mark.parametrize('range_header', ['bytes=0-1,2-3', 'anything', 'bytes=abc-def', 'bytes=' + '1' * 90 + '-'])
def test_invalid_ranges_are_rejected_before_remote_read(studio, monkeypatch, remote, range_header):
    item, _ = import_resource(studio, monkeypatch, video_url=AVATAR_VIDEO)
    assert studio.get(item['preview_url'], headers={'Range': range_header}).status_code == 400
    assert not remote[0]


def test_redirects_are_bounded_and_cookies_are_not_forwarded(studio, monkeypatch, remote):
    item, _ = import_resource(studio, monkeypatch, video_url=AVATAR_VIDEO)
    remote[1]['handler'] = lambda request: httpx.Response(302, headers={
        'Location': 'https://hfcdn.lingverse.co/next.mp4', 'Set-Cookie': 'provider-cookie=private; Path=/'})
    assert studio.get(item['preview_url']).status_code == 400
    assert len(remote[0]) == 4


def test_public_dns_is_pinned_and_private_dns_is_rejected(monkeypatch):
    monkeypatch.setattr(p.network.socket, 'getaddrinfo', lambda *a, **kw: [(2, 1, 6, '', ('8.8.8.8', 443))])
    target, headers, extensions = p.network.public_target(AVATAR_VIDEO)
    assert target.host == '8.8.8.8' and headers['Host'] == 'hfcdn.lingverse.co'
    assert extensions['sni_hostname'] == 'hfcdn.lingverse.co'
    monkeypatch.setattr(p.network.socket, 'getaddrinfo', lambda *a, **kw: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError):p.network.public_target(AVATAR_VIDEO)
