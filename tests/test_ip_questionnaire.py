import json
import pytest
from test_workflows import client, account
from test_creation import fake_model, finish
from backend import store as s, gateway as g, ip_questionnaire as ipq


def create(c, **extra):
    r=c.post('/api/studio/interviews',json={'type':'profile',**extra})
    assert r.status_code==200,r.text
    return r.json()


def answer(c,row,value='不知道',request=None):
    return c.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':request or 'answer-'+str(row['version']),'answer':value})


def all_answers(c,owner,row):
    for index in range(12):
        assert row['question_index']==index
        assert ipq.QUESTIONS[index][1] in row['messages'][-1]['content']
        assert answer(c,row,'主要客户是物业公司' if index==0 else '不知道').status_code==200
        row=s.get(owner,row['id'])
    return row


def report():
    # Fixture output: not a real model quality acceptance.
    return {'title':'我的定位','position':'服务本地业主','body':'\n\n'.join('## '+h+'\n基于回答的建议；未知信息【待确认】，向负责人核实。' for h in ipq.REPORT_SECTIONS),'topic_candidates':[{'title':'选梯先核对使用场景','angle':'建议到获授权展厅拍摄，具体场地待确认'},{'title':'报价单上先看哪些项目','angle':'不得公开未授权报价；先向公司确认可公开项目'}]}


def generate_report(c,owner,row):
    r=c.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':'report-'+str(row['version']),'summarize':True,'answer':''})
    assert r.status_code==200,r.text
    job=finish(c,r.json())
    return job,s.get(owner,row['id'])


def test_exact_questions_match_feedback_source():
    # Immutable approved question wording, including order, is the API contract.
    assert len(ipq.QUESTIONS)==12 and len({q[0] for q in ipq.QUESTIONS})==12
    assert ipq.QUESTIONS[0][1].startswith('你的电梯主要卖给谁？')
    assert ipq.QUESTIONS[-1][1]=='有没有绝对不能碰的？比如不能露品牌名、不能露价格、公司不允许。'
    assert all(q[2] and q[4] for q in ipq.QUESTIONS)


def test_twelve_steps_are_deterministic_persistent_and_never_call_model(client,monkeypatch):
    owner=account(client)['user']['id']
    original_profiles=s.list_(owner,'profile')
    monkeypatch.setattr(g,'generate',lambda *a:pytest.fail('Questions must not invoke AI'))
    row=create(client);url='/api/studio/interviews/'+row['id']
    assert row['version']==1 and len(row['messages'])==1
    assert client.post(url+'/turn',json={'version':1,'request_id':'early','summarize':True}).status_code==400
    assert answer(client,row,'').status_code==400
    r=answer(client,row,'不知道','same');assert r.status_code==200
    assert answer(client,row,'不知道','same').status_code==200
    assert answer(client,row,'篡改','same').status_code==409
    assert answer(client,row,'旧窗口','new-request').status_code==409
    row=s.get(owner,row['id']);assert row['question_index']==1
    for index in range(1,12):
        assert ipq.QUESTIONS[index][1] in row['messages'][-1]['content']
        assert answer(client,row).status_code==200
        row=next(x for x in client.get('/api/studio/interviews').json()['items'] if x['id']==row['id'])
        assert row['question_index']==index+1
    assert row['status']=='ready_report' and len(row['answers'])==12
    assert answer(client,row,'再问').status_code==400
    assert s.list_(owner,'profile')==original_profiles and not s.list_(owner,'job')


