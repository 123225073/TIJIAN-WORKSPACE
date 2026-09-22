"""Download a checksummed Windows FFprobe build into this project's private build cache."""
from pathlib import Path
import hashlib,json,urllib.request,zipfile

root=Path(__file__).resolve().parents[1]/'.runtime'/'media-tools'
root.mkdir(parents=True,exist_ok=True)
base='https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
with urllib.request.urlopen(base+'.sha256',timeout=60) as response:
    expected=response.read().decode().split()[0].lower()
if len(expected)!=64 or any(c not in '0123456789abcdef' for c in expected):raise ValueError('Invalid checksum response')
archive=root/'ffmpeg-release-essentials.zip'
if not archive.exists() or hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()!=expected:
    with urllib.request.urlopen(base,timeout=120) as response, archive.open('wb') as output:
        while chunk:=response.read(1024*1024):output.write(chunk)
with archive.open('rb') as stream:
    if hashlib.file_digest(stream,'sha256').hexdigest()!=expected:raise ValueError('Download checksum mismatch')
with zipfile.ZipFile(archive) as bundle:
    probe=next(x for x in bundle.namelist() if x.endswith('/bin/ffprobe.exe'))
    (root/'ffprobe.exe').write_bytes(bundle.read(probe))
    for name in bundle.namelist():
        if name.endswith('/LICENSE') or name.endswith('/README.txt'):
            (root/Path(name).name).write_bytes(bundle.read(name))
    version=probe.split('/')[0]
(root/'SOURCE.json').write_text(json.dumps({'url':base,'sha256':expected,'build':version,'source':'https://ffmpeg.org/download.html','license':'GPL-3.0-or-later; see bundled LICENSE'},indent=2),encoding='utf-8')
print(json.dumps({'ffprobe':str(root/'ffprobe.exe'),'build':version,'checksum_verified':True}))
