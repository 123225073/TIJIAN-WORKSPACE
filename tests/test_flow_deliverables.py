import base64
import io
import zipfile
import pytest

from PIL import Image

from test_workflows import client, account
from backend import store as s, media_studio, flow_deliverables as delivery


def setup(client):
    owner = account(client)['user']['id']
    topic = s.put(owner, 'studio_topic', {'title': '电梯报价核对'})
    flow = s.put(owner, 'studio_flow', {'topic_id': topic['id'], 'brief': topic['title']})
    return owner, flow, topic


def document(owner, flow, topic, format='公众号文章', **extra):
    row = s.put(owner, 'content', {'title': '设备与服务怎么核对', 'body': '真实正文',
                                 'format': format, 'flow_id': flow['id'], **extra})
    if topic:
        draft = s.put(owner, 'studio_text_draft', {'flow_id': flow['id'], 'topic_id': topic['id'],
                                                  'creation_channel': delivery.FORMATS[format]})
        s.put(owner, 'job', {'status': 'done', 'flow_id': flow['id'], 'input': {'draft_id': draft['id']},
                            'result': {'content_id': row['id'], 'version': row['version']}})
    return row


def image(owner, **extra):
    binary = io.BytesIO()
    Image.new('RGB', (10, 12), 'blue').save(binary, 'PNG')
    ident = s.uid()
    root = media_studio._root(owner)
    (root / (ident + '.png')).write_bytes(binary.getvalue())
    return s.put(owner, 'studio_asset', {'title': '内部任务 ' + ident, 'asset_type': 'image',
                 'status': 'ready', 'mime_type': 'image/png', 'local_file': ident + '.png', **extra}, ident), binary.getvalue()


def items(result):
    return [item for group in result['groups'] for item in group['versions']]


def test_manifest_uses_stored_draft_topics_groups_platforms_and_keeps_unknown_history(client):
    owner, flow, topic = setup(client)
    current = document(owner, flow, topic)
    social = document(owner, flow, topic, '小红书文案')
    old_topic = s.put(owner, 'studio_topic', {'title': '旧选题'})
    old = document(owner, flow, old_topic)
    unknown = document(owner, flow, None)
    before = s.get(owner, flow['id']), s.get(owner, current['id'])
    result = client.get('/api/studio/flows/' + flow['id'] + '/deliverables').json()
    assert [g['platform'] for g in result['groups']] == ['wechat', 'xiaohongshu', 'moments', 'video', 'avatar']
    assert result['topic_title'] == topic['title']
    assert {r['content_id'] for r in items(result)} == {current['id'], social['id']}
    assert {r['content_id'] for r in result['history']} == {old['id'], unknown['id']}
    assert all(not r['images_zip_url'] for r in result['history'])
    assert next(r for r in result['history'] if r['content_id'] == unknown['id'])['scope_reason'].endswith('待归类')
    assert before == (s.get(owner, flow['id']), s.get(owner, current['id']))


def test_saved_delivery_association_classifies_conversation_handoff_without_guessing(client):
    owner, flow, topic = setup(client)
    current = document(owner, flow, None)
    s.put(owner, 'studio_delivery', {'flow_id': flow['id'], 'topic_id': topic['id'], 'source_ids': [current['id']]})
    assert [r['content_id'] for r in items(delivery.manifest(owner, flow['id']))] == [current['id']]
    other = s.put(owner, 'studio_topic', {'title': '冲突的选题'})
    s.put(owner, 'studio_delivery', {'flow_id': flow['id'], 'topic_id': other['id'], 'source_ids': [current['id']]})
    result = delivery.manifest(owner, flow['id'])
    assert not items(result) and '冲突' in result['history'][0]['scope_reason']


def test_markdown_image_zip_includes_legacy_illustrations_deduplicates_and_preserves_order(client):
    owner, flow, topic = setup(client)
    asset, binary = image(owner, flow_id=flow['id'])
    row = document(owner, flow, topic)
    legacy = s.put(owner, 'illustration', {'content_id': row['id'], 'data_uri': 'data:image/png;base64,' + base64.b64encode(binary).decode()})
    tag = '![](/api/studio/assets/' + asset['id'] + '/file)'
    body = tag + '\n\n' + '![](/api/illustrations/' + legacy['id'] + '/file)\n\n' + tag
    body += '\n\n```md\n![](https://never-fetch.example/code.png)\n```'
    body += '\n\n:::article-production note note-1\n![](https://never-fetch.example/note.png)\n:::end-article-production'
    row = s.put(owner, 'content', {**row, 'body': body}, row['id'], row['version'])
    result = client.get('/api/studio/flows/' + flow['id'] + '/deliverables').json()
    current = items(result)[0]
    assert [(x['kind'], x['index']) for x in current['images']] == [('studio_asset', 1), ('illustration', 2)]
    assert current['unavailable_count'] == 0
    response = client.get(current['images_zip_url'])
    assert response.status_code == 200, response.text
    assert 'filename*=UTF-8' in response.headers['content-disposition']
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ['01-公众号配图.png', '02-公众号配图.png']
        assert all(archive.read(name) == binary for name in archive.namelist())
        assert asset['id'] not in ''.join(archive.namelist())
    assert s.get(owner, row['id'])['body'] == body


