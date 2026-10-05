"""Thumbnails are bounded previews and retain the original access boundary."""
import io

from PIL import Image
from test_media_studio import studio


def test_large_reference_thumbnail_is_small_and_original_is_unchanged(studio):
    source = io.BytesIO()
    Image.effect_noise((2400, 1600), 80).convert('RGB').save(source, format='PNG')
    original = source.getvalue()
    uploaded = studio.post('/api/studio/upload', files={'file': ('large.png', original, 'image/png')}).json()
    response = studio.get(uploaded['thumbnail_url'])
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/jpeg'
    assert response.headers['cache-control'].startswith('private,')
    assert response.headers['vary'] == 'Authorization'
    with Image.open(io.BytesIO(response.content)) as preview:
        assert max(preview.size) <= 320
        assert preview.width / preview.height == 320 / 213
    assert len(response.content) < len(original) / 10
    assert studio.get(uploaded['file_url']).content == original
    assert studio.get(uploaded['thumbnail_url'], headers={'Authorization': 'Bearer bob'}).status_code == 404
    assert studio.get(uploaded['thumbnail_url'], headers={'Authorization': ''}).status_code == 401


def test_transparent_reference_has_a_readable_thumbnail(studio):
    source = io.BytesIO()
    Image.new('RGBA', (100, 100), (20, 40, 60, 0)).save(source, format='PNG')
    uploaded = studio.post('/api/studio/upload', files={'file': ('transparent.png', source.getvalue(), 'image/png')}).json()
    with Image.open(io.BytesIO(studio.get(uploaded['thumbnail_url']).content)) as preview:
        assert preview.getpixel((50, 50)) == (255, 255, 255)