def test_report_prompt_eight_sections_unknowns_and_confirm_only(client,monkeypatch):
    owner=account(client)['user']['id'];seen=[]
    original_profiles=s.list_(owner,'profile')
    fake_model(monkeypatch,lambda mid,messages:(seen.append(messages) or json.dumps(report(),ensure_ascii=False)))
    row=all_answers(client,owner,create(client))
    job,row=generate_report(client,owner,row)
    assert job['status']=='done',job
    assert row['status']=='review' and s.list_(owner,'profile')==original_profiles
    prompt=seen[0][0]['content']
    assert all(h in prompt for h in ipq.REPORT_SECTIONS)
    assert '每根' in prompt and '10条具体选题' in prompt
    assert '不得为了满足报告格式补造数字' in prompt and '已明确允许' not in prompt
    context=json.loads(seen[0][1]['content'].split('：',1)[1])
    assert len(context['十二题回答'])==12 and context['十二题回答'][0]['回答']=='主要客户是物业公司'
    assert all(x['回答']=='不知道' for x in context['十二题回答'][1:])
    url='/api/studio/interviews/'+row['id']+'/apply'
    bad={**row['fields'],'body':'## 一、一句话定位\n不完整'}
    assert client.post(url,json={'version':row['version'],'fields':bad}).status_code==400
    applied=client.post(url,json={'version':row['version'],'fields':row['fields']})
    assert applied.status_code==200,applied.text
    item=applied.json();assert item['status']=='accepted' and item['body']==report()['body']
    assert item['questionnaire_answers']==row['answers']
    topics=[s.get(owner,tid) for tid in item['positioning_topic_ids']]
    assert len(topics)==2 and all(t['profile_id']==item['id'] and t['status']=='idea' for t in topics)
    assert [dict(title=t['title'],angle=t['angle']) for t in topics]==report()['topic_candidates']
    assert all(t['source_interview_id']==row['id'] for t in topics)
    assert client.post(url,json={}).json()['id']==item['id']
    assert {t['id'] for t in s.list_(owner,'studio_topic') if t.get('source_interview_id')==row['id']}=={t['id'] for t in topics}
    assert len(s.list_(owner,'profile'))==len(original_profiles)+1 and len(seen)==1


def test_failed_report_keeps_all_answers_for_retry(client,monkeypatch):
    owner=account(client)['user']['id'];fake_model(monkeypatch,lambda *a:json.dumps({'title':'不完整','body':'只有一段'}))
    row=all_answers(client,owner,create(client));before=row.copy()
    job,row=generate_report(client,owner,row)
    assert job['status']=='failed' and row['answers']==before['answers']
    assert row['status']=='ready_report' and row['version']==before['version']
    monkeypatch.setattr(g,'generate',lambda *a:json.dumps(report(),ensure_ascii=False))
    r=client.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':row['version'],'request_id':'explicit-retry','summarize':True})
    assert finish(client,r.json())['status']=='done'


def test_report_headings_with_copied_requirements_are_normalized_without_another_call(client,monkeypatch):
    owner=account(client)['user']['id'];calls=[]
    returned=report()
    requirements=[line for line in ipq.REPORT_RULES.splitlines() if line.startswith(tuple('一二三四五六七八'))]
    assert len(requirements)==8
    returned['body']='\n\n'.join('## '+heading+'\n第'+str(index+1)+'段实际建议；未知【待确认】。'
                                  for index,heading in enumerate(requirements))
    fake_model(monkeypatch,lambda *args:(calls.append(args) or json.dumps(returned,ensure_ascii=False)))
    row=all_answers(client,owner,create(client));before=row['answers'].copy()
    job,row=generate_report(client,owner,row)
    assert job['status']=='done',job
    assert len(calls)==1 and row['status']=='review' and row['answers']==before
    body=row['fields']['body']
    assert [line for line in body.splitlines() if line.startswith('## ')]==['## '+h for h in ipq.REPORT_SECTIONS]
    assert all('第'+str(index+1)+'段实际建议' in body for index in range(8))
    # An annotation may contain useful information: preserve it as normal text.
    assert all(line.split('：',1)[1] in body for line in requirements)
    assert row['topic_candidates']==returned['topic_candidates']
    assert ipq.validate_report(body)==body


