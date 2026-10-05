"""Structured edit annotations remain draft data and produce a temporary guide."""

from copy import deepcopy
import base64
import hashlib
import io

import pytest
from PIL import Image

from backend import media_registry, media_studio as media, store as s
from test_media_studio import asset, png, studio, submit


EDIT = 'media:wavespeed-gpt-image-25-flare-edit'


def body(image_id, *, marks=None, layers=None, prompt=''):
    return {'tool': 'image_edit', 'title': '区域修改', 'model_id': EDIT,
            'input': {'image_id': image_id, 'prompt': prompt,
                      'edit_marks': marks if marks is not None else [],
                      'image_layers': layers if layers is not None else []}, 'options': {}}


def mark(instruction='替换标牌文字'):
    return {'id': 'mark-1', 'x': .1, 'y': .2, 'width': .3, 'height': .4,
            'instruction': instruction}


def layer(asset_id):
    return {'id': 'layer-1', 'asset_id': asset_id, 'x': .5, 'y': .1, 'width': .3, 'height': .2}


def test_ai_edit_accepts_canvas_object_and_sends_composited_base(studio):
    base = asset(studio)['id']
    overlay_bytes = io.BytesIO()
    Image.new('RGB', (32, 32), 'red').save(overlay_bytes, format='PNG')
    uploaded = studio.post('/api/studio/upload', files={'file': ('red.png', overlay_bytes.getvalue(), 'image/png')})
    assert uploaded.status_code == 200, uploaded.text
    overlay = uploaded.json()['id']
    source = media._path('alice', s.get('alice', base)['local_file'])
    before = hashlib.sha256(source.read_bytes()).digest()
    draft = studio.post('/api/studio/drafts', json={**body(base, layers=[layer(overlay)]), 'model_id': 'service:aliyun'})
    assert draft.status_code == 200, draft.text
    clean = {key: value for key, value in draft.json().items() if key in {'tool', 'title', 'input', 'options', 'model_id', 'brand_id', 'profile_id', 'source_ids'}}
    media._validate('alice', clean, complete=True)
    _, payload, _ = media._build('alice', clean, {})
    content = payload['input']['messages'][0]['content']
    assert len(content) == 2
    rendered = base64.b64decode(content[0]['image'].split(',', 1)[1])
    with Image.open(io.BytesIO(rendered)) as image:
        assert image.getpixel((160, 52))[0] > 190  # placed red object
        assert image.getpixel((20, 20))[1] > 70  # untouched green source
    assert hashlib.sha256(source.read_bytes()).digest() == before


def test_wavespeed_ai_edit_uploads_layered_base_instead_of_original(studio, monkeypatch):
    base = asset(studio)['id']
    overlay = asset(studio)['id']
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    uploaded = []
    monkeypatch.setattr(media, '_wavespeed_upload', lambda *args: uploaded.append(('original', args[1])) or 'https://example.com/original.png')
    monkeypatch.setattr(media, '_wavespeed_upload_bytes', lambda raw, name, mime, service: uploaded.append((name, raw, mime)) or 'https://example.com/layered.jpg')
    monkeypatch.setattr(media, '_request', lambda *args, **kwargs: {'code': 200, 'data': {'id': 'offline-layer-task', 'status': 'created'}})
    saved = studio.post('/api/studio/drafts', json=body(base, layers=[layer(overlay)]))
    assert saved.status_code == 200, saved.text
    run = submit(studio, saved.json(), 'layer-only-edit')
    assert run.status_code == 200, run.text
    assert run.json()['status'] == 'running'
    assert len(uploaded) == 1 and uploaded[0][0] == 'edit-base.jpg'
    assert uploaded[0][1].startswith(b'\xff\xd8') and uploaded[0][2] == 'image/jpeg'
    assert '自然融合' in run.json()['generation']['input']['prompt']


def test_marks_and_layers_round_trip_without_changing_existing_drafts(studio):
    base, overlay = asset(studio)['id'], asset(studio)['id']
    original = studio.post('/api/studio/drafts', json={'tool': 'image_edit', 'title': '旧草稿',
        'model_id': EDIT, 'input': {'image_id': base, 'prompt': '调亮画面'}, 'options': {}})
    assert original.status_code == 200, original.text
    assert original.json()['input'] == {'image_id': base, 'prompt': '调亮画面'}
    saved = studio.post('/api/studio/drafts', json=body(base, marks=[mark()], layers=[layer(overlay)]))
    assert saved.status_code == 200, saved.text
    assert saved.json()['input']['edit_marks'] == [mark()]
    assert saved.json()['input']['image_layers'] == [layer(overlay)]
    changed = deepcopy(mark()); changed['instruction'] = '仅把标牌换成绿色'
    patched = studio.patch('/api/studio/drafts/' + saved.json()['id'], json={
        'version': saved.json()['version'], 'input': body(base, marks=[changed], layers=[layer(overlay)])['input']})
    assert patched.status_code == 200, patched.text
    assert s.get('alice', saved.json()['id'])['input']['edit_marks'] == [changed]


