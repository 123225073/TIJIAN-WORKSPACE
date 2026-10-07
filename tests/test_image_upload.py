import io
from PIL import Image
import pytest
from backend import media_studio as m, store as s, image_upload
from test_media_studio import studio


def picture(size=(640, 960), fmt='JPEG', mode='RGB', exif=None):
    out = io.BytesIO()
    im = Image.new(mode, size, '#9abbff')
    im.save(out, format=fmt, **({'exif': exif} if exif else {}))
    return out.getvalue()


@pytest.mark.parametrize('name,fmt', [('photo.JPG','JPEG'),('photo.jpeg','JPEG'),('actually-webp.jpg','WEBP'),('actually-png.jpg','PNG')])
def test_content_detection_and_unchanged_quality(studio, name, fmt):
    raw = picture(fmt=fmt)
    response = studio.post('/api/studio/upload', files={'file': (name, raw, 'image/jpeg')})
    assert response.status_code == 200, response.text
    asset = response.json()
    assert studio.get(asset['file_url']).content == raw
    assert asset['mime_type'] == Image.MIME[fmt]
    assert 'original_file' not in asset and 'local_file' not in asset
    if fmt != 'JPEG':
        assert asset['image_adjustment']['message']
        assert studio.get(asset['original_file_url']).content == raw
        assert studio.get(asset['original_file_url'], headers={'authorization':'Bearer bob'}).status_code == 404


def test_large_jpeg_is_resized_and_original_preserved(studio):
    raw = picture((8000, 6000))  # Former 40 MP cutoff rejected this valid photograph.
    response = studio.post('/api/studio/upload', files={'file': ('large.jpg', raw, 'image/jpeg')})
    assert response.status_code == 200, response.text
    asset = response.json()
    assert (asset['width'],asset['height']) == (4096,3072)
    assert asset['size'] <= image_upload.MAX_BYTES
    assert studio.get(asset['original_file_url']).content == raw
    with Image.open(io.BytesIO(studio.get(asset['file_url']).content)) as image:
        assert image.getpixel((100,100)) == pytest.approx((154,187,255),abs=2)
    assert '8000' not in asset['image_adjustment']['message']


def test_transparency_orientation_and_byte_limit(studio, monkeypatch):
    monkeypatch.setattr(image_upload, 'MAX_EDGE', 100)
    raw=picture((640,960),fmt='PNG',mode='RGBA')
    asset=studio.post('/api/studio/upload',files={'file':('alpha.png',raw,'image/png')}).json()
    assert (asset['width'],asset['height']) == (67,100)
    with Image.open(io.BytesIO(studio.get(asset['file_url']).content)) as image:
        assert image.mode=='RGBA'
    exif=Image.Exif();exif[274]=6
    raw=picture((80,40),exif=exif)
    asset=studio.post('/api/studio/upload',files={'file':('rotated.jpg',raw,'image/jpeg')}).json()
    assert (asset['width'],asset['height'])==(40,80)
    assert studio.get(asset['original_file_url']).content==raw


def test_corrupt_file_rejected_and_no_orphans(studio):
    for raw in (b'not an image', picture()[:120]):
        response=studio.post('/api/studio/upload',files={'file':('bad.jpg',raw,'image/jpeg')})
        assert response.status_code==400
        assert '解码' in response.json()['detail']
    assert not s.list_('alice','studio_asset')
    assert not list(m._path('alice',s.uid()+'.jpg').parent.iterdir())


def test_pixel_safety_limit_and_encoding_byte_limit(studio,monkeypatch):
    monkeypatch.setattr(image_upload,'MAX_PIXELS',100)
    response=studio.post('/api/studio/upload',files={'file':('over.jpg',picture(),'image/jpeg')})
    assert response.status_code==400 and '安全处理上限' in response.text
    monkeypatch.setattr(image_upload,'MAX_PIXELS',100_000_000)
    monkeypatch.setattr(image_upload,'MAX_BYTES',5000)
    raw=io.BytesIO();Image.effect_noise((512,512),100).convert('RGB').save(raw,format='JPEG',quality=98)
    asset=studio.post('/api/studio/upload',files={'file':('noise.jpg',raw.getvalue(),'image/jpeg')}).json()
    assert asset['size']<=5000
    assert studio.get(asset['original_file_url']).content==raw.getvalue()


def test_decode_budget_does_not_block_other_requests_or_leave_file(studio):
    image_upload.DECODE_SLOT.acquire()
    try:
        response=studio.post('/api/studio/upload',files={'file':('busy.jpg',picture(),'image/jpeg')})
        assert response.status_code==400 and '稍候' in response.text
        assert studio.get('/api/studio/drafts').status_code==200
        assert not list(m._path('alice',s.uid()+'.jpg').parent.iterdir())
    finally:
        image_upload.DECODE_SLOT.release()


def test_backup_retains_original_and_rebuilds_urls(studio):
    from backend import studio_backup
    import zipfile
    raw=picture(fmt='PNG')
    asset=studio.post('/api/studio/upload',files={'file':('source.jpg',raw,'image/jpeg')}).json()
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:
        records=studio_backup.export('alice',[s.get('alice',asset['id'])],archive)
        assert all(field not in records[0] for field in ('original_file','original_file_url','thumbnail_url'))
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive:
        assert archive.read(records[0]['backup_original'])==raw
        studio_backup.validate(records,archive)
        ids={};restored=studio_backup.import_assets('bob',records,archive,ids)
    data=studio_backup.restored_data('studio_asset',records[0],restored[asset['id']])
    assert data['id']==ids[asset['id']] and 'original_file_url' not in data
    public=m._public(data)
    assert ids[asset['id']] in public['original_file_url']
    assert studio.get(public['original_file_url'],headers={'authorization':'Bearer bob'}).content==raw
    assert studio.get(public['original_file_url']).status_code==404
