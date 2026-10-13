"""Saved conversation content transfers atomically, without models or publishing."""
from test_creation_workflow_isolation import account, client
from backend import store as s


def source(platform='wechat'):
    asset = s.put('alice', 'studio_asset', {'title': '正文图片', 'asset_type': 'image', 'status': 'ready'})
    task = s.put('alice', 'task', {'title': '写文章', 'messages': []})
    content = s.put('alice', 'content', {'title': '电梯分类', 'body': '文章正文\n\n![配图](/api/studio/assets/' + asset['id'] + '/file)',
                    'summary': '分类知识', 'cover_brief': '示意封面', 'wechat_style': {'font_size': '17'},
                    'task_id': task['id'], 'platform': platform, 'format': '公众号', 'outcome_type': 'writing',
                    'script': '只说口播。', 'caption': '发布描述', 'shotlist': '镜头1', 'tags': '#电梯'})
    task = s.put('alice', 'task', {**task, 'platform_outcomes': {platform: content['id']}}, task['id'])
    return task, content, f"/api/tasks/{task['id']}/outcomes/{content['id']}/handoff"


def test_transfers_article_all_fields_and_inline_images_as_independent_work(client):
    account(client)
    task, content, url = source()
    result = client.post(url, json={'version': content['version']})
    assert result.status_code == 200, result.text
    flow = result.json()['flow']
    assert flow['source_outcome_id'] == content['id'] and flow['stage'] == '4'
    copied = s.get('alice', flow['content_id'])
    assert copied['flow_id'] == flow['id'] and copied['id'] != content['id']
    assert copied['body'].startswith('文章正文\n\n![配图]') and 'task_id' not in copied
    assert copied['body'] != content['body']  # Local image references use owned snapshots.
    delivery = s.get('alice', flow['delivery_id'])
    assert delivery['body'] == copied['body'] and delivery['summary'] == content['summary']
    assert delivery['wechat_style']['font_size'] == '17'
    assert delivery['flow_id'] == flow['id'] and delivery['topic_id'] == flow['topic_id']
    assert client.get('/api/studio/deliveries', params={'flow_id': flow['id']}).json()['items'][0]['id'] == delivery['id']
    assert client.get('/api/studio/flows').json()['items'][0]['id'] == flow['id']
    assert s.get('alice', content['id']) == content and s.get('alice', task['id']) == task


def test_repeat_same_version_reuses_work_and_preserves_manual_delivery(client):
    account(client)
    task, content, url = source()
    flow = client.post(url, json={'version': 1}).json()['flow']
    row = s.get('alice', flow['delivery_id'])
    edited = s.put('alice', 'studio_delivery', {**row, 'body': '人工修改的交付正文'}, row['id'])
    second = client.post(url, json={'version': 1})
    assert second.status_code == 200
    assert second.json()['flow']['id'] == flow['id']
    assert len(s.list_('alice', 'studio_flow')) == 1
    assert s.get('alice', row['id']) == edited
    links = client.get(url+'s').json()['items']
    assert links[0]['source_version'] == 1


def test_new_source_version_creates_new_snapshot_without_overwriting_previous(client):
    account(client)
    task, content, url = source()
    flow = client.post(url, json={'version': 1}).json()['flow']
    original_copy = s.get('alice', flow['content_id'])
    new = s.put('alice', 'content', {**content, 'body': '对话更新的新正文'}, content['id'])
    assert client.post(url, json={'version': 1}).status_code == 409
    next_flow = client.post(url, json={'version': new['version']}).json()['flow']
    assert next_flow['id'] != flow['id']
    assert s.get('alice', flow['content_id']) == original_copy
    assert s.get('alice', next_flow['content_id'])['body'] == '对话更新的新正文'


def test_rejects_foreign_archived_unbound_and_active_generation_without_writes(client):
    account(client)
    task, content, url = source()
    client.headers['authorization'] = 'bob'
    assert client.post(url, json={'version': 1}).status_code == 404
    client.headers['authorization'] = 'alice'
    assert client.post(url, json={'version': True}).status_code == 400
    assert client.post(url, json={'version': 1, 'platform': 'douyin'}).status_code == 400
    job = s.put('alice', 'job', {'task_id': task['id'], 'status': 'running'})
    assert client.post(url, json={'version': 1}).status_code == 409
    s.put('alice', 'job', {**job, 'status': 'done'}, job['id'])
    s.put('alice', 'task', {**task, 'platform_outcomes': {}}, task['id'])
    assert client.post(url, json={'version': 1}).status_code == 409
    s.put('alice', 'task', {**task, 'archived': True}, task['id'])
    assert client.post(url, json={'version': 1}).status_code == 404
    assert not s.list_('alice', 'studio_flow') and not s.list_('alice', 'studio_delivery')


def test_invalid_cover_or_profile_does_not_leave_partial_work(client):
    account(client)
    task, content, url = source()
    invalid = s.put('alice', 'studio_asset', {'title': '未完成的图片', 'asset_type': 'image', 'status': 'failed'})
    content = s.put('alice', 'content', {**content, 'cover_asset_id': invalid['id']}, content['id'])
    assert client.post(url, json={'version': content['version']}).status_code == 400
    assert not s.list_('alice', 'studio_topic') and not s.list_('alice', 'studio_flow')


def test_video_script_and_cover_transfer(client):
    account(client)
    task, content, url = source('douyin')
    cover = s.put('alice', 'studio_asset', {'title': '封面', 'asset_type': 'image', 'status': 'ready', 'local_file': '/unused.png'})
    content = s.put('alice', 'content', {**content, 'cover_asset_id': cover['id']}, content['id'])
    flow = client.post(url, json={'version': content['version']}).json()['flow']
    delivery = s.get('alice', flow['delivery_id'])
    assert delivery['script'] == '只说口播。' and delivery['caption'] == '发布描述'
    assert flow['cover_id'] != cover['id']
    assert s.get('alice', flow['cover_id'])['flow_id'] == flow['id']
    assert delivery['cover_asset_id'] == flow['cover_id']


def test_unsupported_platform_has_no_partial_work(client):
    account(client)
    task, content, url = source('moments')
    assert client.post(url, json={'version': 1}).status_code == 400
    assert not s.list_('alice', 'studio_flow')


def test_legacy_article_uses_explicit_saved_format_and_task_binding(client):
    account(client)
    task, content, url = source()
    old = s.put('alice', 'content', {key: value for key, value in content.items() if key != 'platform'}, content['id'])
    s.put('alice', 'task', {**task, 'platform_outcomes': {}, 'content_id': content['id']}, task['id'])
    result = client.post(url, json={'version': old['version']})
    assert result.status_code == 200, result.text
    assert result.json()['flow']['platform'] == 'wechat'
