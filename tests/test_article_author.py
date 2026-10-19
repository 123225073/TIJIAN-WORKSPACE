"""Article metadata through real local routes; model and WeChat boundaries intercepted."""
import json

import pytest

from backend import store as s, wechat_publish
from test_wechat_publish import client, _prepared
from test_writing_improvements import bind_writing, finished


def owner(client):
    return client.get('/api/state').json()['user']['id']


def test_content_metadata_save_export_and_empty_author(client):
    created = client.post('/api/objects/content', json={'title': '原题', 'body': '保留正文', 'author': ''})
    assert created.status_code == 200, created.text
    row = created.json()
    changed = client.patch('/api/objects/' + row['id'], json={
        'version': row['version'], 'title': '独立 <标题>', 'author': '作者 <script>&',
    })
    assert changed.status_code == 200, changed.text
    saved = changed.json()
    assert saved['body'] == '保留正文' and saved['author'] == '作者 <script>&'
    url = '/api/content/' + row['id'] + '/export'
    body_only = client.get(url, params={'format': 'html'})
    assert body_only.status_code == 200
    assert '独立' not in body_only.text and '作者' not in body_only.text
    assert client.get(url).text == saved['body']
    html = client.get(url, params={'format': 'html', 'include_metadata': True}).text
    assert '<h1>独立 &lt;标题&gt;</h1>' in html
    assert '作者 &lt;script&gt;&amp;' in html and '<script>' not in html
    md = client.get(url, params={'include_metadata': True}).text
    assert md.startswith('# 独立 \\<标题\\>\n\n作者：作者 \\<script\\>&\n\n')
    assert md.endswith('保留正文')
    assert s.get(owner(client), saved['id'])['body'] == saved['body']
    for bad in (None, 1, [], '字' * 65):
        assert client.patch('/api/objects/' + row['id'], json={'version': saved['version'], 'author': bad}).status_code == 400
        assert client.post('/api/objects/content', json={'title': '稿', 'author': bad}).status_code == 400
    cleared = client.patch('/api/objects/' + row['id'], json={'version': saved['version'], 'author': ''})
    assert cleared.status_code == 200 and cleared.json()['author'] == ''
    assert '作者：' not in client.get(url, params={'format': 'html', 'include_metadata': True}).text


def test_outcome_save_handoff_and_manual_delivery_author(client):
    ident = owner(client)
    task = s.put(ident, 'task', {'title': '写公众号', 'messages': []})
    row = s.put(ident, 'content', {'title': '原题', 'body': '正文', 'task_id': task['id'],
        'platform': 'wechat', 'format': '公众号', 'outcome_type': 'writing'})
    s.put(ident, 'task', {**task, 'platform_outcomes': {'wechat': row['id']}}, task['id'])
    url = f"/api/tasks/{task['id']}/outcomes/{row['id']}"
    for bad in (None, 42, '字' * 65):
        assert client.patch(url, json={'version': row['version'], 'author': bad}).status_code == 400
    saved = client.patch(url, json={'version': row['version'], 'title': '实际文章标题', 'author': '手填作者'})
    assert saved.status_code == 200, saved.text
    transferred = client.post(url + '/handoff', json={'version': saved.json()['version']})
    assert transferred.status_code == 200, transferred.text
    flow = transferred.json()['flow']
    for key in ('content_id', 'delivery_id'):
        copied = s.get(ident, flow[key])
        assert copied['title'] == '实际文章标题' and copied['author'] == '手填作者'
    delivery = s.get(ident, flow['delivery_id'])
    endpoint = '/api/studio/deliveries/' + delivery['id']
    for bad in (None, 42, '字' * 65):
        assert client.patch(endpoint, json={'version': delivery['version'], 'author': bad}).status_code == 400
    cleared = client.patch(endpoint, json={'version': delivery['version'], 'author': ''})
    assert cleared.status_code == 200 and cleared.json()['author'] == ''
    repeat = client.post(url + '/handoff', json={'version': saved.json()['version']})
    assert repeat.status_code == 200 and repeat.json()['flow']['id'] == flow['id']
    assert s.get(ident, flow['delivery_id'])['author'] == ''


