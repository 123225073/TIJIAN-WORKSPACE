"""High-impact workflow gates: tenant isolation, revocation, no fake media success."""
import pytest
import threading
import time
from fastapi.testclient import TestClient

from backend import gateway, media_studio, resources, store as s
from backend.app import app, ATTEMPTS


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(s, 'DATA', tmp_path)
    monkeypatch.setattr(s, 'DB', tmp_path / 'test.sqlite')
    monkeypatch.setattr(gateway, 'KEYFILE', tmp_path / 'provider.key')
    monkeypatch.setattr(media_studio.network, 'public_url', lambda url: url)
    ATTEMPTS.clear()
    with TestClient(app, base_url='http://127.0.0.1') as c:
        response = c.post('/api/auth/login', json={'email': 'admin', 'password': 'admin'})
        assert response.status_code == 200, response.text
        c.headers['Authorization'] = 'Bearer ' + response.json()['token']
        yield c


def test_media_registry_encryption_classification_and_immediate_revocation(client):
    initial = client.get('/api/admin/media-registry').json()
    assert {m['family'] for m in initial['models'] if m['category'] == 'AI 视频'} == {'seedance-2.0', 'seedance-2.5'}
    assert 'wan' not in client.get('/api/studio/catalog').text.lower()
    saved = client.post('/api/admin/media-registry/providers', json={'id': 'segmind', 'api_key': 'secret-never-public'})
    assert saved.status_code == 200, saved.text
    assert 'secret-never-public' not in saved.text
    assert 'secret-never-public' not in client.get('/api/admin/media-registry').text
    assert 'secret-never-public' not in client.get('/api/studio/catalog').text
    assert 'secret-never-public' not in s.config('media_registry_providers')['segmind']['secret']
    assert client.post('/api/admin/media-registry/providers', json={'id': 'segmind', 'base_url': 123}).status_code == 400
    assert client.post('/api/admin/media-registry/providers', json={'id': 'segmind', 'api_key': 123}).status_code == 400
    assert client.post('/api/admin/media-registry/models', json={'id': 'segmind-seedance-20', 'tools': [{}]}).status_code == 400
    assert client.post('/api/admin/bindings', json={'text_video': 'service:aliyun'}).status_code == 400
    assert client.post('/api/admin/bindings', json={'text_video': 'media:segmind-seedance-20'}).status_code == 200
    before = next(x for x in client.get('/api/studio/catalog').json()['tools'] if x['id'] == 'text_video')
    assert not before['configured'] and any(m['id'] == 'media:segmind-seedance-20' for m in before['models'])
    draft = client.post('/api/studio/drafts', json={'tool': 'text_video', 'title': '测试视频', 'input': {'prompt': '电梯'} ,'model_id': 'media:segmind-seedance-20', 'options': {}}).json()
    submitted = client.post('/api/studio/generate', json={'draft_id': draft['id'], 'version': draft['version'], 'confirmed': True, 'request_id': 'blocked-video'})
    assert submitted.status_code == 400 and not s.list_(client.get('/api/state').json()['user']['id'], 'studio_run')
    assert client.post('/api/admin/media-registry/models', json={'id': 'segmind-seedance-20', 'published': False}).status_code == 200
    after = next(x for x in client.get('/api/studio/catalog').json()['tools'] if x['id'] == 'text_video')
    assert all(m['id'] != 'media:segmind-seedance-20' for m in after['models'])
    assert client.post('/api/studio/generate', json={'draft_id': draft['id'], 'version': draft['version'], 'confirmed': True, 'request_id': 'blocked-after-unpublish'}).status_code == 400
    assert client.post('/api/admin/media-registry/models', json={'id': 'segmind-seedance-20', 'published': True}).status_code == 200
    assert client.post('/api/admin/media-registry/providers', json={'id': 'segmind', 'published': False}).status_code == 200
    after_provider = next(x for x in client.get('/api/studio/catalog').json()['tools'] if x['id'] == 'text_video')
    assert all(m['provider'] != 'segmind' for m in after_provider['models'])


