import time
import pytest
from fastapi.testclient import TestClient
from backend import store as s, gateway, jobs
from backend.app import app, ATTEMPTS

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(s,'DATA',tmp_path)
    monkeypatch.setattr(s,'DB',tmp_path/'test.sqlite')
    monkeypatch.setattr(gateway,'KEYFILE',tmp_path/'provider.key')
    ATTEMPTS.clear()
    with TestClient(app,base_url='http://127.0.0.1') as c:
        yield c

def account(c,email='creator@example.test'):
    r=c.post('/api/auth/register',json={'email':email,'password':'test-password-381','name':'测试创作者'})
    assert r.status_code==200,r.text
    data=r.json();c.headers['Authorization']='Bearer '+data['token']
    assert c.post('/api/workspace',json={}).status_code==200
    return data

def test_auth_isolation_and_admin(client):
    a=account(client)
    source=client.post('/api/import/text',json={'title':'私有资料','body':'用户一的事实'}).json()
    account(client,'second@example.test')
    assert client.get('/api/admin/state').status_code==403
    assert client.patch('/api/objects/'+source['id'],json={'body':'越权'}).status_code==404
    assert source['id'] not in [x['id'] for x in client.get('/api/state').json()['objects']]
    assert client.post('/api/auth/logout').status_code==200
    assert client.get('/api/state').status_code==401

def test_channel_platform_is_immutable_and_owner_scoped(client):
    account(client)
    obj=client.post('/api/objects/channel',json={'title':'运营号','platform':'wechat'}).json()
    assert client.patch('/api/objects/'+obj['id'],json={'title':'新名称'}).status_code==200
    assert client.patch('/api/objects/'+obj['id'],json={'platform':'weibo'}).status_code==400
    assert next(x for x in client.get('/api/state').json()['objects'] if x['id']==obj['id'])['platform']=='wechat'
    account(client,'different@example.test')
    assert client.patch('/api/objects/'+obj['id'],json={'title':'越权'}).status_code==404

def test_draft_concurrency_check_and_restore(client):
    account(client)
    obj=client.post('/api/objects/content',json={'title':'测试文稿','body':'初稿','status':'final','check':{'items':[]}}).json()
    assert obj['status']=='draft' and not obj.get('check')
    changed=client.patch('/api/objects/'+obj['id'],json={'body':'二稿','version':obj['version']}).json()
    assert client.patch('/api/objects/'+obj['id'],json={'body':'旧窗口','version':obj['version']}).status_code==409
    assert client.patch('/api/objects/'+obj['id'],json={'status':'final'}).status_code==409
    versions=client.get('/api/objects/'+obj['id']+'/versions').json()
    first=next(x for x in versions if x['body']=='初稿')
    restored=client.post(f"/api/content/{obj['id']}/restore/{first['version']}").json()
    assert restored['body']=='初稿' and restored['status']=='draft'
    assert client.get(f"/api/content/{obj['id']}/export?format=html").status_code==200

def test_external_file_conflict_does_not_overwrite(client):
    user=account(client)['user']['id']
    obj=client.post('/api/objects/content',json={'title':'文件冲突','body':'应用初稿'}).json()
    path=s.workspace(user)/obj['file'];path.write_text(path.read_text(encoding='utf-8')+'\n外部编辑',encoding='utf-8')
    external=path.read_text(encoding='utf-8')
    assert client.patch('/api/objects/'+obj['id'],json={'body':'应用二稿','version':obj['version']}).status_code==200
    assert path.read_text(encoding='utf-8')==external
    assert any(x['type']=='file_conflict' for x in s.list_(user,'issue'))

