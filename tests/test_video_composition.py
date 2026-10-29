import hashlib
import json
import subprocess

import pytest
from PIL import Image

from backend import hifly_render, media_studio as m, store as s, video_composition as vc
from test_media_studio import studio


@pytest.fixture
def source_video(studio):
    ff = hifly_render.ffmpeg()
    if not ff:
        pytest.skip('FFmpeg not available')
    aid = s.uid()
    path = m._path('alice', aid + '.mp4')
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=25:d=3',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264',
                    '-c:a', 'aac', '-threads', '2', str(path)], check=True, capture_output=True)
    obj = s.put('alice', 'studio_asset', {**m._metadata(path, '.mp4'), 'title': '数字人', 'status': 'ready',
                 'provider': 'hifly', 'compat': m.COMPAT['video'], 'local_file': path.name}, aid)
    return path, obj


def frame(path, at):
    return subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-ss', str(at), '-i', str(path),
                           '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout


def test_real_export_preserves_source_and_audio_and_burns_timed_text(studio, source_video):
    source, asset = source_video
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    srt = '1\n00:00:00,300 --> 00:00:01,500\n中文：50% “abc” {测试} \\N\n\n2\n00:00:01,500 --> 00:00:02,900\n第二句字幕'
    res = studio.post('/api/studio/assets/' + asset['id'] + '/compose-video', json={'style': 'blue', 'title': '电梯行业观点', 'position': 'bottom', 'srt': srt})
    assert res.status_code == 200, res.text
    saved = s.get('alice', res.json()['id'])
    output = m._path('alice', saved['local_file'])
    assert output != source and hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert abs(saved['duration'] - 3) < .15 and (saved['width'], saved['height']) == (320, 480)
    streams = json.loads(subprocess.run([m._ffprobe(), '-v', 'error', '-show_streams', '-of', 'json', str(output)], capture_output=True, check=True).stdout)['streams']
    assert {x['codec_type'] for x in streams} >= {'video', 'audio'}
    assert frame(source, .8) != frame(output, .8)
    assert studio.get('/api/studio/assets/' + saved['id'] + '/file').status_code == 200
    assert studio.get('/api/studio/assets/' + saved['id'] + '/file', headers={'authorization': 'Bearer bob'}).status_code == 404


@pytest.mark.parametrize('srt', ['1\n00:00:02,000 --> 00:00:04,000\n超出时长',
                                '1\n00:00:00,000 --> 00:00:02,000\n' + '长' * 37,
                                '1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:01,000 --> 00:00:02,500\n重叠'])
def test_invalid_captions_do_not_create_or_overwrite(studio, source_video, srt):
    source, asset = source_video
    before = source.read_bytes()
    response = studio.post('/api/studio/assets/' + asset['id'] + '/compose-video', json={'style': 'gold', 'title': '测试', 'srt': srt})
    assert response.status_code == 400
    assert source.read_bytes() == before
    assert len(s.list_('alice', 'studio_asset')) == 1


def test_template_without_subtitles_and_invalid_style(studio, source_video):
    source, asset = source_video
    path = '/api/studio/assets/' + asset['id'] + '/compose-video'
    assert studio.post(path, json={'style': 'invalid', 'title': 'test'}).status_code == 400
    response = studio.post(path, json={'style': 'clean', 'title': '封面标题', 'srt': ''})
    assert response.status_code == 200, response.text
    # Longer opening selections are safely bounded by this 3-second source.
    assert studio.post(path, json={'style': 'gold', 'title': '片头', 'title_duration': '8'}).status_code == 200


def test_work_scope_comes_from_owned_source_not_request(studio, source_video):
    source, asset = source_video
    flow = s.put('alice', 'studio_flow', {'title': '当前作品'})
    topic = s.put('alice', 'studio_topic', {'title': '当前主题'})
    s.put('alice', 'studio_asset', {**asset, 'flow_id': flow['id'], 'topic_id': topic['id']}, asset['id'], asset['version'])
    other = s.put('bob', 'studio_flow', {'title': '其他用户作品'})
    response = studio.post('/api/studio/assets/' + asset['id'] + '/compose-video',
                           json={'style': 'gold', 'title': '观点', 'flow_id': other['id']})
    assert response.status_code == 200, response.text
    result = s.get('alice', response.json()['id'])
    assert result['flow_id'] == flow['id'] and result['topic_id'] == topic['id']


def test_subtitles_render_in_active_interval_without_an_audio_track(studio, source_video):
    source, asset = source_video
    silent = m._path('alice', s.uid() + '.mp4')
    subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-y', '-i', str(source), '-an', '-c:v', 'copy', str(silent)], check=True, capture_output=True)
    silent_asset = s.put('alice', 'studio_asset', {**m._metadata(silent, '.mp4'), 'title': '无音轨', 'status': 'ready',
                          'provider': 'hifly', 'compat': m.COMPAT['video'], 'local_file': silent.name})
    response = studio.post('/api/studio/assets/' + silent_asset['id'] + '/compose-video',
                           json={'style': 'clean', 'title': '', 'srt': '1\n00:00:00,500 --> 00:00:01,500\n测试字幕：中文 50%！'})
    assert response.status_code == 200, response.text
    output = m._path('alice', s.get('alice', response.json()['id'])['local_file'])
    before, during, after = frame(output, .2), frame(output, 1), frame(output, 2)
    assert sum(abs(x-y) for x,y in zip(before, during)) > sum(abs(x-y) for x,y in zip(before, after)) * 5


