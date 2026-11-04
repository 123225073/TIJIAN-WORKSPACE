"""OAIREGBOX MiniMax H3 video request contract."""
from pathlib import Path

from . import ark_video

PROVIDER = 'oairegbox'
BASE_URL = 'https://api.oairegbox.cc'
DOCS_URL = 'https://docs.oairegbox.cc/#minimax-h3-persec'
TASKS = '/v1/videos'
MODELS = {
    'minimax-h3-768p': ('MiniMax H3 标准 · 768P', 0.15),
    'minimax-h3-2k': ('MiniMax H3 标准 · 2K', 0.20),
    'minimax-h3-pro-768p': ('MiniMax H3 Pro · 768P', 0.25),
    'minimax-h3-pro-2k': ('MiniMax H3 Pro · 2K', 0.33),
}
DEFAULT_MODEL = 'media:minimax-h3-768p'
MODES = ('text', 'first_frame', 'first_last_frame', 'reference')
OPTIONS = {'ratio': ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4', 'adaptive'],
           'duration': list(range(4, 16))}
LIMITS = {model: {'image': 9 if '-pro-' in model else 5,
                  'video': int('-pro-' in model), 'audio': 3} for model in MODELS}
FORMATS = {'image': {'.png', '.jpg', '.jpeg', '.webp'}, 'video': {'.mp4', '.mov'},
           'audio': {'.mp3', '.wav'}}


def validate(model, inputs, opts, asset_lookup, *, complete):
    mode = inputs.get('reference_mode', 'reference')
    refs = ark_video.references(inputs)
    if not complete:
        return refs
    if mode not in MODES or inputs.get('draft_run'):
        raise ValueError('MiniMax H3 不支持此创作方式，请重新选择。')
    counts = {kind: sum(ref['kind'] == kind for ref in refs) for kind in FORMATS}
    limits = LIMITS[model['api_model_id']]
    if counts['video'] and not limits['video']:
        raise ValueError('当前 MiniMax H3 标准版不支持参考视频，请切换到 H3 Pro 或移除参考视频。')
    if any(counts[kind] > limits[kind] for kind in counts):
        raise ValueError(f"当前模型最多支持 {limits['image']} 张参考图、{limits['video']} 段参考视频、3 段参考音频。")
    prompt = inputs.get('prompt', '').strip()
    if not 1 <= len(prompt) <= 7000:
        raise ValueError('请填写 7000 字以内的 MiniMax H3 提示词。')
    if mode == 'text' and refs:
        raise ValueError('文字生视频不使用素材，请移除素材或切换创作方式。')
    if mode in ('first_frame', 'first_last_frame'):
        required = 1 if mode == 'first_frame' else 2
        slots = inputs.get('frame_slots')
        if counts['image'] != required or len(refs) != required or (
            slots is not None and (not slots.get('first_frame') or (required == 2 and not slots.get('last_frame')))
        ):
            raise ValueError('请选齐首帧或首尾帧图片。此方式只使用指定的帧图片。')
    if not refs and opts.get('ratio') == 'adaptive':
        raise ValueError('无参考素材时，请选择明确的画面比例。')
    if counts['audio'] and not counts['image']:
        raise ValueError('参考音频需要搭配至少一张参考图片。')
    audio_duration = inline_size = 0
    for ref in refs:
        kind = ref['kind']
        if ref.get('id'):
            asset = asset_lookup(ref['id'], kind)
            if Path(asset['local_file']).suffix.lower() not in FORMATS[kind]:
                raise ValueError('H3 支持 PNG/JPEG/WebP 图片、MP4/MOV 视频和 MP3/WAV 音频。')
            duration = asset.get('duration') or 0
            inline_size += asset.get('size', 0)
            if kind != 'image' and not duration:
                raise ValueError('无法读取参考视频或音频的时长，请重新上传可播放的素材。')
        else:
            if not ref['url'].startswith('https://'):
                raise ValueError('OAIREGBOX 参考素材链接须使用公开 HTTPS 地址。')
            duration = ref.get('duration')
        if kind == 'video' and duration is not None and not 2 <= duration <= 5:
            raise ValueError('H3 Pro 参考视频时长须为 2–5 秒。')
        if kind == 'audio':
            audio_duration += duration or 0
    if audio_duration > 15:
        raise ValueError('参考音频合计最多 15 秒。')
    if inline_size > 100 * 1024 * 1024:
        raise ValueError('本地参考素材合计最多 100 MB，请压缩素材或使用公开链接。')
    return refs


def payload(model, inputs, opts, refs, resolve):
    body = {'model': model['api_model_id'], 'prompt': inputs['prompt'].strip(),
            'duration': opts.get('duration', 5), 'ratio': opts.get('ratio', '16:9')}
    if inputs.get('reference_mode') in ('first_frame', 'first_last_frame'):
        body['first_image'] = resolve(refs[0])
        if len(refs) == 2:
            body['last_image'] = resolve(refs[1])
    else:
        for kind, key in [('image', 'referenceImages'), ('video', 'referenceVideos'), ('audio', 'referenceAudios')]:
            values = [resolve(ref) for ref in refs if ref['kind'] == kind]
            if values:
                body[key] = values
    return body