@pytest.mark.parametrize('heading',[
    lambda h:'## '+h+'：具体建议',
    lambda h:'## **'+h+'**',
    lambda h:'## **'+h+'**：具体建议',
    lambda h:h.replace('30 天','30天')+':',
])
def test_report_heading_format_variants_preserve_content(heading):
    body='\n\n'.join(heading(h)+'\n已知事实与待确认建议。' for h in ipq.REPORT_SECTIONS)
    normalized=ipq.validate_report(body)
    assert [line for line in normalized.splitlines() if line.startswith('## ')]==['## '+h for h in ipq.REPORT_SECTIONS]
    assert normalized.count('已知事实与待确认建议。')==8


def test_report_heading_annotation_keeps_its_original_emphasis():
    body='\n\n'.join('## '+h+'：请保留**用户原始边界**\n实际建议。' for h in ipq.REPORT_SECTIONS)
    assert ipq.validate_report(body).count('请保留**用户原始边界**')==8


@pytest.mark.parametrize('defect',['missing','duplicate','out_of_order','empty','annotation_only','renamed'])
def test_report_normalization_never_masks_missing_or_invalid_sections(defect):
    sections=['## '+h+'\n实际建议。' for h in ipq.REPORT_SECTIONS]
    if defect=='missing':sections.pop(3)
    elif defect=='duplicate':sections.insert(2,sections[1])
    elif defect=='out_of_order':sections[0],sections[1]=sections[1],sections[0]
    elif defect=='empty':sections[3]='## '+ipq.REPORT_SECTIONS[3]
    elif defect=='annotation_only':sections[3]='## '+ipq.REPORT_SECTIONS[3]+'：这是写作要求，不是正文'
    elif defect=='renamed':sections[3]='## 四、其他身份\n实际建议。'
    with pytest.raises(ValueError):ipq.validate_report('\n\n'.join(sections))


def test_manual_draft_confirm_version_and_user_isolation(client):
    owner=account(client)['user']['id'];url='/api/studio/ip-questionnaire/profile'
    questions=client.get('/api/studio/ip-questionnaire').json()['questions']
    assert len(questions)==12 and all(q['reference'] for q in questions)
    answers={q['key']:'不知道【待确认】' for q in questions}
    data={'version':0,'fields':{'title':'用户自己填写'},'answers':answers,'confirmed':False}
    draft=client.post(url,json=data).json();assert draft['status']=='draft'
    assert client.post(url,json={**data,'id':draft['id'],'version':0,'confirmed':True}).status_code==409
    assert client.post(url,json={**data,'id':draft['id'],'version':draft['version'],'answers':{},'confirmed':True}).status_code==400
    good={**data,'id':draft['id'],'version':draft['version'],'confirmed':True}
    assert client.post(url,json=good).status_code==400
    assert s.get(owner,draft['id'])['status']=='draft'
    answers['customers']='主要服务本地物业公司'
    item=client.post(url,json=good).json()
    assert item['status']=='accepted' and item['audience']=='主要服务本地物业公司'
    assert s.get(owner,item['id'])['questionnaire_answers']==answers
    account(client,'other-ip-questionnaire@example.test')
    assert client.post(url,json={**good,'version':item['version']}).status_code==404


def test_edit_old_profile_keeps_legacy_fields_and_extension_data(client):
    owner=account(client)['user']['id']
    old=s.put(owner,'profile',{'title':'老 IP','position':'原定位','body':'完整旧报告','agency_brands':'原代理品牌','brand_id':'unchanged-brand-reference','custom':'扩展数据','status':'accepted'})
    answers={q[0]:'待确认' for q in ipq.QUESTIONS}
    answers['customers']='本地物业公司'
    draft=client.post('/api/studio/ip-questionnaire/profile',json={'id':old['id'],'version':old['version'],'answers':{},'fields':{'title':'未确认改名'},'confirmed':False}).json()
    assert draft['status']=='accepted' and draft['title']==old['title'] and draft['body']==old['body']
    assert draft['questionnaire_draft']['fields']['title']=='未确认改名'
    old=draft
    r=client.post('/api/studio/ip-questionnaire/profile',json={'id':old['id'],'version':old['version'],'answers':answers,'fields':{'title':'老 IP 新名称'},'confirmed':True})
    assert r.status_code==200,r.text
    for key in ('position','body','agency_brands','brand_id','custom'):assert r.json()[key]==old[key]
    assert r.json()['status']=='accepted'
    assert 'questionnaire_draft' not in r.json()


