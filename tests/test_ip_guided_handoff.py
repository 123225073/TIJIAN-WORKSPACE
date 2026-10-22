"""Unified IP guidance uses disposable API/SQLite state, never a live provider."""
import json
import sqlite3

import pytest

from backend import gateway as g, store as s, ip_questionnaire as ipq
from test_workflows import client, account
from test_creation import finish
from test_ip_questionnaire import all_answers, generate_report, report


def local_models(monkeypatch, seen=None):
    s.set_config('bindings', {'profile': 'admin-default', 'writing': 'admin-default'})
    def select(owner, purpose, chosen=None):
        if chosen=='unavailable':raise ValueError('模型不可用')
        return chosen or 'admin-default'
    def generate(mid, messages):
        if seen is not None:seen.append((mid,messages))
        return json.dumps(report(),ensure_ascii=False)
    monkeypatch.setattr(g,'select',select)
    monkeypatch.setattr(g,'generate',generate)


def open_session(client, **data):
    response=client.post('/api/studio/interviews',json={'type':'profile',**data})
    assert response.status_code==200,response.text
    return response.json()


def test_standalone_entrance_resumes_progress_and_keeps_old_targets(client, monkeypatch):
    owner=account(client)['user']['id']
    monkeypatch.setattr(g,'generate',lambda *args:pytest.fail('Opening/answering must not call a model'))
    old=s.put(owner,'profile',{'title':'原身份','body':'旧正文','status':'accepted','custom':'保留'})
    for target in ('',old['id']):
        row=open_session(client,target_id=target)
        response=client.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':'answer','answer':'本地物业'})
        assert response.status_code==200
        resumed=open_session(client,target_id=target)
        assert resumed['id']==row['id'] and resumed['question_index']==1
        assert resumed['answers']=={'customers':'本地物业'}
    assert len(s.list_(owner,'studio_interview'))==2 and s.get(owner,old['id'])==old
    changed=s.put(owner,'profile',{**old,'style':'另一个窗口的修改'},old['id'],old['version'])
    fresh=open_session(client,target_id=old['id'])
    assert fresh['id']!=row['id'] and fresh['target_version']==changed['version']
    assert s.get(owner,row['id'])['answers']=={'customers':'本地物业'}


def test_profile_api_handoff_needs_no_model_and_preserves_other_outcomes(client, monkeypatch):
    owner=account(client)['user']['id']
    before=s.list_(owner,'profile')
    task=s.put(owner,'task',{'title':'新IP','messages':[],'source_ids':[],
                           'platform_outcomes':{'wechat':'existing-content'},'media_outcomes':{'image':'existing-draft'},'content_id':'existing-content'})
    monkeypatch.setattr(g,'select',lambda *args,**kwargs:pytest.fail('Question start needs no configured model'))
    monkeypatch.setattr(g,'generate',lambda *args:pytest.fail('Question start needs no provider'))
    response=client.post('/api/tasks/'+task['id']+'/send',json={'text':'帮我建立一个新IP','mode':'profile'})
    assert response.status_code==200,response.text
    done=finish(client,response.json());assert done['status']=='done',done
    current=s.get(owner,task['id']);row=s.get(owner,current['ip_interview_id'])
    assert done['result']['interview_id']==row['id'] and row['answers']=={} and row['question_index']==0
    assert current['platform_outcomes']==task['platform_outcomes'] and current['media_outcomes']==task['media_outcomes']
    assert current['content_id']==task['content_id'] and current['active_outcome']=='profile'
    assert not current.get('agent_proposal') and s.list_(owner,'profile')==before


def test_selected_model_persists_create_answer_report_and_rejects_invalid_choice(client, monkeypatch):
    owner=account(client)['user']['id'];seen=[];local_models(monkeypatch,seen)
    row=open_session(client,model_id='selected-first')
    assert row['model_id']=='selected-first'
    response=client.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':'selected-answer','answer':'本地物业','model_id':'selected-next'})
    assert response.status_code==200
    row=s.get(owner,row['id']);assert row['model_id']=='selected-next'
    bad=client.post('/api/studio/interviews',json={'type':'profile','model_id':'unavailable'})
    assert bad.status_code==400 and s.get(owner,row['id'])==row
    for index in range(1,12):
        response=client.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':'step-'+str(index),'answer':'不知道'})
        assert response.status_code==200
        row=s.get(owner,row['id'])
    done,row=generate_report(client,owner,row)
    assert done['status']=='done' and seen[0][0]=='selected-next'
    assert row['model_id']=='selected-next' and row['fields']['body'].startswith('# 我的定位 · IP 定位报告\n')


