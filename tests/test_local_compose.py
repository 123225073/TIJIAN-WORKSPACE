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


def test_caption_layout_preserves_text_and_fits_long_lines():
    style = {'size': 'medium', 'font_scale': 1, 'x': .01, 'y': .6}
    text = '这是一个需要合理缩小和分成两行显示的字幕示例，不能丢失任何文字，包括ABC123。'
    lines, size, x, y = lc._caption_layout(text, 720, 1280, style)
    assert len(lines) == 2 and ''.join(lines) == text
    assert max(len(line) for line in lines) * size * 1.10 <= 720 * .8 + .001
    assert x > 720 * .01 and y == 768


def test_caption_layout_keeps_wide_english_and_two_lines_in_frame():
    style = {'size': 'large', 'font_scale': 2, 'x': .01, 'y': .01, 'stroke': 5}
    lines, size, x, y = lc._caption_layout('W' * 30, 1280, 720, style)
    assert ''.join(lines) == 'W' * 30 and len(lines) == 2
    estimated_width = max(len(line) for line in lines) * size * 1.10
    assert estimated_width <= 1280 * .8 + .001
    assert x >= estimated_width / 2 - 1
    margin_y = size * len(lines) * 1.3 / 2 + style['stroke'] + 2
    assert y >= margin_y - 1
    style['y'] = .99
    assert lc._caption_layout('W' * 30, 1280, 720, style)[3] <= 720 - margin_y + 1
    # The real Windows font need not exist on Linux test runners; when it is
    # available, check its widest common Latin glyph against our fit estimate.
    from pathlib import Path
    from PIL import ImageFont
    font_file = Path('C:/Windows/Fonts/msyhbd.ttc')
    if font_file.is_file():
        font = ImageFont.truetype(str(font_file), max(1, round(size)))
        assert max(font.getlength(line) for line in lines) <= 1280 * .8 + 3


def test_subtitle_intro_cut_position_and_speed_in_real_export(studio):
    main, _ = media('video', color='blue', length=3)
    title = picture(transparent=True)
    config = {'scenes': [{'asset_id': main['id'], 'length': 3}],
              'intro': {'overlay_asset_id': title['id'], 'overlay_duration': .7},
              'srt': '1\n00:00:00,200 --> 00:00:01,600\nThis is a caption',
              'subtitle_style': {'size': 'medium', 'font_scale': 1.1, 'x': .3, 'y': .6,
                                 'color': '#ff8000', 'hide_during_intro': True, 'start_time': .9},
              'aspect_ratio': '9:16', 'resolution': '720p', 'playback_speed': 1.2}
    _, project = setup_project(studio, config)
    started = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert started.status_code == 200, started.text
    job = studio.get('/api/studio/local-compose/jobs/' + started.json()['id']).json()
    assert job['status'] == 'done', job
    output = m._path('alice', s.get('alice', job['result_asset_id'])['local_file'])
    def orange(at):
        image = image_frame(output, at)
        return [(x, y) for y in range(650, 880) for x in range(0, 500)
                if (lambda p: p[0] > 150 and 50 < p[1] < 210 and p[2] < 80)(image.getpixel((x, y)))]
    assert not orange(.5), '片头及字幕起始时间前不能显示字幕'
    visible = orange(.9)
    assert len(visible) > 10
    assert 110 < sum(x for x, _ in visible) / len(visible) < 320
    assert 700 < sum(y for _, y in visible) / len(visible) < 830
    assert not orange(1.5), '按原始时间裁切且倍速后，字幕应准时结束'


def test_subtitle_rejects_unreadably_long_line(studio):
    main, _ = media('video')
    config = {'scenes': [{'asset_id': main['id'], 'length': 2}],
              'srt': '1\n00:00:00,200 --> 00:00:01,600\n' + '很长的字幕' * 60}
    _, project = setup_project(studio, config)
    result = studio.post('/api/studio/local-compose/projects/' + project['id'] + '/render', json={'version': project['version']})
    assert result.status_code == 400 and '无法清晰显示' in result.json()['detail']


def test_hidden_unreadable_line_does_not_block_other_subtitles(studio):
    main, _ = media('video')
    config = {'scenes': [{'asset_id': main['id'], 'length': 2}],
              'subtitle_style': {'start_time': 1},
              'srt': '1\n00:00:00,100 --> 00:00:00,900\n' + '很长的字幕' * 60 +
                     '\n\n2\n00:00:01,000 --> 00:00:01,800\n正常显示'}
    validated = lc._validated('alice', config)
    assert validated['style']['start_time'] == 1


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