def test_legacy_profile_session_still_finishes_and_preserves_body(client,monkeypatch):
    owner=account(client)['user']['id']
    old=s.put(owner,'profile',{'title':'旧 IP','body':'旧报告','status':'accepted'})
    row=s.put(owner,'studio_interview',{'type':'profile','target_id':old['id'],'target_version':old['version'],'brand_id':'','original':{'title':'旧 IP'},'messages':[{'role':'assistant','content':'原访谈问题'}],'status':'interview'})
    fake_model(monkeypatch,lambda *a:'{"title":"旧 IP 补全","audience":"物业"}')
    j=client.post('/api/studio/interviews/'+row['id']+'/turn',json={'version':1,'request_id':'old','answer':'物业','summarize':True}).json()
    assert finish(client,j)['status']=='done'
    row=s.get(owner,row['id'])
    item=client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':row['version'],'fields':row['fields']}).json()
    assert item['id']==old['id'] and item['body']=='旧报告' and item['audience']=='物业'


def test_report_apply_does_not_overwrite_concurrent_profile_edit(client,monkeypatch):
    owner=account(client)['user']['id'];old=s.put(owner,'profile',{'title':'已有身份'})
    fake_model(monkeypatch,lambda *a:json.dumps(report(),ensure_ascii=False))
    row=all_answers(client,owner,create(client,target_id=old['id']))
    job,row=generate_report(client,owner,row);assert job['status']=='done'
    s.put(owner,'profile',{**old,'title':'另一窗口修改'},old['id'],expected=old['version'])
    r=client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':row['version'],'fields':row['fields']})
    assert r.status_code==409 and s.get(owner,old['id'])['title']=='另一窗口修改'


def test_topic_candidates_validation_and_deduplication():
    candidate={'title':'真实返回的建议','angle':'仅是建议，不冒充已发生案例'}
    assert ipq.topic_candidates([candidate,candidate])==[candidate]
    for value in (None,[],[{'title':'缺少角度'}],[{**candidate,'profile_id':'不能由模型指定'}]):
        with pytest.raises(ValueError):ipq.topic_candidates(value)


def test_manual_mapping_refreshes_generation_snapshot_without_overwriting_custom_fields(client):
    from backend.creation import context
    owner=account(client)['user']['id'];url='/api/studio/ip-questionnaire/profile'
    answers={q[0]:'不知道' for q in ipq.QUESTIONS}
    answers.update(customers='别墅业主',region='上海',appearance='不露脸',questions='售后谁负责')
    payload={'version':0,'fields':{'title':'映射回归'},'answers':answers,'confirmed':True}
    item=client.post(url,json=payload).json()
    assert item['audience']=='别墅业主'
    answers.update(customers='物业公司',region='杭州',appearance='可以露脸',questions='如何安排维保')
    payload.update(id=item['id'],version=item['version'])
    item=client.post(url,json=payload).json()
    snapshot=context(owner,{'profile_id':item['id']})['profile']
    assert snapshot['audience']=='物业公司' and snapshot['position']=='服务范围：杭州'
    assert snapshot['style']=='出镜方式：可以露脸' and snapshot['views']=='如何安排维保'
    # A direct edit (even identical to the previous automatic text, or blank)
    # makes the field independent; later questionnaire saves must preserve it.
    payload.update(version=item['version'],fields={'title':'映射回归','audience':item['audience'],'style':''})
    item=client.post(url,json=payload).json()
    answers.update(customers='厂房业主',region='宁波',appearance='仅拍工地')
    payload.update(version=item['version'],fields={'title':'映射回归'})
    item=client.post(url,json=payload).json()
    assert item['audience']=='物业公司' and item['style']==''
    assert item['position']=='服务范围：宁波'
    assert item['questionnaire_answers']['customers']=='厂房业主'


