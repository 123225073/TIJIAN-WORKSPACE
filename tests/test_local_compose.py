import hashlib
import io
import json
import math
import struct
import subprocess
import time
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from backend import hifly_render, local_compose as lc, media_studio as m, store as s
from test_media_studio import studio


def media(kind, color='blue', length=3, owner='alice'):
    ff = hifly_render.ffmpeg()
    if not ff:
        pytest.skip('FFmpeg missing')
    ident = s.uid()
    path = m._path(owner, ident + ('.mp4' if kind == 'video' else '.wav'))
    if kind == 'video':
        args = ['-f', 'lavfi', '-i', f'color=c={color}:s=180x320:r=30:d={length}', '-f', 'lavfi', '-i', f'sine=frequency=440:sample_rate=48000:duration={length}', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '2']
    else:
        args = ['-f', 'lavfi', '-i', f'sine=frequency=880:sample_rate=48000:duration={length}', '-c:a', 'pcm_s16le']
    subprocess.run([ff, '-v', 'error', '-y', *args, str(path)], check=True, capture_output=True)
    row = s.put(owner, 'studio_asset', {**m._metadata(path, path.suffix), 'title': '隔离素材', 'status': 'ready',
                'provider': 'local', 'local_file': path.name, 'compat': m.COMPAT[kind]}, ident)
    return row, path


def picture(color='red', owner='alice', transparent=False):
    ident = s.uid()
    path = m._path(owner, ident + '.png')
    image = Image.new('RGBA' if transparent else 'RGB', (90, 160), (0, 0, 0, 0) if transparent else color)
    if transparent:
        for x in range(20, 70):
            for y in range(10, 35):
                image.putpixel((x, y), (255, 255, 0, 255))
    image.save(path)
    return s.put(owner, 'studio_asset', {**m._metadata(path, '.png'), 'title': '图片', 'status': 'ready',
                 'provider': 'local', 'local_file': path.name, 'compat': m.COMPAT['image']}, ident)


def setup_project(client, project):
    draft = s.put('alice', 'studio_draft', {'title': '成片草稿', 'tool': 'compose', 'input': {'scenes': []}})
    response = client.post('/api/studio/local-compose/projects', json={'draft_id': draft['id'], 'title': '本机剪辑', 'project': project})
    assert response.status_code == 200, response.text
    return draft, response.json()


def image_frame(path, sec):
    data = subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-ss', str(sec), '-i', str(path), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert('RGB')


def test_local_composition_renders_b_roll_without_replacing_main_audio(studio):
    main, source = media('video')
    original = hashlib.sha256(source.read_bytes()).hexdigest()
    b = picture()
    voice, _ = media('audio')
    overlay = picture(transparent=True)
    config = {'scenes': [{'asset_id': main['id'], 'trim': 0, 'length': 3, 'volume': 1, 'audio_id': voice['id'], 'audio_volume': .25}],
              'b_roll': [{'asset_id': b['id'], 'start': 1, 'trim': 0, 'length': 1}],
              'music': {'asset_id': voice['id'], 'volume': .1}, 'aspect_ratio': '9:16', 'resolution': '720p',
              'srt': '1\n00:00:00,200 --> 00:00:00,800\n电梯安全要注意',
              'subtitle_style': {'font': 'Microsoft YaHei', 'size': 'medium', 'color': '#ffffff', 'stroke_color': '#101720', 'stroke': 3, 'position': 'bottom'},
              'intro': {'overlay_asset_id': overlay['id'], 'overlay_duration': .7}, 'cover': {'title': '封面测试'}}
    draft, project = setup_project(studio, config)
    assert studio.get('/api/studio/local-compose/projects?draft_id=' + draft['id']).json()['items'][0]['project']['cover'] == {'title': '封面测试'}
    response = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert response.status_code == 200, response.text
    job = studio.get('/api/studio/local-compose/jobs/' + response.json()['id']).json()
    assert job['status'] == 'done', job
    output = s.get('alice', job['result_asset_id'])
    path = m._path('alice', output['local_file'])
    assert path.is_file() and hashlib.sha256(source.read_bytes()).hexdigest() == original
    assert abs(output['duration'] - 3) < .2 and (output['width'], output['height']) == (720, 1280)
    stream = json.loads(subprocess.run([m._ffprobe(), '-v', 'error', '-show_streams', '-of', 'json', str(path)], check=True, capture_output=True).stdout)['streams']
    assert any(x['codec_type'] == 'audio' for x in stream)
    samples = subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-ss', '1.3', '-t', '0.4', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    values = struct.unpack('<' + 'h' * (len(samples)//2), samples)
    tone = abs(sum(value * complex(math.cos(2*math.pi*440*i/8000), -math.sin(2*math.pi*440*i/8000)) for i, value in enumerate(values))) / len(values)
    assert tone > 100, 'B-roll 覆盖期间主轨 440Hz 原声应持续存在'
    assert image_frame(path, .8).getpixel((360, 600))[2] > 100
    assert image_frame(path, 1.3).getpixel((360, 600))[0] > 100
    assert image_frame(path, 2.3).getpixel((360, 600))[2] > 100
    assert studio.get('/api/studio/local-compose/jobs/' + job['id'], headers={'authorization': 'Bearer bob'}).status_code == 404
    assert studio.get('/api/studio/local-compose/projects/' + project['id']).json()['last_job_id'] == job['id']