def test_topic_delivery_persistence_versions_and_tenant_boundary(client):
    owner = client.get('/api/state').json()['user']['id']
    source = client.post('/api/objects/source', json={'title': '现场观察', 'body': '老旧电梯更新问题'}).json()
    topic = client.post('/api/studio/topics', json={'title': '老旧电梯更新常见问题', 'angle': '面向物业', 'source_ids': [source['id']], 'origin': '用户手动添加', 'origin_ref': 'manual:test'}).json()
    assert topic['version'] == 1
    duplicate = client.post('/api/studio/topics', json={'title': '重复添加', 'origin_ref': 'manual:test'}).json()
    assert duplicate['id'] == topic['id']
    assert client.post('/api/studio/topics', json={'title': '跨账号', 'source_ids': ['missing']}).status_code == 404
    assert client.post('/api/studio/topics', json={'title': '参数异常', 'source_ids': [{}]}).status_code == 400
    assert client.patch('/api/studio/topics/' + topic['id'], json={'version': 1, 'angle': '核对法规'}).json()['version'] == 2
    assert client.patch('/api/studio/topics/' + topic['id'], json={'version': 1, 'angle': '过期'}).status_code == 409
    delivery = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat'}).json()
    assert delivery['status'] == 'draft' and not delivery.get('published_at')
    image = s.put(owner, 'studio_asset', {'title': '现场照片', 'asset_type': 'image', 'status': 'ready'})
    video = s.put(owner, 'studio_asset', {'title': '成片', 'asset_type': 'video', 'status': 'ready'})
    assert client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': 1, 'cover_asset_id': video['id']}).status_code == 400
    updated = client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': 1, 'title': '发布前草稿', 'body': '需要人工核对', 'cover_asset_id': image['id']},).json()
    assert updated['version'] == 2 and updated['body'] == '需要人工核对' and updated['cover_asset_id'] == image['id']
    channel = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'channels'}).json()
    attached = client.patch('/api/studio/deliveries/' + channel['id'], json={'version': 1, 'video_asset_id': video['id']}).json()
    assert attached['video_asset_id'] == video['id']
    assert client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': 1, 'body': '覆盖'}).status_code == 409
    assert client.post('/api/studio/deliveries/' + delivery['id'] + '/generate', json={'version': 2}).status_code == 400
    assert client.get('/api/studio/topics').json()['items'][0]['delivery_count'] == 2
    assert next(x for x in client.get('/api/studio/deliveries?topic_id=' + topic['id']).json()['items'] if x['id'] == delivery['id'])['body'] == '需要人工核对'
    archived = client.post('/api/studio/topics/' + topic['id'] + '/archive')
    assert archived.status_code == 200
    assert client.get('/api/studio/topics').json()['items'] == []
    assert next(x for x in client.get('/api/studio/topics?include_archived=true').json()['items'] if x['id'] == topic['id'])['archived']
    assert client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'douyin'}).status_code == 404
    restored = client.post('/api/studio/topics/' + topic['id'] + '/restore')
    assert restored.status_code == 200 and not restored.json()['archived']
    assert client.get('/api/studio/topics').json()['items'][0]['delivery_count'] == 2
    other = client.post('/api/admin/users', json={'email': 'other@example.test', 'name': '其他人', 'password': 'password-12345'})
    assert other.status_code == 200
    login = client.post('/api/auth/login', json={'email': 'other@example.test', 'password': 'password-12345'}).json()
    client.headers['Authorization'] = 'Bearer ' + login['token']
    assert client.get('/api/studio/topics').json()['items'] == []
    assert client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat'}).status_code == 404
    assert client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': 2, 'body': '越权'}).status_code == 404