def test_pre_tracking_manual_mappings_migrate_conservatively():
    before={'customers':'业主','region':'上海','appearance':'不露脸','questions':'多久保养'}
    after={**before,'customers':'物业','region':'杭州','appearance':'露脸','questions':'停电怎么办'}
    old={**ipq._mapped_values(before),'questionnaire_version':ipq.VERSION,'questionnaire_answers':before}
    old['style']='用户自定义表达风格'
    fields=ipq.manual_fields(after,old)
    assert fields['audience']=='物业' and fields['position']=='服务范围：杭州'
    assert fields['views']=='停电怎么办' and fields['style']==old['style']
    # An old AI report is not assumed to be an automatic manual mapping.
    old['interview_id']='old-ai-report'
    fields=ipq.manual_fields(after,old)
    assert fields['audience']==old['audience'] and fields['position']==old['position']


@pytest.mark.parametrize('placeholder',['','   ','不知道【待确认】','暂时不知道','待补充','...','\u200b','？？？','N/A'])
def test_manual_placeholder_only_cannot_be_accepted(client,placeholder):
    owner=account(client)['user']['id'];before=s.list_(owner,'profile')
    payload={'version':0,'fields':{'title':'不能空过'},'answers':{q[0]:placeholder for q in ipq.QUESTIONS},'confirmed':True}
    response=client.post('/api/studio/ip-questionnaire/profile',json=payload)
    assert response.status_code==400,response.text
    assert s.list_(owner,'profile')==before
    payload['confirmed']=False
    assert client.post('/api/studio/ip-questionnaire/profile',json=payload).json()['status']=='draft'


def test_unknown_only_ai_report_cannot_create_accepted_identity_or_topics(client,monkeypatch):
    owner=account(client)['user']['id'];before=s.list_(owner,'profile')
    fake_model(monkeypatch,lambda *a:json.dumps(report(),ensure_ascii=False))
    row=create(client)
    for _ in range(12):
        assert answer(client,row).status_code==200
        row=s.get(owner,row['id'])
    job,row=generate_report(client,owner,row);assert job['status']=='done'
    response=client.post('/api/studio/interviews/'+row['id']+'/apply',json={'version':row['version'],'fields':row['fields']})
    assert response.status_code==400
    assert s.list_(owner,'profile')==before
    assert not [t for t in s.list_(owner,'studio_topic') if t.get('source_interview_id')==row['id']]


@pytest.mark.parametrize('blank',['','   ','...','\u200b','？？？'])
def test_one_real_answer_cannot_hide_other_empty_questions(client,blank):
    account(client)
    answers={q[0]:'不知道' for q in ipq.QUESTIONS}
    answers.update(customers='本地物业公司',region=blank)
    response=client.post('/api/studio/ip-questionnaire/profile',json={'version':0,'fields':{'title':'缺少一题'},'answers':answers,'confirmed':True})
    assert response.status_code==400,response.text


def confirmed_context_profile(client,owner):
    answers={q[0]:'不知道' for q in ipq.QUESTIONS}
    answers.update(customers='园区物业决策人',time='每周仅周六一小时',goal='预约展厅实地咨询',
                   materials='已获授权的展厅导览录像',boundaries='严禁公开客户住址和具体报价')
    item=client.post('/api/studio/ip-questionnaire/profile',json={'version':0,'fields':{'title':'上下文测试'},'answers':answers,'confirmed':True}).json()
    # An accepted profile may also have unfinished edits. These are never input.
    item=s.put(owner,'profile',{**item,'questionnaire_draft':{'answers':{'boundaries':'UNCONFIRMED_DRAFT_SECRET'}},
                               'unrelated_metadata':'UNRELATED_METADATA_SECRET'},item['id'],expected=item['version'])
    return item,answers