def test_marks_and_layers_reject_invalid_shape_bounds_ownership_and_limits(studio):
    base, overlay = asset(studio)['id'], asset(studio)['id']
    valid = body(base, marks=[mark()], layers=[layer(overlay)])
    invalid = []
    for field, value in [('x', -0.01), ('width', 0), ('width', .95), ('y', True)]:
        changed = deepcopy(valid); changed['input']['edit_marks'][0][field] = value
        invalid.append(changed)
    changed = deepcopy(valid); changed['input']['edit_marks'][0]['extra'] = 1; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['edit_marks'][0]['region'] = {'x': .1}; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['edit_marks'][0]['instruction'] = 'a' * 301; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['edit_marks'] *= 13; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['image_layers'][0]['x'] = .8; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['image_layers'][0]['asset_id'] = 'missing'; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['image_layers'][0]['extra'] = 1; invalid.append(changed)
    changed = deepcopy(valid); changed['input']['image_layers'] *= 17; invalid.append(changed)
    for candidate in invalid:
        assert studio.post('/api/studio/drafts', json=candidate).status_code in (400, 404)
    bob_base = studio.post('/api/studio/upload', headers={'authorization': 'Bearer bob'},
                           files={'file': ('bob.png', png(), 'image/png')})
    assert bob_base.status_code == 200, bob_base.text
    assert studio.post('/api/studio/drafts', headers={'authorization': 'Bearer bob'},
                       json=body(bob_base.json()['id'], layers=[layer(overlay)])).status_code == 404
    with pytest.raises(media.StudioError, match='坐标'):
        changed = deepcopy(valid); changed['input']['edit_marks'][0]['x'] = float('nan')
        media._validate('alice', changed)


def test_generation_sends_marked_guide_and_requires_each_instruction(studio, monkeypatch):
    base = asset(studio)['id']
    incomplete = studio.post('/api/studio/drafts', json=body(base, marks=[mark('')]))
    assert incomplete.status_code == 200, incomplete.text
    assert submit(studio, incomplete.json(), 'blank-mark').status_code == 400
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    monkeypatch.setattr(media, '_wavespeed_upload', lambda owner, asset_id, kind, tool, service: 'https://example.com/base.png')
    guides = []
    def upload_guide(raw, filename, mime, service):
        guides.append((raw, filename, mime))
        return 'https://example.com/edit-guide.png'
    monkeypatch.setattr(media, '_wavespeed_upload_bytes', upload_guide)
    requests = []
    def fake_request(method, url, **kwargs):
        requests.append(kwargs['payload'])
        return {'code': 200, 'data': {'id': 'offline-edit-task', 'status': 'created'}}
    monkeypatch.setattr(media, '_request', fake_request)
    edited = studio.post('/api/studio/drafts', json=body(base, marks=[mark()]))
    assert edited.status_code == 200, edited.text
    result = submit(studio, edited.json(), 'marked-edit')
    assert result.status_code == 200 and result.json()['status'] == 'running', result.text
    assert '替换标牌文字' in requests[0]['prompt']
    assert requests[0]['images'] == ['https://example.com/base.png', 'https://example.com/edit-guide.png']
    assert guides[0][0].startswith(b'\x89PNG') and guides[0][2] == 'image/png'
    assert 'mask' not in requests[0] and 'edit_marks' not in requests[0]


def test_snapshot_compiles_global_prompt_then_each_mark_and_rejects_overflow(studio, monkeypatch):
    base = asset(studio)['id']
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    monkeypatch.setattr(media, '_wavespeed_upload', lambda *args: 'https://example.com/base.png')
    monkeypatch.setattr(media, '_request', lambda *args, **kwargs:
                        {'code': 200, 'data': {'id': 'offline-edit-task', 'status': 'created'}})
    second = {**mark('更换背景颜色'), 'id': 'mark-2', 'x': .5}
    marks = [mark('替换标牌文字'), second]
    saved = studio.post('/api/studio/drafts', json=body(base, marks=marks, prompt='保持人物原貌'))
    assert saved.status_code == 200, saved.text
    result = submit(studio, saved.json(), 'two-mark-edit')
    assert result.status_code == 200, result.text
    draft = s.get('alice', saved.json()['id'])
    snapshot = s.get('alice', result.json()['id'])['snapshot']['input']
    assert result.json()['generation']['prompt_original'] == '保持人物原貌'
    assert draft['input']['prompt'] == '保持人物原貌'
    assert draft['input']['edit_marks'] == marks
    assert snapshot['edit_marks'] == marks
    assert snapshot['prompt'].startswith('保持人物原貌\n区域 1 [左上角 (0.100, 0.200)')
    assert snapshot['prompt'].index('替换标牌文字') < snapshot['prompt'].index('区域 2') < snapshot['prompt'].index('更换背景颜色')
    overflow = studio.post('/api/studio/drafts', json=body(base, marks=[
        {**mark('很长的要求' * 50), 'id': f'mark-{index}'} for index in range(6)]))
    assert overflow.status_code == 200, overflow.text
    failed = submit(studio, overflow.json(), 'too-many-words')
    assert failed.status_code == 400 and '超过1500字' in failed.text
    assert s.get('alice', overflow.json()['id'])['input']['prompt'] == ''