def test_uploaded_five_minute_music_uses_exact_one_minute_range(studio, tmp_path):
    main, _ = media('video', length=62)
    music_file = tmp_path / 'external-music.wav'
    ff = hifly_render.ffmpeg()
    # Audible markers distinguish the requested middle passage from the
    # beginning and ending of the original music.
    subprocess.run([ff, '-v', 'error', '-y',
                    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=8000:duration=105',
                    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=8000:duration=62',
                    '-f', 'lavfi', '-i', 'sine=frequency=1100:sample_rate=8000:duration=133',
                    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]', '-map', '[a]',
                    str(music_file)], check=True, capture_output=True)
    with music_file.open('rb') as source:
        uploaded = studio.post('/api/studio/upload', files={'file': ('external-music.wav', source, 'audio/wav')})
    assert uploaded.status_code == 200, uploaded.text
    music = uploaded.json()
    assert music['duration'] == pytest.approx(300)
    clip = {'asset_id': music['id'], 'volume': .6, 'trim': 106.125, 'start': .375, 'length': 60}
    config = {'scenes': [{'asset_id': main['id'], 'length': 62}], 'music': clip, 'resolution': '720p'}
    _, project = setup_project(studio, config)
    project_url = '/api/studio/local-compose/projects/' + project['id']
    assert studio.get(project_url).json()['project']['music'] == clip
    response = studio.post(project_url + '/render', json={'version': project['version']})
    assert response.status_code == 200, response.text
    job = studio.get('/api/studio/local-compose/jobs/' + response.json()['id']).json()
    assert job['status'] == 'done', job
    output = s.get('alice', job['result_asset_id'])
    assert output['duration'] == pytest.approx(62, abs=.06)
    path = m._path('alice', output['local_file'])
    audio = subprocess.run([ff, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-ar', '8000',
                            '-f', 's16le', '-'], check=True, capture_output=True).stdout

    def tone(start, end, frequency):
        chunk = audio[round(start * 8000) * 2:round(end * 8000) * 2]
        values = struct.unpack('<' + 'h' * (len(chunk) // 2), chunk)
        return abs(sum(value * complex(math.cos(2 * math.pi * frequency * i / 8000),
                                      -math.sin(2 * math.pi * frequency * i / 8000))
                       for i, value in enumerate(values))) / len(values)

    assert tone(.255, .355, 880) < 20
    assert tone(.395, .495, 880) > 100
    assert tone(60.255, 60.355, 880) > 100
    assert tone(60.395, 60.495, 880) < 20
    assert max(tone(.395, .495, 660), tone(60.255, 60.355, 1100)) < 20
    assert min(tone(.255, .355, 440), tone(.395, .495, 440), tone(60.395, 60.495, 440)) > 100
    assert hashlib.sha256(m._path('alice', s.get('alice', music['id'])['local_file']).read_bytes()).digest() == hashlib.sha256(music_file.read_bytes()).digest()


def test_music_clip_cannot_read_past_source_and_clamps_to_shortened_film(studio):
    main = picture()
    audio, _ = media('audio')
    config = {'scenes': [{'asset_id': main['id'], 'length': 2}],
              'music': {'asset_id': audio['id'], 'trim': 1, 'start': 1.5, 'length': 2}}
    resolved = lc._validated('alice', config)
    assert resolved['music']['length'] == .5
    assert config['music']['length'] == 2
    config['music']['length'] = 2.1
    with pytest.raises(ValueError, match='裁剪超出素材时长'):
        lc._validated('alice', config)


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


def test_tracks_disable_and_clip_without_mutating_project(studio):
    main, _ = media('video', length=3)
    b = picture()
    voice, _ = media('audio')
    title = picture(transparent=True)
    project = {'scenes': [{'asset_id': main['id'], 'length': 2}, {'asset_id': 'missing', 'length': 3, 'enabled': False}],
               'b_roll': [{'asset_id': b['id'], 'start': 1.5, 'length': 2, 'fit': 'cover'}, {'asset_id': 'missing', 'start': 0, 'length': 1, 'enabled': False}],
               'music': {'asset_id': voice['id'], 'volume': .2, 'enabled': False},
               'intro': {'overlay_asset_id': title['id'], 'overlay_duration': 1, 'enabled': False},
               'srt': '1\n00:00:01,000 --> 00:00:03,500\n保留原句',
               'subtitle_style': {'enabled': False}, 'clip_to_duration': True}
    before = json.dumps(project, ensure_ascii=False)
    resolved = lc._validated('alice', project)
    assert len(resolved['scenes']) == 1 and resolved['total'] == 2
    assert len(resolved['b_roll']) == 1 and resolved['b_roll'][0]['length'] == .5
    assert resolved['music'] is None and resolved['overlay'] is None and resolved['segments'] == []
    assert json.dumps(project, ensure_ascii=False) == before
    project['subtitle_style']['enabled'] = True
    resolved = lc._validated('alice', project)
    assert resolved['segments'] == [(1.0, 2.0, '保留原句')]
    project['scenes'][0]['enabled'] = False
    with pytest.raises(ValueError, match='至少启用一个主画面'):
        lc._validated('alice', project)


def test_title_and_subtitle_independent_timing_in_real_export(studio):
    main, _ = media('video', color='blue', length=3)
    title = picture(transparent=True)
    config = {'scenes': [{'asset_id': main['id'], 'length': 3}],
              'intro': {'overlay_asset_id': title['id'], 'start_time': 1, 'overlay_duration': 1},
              'srt': '1\n00:00:00,200 --> 00:00:02,500\n字幕始终独立显示',
              'subtitle_style': {'color': '#ff8000', 'y': .65, 'start_time': .2},
              'aspect_ratio': '9:16', 'resolution': '720p'}
    _, project = setup_project(studio, config)
    res = studio.post('/api/studio/local-compose/projects/'+project['id']+'/render', json={'version':project['version']})
    assert res.status_code == 200, res.text
    job=studio.get('/api/studio/local-compose/jobs/'+res.json()['id']).json()
    assert job['status']=='done', job
    output=m._path('alice', s.get('alice',job['result_asset_id'])['local_file'])
    def colors(t):
        frame=image_frame(output,t)
        pix=list(frame.getdata())
        return (sum(1 for r,g,b in pix if r>180 and g>180 and b<80),sum(1 for r,g,b in pix if r>180 and 65<g<190 and b<75))
    before,during,after=colors(.5),colors(1.5),colors(2.3)
    assert before[0]<20 and during[0]>100 and after[0]<20, (before,during,after)
    assert min(before[1],during[1],after[1])>10, (before,during,after)
