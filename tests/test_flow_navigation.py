"""One-stop creation keeps each work and its delivery separate."""

from test_creation_workflow_isolation import account, client


def test_creation_works_are_independent_and_deliveries_follow_their_work(client):
    account(client)
    topic = client.post('/api/studio/topics', json={'title': '老旧电梯更新', 'source_ids': []}).json()
    first = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'brief': '作品一', 'stage': 0}).json()
    second = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'brief': '作品二', 'stage': 0}).json()
    assert first['id'] != second['id']
    assert {row['id'] for row in client.get('/api/studio/flows').json()['items']} == {first['id'], second['id']}

    updated = client.post('/api/studio/flow', json={**first, 'brief': '作品一已修改', 'topic_id': topic['id'], 'stage': 4, 'assembled': 'no'}).json()
    client.post('/api/studio/flow', json={**second, 'topic_id': topic['id'], 'stage': 4})
    assert client.get('/api/studio/flow', params={'work_id': first['id']}).json()['brief'] == '作品一已修改'
    assert client.get('/api/studio/flow', params={'work_id': second['id']}).json()['brief'] == '作品二'
    assert client.post('/api/studio/flow', json={**first, 'brief': '过期页面'}).status_code == 409

    one = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat', 'flow_id': first['id']})
    two = client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat', 'flow_id': second['id']})
    assert one.status_code == two.status_code == 200
    assert one.json()['flow_id'] == first['id'] and two.json()['flow_id'] == second['id']
    other_topic = client.post('/api/studio/topics', json={'title': '电梯维保', 'source_ids': []}).json()
    assert client.post('/api/studio/deliveries', json={'topic_id': other_topic['id'], 'platform': 'wechat', 'flow_id': first['id']}).status_code == 400

    account(client, 'another-flow-user@example.test')
    assert client.get('/api/studio/flow', params={'work_id': first['id']}).status_code == 404
    assert client.post('/api/studio/flow', json={**updated, 'brief': '越权修改'}).status_code == 404
    assert client.post('/api/studio/deliveries', json={'topic_id': topic['id'], 'platform': 'wechat', 'flow_id': first['id']}).status_code == 404