def test_ai_topic_and_delivery_jobs_are_idempotent_and_preserve_user_edits(client, monkeypatch):
    owner = client.get('/api/state').json()['user']['id']
    s.set_config('bindings', {'writing': 'fixture-model'})
    monkeypatch.setattr(gateway, 'select', lambda *args, **kwargs: 'fixture-model')
    captured = []

    def generate(_, messages):
        captured.append(messages)
        if '"topics"' in messages[0]['content']:
            return '{"topics":[{"title":"电梯维保常见疑问","angle":"面向物业","rationale":"依据用户提供的资料","audience":"物业经理"}]}'
        return '{"title":"交付标题","summary":"摘要","body":"完整正文","cover_brief":"设备照片","keywords":"电梯","publishing_notes":"人工核对"}'

    monkeypatch.setattr(gateway, 'generate', generate)
    source = client.post('/api/objects/source', json={'title': '维保原文', 'body': '物业问维保周期'}).json()
    request = {'brief': '给物业找选题', 'source_ids': [source['id']], 'request_id': 'topic-once'}
    first = client.post('/api/studio/topics/generate', json=request).json()
    assert client.post('/api/studio/topics/generate', json={**request, 'count': 100}).status_code == 400
    assert client.post('/api/studio/topics/generate', json=request).json()['id'] == first['id']

    def finish(job_id):
        for _ in range(200):
            item = s.get(owner, job_id)
            if item['status'] in {'done', 'failed', 'cancelled'}:
                return item
            time.sleep(.01)
        raise AssertionError('job did not finish')

    done = finish(first['id'])
    assert done['status'] == 'done', done
    assert len(s.list_(owner, 'studio_topic')) == 1
    topic_id = done['result']['topic_ids'][0]
    delivery = client.post('/api/studio/deliveries', json={'topic_id': topic_id, 'platform': 'wechat'}).json()
    job = client.post('/api/studio/deliveries/' + delivery['id'] + '/generate', json={'version': 1}).json()
    assert client.post('/api/studio/deliveries/' + delivery['id'] + '/generate', json={'version': 1}).json()['id'] == job['id']
    assert finish(job['id'])['status'] == 'done'
    result = s.get(owner, delivery['id'])
    assert result['title'] == '交付标题' and result['body'] == '完整正文' and result['status'] == 'draft'
    assert not result.get('published_at')
    assert '物业问维保周期' in str(captured)

    started, release = threading.Event(), threading.Event()

    def delayed(_, messages):
        started.set()
        assert release.wait(3)
        return '{"title":"模型覆盖","summary":"摘要","body":"模型内容","cover_brief":"封面","keywords":"电梯","publishing_notes":"核对"}'

    monkeypatch.setattr(gateway, 'generate', delayed)
    pending = client.post('/api/studio/deliveries/' + delivery['id'] + '/generate', json={'version': result['version']}).json()
    assert started.wait(3)
    edited = client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': result['version'], 'title': '用户编辑', 'body': '用户内容'}).json()
    release.set()
    assert finish(pending['id'])['status'] == 'failed'
    assert s.get(owner, delivery['id'])['body'] == '用户内容'
    assert edited['version'] == result['version'] + 1


def test_admin_knowledge_only_enters_qa_after_publication(client):
    draft = client.post('/api/admin/resources', json={'title': '本公司接待口径', 'body': '先核对客户楼宇情况。', 'type': 'knowledge', 'purpose': 'qa', 'status': 'draft'}).json()
    assert draft['id'] and '本公司接待口径' not in resources.context('qa')
    assert client.post('/api/admin/resources', json={**draft, 'status': 'published'}).status_code == 400
    published = client.post('/api/admin/resources', json={**draft, 'source': '公司确认的 SOP', 'scope': '本公司售后接待', 'valid_from': '2020-01-01', 'status': 'published'}).json()
    assert '系统资料ID:' + draft['id'] in resources.context('qa')
    assert '本公司接待口径' not in resources.context('writing')
    future = client.post('/api/admin/resources', json={'title': '未来口径', 'body': '未来才可用', 'type': 'knowledge', 'purpose': 'qa', 'source': '内部资料', 'scope': '测试', 'valid_from': '2099-01-01', 'status': 'published'})
    assert future.status_code == 200 and '未来口径' not in resources.context('qa')
    stopped = client.post('/api/admin/resources', json={**published, 'status': 'disabled'}).json()
    assert stopped['version'] == published['version'] + 1
    assert '本公司接待口径' not in resources.context('qa')
