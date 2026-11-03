"""Local video assembly. User projects refer only to owned studio assets."""
import copy
import json
import math
import re
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import Depends

from . import store as s, jobs, hifly_render, video_composition

RATIOS = {'9:16': (9, 16), '16:9': (16, 9), '1:1': (1, 1), '4:5': (4, 5)}
FONTS = {'Microsoft YaHei', 'SimHei', 'SimSun'}


def _number(value, label, minimum=0, maximum=3600):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(label + '数值无效')
    return float(value)


def _shape(value):
    if not isinstance(value, dict) or len(json.dumps(value, ensure_ascii=False)) > 300000:
        raise ValueError('成片项目格式无效或内容过长')
    if not isinstance(value.get('scenes', []), list) or len(value.get('scenes', [])) > 20:
        raise ValueError('主轨最多 20 个片段')
    if not isinstance(value.get('b_roll', []), list) or len(value.get('b_roll', [])) > 30:
        raise ValueError('补充画面最多 30 个片段')
    if not isinstance(value.get('srt', ''), str) or len(value.get('srt', '')) > 100000:
        raise ValueError('字幕内容无效或过长')
    if not isinstance(value.get('cover', {}), dict) or len(json.dumps(value.get('cover', {}), ensure_ascii=False)) > 50000:
        raise ValueError('封面设置无效或过长')
    return copy.deepcopy(value)


def _draft(owner, draft_id):
    from . import media_studio as m
    draft = m._object(owner, draft_id, 'studio_draft')
    if draft.get('tool') != 'compose':
        raise ValueError('请选择素材成片草稿')
    return draft


def _project(owner, ident):
    from . import media_studio as m
    return m._object(owner, ident, 'local_compose_project')


def _asset(owner, ident, types):
    from . import media_studio as m
    if not isinstance(ident, str):
        raise ValueError('素材编号无效')
    item = m._object(owner, ident, 'studio_asset')
    if item.get('asset_type') not in types or item.get('status') != 'ready':
        raise ValueError('素材类型或状态不支持本地合成')
    path = m._path(owner, item.get('local_file'), create=False)
    if not path.is_file():
        raise ValueError('本地素材文件不存在')
    metadata = m._metadata(path, path.suffix.lower())
    return item, path, metadata


