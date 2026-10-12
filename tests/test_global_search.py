"""Search must match user-visible text, collapse generated copies, and stay read-only."""
from test_workflows import client, account
from backend import store as s


def test_empty_search_never_returns_everything(client):
    owner = account(client)['user']['id']
    s.put(owner, 'studio_flow', {'title': '未命名作品', 'brief': ''})
    s.put(owner, 'task', {'title': '无关的电梯任务'})
    assert client.get('/api/search', params={'q': '  '}).json() == []
    assert client.get('/api/search', params={'q': '结婚'}).json() == []


def test_search_fields_relevance_summary_and_exclusions(client):
    owner = account(client)['user']['id']
    exact = s.put(owner, 'source', {'title': '结婚', 'body': '婚礼准备清单'})
    body = s.put(owner, 'knowledge', {'title': '人生计划', 'body': '准备预算。结婚需要提前商量。'})
    related = s.put(owner, 'studio_topic', {'title': '婚礼筹备指南', 'angle': '家庭沟通'})
    flow = s.put(owner, 'studio_flow', {'title': '未命名作品', 'brief': '结婚纪念视频'})
    chat = s.put(owner, 'task', {'title': '对话', 'messages': [{'role': 'user', 'text': '结婚文案怎么写'}]})
    s.put(owner, 'task', {'title': '维修任务', 'input': {'debug': '结婚'}})
    s.put(owner, 'source', {'title': '结婚归档', 'archived': True})
    s.put(owner, 'studio_flow', {'title': '未命名作品', 'brief': ''})
    s.put(owner, 'job', {'title': '结婚运行记录'})
    before = s.list_(owner)
    result = client.get('/api/search', params={'q': '结婚'}).json()
    assert {x['id'] for x in result} == {exact['id'], body['id'], related['id'], flow['id'], chat['id']}
    assert result[0]['id'] == exact['id']
    assert result[-1]['id'] == related['id']
    assert all(x['category'] and x['summary'] and x['route'] and x['match_reason'] for x in result)
    assert next(x for x in result if x['id'] == body['id'])['route'] == 'knowledge/knowledge/' + body['id']
    assert next(x for x in result if x['id'] == flow['id'])['route'] == 'studio/flow?work=' + flow['id']
    assert s.list_(owner) == before


def test_multiword_literal_percent_and_deterministic_ties(client):
    owner = account(client)['user']['id']
    a = s.put(owner, 'source', {'title': '结婚 预算', 'body': '增长100%'}, 'search-a')
    s.put(owner, 'source', {'title': '结婚 预算', 'body': '增长100%'}, 'search-b')
    s.put(owner, 'source', {'title': '结婚旅行', 'body': '机票'})
    rows = client.get('/api/search', params={'q': '结婚 预算'}).json()
    assert len(rows) == 2 and rows[0]['score'] == rows[1]['score']
    assert rows == client.get('/api/search', params={'q': '结婚 预算'}).json()
    assert len(client.get('/api/search', params={'q': '%'}).json()) == 2
    assert client.get('/api/search', params={'q': 'x' * 201}).status_code == 400


def test_generated_family_and_hotlist_entries_are_deduplicated(client):
    owner = account(client)['user']['id']
    draft = s.put(owner, 'studio_draft', {'title': '结婚图片', 'tool': 'text_image', 'input': {'prompt': '结婚现场'}})
    run = s.put(owner, 'studio_run', {'title': '结婚图片', 'tool': 'text_image', 'draft_id': draft['id'], 'status': 'done'})
    asset = s.put(owner, 'studio_asset', {'title': '结婚图片', 'asset_type': 'image', 'run_id': run['id'], 'local_file': 'private.png', 'remote': {'token': 'private'}})
    source = s.put(owner, 'source', {'title': '结婚指南', 'url': 'https://example.com/wedding', 'body': '原始资料'})
    s.put(owner, 'hotlist', {'title': '微博', 'platform': 'weibo', 'items': [
        {'title': '结婚指南', 'url': source['url'], 'body': ''},
        {'title': '结婚登记预约', 'url': 'https://example.com/register', 'body': '登记须知'},
        {'title': '电梯维护', 'url': 'https://example.com/lift', 'body': ''}]})
    result = client.get('/api/search', params={'q': '结婚'}).json()
    media = [x for x in result if x['kind'].startswith('studio_')]
    assert len(media) == 1 and media[0]['id'] == asset['id']
    assert set(media[0]['related_ids']) == {draft['id'], run['id'], asset['id']}
    assert 'local_file' not in str(media[0]) and 'private' not in str(media[0])
    assert len(result) == 3
    assert next(x for x in result if x['kind'] == 'hotlist')['title'] == '结婚登记预约'
    account(client, 'search-other@example.test')
    assert client.get('/api/search', params={'q': '结婚'}).json() == []