@pytest.mark.parametrize('width,height', [(320, 480), (360, 640), (640, 360)])
def test_title_and_subtitles_stay_centered_for_source_aspect_ratio(tmp_path, width, height):
    ff = hifly_render.ffmpeg()
    if not ff:
        pytest.skip('FFmpeg not available')
    source, output = tmp_path / 'source.mp4', tmp_path / 'output.mp4'
    subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=blue:s={width}x{height}:r=25:d=1',
                    '-c:v', 'libx264', '-threads', '2', str(source)], check=True, capture_output=True)
    vc.render(source, output, 1, width, height, 'blue', '电梯报价先看条件',
              '1\n00:00:00,100 --> 00:00:00,900\n请核对实际条件', 'bottom')
    image = Image.frombytes('RGB', (width, height), frame(output, .5))
    for y0, y1 in [(0, height // 3), (height * 2 // 3, height)]:
        xs = [x for y in range(y0, y1) for x in range(width)
              if (lambda c: c[0] > 85 and c[1] > 100)(image.getpixel((x, y)))]
        assert xs, '文字应出现在预期的标题或字幕区域'
        assert abs((min(xs) + max(xs)) / 2 - width / 2) < width * .06


def test_intro_duration_does_not_truncate_later_subtitles_or_audio(studio, tmp_path):
    ff = hifly_render.ffmpeg()
    if not ff:
        pytest.skip('FFmpeg not available')
    aid = s.uid()
    source = m._path('alice', aid + '.mp4')
    subprocess.run([ff, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:r=25:d=6',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
                    '-c:v', 'libx264', '-c:a', 'aac', '-threads', '2', str(source)], check=True, capture_output=True)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    asset = s.put('alice', 'studio_asset', {**m._metadata(source, '.mp4'), 'title': '片头测试',
                 'status': 'ready', 'provider': 'hifly', 'compat': m.COMPAT['video'], 'local_file': source.name}, aid)
    endpoint = '/api/studio/assets/' + asset['id'] + '/compose-video'
    srt = '1\n00:00:03,300 --> 00:00:05,500\n字幕继续出现在片头之后'
    payload = {'style': 'blue', 'title': '电梯现场如何核对', 'srt': srt, 'position': 'bottom'}
    response = studio.post(endpoint, json=payload)  # Older clients get the three-second default.
    assert response.status_code == 200, response.text
    saved = s.get('alice', response.json()['id'])
    output = m._path('alice', saved['local_file'])
    def visible(at, top):
        img = Image.frombytes('RGB', (360, 640), frame(output, at))
        area = img.crop((0, 0 if top else 400, 360, 220 if top else 640))
        return sum(1 for r, g, _ in area.getdata() if r > 85 and g > 100)
    assert visible(1, True) > 80  # Heading is visible during the opening.
    assert visible(4, True) < 10  # It does not persist over the rest of the video.
    assert visible(4, False) > 80  # A later subtitle remains visible independently.
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert abs(saved['duration'] - 6) < .15
    streams = json.loads(subprocess.run([m._ffprobe(), '-v', 'error', '-show_streams', '-of', 'json', str(output)], capture_output=True, check=True).stdout)['streams']
    assert {s['codec_type'] for s in streams} >= {'video', 'audio'}
    assert studio.post(endpoint, json={**payload, 'title_duration': 'invalid'}).status_code == 400
    extended = studio.post(endpoint, json={**payload, 'title_duration': 'full'})
    assert extended.status_code == 200, extended.text
    extended_path = m._path('alice', s.get('alice', extended.json()['id'])['local_file'])
    image = Image.frombytes('RGB', (360, 640), frame(extended_path, 4)).crop((0, 0, 360, 220))
    assert sum(1 for r, g, _ in image.getdata() if r > 85 and g > 100) > 80
    five = studio.post(endpoint, json={**payload, 'title_duration': '5'})
    assert five.status_code == 200, five.text
    five_path = m._path('alice', s.get('alice', five.json()['id'])['local_file'])
    at_four = Image.frombytes('RGB', (360, 640), frame(five_path, 4)).crop((0, 0, 360, 220))
    at_five = Image.frombytes('RGB', (360, 640), frame(five_path, 5.2)).crop((0, 0, 360, 220))
    assert sum(1 for r, g, _ in at_four.getdata() if r > 85 and g > 100) > 80
    assert sum(1 for r, g, _ in at_five.getdata() if r > 85 and g > 100) < 10