def test_questionnaire_snapshot_is_validated_detached_and_preserves_custom_changes(client):
    from backend import creation, jobs
    owner=account(client)['user']['id'];item,answers=confirmed_context_profile(client,owner)
    snapshot=creation.context(owner,{'profile_id':item['id']})['profile']
    assert snapshot['questionnaire']['answers']==answers
    assert snapshot['questionnaire']['profile_version']==item['version']
    assert snapshot['questionnaire']['profile_id']==item['id']
    assert all(q[0] in snapshot['questionnaire']['questions'] for q in ipq.QUESTIONS)
    text=jobs.context(owner,[],item['id'])
    for value in (answers['boundaries'],answers['time'],answers['goal'],answers['materials']):assert value in text
    assert 'UNCONFIRMED_DRAFT_SECRET' not in text and 'UNRELATED_METADATA_SECRET' not in text
    changed={**answers,'customers':'厂房负责人'}
    response=client.post('/api/studio/ip-questionnaire/profile',json={'id':item['id'],'version':item['version'],
        'answers':changed,'fields':{'title':item['title'],'audience':'我独立编写的受众描述'},'confirmed':True})
    assert response.status_code==200,response.text
    new=ipq.profile_snapshot(response.json())
    assert new['audience']=='我独立编写的受众描述' and 'audience' in new['questionnaire']['independent_fields']
    assert new['questionnaire']['answers']['customers']=='厂房负责人'
    assert snapshot['questionnaire']['answers']==answers  # earlier generation is frozen
    for override in ({'status':'draft'},{'questionnaire_version':'unknown-version'},
                     {'questionnaire_answers':{'customers':'incomplete'}},
                     {'questionnaire_answers':{q[0]:[] for q in ipq.QUESTIONS}}):
        assert 'questionnaire' not in ipq.profile_snapshot({**item,**override})
    assert ipq.profile_snapshot({**item,'archived':True}) is None
    assert ipq.profile_snapshot({'title':'旧档案'})['title']=='旧档案'


@pytest.mark.parametrize('route',['creation','jobs','assistant','topics','delivery','optimize'])
def test_confirmed_twelve_answers_reach_actual_generation_requests(client,monkeypatch,route):
    from backend import assistant_workspace as aw, topics
    owner=account(client)['user']['id'];item,answers=confirmed_context_profile(client,owner)
    captured=[]
    result={'title':'测试标题','body':'基于真实资料的测试正文','summary':'摘要','cover_brief':'展厅画面',
            'keywords':'电梯','publishing_notes':'核对资料'}
    def generated(mid,messages):
        captured.append(messages)
        if route=='topics':return json.dumps({'topics':[{'title':'展厅参观如何准备','angle':'建议先核对授权','rationale':'方向建议，待查证','audience':'物业'}]},ensure_ascii=False)
        if route in ('creation','jobs','optimize'):return '基于真实资料的测试正文'
        return json.dumps(result,ensure_ascii=False)
    fake_model(monkeypatch,generated)
    if route=='creation':
        response=client.post('/api/studio/text/generate',json={'brief':'写一段展厅介绍','profile_id':item['id'],'request_id':'context-test'})
    elif route in ('jobs','assistant'):
        mode='writing' if route=='jobs' else 'auto'
        if route=='assistant':monkeypatch.setattr(aw,'identify',lambda *a:{'action':'text','platforms':['wechat'],'brief':'写展厅介绍'})
        task=client.post('/api/tasks/open',json={'title':'上下文实测','mode':mode}).json()
        response=client.post('/api/tasks/'+task['id']+'/send',json={'text':'写一篇展厅介绍','mode':mode,'profile_id':item['id'],
            'reference_scope':{'mode':'selected','modules':[],'folder_ids':[],'item_ids':[],'excluded_ids':[]}})
    elif route=='topics':
        response=client.post('/api/studio/topics/generate',json={'brief':'找展厅选题','profile_id':item['id'],'request_id':'topic-context'})
    else:
        topic=client.post('/api/studio/topics',json={'title':'展厅参观','angle':'现场介绍','profile_id':item['id']}).json()
        delivery=client.post('/api/studio/deliveries',json={'topic_id':topic['id'],'platform':'wechat'}).json()
        delivery=client.patch('/api/studio/deliveries/'+delivery['id'],json={'version':delivery['version'],'title':'已有标题','body':'已有正文'}).json()
        response=client.post('/api/studio/deliveries/'+delivery['id']+'/'+('generate' if route=='delivery' else 'optimize'),
            json={'version':delivery['version'],**({'scope':'body','instruction':'优化表达','request_id':'opt-context'} if route=='optimize' else {})})
    assert response.status_code==200,response.text
    done=finish(client,response.json());assert done['status']=='done',done
    assert len(captured)==1
    request='\n'.join(m['content'] for m in captured[0])
    for key,value in answers.items():
        assert key in request and value in request,(route,key)
    assert 'UNCONFIRMED_DRAFT_SECRET' not in request and 'UNRELATED_METADATA_SECRET' not in request
    assert 'profile_version' in request and item['id'] in request