def _audio_present(path):
    from . import media_studio as m
    probe = m._ffprobe()
    if not probe:
        raise ValueError('视频信息读取组件不可用')
    try:
        result = subprocess.run([probe, '-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
                                 'stream=codec_type', '-of', 'json', str(path)], capture_output=True,
                                check=True, timeout=20, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return any(x.get('codec_type') == 'audio' for x in json.loads(result.stdout).get('streams', []))
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ValueError('无法读取媒体音轨') from None


def _enabled(item):
    value = item.get('enabled', True)
    if not isinstance(value, bool):
        raise ValueError('轨道启用状态无效')
    return value


def _validated(owner, project):
    data = _shape(project)
    clip_to_duration = data.get('clip_to_duration', False)
    if not isinstance(clip_to_duration, bool):
        raise ValueError('时间轴设置无效')
    scenes = data.get('scenes', [])
    if not scenes:
        raise ValueError('请至少添加一个主轨画面')
    ratio, resolution = data.get('aspect_ratio', '9:16'), data.get('resolution', '1080p')
    if ratio not in RATIOS or resolution not in ('720p', '1080p'):
        raise ValueError('请选择支持的画面比例和清晰度')
    # Project edit timestamps remain in the original timeline.  Speed is
    # applied to the finished picture and mixed sound together, so every
    # overlay and subtitle follows the same clock and existing projects stay
    # unchanged when the field is absent.
    speed = _number(data.get('playback_speed', 1), '播放速度', .5, 2)
    rw, rh = RATIOS[ratio]
    base = 1080 if resolution == '1080p' else 720
    width, height = (base, round(base * rh / rw)) if rw <= rh else (round(base * rw / rh), base)
    width += width % 2
    height += height % 2
    total, prepared = 0.0, []
    for scene in scenes:
        if not isinstance(scene, dict):
            raise ValueError('主轨片段格式无效')
        if not _enabled(scene):
            continue
        asset, path, meta = _asset(owner, scene.get('asset_id'), {'image', 'video'})
        start = _number(scene.get('trim', 0), '主轨开始', 0, 3600)
        length = _number(scene.get('length'), '主轨时长', .1, 1800)
        if asset['asset_type'] == 'video' and start + length > float(meta.get('duration', 0)) + .05:
            raise ValueError('主轨片段超出视频时长，请调整起点或时长')
        if asset['asset_type'] == 'image' and start != 0:
            raise ValueError('图片没有可裁剪的开始时间')
        fit = scene.get('fit', 'cover')
        if fit not in ('cover', 'contain', 'crop', 'none'):
            raise ValueError('画面适配方式无效')
        volume = _number(scene.get('volume', 1), '原声音量', 0, 2)
        voice_volume = _number(scene.get('audio_volume', 1), '配音音量', 0, 2)
        voice = _asset(owner, scene['audio_id'], {'audio'})[1] if scene.get('audio_id') else None
        prepared.append(dict(path=path, kind=asset['asset_type'], trim=start, length=length, fit=fit,
                             volume=volume, voice=voice, voice_volume=voice_volume,
                             has_audio=asset['asset_type'] == 'video' and _audio_present(path)))
        total += length
    if not prepared:
        raise ValueError('请至少启用一个主画面')
    if total > 3600:
        raise ValueError('成片总时长不能超过 60 分钟')
    b_roll = []
    for clip in data.get('b_roll', []):
        if not isinstance(clip, dict):
            raise ValueError('补充画面格式无效')
        if not _enabled(clip):
            continue
        asset, path, meta = _asset(owner, clip.get('asset_id'), {'image', 'video'})
        start = _number(clip.get('start'), '补充画面起点', 0, 3600 if clip_to_duration else total)
        trim = _number(clip.get('trim', 0), '补充画面素材起点', 0, 3600)
        length = _number(clip.get('length'), '补充画面时长', .1, 3600 if clip_to_duration else total)
        if clip_to_duration:
            if start >= total:
                continue
            length = min(length, total - start)
        elif start + length > total + .001:
            raise ValueError('补充画面超出主轨时长')
        if asset['asset_type'] == 'video' and trim + length > float(meta.get('duration', 0)) + .05:
            raise ValueError('补充画面超出素材时长')
        if asset['asset_type'] == 'image' and trim != 0:
            raise ValueError('图片没有可裁剪的开始时间')
        fit = clip.get('fit', 'cover')
        if fit not in ('cover', 'contain', 'crop', 'none'):
            raise ValueError('画面适配方式无效')
        b_roll.append(dict(path=path, kind=asset['asset_type'], start=start, trim=trim, length=length, fit=fit))
    music = data.get('music')
    if music:
        if not isinstance(music, dict):
            raise ValueError('背景音乐格式无效')
        if not _enabled(music):
            music = None
    if music:
        _, music_path, _ = _asset(owner, music.get('asset_id'), {'audio'})
        music = dict(path=music_path, volume=_number(music.get('volume', .2), '音乐音量', 0, 2))
    else:
        music = None
    intro = data.get('intro') or {}
    if not isinstance(intro, dict):
        raise ValueError('片头设置无效')
    overlay = None
    if _enabled(intro) and intro.get('overlay_asset_id'):
        _, overlay_path, meta = _asset(owner, intro['overlay_asset_id'], {'image'})
        if meta.get('mime_type') != 'image/png':
            raise ValueError('标题图层需为 PNG 图片')
        intro_start = min(max(0, total-.1), _number(intro.get('start_time', 0), '标题开始时间', 0, 3600))
        overlay = dict(path=overlay_path, start=intro_start, duration=min(max(0, total-intro_start), _number(intro.get('overlay_duration', 3), '标题时长', .1, 3600)))
    style = data.get('subtitle_style') or {}
    if not isinstance(style, dict):
        raise ValueError('字幕样式无效')
    font = style.get('font', 'Microsoft YaHei')
    size = style.get('size', 'medium')
    position = style.get('position', 'bottom')
    color = style.get('color', '#ffffff')
    stroke_color = style.get('stroke_color', '#101720')
    stroke = _number(style.get('stroke', 3), '字幕描边', 0, 5)
    font_scale = _number(style.get('font_scale', 1), '字幕缩放', .5, 2)
    x = _number(style.get('x', .5), '字幕水平位置', 0, 1)
    y = _number(style.get('y', .87 if position == 'bottom' else .34), '字幕垂直位置', 0, 1)
    subtitle_start = _number(style.get('start_time', 0), '字幕开始时间', 0, 3600 if clip_to_duration else total)
    subtitle_start = min(total, subtitle_start)
    hide_during_intro = style.get('hide_during_intro', False)
    if not isinstance(hide_during_intro, bool):
        raise ValueError('字幕片头显示设置无效')
    if font not in FONTS or size not in ('small', 'medium', 'large') or position not in ('bottom', 'upper') or not re.fullmatch(r'#[0-9A-Fa-f]{6}', color) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', stroke_color):
        raise ValueError('字幕字体、颜色或位置无效')
    segments = video_composition.parse_srt(data.get('srt', '') if _enabled(style) else '', 3600 if clip_to_duration else total, max_chars=500)
    if clip_to_duration:
        segments = [(start, min(end, total), text) for start, end, text in segments if start < total]
    prepared_style = dict(font=font, size=size, position=position, color=color, stroke_color=stroke_color, stroke=stroke,
                          font_scale=font_scale, x=x, y=y, start_time=subtitle_start, hide_during_intro=hide_during_intro)
    visible_from = max(subtitle_start, overlay['start'] + overlay['duration'] if hide_during_intro and overlay else 0)
    if any(round(max(start, visible_from) * 100) < round(end * 100) and
           _caption_layout(text, width, height, prepared_style)[1] < min(width, height) * .018
           for start, end, text in segments):
        raise ValueError('有一句字幕过长，缩小后无法清晰显示，请按语音停顿拆分并检查时间')
    return dict(scenes=prepared, b_roll=b_roll, music=music, overlay=overlay, segments=segments,
                style=prepared_style,
                width=width, height=height, total=total, playback_speed=speed)


def _ass_color(value):
    return '&H00' + value[5:7] + value[3:5] + value[1:3]


def _caption_layout(text, width, height, style):
    """Return at most two lines and a font that fits the safe frame width.

    Estimate every glyph at one em, then leave a further 10% allowance for
    wide bold glyphs and font/rendering differences. The browser uses
    the same calculation; line boundaries are independent of playback speed.
    """
    chars = list(video_composition.clean(text))
    units = [1 for ch in chars]
    base = min(width, height) * {'small': .035, 'medium': .045, 'large': .055}[style['size']] * style['font_scale']
    safe_width = width * .80
    total = sum(units)
    lines = [''.join(chars)]
    widths = [total]
    if len(chars) > 1 and total * base * 1.10 > safe_width:
        current = 0
        best_index, best_delta = 1, float('inf')
        for i in range(1, len(chars)):
            current += units[i - 1]
            delta = abs(total - 2 * current)
            if delta < best_delta:
                best_index, best_delta = i, delta
        lines = [''.join(chars[:best_index]), ''.join(chars[best_index:])]
        widths = [sum(units[:best_index]), sum(units[best_index:])]
    font_size = min(base, safe_width / (max(widths) * 1.10)) if max(widths) else base
    half_width = max(widths) * font_size * 1.10 / 2
    x = min(width - half_width, max(half_width, width * style['x']))
    margin_y = max(.05 * height, font_size * len(lines) * 1.3 / 2 + style.get('stroke', 3) + 2)
    y = min(height - margin_y, max(margin_y, height * style['y']))
    return lines, font_size, round(x), round(y)


def _subtitle_file(path, data):
    st = data['style']
    w, h = data['width'], data['height']
    font_size = round(min(w, h) * {'small': .035, 'medium': .045, 'large': .055}[st['size']] * st['font_scale'])
    margin_v = round(h * (.105 if st['position'] == 'bottom' else .65))
    content = f'''[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,{st['font']},{font_size},{_ass_color(st['color'])},&H000000FF,{_ass_color(st['stroke_color'])},&H900D1622,-1,0,0,0,100,100,0,0,1,{st['stroke']},1,2,{round(w*.1)},{round(w*.1)},{margin_v},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
    for start, end, text in data['segments']:
        visible_from = max(st['start_time'], data['overlay']['start'] + data['overlay']['duration'] if st['hide_during_intro'] and data['overlay'] else 0)
        start = max(start, visible_from)
        if video_composition.ass_time(start) >= video_composition.ass_time(end):
            continue
        lines, fitted, x, y = _caption_layout(text, w, h, st)
        line = r'{\an5\pos(' + f'{x},{y}' + r')\fs' + f'{fitted:.2f}' + '}' + r'\N'.join(lines)
        content += f'Dialogue: 0,{video_composition.ass_time(start)},{video_composition.ass_time(end)},Caption,,0,0,0,,{line}\n'
    path.write_text(content, encoding='utf-8-sig')


def _fit(width, height, fit):
    if fit in ('contain', 'none'):
        return f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
    return f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1'


def _execute(cmd, cwd, event, timeout):
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + timeout
        while proc.poll() is None:
            if event.wait(.2) or time.monotonic() > deadline:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()
                if event.is_set():
                    raise InterruptedError('已取消本机合成')
                raise ValueError('本机合成超时，原素材已保留')
        if proc.returncode:
            raise ValueError('本机合成失败，请检查素材格式、时长和可用空间；原素材已保留')


def render(owner, project, output, progress, event):
    data = _validated(owner, project)
    ff = hifly_render.ffmpeg()
    if not ff:
        raise ValueError('本机缺少视频合成组件')
    w, h, total = data['width'], data['height'], data['total']
    timeout = min(7200, max(180, total * 15))
    with tempfile.TemporaryDirectory(prefix='tijian-local-compose-') as folder:
        work = Path(folder)
        paths = []
        for i, scene in enumerate(data['scenes']):
            progress(f'正在准备主轨片段 {i+1}/{len(data["scenes"])}')
            segment = work / f'segment-{i:02}.mp4'
            cmd = [ff, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe']
            cmd += (['-loop', '1', '-framerate', '30', '-i', str(scene['path'])] if scene['kind'] == 'image'
                    else ['-ss', str(scene['trim']), '-i', str(scene['path'])])
            if scene['voice']:
                cmd += ['-i', str(scene['voice'])]
            if not scene['has_audio']:
                cmd += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
            audio_index = 0 if scene['has_audio'] else (2 if scene['voice'] else 1)
            filters = [f"[0:v:0]{_fit(w,h,scene['fit'])},fps=30,format=yuv420p,setpts=PTS-STARTPTS[v]",
                       f"[{audio_index}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume={scene['volume']},apad,atrim=0:{scene['length']},asetpts=PTS-STARTPTS[a0]"]
            if scene['voice']:
                filters += [f"[1:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume={scene['voice_volume']},apad,atrim=0:{scene['length']},asetpts=PTS-STARTPTS[a1]",
                            '[a0][a1]amix=inputs=2:duration=first:normalize=0[a]']
            else:
                filters += ['[a0]anull[a]']
            cmd += ['-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]', '-t', str(scene['length']),
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                    '-b:a', '192k', '-threads', '2', str(segment)]
            _execute(cmd, work, event, timeout)
            paths.append(segment)
        progress('正在合成补充画面、字幕和声音')
        cmd = [ff, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe']
        for path in paths:
            cmd += ['-i', str(path)]
        for clip in data['b_roll']:
            cmd += (['-loop', '1', '-framerate', '30', '-t', str(clip['length']), '-i', str(clip['path'])]
                    if clip['kind'] == 'image' else ['-ss', str(clip['trim']), '-t', str(clip['length']), '-i', str(clip['path'])])
        music_index = len(paths) + len(data['b_roll']) if data['music'] else None
        if data['music']:
            cmd += ['-stream_loop', '-1', '-i', str(data['music']['path'])]
        overlay_index = len(paths) + len(data['b_roll']) + (1 if data['music'] else 0) if data['overlay'] else None
        if data['overlay']:
            cmd += ['-loop', '1', '-framerate', '30', '-t', str(data['overlay']['start'] + data['overlay']['duration']), '-i', str(data['overlay']['path'])]
        filters = [''.join(f'[{i}:v:0][{i}:a:0]' for i in range(len(paths))) + f'concat=n={len(paths)}:v=1:a=1[basev][basea]']
        last = 'basev'
        for i, clip in enumerate(data['b_roll']):
            idx = len(paths) + i
            filters += [f"[{idx}:v:0]{_fit(w,h,clip['fit'])},fps=30,setpts=PTS-STARTPTS+{clip['start']}/TB[b{i}]",
                        f"[{last}][b{i}]overlay=0:0:eof_action=pass:repeatlast=0:enable='between(t,{clip['start']},{clip['start']+clip['length']})'[v{i}]"]
            last = f'v{i}'
        if data['overlay']:
            filters += [f'[{overlay_index}:v:0]scale={w}:{h},format=rgba[title]',
                        f"[{last}][title]overlay=0:0:eof_action=pass:repeatlast=0:enable='gte(t,{data['overlay']['start']})*lt(t,{data['overlay']['start']+data['overlay']['duration']})'[titled]"]
            last = 'titled'
        if data['segments']:
            _subtitle_file(work / 'subtitles.ass', data)
            filters += [f'[{last}]ass=subtitles.ass[composedv]']
        else:
            filters += [f'[{last}]null[composedv]']
        if data['music']:
            filters += [f"[{music_index}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume={data['music']['volume']},atrim=0:{total},asetpts=PTS-STARTPTS[music]",
                        '[basea][music]amix=inputs=2:duration=first:normalize=0[composeda]']
        else:
            filters += ['[basea]anull[composeda]']
        speed = data['playback_speed']
        if speed == 1:
            filters += ['[composedv]null[finalv]', '[composeda]anull[finala]']
        else:
            # Change pitch-preserving audio tempo and image timing *after*
            # composition.  This also scales the timings of captions, title,
            # overlays and music; no independent clock can drift out of sync.
            filters += [f'[composedv]setpts=(PTS-STARTPTS)/{speed},fps=30[finalv]',
                        f'[composeda]atempo={speed},asetpts=PTS-STARTPTS[finala]']
        cmd += ['-filter_complex', ';'.join(filters), '-map', '[finalv]', '-map', '[finala]', '-t', str(total / speed),
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                '-b:a', '192k', '-threads', '2', '-movflags', '+faststart', str(output)]
        _execute(cmd, work, event, timeout)


def register(app, user, invoke):
    from . import media_studio as m

    def call(fn, *args):
        def wrapped():
            try:
                return fn(*args)
            except ValueError as exc:
                raise m.StudioError(str(exc)) from None
        return invoke(wrapped)

    def find_job(owner, project_id, active=False):
        with s.conn() as conn:
            row = conn.execute("SELECT * FROM objects WHERE owner=? AND kind='job' "
                               "AND json_extract(data,'$.input.action')='local_compose' "
                               "AND json_extract(data,'$.input.project_id')=? " +
                               ("AND json_extract(data,'$.status') IN ('queued','running') " if active else '') +
                               'ORDER BY updated DESC LIMIT 1', (owner, project_id)).fetchone()
        return s.unpack(row) if row else None

    def with_last_job(owner, project):
        found = find_job(owner, project['id'])
        return {**project, 'last_job_id': found['id'] if found else ''}

    @app.get('/api/studio/local-compose/projects')
    def list_projects(draft_id: str, u=Depends(user)):
        def read():
            _draft(u['id'], draft_id)
            return {'items': [with_last_job(u['id'], x) for x in s.list_(u['id'], 'local_compose_project') if x.get('draft_id') == draft_id and not x.get('archived')]}
        return call(read)

    @app.get('/api/studio/local-compose/projects/{id}')
    def get_project(id: str, u=Depends(user)):
        return call(lambda: with_last_job(u['id'], _project(u['id'], id)))

    @app.post('/api/studio/local-compose/projects')
    def save_project(data: dict, u=Depends(user)):
        def save():
            owner = u['id']
            if not isinstance(data, dict) or not isinstance(data.get('title', ''), str) or len(data.get('title', '')) > 200:
                raise m.StudioError('项目名称无效')
            ident, version = data.get('id'), data.get('version')
            with s.LOCK:
                draft = _draft(owner, data.get('draft_id', ''))
                value = {'title': data.get('title', '').strip() or '本地成片', 'draft_id': draft['id'],
                         'project': _shape(data.get('project', {})), 'flow_id': draft.get('flow_id', ''), 'topic_id': draft.get('topic_id', '')}
                if ident:
                    current = _project(owner, ident)
                    if current['draft_id'] != draft['id']:
                        raise s.Missing('项目不属于此草稿')
                    if type(version) is not int:
                        raise m.StudioError('请提供项目版本')
                    return s.put(owner, 'local_compose_project', {**current, **value}, ident, expected=version)
                existing = next((x for x in s.list_(owner, 'local_compose_project') if x.get('draft_id') == draft['id'] and not x.get('archived')), None)
                if existing:
                    raise s.Conflict('该草稿已有本地成片项目，请重新读取后编辑')
                return s.put(owner, 'local_compose_project', value)
        return call(save)

    @app.post('/api/studio/local-compose/projects/{id}/render')
    def start_render(id: str, data: dict, u=Depends(user)):
        def start():
            owner = u['id']
            with s.LOCK:
                project = _project(owner, id)
                if type(data.get('version')) is not int or project['version'] != data['version']:
                    raise s.Conflict('项目已变化，请先保存并重新开始')
                existing = find_job(owner, id, active=True)
                if existing:
                    if existing.get('input', {}).get('project_version') != project['version']:
                        raise m.StudioError('该项目有上一版本正在合成，请等待或取消')
                    return existing
                snapshot = copy.deepcopy(project['project'])
                _validated(owner, snapshot)
                def work(progress, event):
                    aid = s.uid()
                    target = m._path(owner, aid + '.mp4')
                    try:
                        render(owner, snapshot, target, progress, event)
                        if event.is_set():
                            raise InterruptedError('已取消本机合成')
                        meta = m._metadata(target, '.mp4')
                        with s.LOCK:
                            if event.is_set():
                                raise InterruptedError('已取消本机合成')
                            value = {**meta, 'title': project['title'] + ' · 本地成片', 'status': 'ready',
                                     'provider': 'local', 'compat': m.COMPAT['video'], 'local_file': target.name,
                                     'source_project_id': id, 'source_project_version': project['version'],
                                     'flow_id': project.get('flow_id', ''), 'topic_id': project.get('topic_id', '')}
                            result = s.put(owner, 'studio_asset', value, aid)
                        return {'result_asset_id': result['id']}
                    except Exception:
                        target.unlink(missing_ok=True)
                        raise
                return jobs.start(owner, project['title'] + ' · 本地合成', work,
                                  {'action': 'local_compose', 'project_id': id, 'project_version': project['version']})
        return call(start)

    @app.get('/api/studio/local-compose/jobs/{id}')
    def read_job(id: str, u=Depends(user)):
        def read():
            job = m._object(u['id'], id, 'job')
            if job.get('input', {}).get('action') != 'local_compose':
                raise s.Missing('任务不存在')
            return {**job, 'result_asset_id': (job.get('result') or {}).get('result_asset_id', '')}
        return call(read)

    @app.post('/api/studio/local-compose/jobs/{id}/cancel')
    def cancel_job(id: str, u=Depends(user)):
        def cancel():
            job = m._object(u['id'], id, 'job')
            if job.get('input', {}).get('action') != 'local_compose':
                raise s.Missing('任务不存在')
            return jobs.cancel(u['id'], id)
        return call(cancel)