def test_social_picture_order_and_unavailable_references_never_silently_drop_images(client):
    owner, flow, topic = setup(client)
    first, _ = image(owner, flow_id=flow['id'])
    second, _ = image(owner)
    missing = s.uid()
    row = document(owner, flow, topic, '小红书文案', image_asset_ids=[second['id'], first['id'], second['id'], missing])
    current = items(delivery.manifest(owner, flow['id']))[0]
    assert [p['id'] for p in current['images']] == [second['id'], first['id'], missing]
    assert current['unavailable_count'] == 1 and '不完整' in current['notice']
    response = client.get(current['images_zip_url'])
    assert response.status_code == 400 and '不可下载' in response.json()['detail']


def test_zip_scope_and_optimistic_version_checks(client):
    owner, flow, topic = setup(client)
    asset, _ = image(owner)
    row = document(owner, flow, topic, '小红书文案', image_asset_ids=[asset['id']])
    url = items(delivery.manifest(owner, flow['id']))[0]['images_zip_url']
    s.put(owner, 'content', {**row, 'image_asset_ids': []}, row['id'], row['version'])
    assert client.get(url).status_code == 409
    assert client.get(url.split('?')[0]).status_code == 422
    other_topic = s.put(owner, 'studio_topic', {'title': '其他选题'})
    old = document(owner, flow, other_topic)
    assert client.get('/api/studio/flows/' + flow['id'] + '/deliverables/' + old['id'] + '/images.zip?version=' + str(old['version'])).status_code == 409
    foreign_flow = s.put(owner, 'studio_flow', {'topic_id': topic['id']})
    assert client.get('/api/studio/flows/' + foreign_flow['id'] + '/deliverables/' + row['id'] + '/images.zip?version=2').status_code == 404
    account(client, 'foreign-download@example.test')
    assert client.get('/api/studio/flows/' + flow['id'] + '/deliverables').status_code == 404
    assert client.get(url).status_code == 404


def test_external_cross_flow_and_unproven_article_images_are_unavailable_but_explicit_reuse_is_allowed(client):
    owner, flow, topic = setup(client)
    foreign_flow = s.put(owner, 'studio_flow', {'topic_id': topic['id']})
    foreign, binary = image(owner, flow_id=foreign_flow['id'])
    other = s.put(owner, 'studio_topic', {'title': '其他题目'})
    wrong_topic, _ = image(owner, flow_id=flow['id'], topic_id=other['id'])
    legacy = s.put(owner, 'illustration', {'content_id': s.uid(), 'data_uri': 'data:image/png;base64,' + base64.b64encode(binary).decode()})
    row = document(owner, flow, topic, body='\n\n'.join('![](' + path + ')' for path in [
        '/api/studio/assets/' + foreign['id'] + '/file', '/api/studio/assets/' + wrong_topic['id'] + '/file',
        '/api/illustrations/' + legacy['id'] + '/file', 'https://never-fetch.example/image.png']))
    item = items(delivery.manifest(owner, flow['id']))[0]
    assert item['unavailable_count'] == 3
    assert item['images'][1]['available'] and item['images'][1]['id'] == wrong_topic['id']
    assert client.get(item['images_zip_url']).status_code == 400


def test_independent_media_requires_proven_current_topic_and_contains_no_private_payloads(client):
    owner, flow, topic = setup(client)
    row = document(owner, flow, topic)
    draft = s.put(owner, 'studio_draft', {'flow_id': flow['id'], 'source_ids': [row['id']]})
    asset, _ = image(owner, flow_id=flow['id'])
    s.put(owner, 'studio_run', {'flow_id': flow['id'], 'draft_id': draft['id'], 'asset_ids': [asset['id']]})
    unknown, _ = image(owner, flow_id=flow['id'])
    result = delivery.manifest(owner, flow['id'])
    assert [a['id'] for a in result['assets']] == [asset['id']]
    assert result['assets'][0]['file_url'] == '/api/studio/assets/' + asset['id'] + '/file'
    assert result['assets'][0]['filename'] == '独立图片.png'
    assert result['assets'][0]['mime_type'] == 'image/png'
    assert [a['id'] for a in result['unassigned']] == [unknown['id']]
    assert all('local_file' not in a and 'data_uri' not in a and 'snapshot' not in a for a in result['assets'] + result['unassigned'])