def test_playback_speed_preserves_all_timeline_relationships(studio):
    """Real export: all source-clock overlays and speech move together."""
    main, source = media('video', color='blue', length=3)
    original = hashlib.sha256(source.read_bytes()).hexdigest()
    b = picture('red')
    title = picture(transparent=True)
    voice, _ = media('audio')
    config = {'scenes': [{'asset_id': main['id'], 'length': 3, 'audio_id': voice['id'], 'audio_volume': .25}],
              'b_roll': [{'asset_id': b['id'], 'start': 1, 'length': 1}],
              'music': {'asset_id': voice['id'], 'volume': .1},
              'intro': {'overlay_asset_id': title['id'], 'overlay_duration': .72},
              'srt': '1\n00:00:00,600 --> 00:00:00,960\n字幕同步测试',
              'aspect_ratio': '9:16', 'resolution': '720p', 'playback_speed': 1.2}
    _, project = setup_project(studio, config)
    response = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert response.status_code == 200, response.text
    job = studio.get('/api/studio/local-compose/jobs/' + response.json()['id']).json()
    assert job['status'] == 'done', job
    asset = s.get('alice', job['result_asset_id'])
    output = m._path('alice', asset['local_file'])
    assert abs(asset['duration'] - 2.5) < .12
    assert hashlib.sha256(source.read_bytes()).hexdigest() == original
    # 0.72 s title -> 0.60 s; B-roll 1.0–2.0 s -> 0.83–1.67 s.
    assert image_frame(output, .3).getpixel((360, 120))[0] > 150
    assert image_frame(output, .7).getpixel((360, 120))[2] > 100
    assert image_frame(output, 1.1).getpixel((360, 640))[0] > 100
    assert image_frame(output, 1.9).getpixel((360, 640))[2] > 100
    # 0.60–0.96 source seconds -> 0.50–0.80 s in the output; actual ASS
    # pixels should be visible during this interval and absent before it.
    def bright_pixels(at):
        region = image_frame(output, at).crop((60, 970, 660, 1190))
        return sum(1 for r, g, b in region.getdata() if min(r, g, b) > 160)
    assert bright_pixels(.65) > bright_pixels(.3) + 30
    assert bright_pixels(1.9) < bright_pixels(.65)
    samples = subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-ss', '1', '-t', '0.4', '-i', str(output),
                              '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                             capture_output=True, check=True).stdout
    values = struct.unpack('<' + 'h' * (len(samples)//2), samples)
    tone = abs(sum(value * complex(math.cos(2*math.pi*440*i/8000), -math.sin(2*math.pi*440*i/8000))
                   for i, value in enumerate(values))) / len(values)
    assert tone > 100, '加速后音轨仍保持 440 Hz 音高并持续到 B-roll 阶段'
    voice_tone = abs(sum(value * complex(math.cos(2*math.pi*880*i/8000), -math.sin(2*math.pi*880*i/8000))
                         for i, value in enumerate(values))) / len(values)
    assert voice_tone > 20, '加速后配音和背景音乐仍可听到且保持 880 Hz 音高'


@pytest.mark.parametrize('speed', [0, .49, 2.01, True, '1.2'])
def test_reject_invalid_speed_without_affecting_draft(studio, speed):
    main, _ = media('video')
    _, project = setup_project(studio, {'scenes': [{'asset_id': main['id'], 'length': 2}], 'playback_speed': speed})
    response = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert response.status_code == 400 and '播放速度' in response.json()['detail']
    assert studio.get('/api/studio/local-compose/projects/' + project['id']).json()['project']['playback_speed'] == speed


def test_scope_version_and_old_cloud_submission_blocked(studio):
    main, _ = media('video')
    draft, project = setup_project(studio, {'scenes': [{'asset_id': main['id'], 'trim': 0, 'length': 2}], 'b_roll': []})
    assert studio.post('/api/studio/generate', json={'draft_id': draft['id'], 'version': draft['version'], 'confirmed': True, 'request_id': 'never-upload'}).status_code == 400
    assert not [x for x in s.list_('alice', 'studio_run') if x.get('request_id') == 'never-upload']
    edited = studio.post('/api/studio/local-compose/projects', json={'id': project['id'], 'version': project['version'], 'draft_id': draft['id'], 'project': project['project']})
    assert edited.status_code == 200
    assert studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']}).status_code == 409
    assert studio.get('/api/studio/local-compose/projects/' + project['id'], headers={'authorization': 'Bearer bob'}).status_code == 404
    foreign = picture(owner='bob')
    unsafe = {**project['project'], 'b_roll': [{'asset_id': foreign['id'], 'start': 0, 'length': 1}]}
    invalid = studio.post('/api/studio/local-compose/projects', json={'id': project['id'], 'version': edited.json()['version'], 'draft_id': draft['id'], 'project': unsafe})
    assert invalid.status_code == 200
    assert studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': invalid.json()['version']}).status_code == 404


def test_reject_out_of_bounds_b_roll(studio):
    main, _ = media('video')
    b = picture()
    _, project = setup_project(studio, {'scenes': [{'asset_id': main['id'], 'length': 2}], 'b_roll': [{'asset_id': b['id'], 'start': 1, 'length': 2}]})
    response = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert response.status_code == 400 and '超出主轨' in response.json()['detail']


def test_video_without_audio_image_and_video_b_roll(studio):
    source, source_path = media('video', color='blue')
    silent_path = m._path('alice', s.uid() + '.mp4')
    subprocess.run([hifly_render.ffmpeg(), '-v', 'error', '-y', '-i', str(source_path), '-an', '-c:v', 'copy', str(silent_path)], check=True, capture_output=True)
    silent = s.put('alice', 'studio_asset', {**m._metadata(silent_path, '.mp4'), 'title': '无声音', 'status': 'ready', 'local_file': silent_path.name, 'compat': m.COMPAT['video']})
    red, _ = media('video', color='red')
    still = picture(color='green')
    _, project = setup_project(studio, {'scenes': [{'asset_id': silent['id'], 'length': 1}, {'asset_id': still['id'], 'length': 1}],
                                       'b_roll': [{'asset_id': red['id'], 'start': .4, 'trim': .5, 'length': 1}],
                                       'aspect_ratio': '1:1', 'resolution': '720p', 'srt': ''})
    response = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert response.status_code == 200, response.text
    job = studio.get('/api/studio/local-compose/jobs/' + response.json()['id']).json()
    assert job['status'] == 'done', job
    path = m._path('alice', s.get('alice', job['result_asset_id'])['local_file'])
    assert image_frame(path, .2).getpixel((360, 360))[2] > 100
    assert image_frame(path, .8).getpixel((360, 360))[0] > 100
    assert image_frame(path, 1.6).getpixel((360, 360))[1] > 40


def test_duplicate_active_request_returns_existing_job(studio, monkeypatch):
    main, _ = media('video')
    _, project = setup_project(studio, {'scenes': [{'asset_id': main['id'], 'length': 2}]})
    count = []
    def queued(owner, title, work, inputs):
        count.append(1)
        return s.put(owner, 'job', {'title': title, 'status': 'queued', 'input': inputs})
    monkeypatch.setattr(lc.jobs, 'start', queued)
    url = '/api/studio/local-compose/projects/' + project['id'] + '/render'
    first = studio.post(url, json={'version': project['version']})
    second = studio.post(url, json={'version': project['version']})
    assert first.status_code == second.status_code == 200
    assert first.json()['id'] == second.json()['id'] and len(count) == 1
    assert studio.get('/api/studio/local-compose/projects/' + project['id']).json()['last_job_id'] == first.json()['id']


def test_cancel_stops_actual_ffmpeg_process(studio, tmp_path):
    ff = hifly_render.ffmpeg()
    event = threading.Event()
    timer = threading.Timer(.8, event.set)
    timer.start()
    try:
        with pytest.raises(InterruptedError):
            lc._execute([ff, '-v', 'error', '-nostdin', '-y', '-re', '-f', 'lavfi', '-i',
                         'color=c=blue:s=320x480:r=30:d=8', '-c:v', 'libx264', str(tmp_path/'cancelled.mp4')],
                        tmp_path, event, 20)
    finally:
        timer.cancel()


def test_cancel_job_does_not_publish_partial_asset(studio, monkeypatch):
    source, path = media('video', length=8)
    _, project = setup_project(studio, {'scenes': [{'asset_id': source['id'], 'length': 8}], 'resolution': '720p'})
    original = hashlib.sha256(path.read_bytes()).hexdigest()
    pool = ThreadPoolExecutor(max_workers=1)
    monkeypatch.setattr(lc.jobs, 'POOL', pool)
    try:
        started = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
        assert started.status_code == 200
        ident = started.json()['id']
        cancelled = studio.post('/api/studio/local-compose/jobs/' + ident + '/cancel')
        assert cancelled.status_code == 200 and cancelled.json()['status'] == 'cancelled'
        deadline = time.monotonic() + 15
        while ident in lc.jobs.CANCEL and time.monotonic() < deadline:
            time.sleep(.1)
        assert ident not in lc.jobs.CANCEL
        final = studio.get('/api/studio/local-compose/jobs/' + ident).json()
        assert final['status'] == 'cancelled' and not final['result_asset_id']
        assert len(s.list_('alice', 'studio_asset')) == 1
        assert hashlib.sha256(path.read_bytes()).hexdigest() == original
    finally:
        pool.shutdown(wait=True)
