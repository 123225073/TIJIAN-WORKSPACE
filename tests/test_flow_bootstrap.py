from test_workflows import client, account
from backend import store as s


def test_bootstrap_reconciles_scoped_drafts_and_reflects_new_versions(client):
    owner = account(client)['user']['id']
    topic = s.put(owner, 'studio_topic', {'title': '切换验收'})
    flow = s.put(owner, 'studio_flow', {'title': '当前作品', 'topic_id': topic['id']})
    draft = s.put(owner, 'studio_text_draft', {'title': '独立稿件', 'flow_id': flow['id'],
                  'topic_id': topic['id'], 'creation_channel': 'wechat', 'tool': 'text',
                  'input': {'brief': '保存内容', 'format': '公众号文章'}})
    content = s.put(owner, 'content', {'title': '结果', 'body': '原始正文', 'format': '公众号文章'})
    s.put(owner, 'job', {'status': 'done', 'input': {'draft_id': draft['id']},
                         'result': {'content_id': content['id']}})
    other = s.put(owner, 'studio_flow', {'title': '另一作品'})
    s.put(owner, 'studio_text_draft', {'title': '其他稿件', 'flow_id': other['id'], 'tool': 'text'})

    url = '/api/studio/flows/' + flow['id'] + '/bootstrap'
    first = client.get(url)
    assert first.status_code == 200, first.text
    assert first.json()['flow']['id'] == flow['id']
    assert [row['id'] for row in first.json()['items']] == [draft['id']]
    assert s.get(owner, content['id'])['flow_id'] == flow['id']
    s.put(owner, 'studio_text_draft', {**draft, 'title': '更新后的稿件'}, draft['id'], draft['version'])
    assert client.get(url).json()['items'][0]['title'] == '更新后的稿件'

    account(client, 'foreign-bootstrap@example.test')
    assert client.get(url).status_code == 404


def test_bootstrap_recovers_legacy_link_without_exposing_other_work(client):
    owner = account(client)['user']['id']
    legacy = s.put(owner, 'studio_text_draft', {'title': '旧草稿', 'tool': 'text',
                   'input': {'brief': '原文', 'format': '公众号文章'}})
    flow = s.put(owner, 'studio_flow', {'title': '旧作品', 'last_draft': legacy['id']})
    result = client.get('/api/studio/flows/' + flow['id'] + '/bootstrap')
    assert result.status_code == 200, result.text
    upgraded = result.json()['flow']
    assert upgraded['last_draft'] != legacy['id']
    assert result.json()['items'][0]['id'] == upgraded['last_draft']
    assert s.get(owner, legacy['id']).get('flow_id') is None
