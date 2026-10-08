"""Read-only Hifly resource media, never synthesis or guessed resource URLs.

The v2 public list currently documents/returns IDs and titles only. Optional
media fields below are observed in Hifly's own public web client (2026-10-09):
https://api.hifly.cc/hifly.html and https://hifly.cc/market/digital
https://hifly.cc/market/voice. Keep only explicit URLs on observed Hifly CDNs;
web resource IDs and v2 IDs are different, so names are never used to join them.
"""
import re
from urllib.parse import unquote, urljoin, urlsplit

import httpx
from fastapi.responses import Response

from . import network


CDN_HOSTS = frozenset({'hfcdn.lingverse.co', 'shortvideo-cdn.lingverse.co', 'fantasy-cdn.lingverse.co'})
MAX_PREVIEW = 64 * 1024 * 1024
OFFICIAL_VIEWS = {'avatar': 'https://hifly.cc/market/digital', 'voice': 'https://hifly.cc/market/voice'}
MIME_TYPES = {
    'image': {'image/png', 'image/jpeg', 'image/webp', 'image/gif'},
    'video': {'video/mp4', 'video/quicktime', 'video/webm'},
    'audio': {'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg'},
}


class PreviewError(ValueError):
    """Only locally authored messages; never remote exception or response text."""


def media_url(value):
    """Syntactic allowlist first; every actual connection also pins public DNS."""
    if not isinstance(value, str) or not value or len(value) > 16000:
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme != 'https' or parts.hostname not in CDN_HOSTS or
                parts.username or parts.password or parts.port not in (None, 443) or
                not parts.path or parts.fragment or re.search(r'[\x00-\x20\x7f\\]', unquote(value))):
            return None
    except ValueError:
        return None
    return value


def metadata(item, asset_type):
    """Store server-side URLs only when the provider supplies them on this row."""
    result = {}
    fields = ('video_url_v2', 'video_url') if asset_type == 'avatar' else ('demo_url', 'audio_url')
    kind = 'video' if asset_type == 'avatar' else 'audio'
    for field in fields:
        url = media_url(item.get(field))
        if url:
            result['media'] = {'url': url, 'asset_type': kind}
            break
    cover_fields = ('snapshot_img_url', 'face_url', 'cover_url', 'group_cover_url') if asset_type == 'avatar' else ('group_cover_url', 'cover_url')
    for field in cover_fields:
        url = media_url(item.get(field))
        if url:
            result['cover'] = {'url': url, 'asset_type': 'image'}
            break
    return result


def pointer(asset, cover=False):
    saved = asset.get('provider_preview')
    if not isinstance(saved, dict):
        return None
    value = saved.get('cover' if cover else 'media')
    if not isinstance(value, dict) or not media_url(value.get('url')):
        return None
    expected = 'image' if cover else 'video' if asset.get('asset_type') == 'avatar' else 'audio'
    return value if value.get('asset_type') == expected else None


def _media_header(data, mime):
    if mime == 'image/png':return data.startswith(b'\x89PNG\r\n\x1a\n')
    if mime == 'image/jpeg':return data.startswith(b'\xff\xd8\xff')
    if mime == 'image/gif':return data.startswith((b'GIF87a', b'GIF89a'))
    if mime == 'image/webp':return data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    if mime in ('audio/wav', 'audio/x-wav'):return data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    if mime == 'audio/ogg':return data.startswith(b'OggS')
    if mime in ('audio/mpeg', 'audio/mp3'):
        return data.startswith(b'ID3') or (len(data) > 1 and data[0] == 255 and data[1] & 224 == 224)
    if mime == 'video/webm':return data.startswith(b'\x1aE\xdf\xa3')
    return data[4:8] == b'ftyp'


def fetch(url, asset_type, range_header=None):
    """Authenticated local proxy; remote hosts receive neither API keys nor cookies.

    Buffer a bounded preview so errors, oversized responses and unexpected HTML
    fail before a success response. Support byte ranges for native audio/video.
    """
    if not media_url(url) or asset_type not in MIME_TYPES:
        raise PreviewError('飞影资源预览地址不可用，请重新同步公共资源')
    request_headers = {}
    if range_header:
        if len(range_header) > 80 or not re.fullmatch(r'bytes=(?:[0-9]+-[0-9]*|-[0-9]+)', range_header):
            raise PreviewError('预览仅支持单段字节范围')
        request_headers['Range'] = range_header
    with httpx.Client(timeout=httpx.Timeout(30, connect=10), follow_redirects=False, trust_env=False) as client:
        for _ in range(4):
            if not media_url(url):
                raise PreviewError('飞影预览跳转地址不受支持，请在官方资源库查看')
            target, host, extensions = network.public_target(url)
            client.cookies.clear()
            with client.stream('GET', target, headers={**request_headers, **host}, extensions=extensions) as response:
                if response.is_redirect:
                    location = response.headers.get('location')
                    if not location:
                        raise PreviewError('飞影资源预览跳转无效')
                    url = urljoin(url, location)
                    continue
                if response.status_code not in (200, 206):
                    raise PreviewError('飞影资源预览暂不可用，请重新同步或在官方资源库查看')
                mime = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
                if mime not in MIME_TYPES[asset_type]:
                    raise PreviewError('飞影未返回对应类型的预览媒体')
                length = response.headers.get('content-length', '')
                if length.isdecimal() and int(length) > MAX_PREVIEW:
                    raise PreviewError('飞影资源预览超过64MB，请在官方资源库查看')
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_PREVIEW:
                        raise PreviewError('飞影资源预览超过64MB，请在官方资源库查看')
                if not data:
                    raise PreviewError('飞影资源预览为空')
                starts_at_zero = response.status_code == 200
                headers = {'Cache-Control': 'private, no-store', 'Vary': 'Authorization',
                           'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes'}
                if response.status_code == 206:
                    value = response.headers.get('content-range', '')
                    match = re.fullmatch(r'bytes ([0-9]+)-([0-9]+)/([0-9]+|\*)', value)
                    if (not range_header or not match or int(match[2]) < int(match[1]) or
                            int(match[2]) - int(match[1]) + 1 != len(data) or
                            (match[3] != '*' and int(match[2]) >= int(match[3]))):
                        raise PreviewError('飞影返回的预览字节范围无效')
                    requested = range_header[6:].split('-')
                    start, end = int(match[1]), int(match[2])
                    total = int(match[3]) if match[3] != '*' else None
                    if (requested[0] and (start != int(requested[0]) or (requested[1] and end > int(requested[1])))) or (
                            not requested[0] and (total is None or start != max(0, total - int(requested[1])) or end != total - 1)):
                        raise PreviewError('飞影返回的预览字节范围不符合请求')
                    starts_at_zero = start == 0
                    headers['Content-Range'] = value
                # Short ranges may be smaller than a header; the decoder will
                # assemble them. Full responses and initial >=12-byte chunks
                # must have real media magic, even if HTML is labelled video.
                if starts_at_zero and (response.status_code == 200 or len(data) >= 12) and not _media_header(data, mime):
                    raise PreviewError('飞影未返回有效的预览媒体内容')
                return Response(bytes(data), status_code=response.status_code, media_type=mime, headers=headers)
    raise PreviewError('飞影预览跳转次数过多，请在官方资源库查看')
