"""Behavior checks for natural chat, identity gating and isolated platform outcomes."""
import json
import re
from test_workflows import client,account
from test_interaction_revision import wait
from backend import store as s, gateway as g, assistant_workspace as aw, capabilities, wechat_layout, media_studio

def setup(client,monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(g,'select',lambda *a,**kw:'isolated-test')
    task=client.post('/api/tasks/open',json={'title':'工作对话','mode':'auto'}).json()
    captured=[]
    def generate(model,messages):
        system=messages[0]['content'];payload=json.loads(messages[1]['content']) if '需求识别器' in system or '只返回JSON对象' in system else None
        captured.append(messages)
        if '需求识别器' in system:
            text=payload['最新用户请求']
            action='image' if '生成图片' in text else 'video' if '生成视频' in text else 'chat' if text=='你好' else 'text'
            platforms=['moments'] if '朋友圈' in text else ['xiaohongshu'] if '小红书' in text else ['channels'] if '脚本' in text else ['wechat']
            if '都写' in text:platforms=['wechat','moments']
            return json.dumps({'action':action,'platforms':platforms if action=='text' else [],'brief':text},ensure_ascii=False)
        if '只返回JSON对象' in system:
            return json.dumps({'title':payload['平台']+'隔离测试稿','body':'具体正文。\n\n第二段。 ['+'a'*32+']',
                'summary':'概括读者收获','cover_brief':'电梯门与项目现场的示意画面','caption':'发布文案','script':'口播稿','shotlist':'镜头一：电梯门','tags':'电梯'},ensure_ascii=False)
        return '普通问答，不创作成品'
    monkeypatch.setattr(g,'generate',generate)
    return owner,task,captured,generate

def send(client,owner,task,text,**extra):
    response=client.post('/api/tasks/'+task['id']+'/send',json={'text':text,'mode':'auto',**extra})
    assert response.status_code==200,response.text
    result=wait(owner,response.json())
    assert result['status']=='done',result
    return s.get(owner,task['id'])

def test_plain_chat_and_capability_question_do_not_generate_or_gate(client,monkeypatch):
    owner,task,_,_=setup(client,monkeypatch)
    task=send(client,owner,task,'你好')
    assert not task.get('identity_required') and not s.list_(owner,'content')
    # The fixture deliberately misclassifies this as text: the server guard wins.
    send(client,owner,task,'公众号文章怎么用？')
    send(client,owner,task,'请先不要写公众号文章',skip_profile=True)
    send(client,owner,task,'请解释如何写公众号文章',skip_profile=True)
    assert not s.list_(owner,'content')

def test_identity_gate_skip_and_multiple_platforms_survive(client,monkeypatch):
    owner,task,captured,_=setup(client,monkeypatch)
    task=send(client,owner,task,'帮我写公众号文章，电梯报价500字')
    assert task['identity_required'] and not s.list_(owner,'content')
    assert task['pending_creation']['brief']=='帮我写公众号文章，电梯报价500字'
    task=send(client,owner,task,'不需要身份，继续')
    assert task['identity_skipped'] and not task['identity_required']
    first=s.get(owner,task['platform_outcomes']['wechat'])
    assert first['summary'] and first['cover_brief'] and '['+'a'*32+']' not in first['body']
    patch=client.patch('/api/tasks/'+task['id']+'/outcomes/'+first['id'],json={'version':first['version'],'body':'人工保留的公众号正文'})
    assert patch.status_code==200
    task=send(client,owner,task,'再写朋友圈文案')
    assert set(task['platform_outcomes'])=={'wechat','moments'}
    assert s.get(owner,first['id'])['body']=='人工保留的公众号正文'
    assert task['active_outcome']=='moments'
    task=send(client,owner,task,'改短公众号正文')
    payload=json.loads(next(m[1]['content'] for m in reversed(captured) if '只返回JSON对象' in m[0]['content']))
    assert payload['当前权威底稿']['body']=='人工保留的公众号正文'
    assert len(s.list_(owner,'content'))==2 and task['platform_outcomes']['wechat']==first['id']

def test_selected_identity_and_atomic_multi_platform_failure(client,monkeypatch):
    owner,task,_,generate=setup(client,monkeypatch)
    profile=s.put(owner,'profile',{'title':'真实身份','position':'电梯服务','audience':'物业经理'})
    task=send(client,owner,task,'帮我公众号和朋友圈都写',profile_id=profile['id'])
    ids=task['platform_outcomes'];assert set(ids)=={'wechat','moments'}
    versions={p:s.get(owner,id)['version'] for p,id in ids.items()}
    count=0
    def concurrent(model,messages):
        nonlocal count
        if '只返回JSON对象' in messages[0]['content']:
            count+=1
            if count==2:
                old=s.get(owner,ids['wechat']);s.put(owner,'content',{**old,'body':'另一窗口的人工修改'},old['id'])
        return generate(model,messages)
    monkeypatch.setattr(g,'generate',concurrent)
    job=client.post('/api/tasks/'+task['id']+'/send',json={'text':'再帮我公众号和朋友圈都写','mode':'auto','profile_id':profile['id']}).json()
    result=wait(owner,job);assert result['status']=='failed'
    assert s.get(owner,ids['wechat'])['body']=='另一窗口的人工修改'
    assert s.get(owner,ids['moments'])['version']==versions['moments']

def test_unknown_action_and_cross_owner_never_write(client,monkeypatch):
    owner,task,_,_=setup(client,monkeypatch)
    monkeypatch.setattr(g,'generate',lambda *a:json.dumps({'action':'publish','platforms':[],'brief':'执行发布'}))
    result=client.post('/api/tasks/'+task['id']+'/send',json={'text':'写文章','mode':'auto','skip_profile':True}).json()
    assert wait(owner,result)['status']=='failed' and not s.list_(owner,'content')
    content=s.put(owner,'content',{'title':'本人成果','body':'正文','task_id':task['id']})
    account(client,'other-workspace@example.test')
    response=client.patch('/api/tasks/'+task['id']+'/outcomes/'+content['id'],json={'version':content['version'],'body':'越权'})
    assert response.status_code==404 and s.get(owner,content['id'])['body']=='正文'

def test_media_plan_is_local_and_requires_generation_confirmation(client,monkeypatch):
    owner,task,_,_=setup(client,monkeypatch)
    monkeypatch.setattr(media_studio,'save_draft',lambda owner,data:s.put(owner,'studio_draft',data))
    calls=[];monkeypatch.setattr(media_studio,'generate',lambda *a,**k:calls.append(a))
    task=send(client,owner,task,'帮我生成图片：豪华电梯门',skip_profile=True)
    assert task['media_outcomes']['image'] and not calls
    assert not task.get('platform_outcomes')
    draft=s.get(owner,task['media_outcomes']['image'])
    assert draft['input']['prompt']=='帮我生成图片：豪华电梯门'

def test_reader_facing_layout_and_builtin_methods(client):
    body='第一段 ['+'b'*32+']\n\n1. 查公告\n\n核对范围。\n\n2. 查更新需求\n\n核对现场。\n\n3. 联系项目方\n\n[实际来源](https://example.com/source)'
    html=wechat_layout.render(body)
    assert 'b'*32 not in html and 'https://example.com/source' in html
    assert re.findall(r'>(\d+)\.</span>',html)==['1','2','3']
    assert 'text-align:justify' not in html and 'letter-spacing:0' in html
    skills={x['id']:x for x in capabilities.list_()}
    assert skills['skill:humanizer']['status']=='published'
    assert '不编造第一人称' in skills['skill:wechat-editor']['body']
    assert 'Humanizer' in capabilities.snapshot('writing')['text']

def test_export_embeds_owned_local_images_for_offline_reading(client,monkeypatch):
    import io
    from PIL import Image
    from fastapi import UploadFile
    owner,task,_,_=setup(client,monkeypatch)
    binary=io.BytesIO();Image.new('RGB',(40,20),'#103f2c').save(binary,format='PNG');binary.seek(0)
    asset=media_studio.upload(owner,UploadFile(binary,filename='local-cover.png'))
    content=s.put(owner,'content',{'title':'本地图文','task_id':task['id'],'body':'正文 ['+'a'*32+']\n\n![现场图](/api/studio/assets/'+asset['id']+'/file)'})
    response=client.get('/api/content/'+content['id']+'/export?format=html')
    assert response.status_code==200 and 'data:image/png;base64,' in response.text
    assert '/api/studio/assets/' not in response.text and 'a'*32 not in response.text
    other=account(client,'export-other@example.test')['user']['id']
    forged=s.put(other,'content',{'title':'不可越权','body':'![图](/api/studio/assets/'+asset['id']+'/file)'})
    assert client.get('/api/content/'+forged['id']+'/export?format=html').status_code==404