def test_background_completion_and_no_fake_model(client,monkeypatch):
    user=account(client)['user']['id']
    s.set_config('settings:'+user,{'auto_memory':False})
    task=client.post('/api/objects/task',json={'title':'写作测试'}).json()
    assert client.post('/api/tasks/'+task['id']+'/send',json={'text':'开始'}).status_code==400
    monkeypatch.setattr(gateway,'select',lambda *a,**kw:'test-only')
    monkeypatch.setattr(gateway,'generate',lambda *a,**kw:'# 测试文稿\n仅用于自动化测试。')
    j=jobs.task_turn(user,task['id'],'写稿')
    for _ in range(100):
        if s.get(user,j['id'])['status'] not in ['queued','running']:break
        time.sleep(.02)
    assert s.get(user,j['id'])['status']=='done'
    assert s.get(user,j['id'])['task_id']==task['id']
    assert not s.get(user,task['id']).get('content_id')
    from backend.artifacts import confirm
    j=confirm(user,task['id'],{})
    for _ in range(100):
        if s.get(user,j['id'])['status'] not in ['queued','running']:break
        time.sleep(.02)
    assert s.get(user,j['id'])['status']=='done'
    assert s.get(user,task['id'])['content_id']

def test_source_url_boundaries(client):
    from backend.network import public_url
    for url in ['http://127.0.0.1/a','file:///etc/passwd','http://user:secret@example.com']:
        with pytest.raises(ValueError):public_url(url)
    assert client.get('/api/state',headers={'Origin':'https://untrusted.example'}).status_code==403

def test_admin_resource_versions_and_user_visibility(client):
    account(client)
    r=client.post('/api/admin/resources',json={'title':'行业写作方法','body':'先列证据，再写观点','purpose':'writing','status':'published'}).json()
    assert r['version']==1
    changed=client.post('/api/admin/resources',json={**r,'body':'先核对时间、地区和来源，再写观点'}).json()
    assert changed['version']==2 and changed['history'][0]['body']=='先列证据，再写观点'
    assert client.post('/api/admin/resources',json=r).status_code==409
    account(client,'reader@example.test')
    assert client.post('/api/admin/resources',json=r).status_code==403
    assert '先核对时间' not in client.get('/api/state').text

def test_external_move_and_restore(client):
    owner=account(client)['user']['id']
    obj=client.post('/api/objects/content',json={'title':'可移动稿件','body':'原有正文'}).json()
    p=s.workspace(owner)/obj['file'];moved=p.with_name('renamed.md');p.rename(moved)
    s.sync_files(owner)
    current=s.get(owner,obj['id']);assert current['file'].endswith('renamed.md') and not current.get('file_missing')
    moved.write_text(moved.read_text(encoding='utf-8').replace('原有正文','外部更新正文'),encoding='utf-8');s.sync_files(owner)
    assert s.get(owner,obj['id'])['body']=='外部更新正文'

def test_knowledge_maintenance_preserves_history(client):
    from backend import maintenance
    owner=account(client)['user']['id']
    record=s.put(owner,'knowledge',{'title':'历史任职','body':'张三在2023年任职A公司','status':'accepted','valid_to':'2023-12-31'})
    assert maintenance.inspect(owner)['created']==1
    assert maintenance.inspect(owner)['created']==0
    assert s.get(owner,record['id'])['body']=='张三在2023年任职A公司'

def test_backup_merge_preserves_existing_and_remaps_sources(client):
    account(client)
    source=client.post('/api/import/text',json={'title':'备份依据','body':'原始记录'}).json()
    obj=client.post('/api/objects/content',json={'title':'备份稿件','body':'有依据的文稿','source_ids':[source['id']]}).json()
    raw=client.get('/api/backup').content
    r=client.post('/api/backup/import',files={'file':('backup.zip',raw,'application/zip')})
    assert r.status_code==200,r.text
    objects=client.get('/api/state').json()['objects']
    restored=next(x for x in objects if x.get('restored_from')==obj['id'])
    assert restored['id']!=obj['id'] and restored['source_ids']!=[source['id']]
    assert next(x for x in objects if x['id']==obj['id'])['body']=='有依据的文稿'
