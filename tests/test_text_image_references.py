"""Offline contracts for reference-image generation; no paid model call is made."""

import pytest

from backend import media_registry, media_studio as studio_api
from test_media_studio import asset, studio, submit


EDIT = 'wavespeed-gpt-image-25-flare-edit'
TEXT = 'wavespeed-gpt-image-25-flare-text'


def body(model_id, images=None):
    return {'tool': 'text_image', 'title': '参考图生成', 'model_id': 'media:' + model_id,
            'input': {'prompt': '以参考图为基础创作电梯海报', **({'image_ids': images} if images is not None else {})},
            'options': {}}


def test_registry_exposes_edit_family_for_both_tools_and_keeps_family_constraints(studio):
    assert media_registry.choice('text_image', EDIT)[0]['family'] == 'gpt-image-2.5-edit'
    assert media_registry.choice('image_edit', EDIT)[0]['family'] == 'gpt-image-2.5-edit'
    assert EDIT in {item['id'].removeprefix('media:') for item in media_registry.choices('text_image')}
    assert EDIT in {item['id'].removeprefix('media:') for item in media_registry.choices('image_edit')}
    choice = next(item for item in media_registry.choices('text_image') if item['id'] == 'media:' + EDIT)
    assert '参考图生成' in choice['title'] and choice['reference_limits']['image'] == 16
    saved = media_registry.save_model({'id': EDIT, 'tools': ['text_image', 'image_edit']})
    assert saved['tools'] == ['text_image', 'image_edit']
    with pytest.raises(media_registry.RegistryError, match='功能绑定'):
        media_registry.save_model({'id': TEXT, 'tools': ['text_image', 'image_edit']})
    with pytest.raises(media_registry.RegistryError, match='功能绑定'):
        media_registry.save_model({'id': EDIT, 'tools': ['text_image', 'text_image']})


def test_existing_edit_only_preset_is_available_for_reference_generation(studio):
    from backend import store as s
    saved = s.config(media_registry.MODEL_KEY, {})
    s.set_config(media_registry.MODEL_KEY, {**saved, EDIT: {'tools': ['image_edit']}})
    assert media_registry.choice('text_image', EDIT)[0]['tools'] == ['text_image', 'image_edit']


def test_reference_generation_draft_requires_owned_unique_images_within_limit(studio):
    images = [asset(studio)['id'] for _ in range(17)]
    saved = studio.post('/api/studio/drafts', json=body(EDIT, images[:16]))
    assert saved.status_code == 200, saved.text
    assert saved.json()['tool'] == 'text_image'
    assert saved.json()['input']['image_ids'] == images[:16]
    assert studio.post('/api/studio/drafts', json=body(EDIT, images)).status_code == 400
    assert studio.post('/api/studio/drafts', json=body(EDIT, [images[0], images[0]])).status_code == 400
    assert studio.post('/api/studio/drafts', headers={'authorization': 'Bearer bob'},
                       json=body(EDIT, images[:1])).status_code == 404
    assert studio.post('/api/studio/drafts', json=body(TEXT, images[:1])).status_code == 400
    assert studio.post('/api/studio/drafts', json=body(TEXT)).status_code == 200
    empty = studio.post('/api/studio/drafts', json=body(EDIT, []))
    assert empty.status_code == 200, empty.text  # Allow an unfinished draft.
    failed = submit(studio, empty.json(), 'empty-reference')
    assert failed.status_code == 400 and '至少需要一张' in failed.text


def test_reference_generation_uses_images_array_without_changing_text_only_payload(studio, monkeypatch):
    images = [asset(studio)['id'] for _ in range(2)]
    media_registry.save_provider({'id': 'wavespeed', 'api_key': 'offline-test-key'})
    uploaded = []
    requests = []

    def fake_upload(owner, asset_id, kind, tool, service):
        uploaded.append((owner, asset_id, kind, tool))
        return 'https://example.com/' + asset_id + '.png'

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs['payload']))
        return {'code': 200, 'data': {'id': 'offline-prediction', 'status': 'created'}}

    monkeypatch.setattr(studio_api, '_wavespeed_upload', fake_upload)
    monkeypatch.setattr(studio_api, '_request', fake_request)
    references = studio.post('/api/studio/drafts', json=body(EDIT, images))
    assert references.status_code == 200, references.text
    result = submit(studio, references.json(), 'reference-image-run')
    assert result.status_code == 200 and result.json()['status'] == 'running', result.text
    assert uploaded == [('alice', image_id, 'image', 'text_image') for image_id in images]
    assert requests[0][1].endswith('/gpt-image-2.5-flare/edit')
    assert requests[0][2]['images'] == ['https://example.com/' + image_id + '.png' for image_id in images]
    assert requests[0][2]['prompt'] == '以参考图为基础创作电梯海报'

    plain = studio.post('/api/studio/drafts', json=body(TEXT))
    assert plain.status_code == 200, plain.text
    plain_result = submit(studio, plain.json(), 'plain-text-image-run')
    assert plain_result.status_code == 200 and plain_result.json()['status'] == 'running', plain_result.text
    assert requests[1][1].endswith('/gpt-image-2.5-flare/text-to-image')
    assert 'images' not in requests[1][2]
