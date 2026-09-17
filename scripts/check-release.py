"""Run only an isolated child backend from the release; never touch the user's process/data."""
import os,sys,time,socket,subprocess,secrets,re,json
from pathlib import Path
import httpx
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
data=root/'.runtime'/('release-check-'+str(time.time_ns()));data.mkdir()
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
exe=root/'release'/version/'win-unpacked/resources/backend/tijian-service/tijian-service.exe'
child=subprocess.Popen([str(exe)],cwd=root,env={**os.environ,'TIJIAN_DATA':str(data),'TIJIAN_PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=30,trust_env=False) as c:
        for _ in range(100):
            if child.poll() is not None:raise RuntimeError('Packaged backend exited')
            try:
                health=c.get('/api/health').json()
                if health.get('ok'):break
            except httpx.RequestError:pass
            time.sleep(.25)
        assert health['version']==version
        html=c.get('/').text
        assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',html)
        assert assets and all(c.get(x).status_code==200 for x in assets)
        assert c.post('/api/discovery/source',json={'url':'http://127.0.0.1'}).status_code==401
        r=c.post('/api/auth/register',json={'email':'release-check@example.test','password':secrets.token_hex(20),'name':'隔离验收'})
        assert r.status_code==200
        c.headers['Authorization']='Bearer '+r.json()['token']
        assert c.post('/api/discovery/source',json={'url':'http://127.0.0.1/private'}).status_code==400
        feed=c.post('/api/discovery/source',json={'url':'https://www.ruanyifeng.com/blog/atom.xml'}).json()
        assert feed.get('type')=='rss' and feed['items']
        result={'version':version,'health':True,'assets':len(assets),'auth_boundary':True,'private_url_blocked':True,'live_rss_items':len(feed['items'])}
        (data/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result))
finally:
    child.terminate()
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:child.kill();child.wait()