@pytest.mark.parametrize('author', ['', '人工署名'])
def test_generation_and_full_optimization_cannot_overwrite_author(client, monkeypatch, author):
    ident = owner(client)
    topic = client.post('/api/studio/topics', json={'title': '电梯选型'}).json()
    response = client.post('/api/studio/deliveries', json={
        'topic_id': topic['id'], 'platform': 'wechat', 'title': '原标题', 'body': '原文', 'author': author,
    })
    assert response.status_code == 200, response.text
    draft = response.json()
    result = {'title': '新标题', 'author': '模型擅自署名', 'summary': '摘要', 'body': '生成正文',
        'cover_brief': '封面', 'keywords': '选型', 'publishing_notes': '核对事实'}
    bind_writing(monkeypatch, lambda *_: json.dumps(result, ensure_ascii=False))
    url = '/api/studio/deliveries/' + draft['id']
    generated = client.post(url + '/generate', json={'version': draft['version']})
    assert generated.status_code == 200, generated.text
    job = finished(client, generated.json())
    assert job['status'] == 'done', job
    current = s.get(ident, draft['id'])
    assert current['author'] == author and current['body'] == result['body']
    optimized = client.post(url + '/optimize', json={'version': current['version'], 'scope': 'all'})
    assert optimized.status_code == 200, optimized.text
    job = finished(client, optimized.json())
    assert job['status'] == 'done', job
    assert 'author' not in job['result']['changed_fields']
    assert job['result']['proposal']['author'] == author
    apply_url = url + '/optimize/' + job['id'] + '/apply'
    assert client.post(apply_url, json={'version': current['version'], 'changes': {'author': '越界署名'}}).status_code == 400
    applied = client.post(apply_url, json={'version': current['version']})
    assert applied.status_code == 200, applied.text
    assert applied.json()['author'] == author


def test_author_only_edit_resyncs_wechat_and_clear_is_sent(client, monkeypatch):
    _, delivery, account = _prepared(client)
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((path, kwargs.get('payload')))
        return {'/material/add_material': {'media_id': 'cover-author'},
                '/draft/add': {'media_id': 'draft-author'}, '/draft/update': {}}[path]

    monkeypatch.setattr(wechat_publish, '_request', fake_request)
    url = '/api/wechat-publish/drafts/' + delivery['id']
    previous = client.post(url, json={'account_id': account['id'], 'version': delivery['version']})
    assert previous.status_code == 200, previous.text
    assert calls[-1][1]['articles'][0]['author'] == ''
    for author in ('新的署名', ''):
        edited = client.patch('/api/studio/deliveries/' + delivery['id'], json={'version': delivery['version'], 'author': author})
        assert edited.status_code == 200, edited.text
        delivery = edited.json()
        assert client.post('/api/wechat-publish/publish/' + delivery['id'], json={'account_id': account['id'], 'confirmed': True}).status_code == 400
        synced = client.post(url, json={'account_id': account['id'], 'version': delivery['version']})
        assert synced.status_code == 200, synced.text
        assert synced.json()['snapshot'] != previous.json()['snapshot']
        assert calls[-1][0] == '/draft/update' and calls[-1][1]['articles']['author'] == author
        before = len(calls)
        assert client.post(url, json={'account_id': account['id'], 'version': delivery['version']}).status_code == 200
        assert len(calls) == before
        previous = synced
    assert [path for path, _ in calls].count('/material/add_material') == 1


@pytest.mark.parametrize('form,text,title,body', [
    ('公众号文章', '# 实际标题\n\n首段\n## 小标题\n末段', '实际标题', '\n首段\n## 小标题\n末段'),
    ('公众号文章', '开场\n# 后续标题\n正文', '既有标题', '开场\n# 后续标题\n正文'),
    ('公众号文章', '## 二级标题\n正文', '既有标题', '## 二级标题\n正文'),
    ('公众号文章', '# \n正文', '既有标题', '# \n正文'),
    ('公众号文章', '# 第一标题\n# 第二标题\n正文', '第一标题', '# 第二标题\n正文'),
    ('通用文案', '# 保留标题\n正文', '既有标题', '# 保留标题\n正文'),
])
def test_only_initial_wechat_h1_becomes_separate_title(client, monkeypatch, form, text, title, body):
    ident = owner(client)
    old = s.put(ident, 'content', {'title': '既有标题', 'body': '旧正文', 'author': '原作者'})
    bind_writing(monkeypatch, lambda *_: text)
    response = client.post('/api/studio/text/generate', json={
        'brief': '这只是用户要求', 'format': form, 'content_id': old['id'], 'version': old['version'],
    })
    assert response.status_code == 200, response.text
    job = finished(client, response.json())
    assert job['status'] == 'done', job
    saved = s.get(ident, job['result']['content_id'])
    assert saved['title'] == title and saved['body'] == body
    assert saved['author'] == '原作者'


@pytest.mark.parametrize('text,title', [('# 真正的文章标题\n正文', '真正的文章标题'), ('没有起始标题的正文', '这只是用户要求')])
def test_new_article_extracts_title_without_inventing_author_from_ip(client, monkeypatch, text, title):
    ident = owner(client)
    profile = s.put(ident, 'profile', {'title': 'IP名称不是作者署名'})
    bind_writing(monkeypatch, lambda *_: text)
    response = client.post('/api/studio/text/generate', json={
        'brief': '这只是用户要求', 'format': '公众号文章', 'profile_id': profile['id'],
    })
    assert response.status_code == 200, response.text
    job = finished(client, response.json())
    assert job['status'] == 'done', job
    saved = s.get(ident, job['result']['content_id'])
    assert saved['title'] == title and saved.get('author', '') == ''
    assert saved['body'] == ('正文' if text.startswith('# ') else text)
