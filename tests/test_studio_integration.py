import io,json,zipfile
from PIL import Image
from test_workflows import client,account
from backend import store as s

def image_bytes():
    buf=io.BytesIO();Image.new('RGB',(256,256),'green').save(buf,'PNG');return buf.getvalue()

def test_text_draft_database_restore_and_conflict(client):
    account(client)
    item=client.post('/api/studio/text/drafts',json={'tool':'text','title':'测试','input':{'brief':'跨重启保留','format':'口播脚本'}}).json()
    assert item['input']['brief']=='跨重启保留'
    assert client.get('/api/studio/text/drafts').json()['items'][0]['id']==item['id']
    assert client.patch('/api/studio/text/drafts/'+item['id'],json={'version':1,'input':{'brief':'第二版'}}).status_code==200
    assert client.patch('/api/studio/text/drafts/'+item['id'],json={'version':1,'input':{'brief':'覆盖'}}).status_code==409

def test_admin_separation_and_media_internal_fields(client):
    owner=account(client)['user']['id']
    asset=client.post('/api/studio/upload',files={'file':('demo.png',image_bytes(),'image/png')}).json()
    internal=s.get(owner,asset['id'])
    s.put(owner,'studio_asset',{**internal,'remote':{'private':'remote-secret'},'provider_resource_id':'private-id'},asset['id'])
    for path in ['/api/state','/api/search?q=demo','/api/objects/'+asset['id']+'/versions']:
        response=client.get(path);assert response.status_code==200,response.text
        assert 'local_file' not in response.text and 'remote-secret' not in response.text and 'private-id' not in response.text
    account(client,'ordinary@example.test')
    for path in ['/api/admin/state','/api/studio/settings','/api/benchmark-api/settings','/api/admin/capabilities']:
        assert client.get(path).status_code==403
    assert client.get('/api/studio/assets/'+asset['id']+'/file').status_code==404

def test_media_backup_roundtrip_without_remote_authority(client):
    owner=account(client)['user']['id']
    asset=client.post('/api/studio/upload',files={'file':('demo.png',image_bytes(),'image/png')}).json()
    original=s.get(owner,asset['id'])
    s.put(owner,'studio_asset',{**original,'remote':{'x':'remote-secret'},'provider_resource_id':'private-id'},asset['id'])
    brand=client.post('/api/studio/brands',json={'title':'品牌'}).json()
    draft=client.post('/api/studio/drafts',json={'tool':'image_edit','title':'编辑','input':{'prompt':'改颜色','image_id':asset['id']},'brand_id':brand['id']}).json()
    backup=client.get('/api/backup');assert backup.status_code==200,backup.text[:100] if backup.status_code!=200 else ''
    with zipfile.ZipFile(io.BytesIO(backup.content)) as bundle:
        records=bundle.read('records.json').decode()
        assert 'remote-secret' not in records and 'private-id' not in records
    result=client.post('/api/backup/import',files={'file':('backup.zip',backup.content,'application/zip')})
    assert result.status_code==200,result.text
    restored=next(x for x in s.list_(owner,'studio_draft') if x.get('restored_from')==draft['id'])
    assert restored['input']['image_id']!=asset['id']
    file=client.get('/api/studio/assets/'+restored['input']['image_id']+'/file')
    assert file.status_code==200 and file.content==image_bytes()
    assert restored['brand_id']!=brand['id']
