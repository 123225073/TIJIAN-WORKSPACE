from zipfile import ZipFile
import pytest
from fastapi import HTTPException
from backend.frontend_bundle import response


def test_frontend_archive_serves_exact_bytes_without_extracting(tmp_path):
    archive=tmp_path/'ui.zip'
    with ZipFile(archive,'w') as bundle:
        bundle.writestr('index.html',b'<!doctype html><h1>test</h1>')
        bundle.writestr('assets/app.js',b'console.log("test")')
        bundle.writestr('visuals/cover.png',b'png-test-bytes')
    html=response(archive,'index.html')
    assert html.body==b'<!doctype html><h1>test</h1>'
    assert html.headers['content-type'].startswith('text/html')
    assert html.headers['cache-control']=='no-cache'
    script=response(archive,'assets/app.js')
    assert script.body==b'console.log("test")' and 'javascript' in script.headers['content-type']
    assert 'immutable' in script.headers['cache-control']
    assert response(archive,'visuals/cover.png').body==b'png-test-bytes'
    assert list(tmp_path.iterdir())==[archive]


@pytest.mark.parametrize('name',['../secret','/secret','assets/../secret','assets\\secret','assets/missing.js'])
def test_frontend_archive_rejects_missing_or_unsafe_names(tmp_path,name):
    archive=tmp_path/'ui.zip'
    with ZipFile(archive,'w') as bundle:bundle.writestr('index.html','test')
    with pytest.raises(HTTPException) as caught:response(archive,name)
    assert caught.value.status_code==404


@pytest.mark.parametrize('content',[None,b'broken zip',b'%TSD-Header-###%encrypted'])
def test_frontend_archive_failure_has_clear_unavailable_status(tmp_path,content):
    archive=tmp_path/'ui.zip'
    if content is not None:archive.write_bytes(content)
    with pytest.raises(HTTPException) as caught:response(archive,'index.html')
    assert caught.value.status_code==503
