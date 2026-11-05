import json
from uuid import uuid4

from backend import store as s
from test_creation import fake_model, finish
from test_workflows import account, client


def test_direct_master_streams_into_saved_document_and_uses_admin_methods(client, monkeypatch):
    from backend import capabilities, streaming
    owner = account(client)['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯报价先对齐条件'}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    path = '/api/studio/flows/' + flow['id'] + '/matrix'
    skill = next(row for row in capabilities.list_() if row['id'] == 'skill:matrix-article')
    capabilities.save({**skill, 'body': '测试管理员方法：先明确判断再解释依据。'}, owner)
    article = '先核对现场条件，再比较报价中的安装范围与交付边界。' * 12
    observed = []

    def answer(_, messages):
        observed.append(messages[0]['content'])
        text = json.dumps({'title': '电梯报价先对齐条件', 'body': article}, ensure_ascii=False)
        streaming.emit('delta', text)
        return text

    fake_model(monkeypatch, answer)
    response = client.post(path + '/write-master', json={
        'topic_id': topic['id'], 'version': 0, 'request_id': str(uuid4()), 'direct': True})
    assert response.status_code == 200, response.text
    job = finish(client, response.json())
    assert job['status'] == 'done', job
    master = client.get(path).json()['master']
    assert master['version'] == 1 and master['body'] == '# 电梯报价先对齐条件\n\n' + article
    assert job['result']['master']['id'] == master['id']
    assert article in job['stream_text']
    assert '测试管理员方法：先明确判断再解释依据。' in observed[0]


def test_direct_master_never_overwrites_document_saved_while_generating(client, monkeypatch):
    import threading
    account(client)
    topic = client.post('/api/studio/topics', json={'title': '维保服务如何核对'}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    path = '/api/studio/flows/' + flow['id'] + '/matrix'
    entered, release = threading.Event(), threading.Event()

    def answer(*_):
        entered.set()
        assert release.wait(4)
        return json.dumps({'title': '先核对服务范围', 'body': '维保服务应先核对合同范围与实际设备情况。' * 15}, ensure_ascii=False)

    fake_model(monkeypatch, answer)
    response = client.post(path + '/write-master', json={
        'topic_id': topic['id'], 'version': 0, 'request_id': str(uuid4()), 'direct': True})
    try:
        assert entered.wait(2)
        saved = client.put(path, json={'topic_id': topic['id'], 'version': 0,
            'body': '另一个窗口保存的真实稿件', 'platforms': ['zhihu']})
        assert saved.status_code == 200, saved.text
    finally:
        release.set()
    assert finish(client, response.json())['status'] == 'failed'
    assert client.get(path).json()['master']['body'] == '另一个窗口保存的真实稿件'


def test_master_ai_uses_selected_topic_and_leaves_existing_draft_for_review(client, monkeypatch):
    owner = account(client)['user']['id']
    source = s.put(owner, 'source', {'title': '勘查记录', 'body': '现场已测井道净宽1600毫米。'})
    topic = client.post('/api/studio/topics', json={'title': '井道改造怎么核价', 'angle': '先看实测', 'source_ids': [source['id']]}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    path = '/api/studio/flows/' + flow['id'] + '/matrix'
    previous = {'topic_id': topic['id'], 'version': 0, 'body': '原有草稿', 'platforms': ['wechat']}
    assert client.put(path, json=previous).status_code == 200
    article = '先向现场勘查人员确认井道净宽和改造边界，再比较同口径报价。' * 10
    messages = []

    def write(_, current):
        messages.append(current)
        return json.dumps({'title': '先核对井道改造边界', 'body': article}, ensure_ascii=False)

    fake_model(monkeypatch, write)
    payload = {'topic_id': topic['id'], 'version': 1, 'request_id': str(uuid4())}
    response = client.post(path + '/write-master', json=payload)
    assert response.status_code == 200, response.text
    job = finish(client, response.json())
    assert job['status'] == 'done', job
    assert client.post(path + '/write-master', json=payload).json()['id'] == job['id']
    overview = client.get(path).json()
    assert overview['master']['body'] == '原有草稿'
    assert overview['master_job']['result']['body'] == '# 先核对井道改造边界\n\n' + article
    assert len(messages) == 1
    context = json.loads(messages[0][-1]['content'])
    assert context['选题']['title'] == '井道改造怎么核价'
    assert context['资料'][0]['body'] == source['body']
    assert client.post(path + '/write-master', json={**payload, 'version': 0}).status_code == 409


def test_platform_runs_use_the_same_saved_master_and_keep_independent_outputs(client, monkeypatch):
    owner = account(client)['user']['id']
    topic = client.post('/api/studio/topics', json={'title': '电梯选型依据', 'angle': '按场地比较'}).json()
    flow = client.post('/api/studio/flow', json={'new': True, 'version': 0, 'topic_id': topic['id']}).json()
    path = '/api/studio/flows/' + flow['id'] + '/matrix'
    assert client.get(path).json()['master']['version'] == 0
    source = '先核对已确认的井道尺寸 1600 毫米。不同住宅应分别复核。'
    payload = {'topic_id': topic['id'], 'version': 0, 'body': source, 'platforms': ['wechat', 'zhihu']}
    saved = client.put(path, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()['version'] == 1
    assert client.put(path, json=payload).status_code == 409
    assert client.put(path, json={**payload, 'version': 1, 'platforms': ['douyin']}).status_code == 400

    messages = []

    def write(_, current):
        text = str(current)
        messages.append(text)
        return '标题：平台示例\n\n请先核对井道尺寸。'

    fake_model(monkeypatch, write)
    results = {}
    for platform in ('wechat', 'zhihu'):
        request = {'platform': platform, 'master_version': 1, 'topic_id': topic['id'], 'request_id': str(uuid4())}
        response = client.post(path + '/generate', json=request)
        assert response.status_code == 200, response.text
        job = response.json()
        assert client.post(path + '/generate', json=request).json()['id'] == job['id']
        complete = finish(client, job)
        assert complete['status'] == 'done', complete
        results[platform] = complete['result']['content_id']
    assert len(set(results.values())) == 2
    assert len(messages) == 2 and all(source in message for message in messages)
    assert '适合手机阅读' in messages[0] and '用具体问题作标题' in messages[1]
    overview = client.get(path).json()
    assert overview['master']['body'] == source
    assert {run['platform']: run['content_id'] for run in overview['runs']} == results
    for run in overview['runs']:
        assert run['master_version'] == 1
        content = s.get(owner, run['content_id'])
        assert content['flow_id'] == flow['id'] and content['topic_id'] == topic['id']
        assert content['creation_channel'] == run['platform'] and content['version'] == run['content_version']
    other = client.post('/api/studio/topics', json={'title': '另一个选题'}).json()
    changed = client.post('/api/studio/flow', json={'id': flow['id'], 'version': flow['version'], 'topic_id': other['id']}).json()
    assert client.get(path).json()['master']['version'] == 0
    client.post('/api/studio/flow', json={'id': flow['id'], 'version': changed['version'], 'topic_id': topic['id']})
    assert client.get(path).json()['master']['body'] == source
    account(client, 'matrix-foreign@example.test')
    assert client.get(path).status_code == 404
    assert client.put(path, json=payload).status_code == 404
