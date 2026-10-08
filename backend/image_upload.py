"""Decode uploads by content; retain the original and prepare a reusable still image."""
import io
import math
import warnings
import uuid
from threading import BoundedSemaphore
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PIXELS = 100_000_000
MAX_EDGE = 4096
MAX_BYTES = 10 * 1024 * 1024
FORMATS = {'JPEG': '.jpg', 'MPO': '.jpg', 'PNG': '.png', 'WEBP': '.webp', 'BMP': '.bmp', 'TIFF': '.tiff', 'GIF': '.gif'}
DECODE_SLOT = BoundedSemaphore(1)


def prepare(path: Path):
    """Return (usable path, public adjustment, private original filename)."""
    # Decode only one large image at a time across all accounts. Other API
    # workers remain available for drafts and task status.
    if not DECODE_SLOT.acquire(blocking=False):
        raise ValueError('正在适配另一张图片，请稍候重新上传。本次没有保存文件或提交生成任务')
    try:
        return _prepare(path)
    finally:
        DECODE_SLOT.release()


def _prepare(path: Path):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', Image.DecompressionBombWarning)
            with Image.open(path) as source:
                if source.format not in FORMATS:
                    raise ValueError('图片编码不支持，请使用 JPEG、PNG 或 WebP')
                width, height = source.size
                if width * height > MAX_PIXELS:
                    raise ValueError('图片超过 1 亿像素的安全处理上限，请使用较小原图')
                fmt = source.format
                orientation = source.getexif().get(274, 1)
                animated = getattr(source, 'n_frames', 1) > 1
                if fmt in ('JPEG', 'MPO') and max(width, height) > MAX_EDGE:
                    scale = MAX_EDGE / max(width, height)
                    source.draft('RGB', tuple(max(1, round(v * scale)) for v in (width, height)))
                source.load()  # Reject truncated files before accepting or converting.
                needs_conversion = (max(width, height) > MAX_EDGE or path.stat().st_size > MAX_BYTES
                                    or orientation != 1 or fmt not in ('JPEG', 'PNG', 'WEBP'))
                extension = FORMATS[fmt]
                mismatch = path.suffix.lower() not in ({'.jpg', '.jpeg'} if fmt in ('JPEG', 'MPO') else
                           {'.tif', '.tiff'} if fmt == 'TIFF' else {extension})
                if not needs_conversion and not mismatch:
                    return path, None, None
                if needs_conversion:
                    ImageOps.exif_transpose(source, in_place=True)
                image = source if needs_conversion else None
                icc = source.info.get('icc_profile')
                original_size = path.stat().st_size
                if image is not None:
                    scale = min(1, MAX_EDGE / max(image.size))
                    if scale < 1:
                        image = image.resize(tuple(max(1, round(v * scale)) for v in image.size), Image.Resampling.LANCZOS)
                    alpha = image.mode in ('RGBA', 'LA') or 'transparency' in image.info
                    image = image.convert('RGBA' if alpha else 'RGB')
                    output_format = 'PNG' if alpha or fmt == 'PNG' else 'JPEG'
                    extension = '.png' if output_format == 'PNG' else '.jpg'
                    for _ in range(12):
                        stream = io.BytesIO()
                        # Retain color profile; use high-quality JPEG without chroma subsampling.
                        image.save(stream, format=output_format, icc_profile=icc,
                                   **({'quality': 95, 'subsampling': 0, 'optimize': True} if output_format == 'JPEG' else {}))
                        binary = stream.getvalue()
                        if len(binary) <= MAX_BYTES:
                            break
                        factor = min(.9, math.sqrt(MAX_BYTES / len(binary)) * .94)
                        image = image.resize(tuple(max(1, round(v * factor)) for v in image.size), Image.Resampling.LANCZOS)
                    else:
                        raise ValueError('图片无法在保留清晰度的情况下适配，请换用较小原图')
                else:
                    binary = path.read_bytes()  # Correct extension without recompressing.
                actual_size = image.size if image is not None else (width, height)
        original = path.with_name(path.stem + uuid.uuid4().hex + path.suffix)
        target = path.with_suffix(extension)
        path.rename(original)
        try:
            target.write_bytes(binary)
        except Exception:
            target.unlink(missing_ok=True)
            original.rename(path)
            raise
        reasons = []
        if mismatch:
            reasons.append('已按真实图片编码识别格式')
        if actual_size != (width, height) or original_size > MAX_BYTES:
            reasons.append(f'已自动适配为 {actual_size[0]} × {actual_size[1]}')
        if orientation != 1:
            reasons.append('已校正照片方向')
        if fmt == 'MPO':
            reasons.append('已将多图层 JPG（MPO）的主照片转换为标准 JPEG')
        elif fmt not in ('JPEG', 'PNG', 'WEBP'):
            reasons.append('已转换为通用图片格式' + ('（使用首帧）' if animated else ''))
        return target, {'original_width': width, 'original_height': height, 'original_bytes': original_size,
                        'message': '；'.join(reasons) + '。原文件已保留，创作使用适配图片。'}, original.name
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
        raise ValueError('无法解码图片内容，文件可能损坏或实际不是图片；请使用能正常打开的 JPEG、PNG 或 WebP 文件') from None