def test_report_uses_chat_as_labeled_context_and_confirmation_is_atomic(client, monkeypatch):
    owner=account(client)['user']['id'];seen=[];local_models(monkeypatch,seen)
    source=s.put(owner,'source',{'title':'已选资料','body':'真实参考'})
    old=s.put(owner,'profile',{'title':'参考身份','body':'原档案','status':'accepted'})
    before=s.list_(owner,'profile')
    task=s.put(owner,'task',{'title':'新定位','profile_id':old['id'],'source_ids':[source['id']],
                           'messages':[{'role':'assistant','text':'可以有十年经验吗？'},{'role':'user','text':'请新建一个IP；我服务物业，但从未说有十年经验。'}]})
    row=open_session(client,source_task_id=task['id'],operation='create')
    assert row['answers']=={} and row['original']=={} and row['reference_profile']['id']==old['id']
    assert open_session(client,source_task_id=task['id'])['id']==row['id']
    row=all_answers(client,owner,row);done,row=generate_report(client,owner,row)
    assert done['status']=='done',done
    request=json.loads(seen[0][1][1]['content'].split('：',1)[1])
    assert request['十二题回答'][0]['回答']=='主要客户是物业公司'
    assert '从未说有十年经验' in json.dumps(request,ensure_ascii=False)
    assert '不是十二题答案' in json.dumps(request,ensure_ascii=False)
    assert s.list_(owner,'profile')==before
    # Force the final task row to fail after profile/topics were inserted.
    with s.conn() as connection:
        connection.execute("CREATE TRIGGER reject_ip_task BEFORE INSERT ON objects WHEN NEW.kind='task' AND NEW.id='"+task['id']+"' BEGIN SELECT RAISE(ABORT,'isolated rollback'); END")
    fields={**row['fields'],'title':'人工核对名称','body':report()['body']}
    url='/api/studio/interviews/'+row['id']+'/apply'
    with pytest.raises(sqlite3.IntegrityError):client.post(url,json={'version':row['version'],'fields':fields})
    assert s.list_(owner,'profile')==before and not s.list_(owner,'studio_topic')
    assert s.get(owner,row['id'])['status']=='review' and s.get(owner,task['id'])['profile_id']==old['id']
    with s.conn() as connection:connection.execute('DROP TRIGGER reject_ip_task')
    applied=client.post(url,json={'version':row['version'],'fields':fields})
    assert applied.status_code==200,applied.text
    saved=applied.json();current=s.get(owner,task['id'])
    assert saved['id']!=old['id'] and saved['source_ids']==[task['id']]
    assert current['profile_id']==saved['id'] and current['source_ids']==[source['id']]
    assert saved['body']==ipq.report_body(report()['body'],'人工核对名称')
    assert saved['body'].count('# 人工核对名称 · IP 定位报告')==1
    assert s.get(owner,old['id'])==old and s.sync_files(owner)==0
    assert client.post(url,json={}).json()['id']==saved['id']


def test_changed_task_during_report_cannot_commit_old_result(client, monkeypatch):
    owner=account(client)['user']['id'];local_models(monkeypatch)
    before=s.list_(owner,'profile')
    task=s.put(owner,'task',{'title':'定位','source_ids':[],'messages':[{'role':'user','text':'请新建IP'}]})
    row=all_answers(client,owner,open_session(client,source_task_id=task['id']))
    def changed(mid,messages):
        current=s.get(owner,task['id'])
        s.put(owner,'task',{**current,'messages':current['messages']+[{'role':'user','text':'先不要确认，我还要改业务方向'}]},task['id'],current['version'])
        return json.dumps(report(),ensure_ascii=False)
    monkeypatch.setattr(g,'generate',changed)
    done,after=generate_report(client,owner,row)
    assert done['status']=='failed' and after['status']=='ready_report' and not after.get('fields')
    assert after['answers']==row['answers'] and s.list_(owner,'profile')==before


def test_source_task_and_target_are_owned_and_session_rebinding_blocks_apply(client, monkeypatch):
    owner=account(client)['user']['id'];local_models(monkeypatch)
    before=s.list_(owner,'profile')
    foreign=s.put('another-owner','task',{'messages':[]})
    foreign_profile=s.put('another-owner','profile',{'title':'其他用户'})
    for data in ({'source_task_id':foreign['id']},{'target_id':foreign_profile['id']}):
        assert client.post('/api/studio/interviews',json={'type':'profile',**data}).status_code==404
    assert not s.list_(owner,'studio_interview')
    task=s.put(owner,'task',{'title':'定位','source_ids':[],'messages':[{'role':'user','text':'请新建IP'}]})
    row=all_answers(client,owner,open_session(client,source_task_id=task['id']))
    done,row=generate_report(client,owner,row);assert done['status']=='done'
    current=s.get(owner,task['id']);s.put(owner,'task',{**current,'ip_interview_id':'different-session'},task['id'],current['version'])
    response=client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':row['version'],'fields':row['fields']})
    assert response.status_code==409 and s.list_(owner,'profile')==before and not s.list_(owner,'studio_topic')


def test_reprepare_after_reference_change_keeps_answers_and_rebinds_session(client, monkeypatch):
    owner=account(client)['user']['id'];local_models(monkeypatch)
    first=s.put(owner,'profile',{'title':'第一份参考身份','body':'旧参考正文','status':'accepted'})
    replacement=s.put(owner,'profile',{'title':'用户新选参考身份','body':'新参考正文','status':'accepted'})
    task=s.put(owner,'task',{'title':'新增定位','profile_id':first['id'],'source_ids':[],
                           'messages':[{'role':'user','text':'请新建IP，原身份仅供参考'}]})
    row=all_answers(client,owner,open_session(client,source_task_id=task['id']))
    done,row=generate_report(client,owner,row);assert done['status']=='done'
    current=s.get(owner,task['id'])
    s.put(owner,'task',{**current,'profile_id':replacement['id']},task['id'],current['version'])
    assert client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':row['version'],'fields':row['fields']}).status_code==409
    recovered=open_session(client,source_task_id=task['id'])
    assert recovered['id']==row['id'] and recovered['answers']==row['answers'] and recovered['question_index']==12
    assert recovered['profile_binding']['reference_profile_id']==replacement['id']
    assert recovered['reference_profile']['id']==replacement['id'] and recovered['reference_profile']['body']=='新参考正文'
    assert recovered['status']=='ready_report' and recovered['report_invalidated'] is True and not recovered.get('fields')
    done,recovered=generate_report(client,owner,recovered);assert done['status']=='done',done
    response=client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':recovered['version'],'fields':recovered['fields']})
    assert response.status_code==200,response.text
    assert response.json()['id'] not in {first['id'],replacement['id']}
    assert s.get(owner,first['id'])==first and s.get(owner,replacement['id'])==replacement