def test_missing_invalid_path_archived_and_foreign_owned_files_are_reported_not_downloaded(client):
    owner, flow, topic = setup(client)
    missing, _ = image(owner)
    media_studio._path(owner, missing['local_file']).unlink()
    invalid, _ = image(owner, local_file='../outside.png')
    archived, _ = image(owner, archived=True)
    foreign, _ = image(s.uid())
    document(owner, flow, topic, '小红书文案', image_asset_ids=[missing['id'], invalid['id'], archived['id'], foreign['id']])
    item = items(delivery.manifest(owner, flow['id']))[0]
    assert item['unavailable_count'] == 4
    assert all(not image['available'] and image['reason'] for image in item['images'])
    response = client.get(item['images_zip_url'])
    assert response.status_code == 400
    assert '../outside.png' not in str(item) and foreign['local_file'] not in str(item)


def test_current_unknown_format_is_unclassified_and_direct_topic_cannot_mask_conflicting_drafts(client):
    owner, flow, topic = setup(client)
    unknown = s.put(owner, 'content', {'flow_id': flow['id'], 'topic_id': topic['id'], 'format': '未知格式', 'body': '正文'})
    row = document(owner, flow, topic)
    other_topic = s.put(owner, 'studio_topic', {'title': '另一个选题'})
    second = s.put(owner, 'studio_text_draft', {'flow_id': flow['id'], 'topic_id': other_topic['id']})
    s.put(owner, 'job', {'flow_id': flow['id'], 'input': {'draft_id': second['id']}, 'result': {'content_id': row['id']}})
    result = delivery.manifest(owner, flow['id'])
    assert not items(result)
    reasons = {r['content_id']: r['scope_reason'] for r in result['history']}
    assert reasons[unknown['id']] == '文稿平台待归类'
    assert '冲突' in reasons[row['id']]


def test_legacy_same_topic_reuse_is_proven_by_origin_and_decoded_once_per_request(client, monkeypatch):
    owner, flow, topic = setup(client)
    original = document(owner, flow, topic)
    _, binary = image(owner)
    legacy = s.put(owner, 'illustration', {'content_id': original['id'], 'data_uri': 'data:image/png;base64,' + base64.b64encode(binary).decode()})
    body = '![](/api/illustrations/' + legacy['id'] + '/file)'
    s.put(owner, 'content', {**original, 'body': body}, original['id'], original['version'])
    reused = document(owner, flow, topic, body=body)
    calls = []
    decode = delivery.base64.b64decode
    monkeypatch.setattr(delivery.base64, 'b64decode', lambda *a, **k: (calls.append(1) or decode(*a, **k)))
    result = delivery.manifest(owner, flow['id'])
    assert all(item['unavailable_count'] == 0 for item in items(result))
    assert len(calls) == 1
    calls.clear()
    response = client.get(next(item for item in items(result) if item['content_id'] == reused['id'])['images_zip_url'])
    assert response.status_code == 200 and len(calls) == 1


@pytest.mark.parametrize('restore', ['flow_read', 'draft_list'])
def test_existing_read_reconciliation_exposes_new_generation_shape_without_manifest_writes(client, restore):
    owner, flow, topic = setup(client)
    draft = s.put(owner, 'studio_text_draft', {'flow_id': flow['id'], 'topic_id': topic['id'],
                  'creation_channel': 'wechat', 'tool': 'text', 'input': {'format': '公众号文章'}})
    # Production's generation worker initially saves an unscoped content/result.
    # Existing flow reads reconcile the immutable draft association afterward.
    content = s.put(owner, 'content', {'title': '刚完成的文稿', 'body': '真实生成形状的正文', 'format': '公众号文章'})
    job = s.put(owner, 'job', {'status': 'done', 'input': {'draft_id': draft['id'], 'draft_version': draft['version']},
                            'result': {'content_id': content['id'], 'version': content['version']}})
    assert not content.get('flow_id') and not job.get('flow_id')
    path = '/api/studio/flow?work_id=' + flow['id'] if restore == 'flow_read' else '/api/studio/flows/' + flow['id'] + '/drafts'
    assert client.get(path).status_code == 200
    bound = s.get(owner, content['id'])
    assert bound['flow_id'] == flow['id']
    versions = {row['id']: row['version'] for row in s.list_(owner)}
    result = client.get('/api/studio/flows/' + flow['id'] + '/deliverables').json()
    assert [row['content_id'] for row in items(result)] == [content['id']]
    assert items(result)[0]['version'] == bound['version']
    assert versions == {row['id']: row['version'] for row in s.list_(owner)}
