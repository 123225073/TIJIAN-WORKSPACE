"""Style metadata is persisted, frozen and sent to an offline image adapter."""
from backend import media_registry, media_studio as media, store as s
from test_media_studio import studio, submit, asset

MODEL = 'media:wavespeed-gpt-image-25-flare-text'
STYLE = {'id': 'blueprint', 'prompt': '工程知识线稿插画，浅蓝白底，深蓝轮廓线与橙色重点。'}


def save(client, *, prompt='电梯井道示意', style=STYLE, tool='text_image', image_id=None):
    data = {'tool': tool, 'title': '风格契约', 'model_id': MODEL if tool == 'text_image' else 'media:wavespeed-gpt-image-25-flare-edit',
            'input': {'prompt': prompt, 'image_style': style, **({'image_id': image_id} if image_id else {})}, 'options': {}}
    return client.post('/api/studio/drafts', json=data)


def prepare(monkeypatch):
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-style-test'})
    calls = []
    monkeypatch.setattr(media, '_request', lambda *args, **kwargs: calls.append(kwargs['payload']) or
                        {'code': 200, 'data': {'id': 'offline-style-task', 'status': 'created'}})
    return calls


def test_style_reaches_provider_while_original_draft_is_retained(studio, monkeypatch):
    calls = prepare(monkeypatch)
    response = save(studio)
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft['input']['image_style'] == STYLE and draft['input']['prompt'] == '电梯井道示意'
    assert studio.get('/api/studio/drafts').json()['items'][0]['input'] == draft['input']
    result = submit(studio, draft, 'style-once')
    assert result.status_code == 200, result.text
    run = result.json()
    assert calls[0]['prompt'].startswith('电梯井道示意\n\n画面风格参考：')
    assert STYLE['prompt'] in calls[0]['prompt']
    assert run['generation']['prompt_original'] == '电梯井道示意'
    assert run['generation']['input']['image_style'] == STYLE
    assert s.get('alice', draft['id'])['input']['prompt'] == '电梯井道示意'
    submit(studio, draft, 'style-once')
    assert len(calls) == 1
    foreign = studio.post('/api/studio/runs/' + run['id'] + '/refresh', json={}, headers={'authorization': 'Bearer bob'})
    assert foreign.status_code == 404
    changed = studio.patch('/api/studio/drafts/' + draft['id'], json={
        **{key: draft[key] for key in ('tool', 'title', 'model_id', 'options')},
        'version': draft['version'], 'input': {**draft['input'], 'image_style': {'id': 'handdrawn', 'prompt': '温暖手绘'}}})
    assert changed.status_code == 200, changed.text
    assert s.get('alice', run['id'])['snapshot']['input']['image_style'] == STYLE
    assert s.get('alice', run['id'])['snapshot']['input']['prompt'] == calls[0]['prompt']


def test_automatic_style_preserves_prompt_and_explicit_edit_style_keeps_region_request(studio, monkeypatch):
    calls = prepare(monkeypatch)
    draft = save(studio, style={'id': 'auto', 'prompt': ''}).json()
    assert submit(studio, draft, 'auto-style').status_code == 200
    assert calls[0]['prompt'] == '电梯井道示意'
    image_id = asset(studio)['id']
    monkeypatch.setattr(media, '_wavespeed_upload', lambda *args: 'https://example.test/reference.png')
    edited = save(studio, tool='image_edit', image_id=image_id, prompt='只调整门框颜色').json()
    run = submit(studio, edited, 'edit-style')
    assert run.status_code == 200, run.text
    assert '只调整门框颜色' in calls[-1]['prompt'] and STYLE['prompt'] in calls[-1]['prompt']
    assert run.json()['generation']['prompt_original'] == '只调整门框颜色'


def test_bad_style_rejected_and_long_combined_prompt_cannot_submit(studio, monkeypatch):
    calls = prepare(monkeypatch)
    for style in (None, '', {'id': 'blueprint'}, {'id': '../invalid', 'prompt': 'x'}, {'id': 'x', 'prompt': 'x' * 601}, {**STYLE, 'tool': 'execute'}):
        assert save(studio, style=style).status_code == 400
    response = save(studio, prompt='场景' * 740)
    assert response.status_code == 200, response.text
    rejected = submit(studio, response.json(), 'overlong-style')
    assert rejected.status_code == 400 and '尚未提交生成' in rejected.text
    assert not calls
