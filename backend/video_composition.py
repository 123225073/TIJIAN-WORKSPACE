"""Local, non-destructive title and timed subtitle rendering for saved videos."""
import math
import re
import subprocess
import tempfile
from pathlib import Path

from . import hifly_render

STYLES = {'clean', 'blue', 'gold'}
TIMING = re.compile(r'^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$')


def seconds(parts):
    h, m, sec, ms = map(int, parts)
    if m > 59 or sec > 59:
        raise ValueError('字幕时间格式不正确')
    return h * 3600 + m * 60 + sec + ms / 1000


def parse_srt(value, duration):
    if not isinstance(value, str) or len(value) > 100000:
        raise ValueError('字幕内容过长或格式无效')
    text = value.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff').strip()
    if not text:
        return []
    segments = []
    for block in re.split(r'\n\s*\n', text):
        lines = block.strip().split('\n')
        if lines and lines[0].strip().isdigit():
            lines.pop(0)
        match = TIMING.fullmatch(lines.pop(0).strip()) if lines else None
        if not match or not lines:
            raise ValueError('字幕需为 SRT 格式：时间行和文字之间不要空行')
        start, end = seconds(match.groups()[:4]), seconds(match.groups()[4:])
        caption = ' '.join(line.strip() for line in lines).strip()
        if not 0 <= start < end <= duration + .05:
            raise ValueError('字幕时间必须位于视频时长内，结束时间应晚于开始时间')
        if not caption or len(caption) > 36:
            raise ValueError('每条字幕请控制在 1 至 36 个字，较长内容请拆分成多条')
        if segments and start < segments[-1][1]:
            raise ValueError('字幕时间不能交叠，请检查顺序')
        segments.append((start, end, caption))
        if len(segments) > 2000:
            raise ValueError('字幕条数过多')
    return segments


def ass_time(value):
    cs = round(value * 100)
    return f'{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}'


def clean(value):
    # Disallow ASS override tags and control sequences while retaining punctuation.
    return value.replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\n', ' ')


def render(source, output, duration, width, height, style, title, subtitle_srt, position, title_duration='3'):
    if style not in STYLES or position not in ('bottom', 'upper'):
        raise ValueError('请选择有效的模板和字幕位置')
    if not isinstance(title, str) or len(title) > 28 or '\n' in title:
        raise ValueError('视频标题请控制在 28 字以内')
    if not math.isfinite(duration) or duration <= 0 or duration > 3600 or width < 64 or height < 64:
        raise ValueError('无法确认视频尺寸或时长，请重新选择视频')
    if title_duration not in ('3', '5', '8', 'full'):
        raise ValueError('请选择有效的片头标题时长')
    title_end = duration if title_duration == 'full' else min(duration, int(title_duration))
    segments = parse_srt(subtitle_srt, duration)
    program = hifly_render.ffmpeg()
    if not program:
        raise ValueError('本机缺少视频处理组件，原视频已保留')
    # Match the source aspect ratio. A fixed 9:16 PlayRes shifts and stretches
    # overlays on 2:3 or landscape videos. Sizes remain relative to height.
    play_width = max(1, round(1920 * width / height))
    title_margin = round(play_width * .0833)
    caption_margin_x = round(play_width * .1111)
    title_size = max(12, min(58, (play_width - title_margin * 2) // 14))
    caption_size = max(12, min(52, (play_width - caption_margin_x * 2) // 18))
    color = {'clean': '&H00FFFFFF', 'blue': '&H00FFDC88', 'gold': '&H0077DEFF'}[style]
    title_border = 3 if style == 'blue' else 1
    caption_margin = 200 if position == 'bottom' else 1270
    ass = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {play_width}
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Microsoft YaHei,{title_size},{color},&H000000FF,&H00121B27,&H900D1622,-1,0,0,0,100,100,0,0,{title_border},8,0,8,{title_margin},{title_margin},130,1
Style: Caption,Microsoft YaHei,{caption_size},&H00FFFFFF,&H000000FF,&H00101720,&H900D1622,-1,0,0,0,100,100,0,0,1,3,1,2,{caption_margin_x},{caption_margin_x},{caption_margin},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    if title.strip():
        end = ass_time(title_end)
        if style in ('blue', 'gold'):
            # An understated rule separates the opening headline from the
            # speaker; it uses the same active interval as the title.
            rule_width, rule_height = max(4, round(play_width * .12)), 5
            rule_x, rule_y = (play_width - rule_width) // 2, 85
            rule_color = '&H00FFDC88&' if style == 'blue' else '&H0077DEFF&'
            rule = (r'{\an7\bord0\shad0\1c' + rule_color + f'\\pos({rule_x},{rule_y})' +
                    r'\p1}' + f'm 0 0 l {rule_width} 0 {rule_width} {rule_height} 0 {rule_height}' + r'{\p0}')
            ass += f'Dialogue: 0,0:00:00.00,{end},Title,,0,0,0,,{rule}\n'
        ass += f'Dialogue: 1,0:00:00.00,{end},Title,,0,0,0,,{clean(title.strip())}\n'
    for start, end, text in segments:
        # Break Chinese text deliberately to keep subtitles to two readable lines.
        line = clean(text)
        if len(line) > 18:
            line = line[:18] + r'\N' + line[18:]
        ass += f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{line}\n'
    with tempfile.TemporaryDirectory(prefix='tijian-video-') as temp:
        Path(temp, 'titles.ass').write_text(ass, encoding='utf-8-sig')
        cmd = [program, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
               '-i', str(source), '-vf', 'ass=titles.ass', '-map', '0:v:0', '-map', '0:a?',
               '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
               '-c:a', 'aac', '-b:a', '192k', '-threads', '2', '-movflags', '+faststart', str(output)]
        try:
            subprocess.run(cmd, cwd=temp, capture_output=True, check=True,
                           timeout=min(3600, max(120, duration * 12)), creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, subprocess.SubprocessError):
            Path(output).unlink(missing_ok=True)
            raise ValueError('成片合成失败，原视频已保留；请检查视频文件和字幕时间') from None