@pytest.mark.parametrize('text',['纠正上一题：其实是物业','上一题说错了','请修改第1题','我想重新回答上一题','上一题不是业主，是物业','我要更正前一题'])
def test_correction_intent_is_guidance_without_mutation(client,text):
    owner=account(client)['user']['id'];row=create(client)
    assert answer(client,row,'业主').status_code==200
    row=s.get(owner,row['id']);before=row.copy()
    response=answer(client,row,text)
    assert response.status_code==200,response.text
    assert response.json()['result']['correction_required'] is True
    assert s.get(owner,row['id'])==before and not s.list_(owner,'job')


def test_explicit_question_correction_preserves_progress_versions_and_idempotency(client):
    owner=account(client)['user']['id'];row=create(client)
    assert answer(client,row,'别墅业主').status_code==200
    row=s.get(owner,row['id']);url='/api/studio/interviews/'+row['id']+'/turn'
    payload={'version':row['version'],'request_id':'correction-1','question_id':'customers','answer':'物业公司'}
    for invalid in ('sales','missing','',[],None):
        assert client.post(url,json={**payload,'question_id':invalid}).status_code==400
    assert client.post(url,json={**payload,'summarize':True}).status_code==400
    assert client.post(url,json={**payload,'answer':''}).status_code==400
    assert client.post(url,json=payload).status_code==200
    updated=s.get(owner,row['id'])
    assert updated['question_index']==1 and updated['status']=='interview'
    assert updated['answers']=={'customers':'物业公司'}
    assert updated['version']==row['version']+1
    assert updated['messages'][-1]['content']==row['messages'][-1]['content']
    assert updated['messages'][1]['content']=='物业公司'
    assert client.post(url,json=payload).status_code==200
    assert s.get(owner,row['id'])==updated
    assert client.post(url,json={**payload,'answer':'不同修正'}).status_code==409
    assert client.post(url,json={**payload,'request_id':'stale-window'}).status_code==409
    assert answer(client,updated,'一年十台').status_code==200
    assert s.get(owner,row['id'])['answers']=={'customers':'物业公司','sales':'一年十台'}
    account(client,'foreign-correction@example.test')
    assert client.post(url,json={**payload,'version':updated['version']}).status_code==404


