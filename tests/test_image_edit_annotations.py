"""Offline checks for temporary edit guidance sent to image providers."""

import base64
import hashlib
import io

from PIL import Image, ImageChops

from backend import media_registry, media_studio as media, store as s
from test_media_studio import asset, studio, submit


EDIT = 'media:wavespeed-gpt-image-25-flare-edit'


def marked(index, instruction, x, y):
    return {'id': f'mark-{index}', 'x': x, 'y': y, 'width': .25, 'height': .25,
            'instruction': instruction}


def test_guide_draws_multiple_boxes_and_notes_without_changing_local_asset(studio):
    image_id = asset(studio)['id']
    path = media._path('alice', s.get('alice', image_id)['local_file'])
    before = hashlib.sha256(path.read_bytes()).digest()
    marks = [marked(1, '把左侧标牌改成红色', .1, .15), marked(2, '把右侧按钮改成蓝色', .6, .55)]
    files_before = set(path.parent.iterdir())

    raw, mime = media._annotation_guide('alice', image_id, marks)
    assert mime in ('image/png', 'image/jpeg') and len(raw) <= 8_000_000
    with Image.open(io.BytesIO(raw)) as guide:
        assert guide.width <= 2048 and guide.height <= 2048
        # The 256px source is enlarged fourfold; each rectangle has a distinct color.
        assert guide.getpixel((20 + round(.1 * 1024), 20 + round(.15 * 1024))) == (225, 29, 72)
        assert guide.getpixel((20 + round(.6 * 1024), 20 + round(.55 * 1024))) == (37, 99, 235)
        assert ImageChops.difference(guide.crop((1060, 0, guide.width, guide.height)),
                                     Image.new('RGB', (guide.width - 1060, guide.height), '#f8fafc')).getbbox()
    if media._guide_font(24)[1]:
        changed = [marks[0], {**marks[1], 'instruction': '请删除右侧按钮并改为黑色'}]
        alternate, _ = media._annotation_guide('alice', image_id, changed)
        assert raw != alternate  # The Chinese note is actually rendered, not just numbered.
    assert hashlib.sha256(path.read_bytes()).digest() == before
    assert set(path.parent.iterdir()) == files_before


def test_aliyun_receives_original_first_and_guide_second(studio):
    image_id = asset(studio)['id']
    source = media._path('alice', s.get('alice', image_id)['local_file']).read_bytes()
    draft = {'tool': 'image_edit', 'title': '区域编辑', 'model_id': 'service:aliyun',
             'input': {'image_id': image_id, 'prompt': '保持其它部分不变',
                       'edit_marks': [marked(1, '替换门上的文字', .2, .3)]}, 'options': {}}
    _, payload, _ = media._build('alice', draft, {})
    content = payload['input']['messages'][0]['content']
    assert len(content) == 3
    assert base64.b64decode(content[0]['image'].split(',', 1)[1]) == source
    guide = base64.b64decode(content[1]['image'].split(',', 1)[1])
    with Image.open(io.BytesIO(guide)) as rendered:
        assert rendered.width > 256
    assert '首张图片' in content[2]['text'] and '区域标注说明图' in content[2]['text']
    unmarked = media._build('alice', {**draft, 'input': {'image_id': image_id, 'prompt': '调亮'}}, {})[1]
    assert len(unmarked['input']['messages'][0]['content']) == 2
    assert unmarked['input']['messages'][0]['content'][1] == {'text': '调亮'}


def test_aliyun_three_image_capacity_includes_annotation_guide(studio):
    first, second, third = [asset(studio)['id'] for _ in range(3)]
    catalog = studio.get('/api/studio/catalog').json()
    choices = next(item for item in catalog['tools'] if item['id'] == 'image_edit')['models']
    assert next(item for item in choices if item['id'] == 'service:aliyun')['reference_limits']['image'] == 3
    body = {'tool': 'image_edit', 'title': '多图', 'model_id': 'service:aliyun',
            'input': {'image_id': first, 'image_ids': [first, second], 'prompt': '',
                      'edit_marks': [marked(1, '改为蓝色', .1, .1)]}, 'options': {}}
    saved = studio.post('/api/studio/drafts', json=body)
    assert saved.status_code == 200, saved.text
    _, payload, _ = media._build('alice', saved.json(), {})
    content = payload['input']['messages'][0]['content']
    assert len(content) == 4 and all('image' in item for item in content[:3])
    assert '区域标注说明图' in content[3]['text']
    full = studio.post('/api/studio/drafts', json={**body, 'input': {**body['input'],
        'image_ids': [first, second, third]}})
    assert full.status_code == 200, full.text
    assert submit(studio, full.json(), 'aliyun-full-marked').status_code == 400


def test_wavespeed_reference_order_and_full_capacity_rejection(studio, monkeypatch):
    first, second = asset(studio)['id'], asset(studio)['id']
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    originals = []
    guides = []
    monkeypatch.setattr(media, '_wavespeed_upload', lambda owner, id, kind, tool, service:
                        originals.append(id) or 'https://example.com/' + id + '.png')
    monkeypatch.setattr(media, '_wavespeed_upload_bytes', lambda raw, filename, mime, service:
                        guides.append((raw, filename, mime)) or 'https://example.com/guide.png')
    requests = []
    def fake_request(method, url, **kwargs):
        requests.append(kwargs['payload'])
        return {'code': 200, 'data': {'id': 'offline-task', 'status': 'created'}}
    monkeypatch.setattr(media, '_request', fake_request)
    body = {'tool': 'image_edit', 'title': '区域编辑', 'model_id': EDIT,
            'input': {'image_id': first, 'image_ids': [first, second], 'prompt': '',
                      'edit_marks': [marked(1, '换成红色', .1, .1)]}, 'options': {}}
    draft = studio.post('/api/studio/drafts', json=body).json()
    run = submit(studio, draft, 'offline-marked').json()
    assert run['status'] == 'running'
    assert originals == [first, second]
    assert requests[0]['images'] == ['https://example.com/' + first + '.png',
                                     'https://example.com/' + second + '.png',
                                     'https://example.com/guide.png']
    assert guides and guides[0][0].startswith(b'\x89PNG')

    ids = [first, second] + [asset(studio)['id'] for _ in range(14)]
    full = studio.post('/api/studio/drafts', json={**body, 'input': {**body['input'], 'image_ids': ids}})
    assert full.status_code == 200, full.text
    rejected = submit(studio, full.json(), 'full-reference-list')
    assert rejected.status_code == 400 and '无法再加入区域标注图' in rejected.text
    assert len(requests) == 1


def test_font_fallback_keeps_numbered_guide_and_prompt_mapping(studio, monkeypatch):
    image_id = asset(studio)['id']
    ascii_font, _ = media._guide_font(18)
    monkeypatch.setattr(media, '_guide_font', lambda size: (ascii_font, False))
    raw, _ = media._annotation_guide('alice', image_id, [marked(1, '中文说明', .2, .2)])
    with Image.open(io.BytesIO(raw)) as guide:
        assert guide.width > 256
    assert '区域 1' in media._guided_prompt('区域 1：中文说明')
