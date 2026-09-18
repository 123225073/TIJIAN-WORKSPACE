import io,json,threading
import pytest
from PIL import Image
from test_workflows import client,account
from test_interaction_revision import wait
from backend import store as s,gateway as g,jobs,artifacts,illustrations

def setup(client,monkeypatch,mode='topics'):
    owner=account(client)['user']['id']
    monkeypatch.setattr(g,'select',lambda *a,**k:'fixture')
    monkeypatch.setattr(g,'generate',lambda *a,**k:'# 选题方案\n第一项：项目机会')
    task=s.put(owner,'task',{'title':'选题工作','mode':mode,'messages':[{'role':'user','text':'整理选题'},{'role':'assistant','text':'第一项：项目机会'}]})
    return owner,task

@pytest.mark.parametrize('mode',list(artifacts.LABELS))
def test_every_mode_explicit_outcome(client,monkeypatch,mode):
    owner,task=setup(client,monkeypatch,mode)
    job=client.post('/api/tasks/'+task['id']+'/outcome',json={}).json()
    assert wait(owner,job)['status']=='done'
    result=s.get(owner,s.get(owner,task['id'])['content_id'])
    assert result['outcome_type']==mode and result['body'].startswith('# 选题')
    assert not s.list_(owner,'source')
    again=client.post('/api/tasks/'+task['id']+'/outcome',json={'version':result['version']}).json()
    assert again['unchanged']

def test_edited_baseline_handoff_and_conflict(client,monkeypatch):
    owner,task=setup(client,monkeypatch)
    assert wait(owner,artifacts.confirm(owner,task['id'],{}))['status']=='done'
    original=s.get(owner,s.get(owner,task['id'])['content_id'])
    edited=s.put(owner,'content',{**original,'body':'# 手改方案\n人工保留说明'},original['id'])
    requests=[]
    monkeypatch.setattr(g,'generate',lambda m,r:(requests.append(r),'追加了新要求')[1])
    assert wait(owner,jobs.task_turn(owner,task['id'],'增加第二项',mode='topics'))['status']=='done'
    assert any('人工保留说明' in r[1]['content'] for r in requests)
    assert s.get(owner,original['id'])['body']==edited['body']
    next_task=client.post('/api/content/'+edited['id']+'/write',json={'brief':'根据第二项写文章','version':edited['version']}).json()
    assert next_task['upstream_body']==edited['body'] and next_task['mode']=='writing'
    assert wait(owner,jobs.task_turn(owner,next_task['id'],'写文章',mode='writing'))['status']=='done'
    assert '人工保留说明' in requests[-1][1]['content']
    entered=threading.Event();release=threading.Event()
    def generate(m,r):requests.append(r);entered.set();release.wait(4);return '新版成果'
    monkeypatch.setattr(g,'generate',generate)
    job=artifacts.confirm(owner,task['id'],{'version':edited['version']});assert entered.wait(3)
    assert '人工保留说明' in requests[-1][1]['content']
    newer=s.put(owner,'content',{**edited,'body':'生成期间的人工修改'},edited['id']);release.set()
    assert wait(owner,job)['status']=='failed'
    assert s.get(owner,edited['id'])['body']==newer['body']

def picture():
    buf=io.BytesIO();Image.new('RGB',(32,32),'green').save(buf,format='PNG');return buf.getvalue()

def test_image_upload_insert_export_auth_and_backup(client,monkeypatch):
    owner,task=setup(client,monkeypatch,'writing');assert wait(owner,artifacts.confirm(owner,task['id'],{}))['status']=='done'
    content=s.get(owner,s.get(owner,task['id'])['content_id']);url='/api/content/'+content['id']+'/illustrations'
    assert client.post(url+'/upload',files={'file':('bad.svg',b'<svg/>','image/svg+xml')}).status_code==400
    pic=client.post(url+'/upload',files={'file':('pic.png',picture(),'image/png')}).json()['illustration_id']
    assert 'data_uri' not in next(x for x in client.get('/api/state').json()['objects'] if x['id']==pic)
    args={'illustration_id':pic,'version':content['version'],'position':len(content['body'])}
    inserted=client.post(url+'/insert',json=args);assert inserted.status_code==200,inserted.text
    assert '/api/illustrations/'+pic+'/file' in inserted.json()['body']
    assert client.post(url+'/insert',json=args).status_code==409
    for format in ['md','html']:
        result=client.get('/api/content/'+content['id']+'/export?format='+format)
        assert 'data:image/png;base64,' in result.text
    backup=client.get('/api/backup').content
    assert client.post('/api/backup/import',files={'file':('backup.zip',backup,'application/zip')}).status_code==200
    restored=next(x for x in s.list_(owner,'content') if x.get('restored_from')==content['id'])
    assert pic not in restored['body'] and 'data:image/png' in illustrations.expanded(owner,restored['body'])
    account(client,'other-pic@example.test')
    assert client.get('/api/illustrations/'+pic+'/file').status_code==404

def test_image_generation_contract_and_no_write_until_insert(client,monkeypatch):
    owner,task=setup(client,monkeypatch,'writing');assert wait(owner,artifacts.confirm(owner,task['id'],{}))['status']=='done'
    content=s.get(owner,s.get(owner,task['id'])['content_id'])
    monkeypatch.setattr(g,'model_record',lambda id:({'capability':'image','verified':True,'published':True},{}))
    monkeypatch.setattr(illustrations,'generate',lambda *a:illustrations.image_uri(picture()))
    job=client.post('/api/content/'+content['id']+'/illustrations',json={'model_id':'fixture','prompt':'结构示意图'}).json()
    result=wait(owner,job);assert result['status']=='done'
    assert result['result']['illustration_id'] and s.get(owner,content['id'])['body']==content['body']

def test_provider_preset_and_isolation(client,monkeypatch):
    account(client)
    s.set_config('providers',[{'id':'a','title':'CPA','base_url':'https://example.com','protocol':'chat','secret':'encrypted'}])
    s.set_config('models',[{'id':'a1','provider':'a','title':'same','model':'same','capability':'text','published':False,'verified':False}])
    state=client.get('/api/admin/state').json();preset=next(p for p in state['providers'] if p['id']=='preset-deepseek')
    assert not preset['has_key'] and 'platform.deepseek.com' in preset['api_key_url']
    assert not any('secret' in p for p in state['providers'])
    s.set_config('providers',s.config('providers')+[{'id':'existing','title':'我的DeepSeek','base_url':'https://api.deepseek.com/v1','protocol':'chat','secret':'keep'}])
    assert not any(p.get('preset') for p in g.public_providers())
    assert s.config('providers')[1]['secret']=='keep'
