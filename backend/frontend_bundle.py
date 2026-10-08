"""Serve packaged UI bytes from a single archive without extracting files."""
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
from fastapi import HTTPException
from fastapi.responses import Response


def response(archive, name):
    if name.startswith('/') or '\\' in name or '..' in name.split('/'):
        raise HTTPException(404)
    try:
        with ZipFile(archive) as bundle:
            data = bundle.read(name)
    except KeyError:
        raise HTTPException(404) from None
    except (OSError, BadZipFile):
        raise HTTPException(503, '界面资源缺失或无法读取，请重新安装最新版') from None
    # Build assets have known types. Avoid Windows registry MIME discovery on a
    # cold packaged launch (and machine-specific overrides for module scripts).
    media_type = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
                  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
                  '.svg':'image/svg+xml','.gif':'image/gif','.ico':'image/x-icon','.avif':'image/avif',
                  '.woff':'font/woff','.woff2':'font/woff2','.json':'application/json',
                  '.txt':'text/plain','.mp4':'video/mp4'}.get(PurePosixPath(name).suffix.lower(),'application/octet-stream')
    return Response(data, media_type=media_type, headers={
        'Cache-Control': 'public, max-age=31536000, immutable' if name.startswith('assets/') else 'no-cache',
        'X-Content-Type-Options': 'nosniff',
    })