def test_report_correction_invalidates_old_report_and_regenerates_from_new_answers(client,monkeypatch):
    owner=account(client)['user']['id'];captured=[]
    fake_model(monkeypatch,lambda mid,msg:(captured.append(msg) or json.dumps(report(),ensure_ascii=False)))
    row=all_answers(client,owner,create(client));job,row=generate_report(client,owner,row)
    assert job['status']=='done';previous=row.copy();base='/api/studio/interviews/'+row['id']
    response=client.post(base+'/turn',json={'version':row['version'],'request_id':'fix-after-report','question_id':'customers','answer':'只服务物流园负责人'})
    assert response.status_code==200,response.text
    changed=s.get(owner,row['id'])
    assert changed['question_index']==12 and changed['status']=='ready_report' and changed['report_invalidated']
    assert all(key not in changed for key in ('fields','topic_candidates','method'))
    assert changed['answers']['customers']=='只服务物流园负责人'
    for version in (previous['version'],changed['version']):
        assert client.post(base+'/apply',json={'version':version,'fields':previous['fields']}).status_code==409
    job,review=generate_report(client,owner,changed)
    assert job['status']=='done' and not review['report_invalidated']
    context=json.loads(captured[-1][1]['content'].split('：',1)[1])
    assert context['十二题回答'][0]['回答']=='只服务物流园负责人'
    result=client.post(base+'/apply',json={'version':review['version'],'fields':review['fields']})
    assert result.status_code==200 and result.json()['questionnaire_answers']['customers']=='只服务物流园负责人'
    assert client.post(base+'/turn',json={'version':review['version']+1,'request_id':'after-applied','question_id':'customers','answer':'不能覆盖'}).status_code==400


def test_correction_during_report_is_rejected_without_losing_answer(client,monkeypatch):
    import threading
    owner=account(client)['user']['id'];started=threading.Event();release=threading.Event()
    def generate(*args):
        started.set();assert release.wait(5)
        return json.dumps(report(),ensure_ascii=False)
    fake_model(monkeypatch,generate)
    row=all_answers(client,owner,create(client));url='/api/studio/interviews/'+row['id']+'/turn'
    response=client.post(url,json={'version':row['version'],'request_id':'report-running','summarize':True})
    try:
        assert started.wait(3)
        correction=client.post(url,json={'version':row['version'],'request_id':'concurrent-edit','question_id':'customers','answer':'不能并发覆盖'})
        assert correction.status_code==409
        assert s.get(owner,row['id'])['answers']==row['answers']
    finally:release.set()
    assert finish(client,response.json())['status']=='done'


def test_ip_topic_apply_transaction_rolls_back_on_write_failure(client,monkeypatch):
    owner=account(client)['user']['id'];fake_model(monkeypatch,lambda *a:json.dumps(report(),ensure_ascii=False))
    row=all_answers(client,owner,create(client));job,row=generate_report(client,owner,row)
    assert job['status']=='done'
    before=s.list_(owner,'profile')
    with s.conn() as c:c.execute("CREATE TRIGGER reject_ip_topic BEFORE INSERT ON objects WHEN NEW.kind='studio_topic' BEGIN SELECT RAISE(ABORT,'test rollback'); END")
    url='/api/studio/interviews/'+row['id']+'/apply'
    with pytest.raises(Exception):client.post(url,json={'version':row['version'],'fields':row['fields']})
    assert s.list_(owner,'profile')==before
    assert s.get(owner,row['id'])['status']=='review'
    with s.conn() as c:c.execute('DROP TRIGGER reject_ip_topic')
    item=client.post(url,json={'version':row['version'],'fields':row['fields']}).json()
    assert len(item['positioning_topic_ids'])==2


@pytest.mark.parametrize('channel',['','wechat','xiaohongshu','moments','video','avatar'])
def test_creation_channel_separate_from_delivery_platform(client,channel):
    account(client)
    flow=client.post('/api/studio/flow',json={'new':True,'version':0,'creation_channel':channel,'platform':'douyin'}).json()
    assert flow['creation_channel']==channel and flow['platform']=='douyin'
    saved=client.post('/api/studio/flow',json={'id':flow['id'],'version':flow['version'],'stage':'1','platform':'wechat'}).json()
    assert saved['creation_channel']==channel and saved['platform']=='wechat'
    assert client.post('/api/studio/flow',json={'id':saved['id'],'version':saved['version'],'creation_channel':'bad'}).status_code==400
    assert client.post('/api/studio/flow',json={'id':saved['id'],'version':saved['version'],'platform':'moments'}).status_code==400
