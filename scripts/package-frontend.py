"""Package generated UI as binary archive; reject encrypted build inputs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib,json

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
output = root / '.runtime' / 'desktop-frontend.zip'
assert (dist / 'index.html').is_file()
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as bundle:
    for path in sorted(dist.rglob('*')):
        if not path.is_file():continue
        assert not path.is_symlink() and path.resolve().is_relative_to(dist.resolve())
        data = path.read_bytes()
        if data.startswith(b'%TSD-Header'):
            raise RuntimeError('Build input is not readable plaintext: ' + str(path.relative_to(dist)))
        bundle.writestr(path.relative_to(dist).as_posix(), data)
with ZipFile(output) as bundle:
    assert bundle.read('index.html').lstrip().startswith(b'<!doctype html>')
print(json.dumps({'frontend_bundle':True,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
