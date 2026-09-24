"""System and personal knowledge must stay isolated; publication is explicit."""
import io
import pytest
from fastapi.testclient import TestClient

from backend import gateway as g, media_registry as media, resources, store as s, system_library as system
from backend.app import app, ATTEMPTS


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'test.sqlite')
    monkeypatch.setattr(g, 'KEYFILE', tmp_path / 'provider.key')
    ATTEMPTS.clear()
    with TestClient(app, base_url='http://127.0.0.1') as c:
        response = c.post('/api/auth/login', json={'email': 'admin', 'password': 'admin'})
        assert response.status_code == 200
        c.headers['Authorization'] = 'Bearer ' + response.json()['token']
        yield c


def test_system_upload_parse_review_and_personal_isolation(client):
    folder = client.post('/api/admin/system-library/folders', json={'title': '电梯销售'}).json()
    child = client.post('/api/admin/system-library/folders', json={'title': '售后', 'parent_id': folder['id']}).json()
    response = client.post('/api/admin/system-library/upload', data={'folder_id': child['id']}, files={'file': ('保养说明.txt', '电梯保养周期由合同确定。\n\n报修请联系售后。'.encode(), 'text/plain')})
    assert response.status_code == 200, response.text
    source = response.json()
    assert source['parse_status'] == 'pending'
    assert not system.context('电梯保养周期')
    assert client.patch('/api/admin/system-library/'+source['id'], json={'status': 'published'}).status_code == 400
    parsed = client.post('/api/admin/system-library/'+source['id']+'/parse').json()
    wiki = parsed['wiki']
    assert wiki['status'] == 'draft' and source['id'] in wiki['body']
    assert not system.context('电梯保养周期')
    source = client.patch('/api/admin/system-library/'+source['id'], json={'source': '售后手册', 'scope': '全国', 'valid_from': '2026-01-01'}).json()
    assert client.patch('/api/admin/system-library/'+wiki['id'], json={'status': 'published'}).status_code == 400
    assert client.patch('/api/admin/system-library/'+source['id'], json={'status': 'published'}).status_code == 200
    assert client.patch('/api/admin/system-library/'+wiki['id'], json={'status': 'published'}).status_code == 200
    assert '电梯保养周期由合同确定' in system.context('电梯保养周期')
    assert s.list_(source['id'], 'system_source') == []
    assert client.get('/api/admin/system-library/'+source['id']+'/file').content == '电梯保养周期由合同确定。\n\n报修请联系售后。'.encode()
    assert client.patch('/api/admin/system-library/'+source['id'], json={'body': '伪造原文'}).status_code == 400
    assert client.patch('/api/admin/system-library/'+source['id'], json={'status': 'disabled'}).status_code == 200
    assert not system.context('电梯保养周期')


def test_online_doc_excel_pdf_and_quota(client):
    for fmt in ('document', 'spreadsheet', 'pdf'):
        created = client.post('/api/admin/system-library/create', json={'format': fmt, 'title': '电梯报价', 'body': '项目,报价\n甲,100' if fmt == 'spreadsheet' else '电梯报价以正式合同为准。具体的价格、服务范围和有效期限请以双方确认的合同正文为依据。'})
        assert created.status_code == 200, created.text
        parsed = client.post('/api/admin/system-library/'+created.json()['id']+'/parse')
        assert parsed.status_code == 200, (fmt, parsed.text)
    assert client.get('/api/knowledge/quota').json() == {'used': 0, 'limit': 100_000_000}
    admin = client.get('/api/state').json()['user']['id']
    changed = client.patch('/api/admin/users/'+admin+'/knowledge-quota', json={'limit_mb': 200})
    assert changed.status_code == 200
    assert client.get('/api/knowledge/quota').json()['limit'] == 200_000_000
    personal = client.post('/api/import/file', files={'file': ('私人资料.txt', '我的资料只属于我'.encode(), 'text/plain')})
    assert personal.status_code == 200, personal.text
    assert client.get('/api/knowledge/quota').json()['used'] == len('我的资料只属于我'.encode())
    assert client.get('/api/knowledge/original/'+personal.json()['id']).content == '我的资料只属于我'.encode()


def test_model_publish_without_probe_but_platform_controls_use(client, monkeypatch):
    monkeypatch.setattr(g, 'public_url', lambda url: url)
    p = client.post('/api/admin/providers', json={'title': '演示平台', 'base_url': 'https://example.com/v1', 'api_key': 'fixture-key'})
    assert p.status_code == 200, p.text
    id = p.json()['id']
    models = [{'id': 'model-1', 'provider': id, 'model': 'demo', 'title': '演示模型', 'capability': 'text', 'verified': False, 'published': False}]
    s.set_config('models', models)
    assert client.patch('/api/admin/models/model-1', json={'published': True}).status_code == 200
    assert g.select('someone', 'writing', 'model-1') == 'model-1'
    assert client.patch('/api/admin/providers/'+id, json={'published': False}).status_code == 200
    with pytest.raises(ValueError, match='不可用'):
        g.select('someone', 'writing', 'model-1')
    assert client.patch('/api/admin/models/model-1', json={'published': True}).status_code == 409


def test_media_provider_off_rejects_model_publish(client):
    assert client.post('/api/admin/media-registry/providers', json={'id': 'wavespeed', 'published': False}).status_code == 200
    response = client.post('/api/admin/media-registry/models', json={'id': 'wavespeed-seedance-20', 'published': True})
    assert response.status_code == 400
    assert 'wavespeed-seedance-20' not in [m['id'] for m in media.choices('text_video') if m['provider'] == 'wavespeed']


def test_legacy_migration_resumes_without_duplicate_and_tampering_blocks_answers(client):
    old = resources.save({'title': '售后常识', 'body': '电梯停梯时应联系维保人员。', 'type': 'knowledge', 'purpose': 'qa', 'source': '售后手册', 'scope': '全国', 'valid_from': '2026-01-01', 'status': 'published'})
    system.migrate_legacy()
    source = next(x for x in system.rows('system_source') if x['filename'] == 'legacy-' + old['id'] + '.txt')
    assert len(system.rows('system_source')) == 1
    s.set_config('system_library_legacy_ids', [])  # Interrupted after writing source and Wiki.
    system.migrate_legacy()
    assert len(system.rows('system_source')) == 1
    assert len(system.rows('system_wiki')) == 1
    assert '电梯停梯时应联系维保人员' in system.context('电梯停梯')
    (system.originals_root() / source['id'] / source['filename']).write_text('伪造内容', encoding='utf-8')
    assert not system.context('电梯停梯')


def test_unprobed_image_is_available_only_while_provider_active(client, monkeypatch):
    from backend import media_studio
    monkeypatch.setattr(g, 'public_url', lambda url: url)
    provider = client.post('/api/admin/providers', json={'title': '图像平台', 'base_url': 'https://example.com/v1', 'api_key': 'fixture-key'}).json()['id']
    s.set_config('models', [{'id': 'img-1', 'provider': provider, 'model': 'image-demo', 'title': '演示生图', 'capability': 'image', 'verified': False, 'published': True}])
    assert any(x['id'] == 'img-1' for x in media_studio.model_choices('text_image'))
    client.patch('/api/admin/providers/'+provider, json={'published': False})
    assert all(x['id'] != 'img-1' for x in media_studio.model_choices('text_image'))
