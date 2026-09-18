"""Explicit conversation outcome, with optimistic protection of the edited baseline."""
import json
from fastapi import Depends
from . import store as s, gateway as g, jobs

LABELS={'daily':'沟通纪要','writing':'文章','research':'研究成果','topics':'选题方案','benchmark':'对标分析','profile':'定位方案'}

def fingerprint(task):
    return s.digest(json.dumps(task.get('messages',[]),ensure_ascii=False))

@jobs.serialized
def confirm(owner,id,data):
    task=s.get(owner,id)
    if task['kind']!='task' or task.get('archived'):raise ValueError('请选择有效对话')
    if any(j.get('task_id')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):raise ValueError('请等待当前任务完成')
    if not any(m.get('role')=='assistant' for m in task.get('messages',[])):raise ValueError('请先完成一轮对话')
    original=s.get(owner,task['content_id']) if task.get('content_id') else None
    if original and (original.get('archived') or data.get('version')!=original['version']):raise ValueError('成果已变化，请保存或刷新当前成果后重试')
    stamp=fingerprint(task)
    if original and original.get('conversation_hash')==stamp:return {'content_id':original['id'],'unchanged':True}
    mode=task.get('mode','daily');model=g.select(owner,mode,data.get('model_id'))
    conversation=s.object_body(task)
    if len(conversation)>120000:raise ValueError('对话过长，请先分成较小的工作任务再整理')
    baseline=original.get('body','') if original else ''
    if len(baseline)>100000:raise ValueError('成果超过10万字符，请缩小本次整理范围')
    def run(progress,event):
        progress('正在将对话整理为工作成果；保留当前成果中的人工修改')
        prompt='你是工作成果编辑。输出可直接使用的完整 Markdown 成果，不输出操作说明。整理类型：'+LABELS.get(mode,'工作成果')+'。当前成果是用户编辑后的权威底稿，必须保留其中未被新要求改变的内容、图片链接与人工修改；只合并后续明确要求，不用历史草案覆盖新底稿。区分事实、建议和信息缺口。'
        payload={'当前成果':baseline,'完整对话':conversation,'已整理消息数':original.get('message_count',0) if original else 0}
        answer=g.generate(model,[{'role':'system','content':jobs.POLICY+'\n'+prompt},{'role':'user','content':json.dumps(payload,ensure_ascii=False)}]).strip()
        if not answer or len(answer)>100000:raise ValueError('未获得有效成果，请重试')
        if event.is_set():return {'cancelled':True}
        with s.LOCK:
            live=s.get(owner,id)
            if live.get('archived') or fingerprint(live)!=stamp or live.get('content_id')!=task.get('content_id'):raise ValueError('对话发生变化，未覆盖成果，请重新确定')
            current=s.get(owner,original['id']) if original else None
            if current and (current['version']!=original['version'] or current.get('archived')):raise ValueError('生成期间成果被修改，已保留人工修改；请重新更新成果')
            refs=list(dict.fromkeys((current or {}).get('source_ids',[])+task.get('source_ids',[])+[v for m in task.get('messages',[]) for v in m.get('reference_ids',[])]))
            title=next((v.strip('# ').strip() for v in answer.splitlines() if v.strip()),task['title'])[:120]
            content=s.put(owner,'content',{**(current or {}),'title':title,'body':answer,'status':'draft','check':None,'task_id':id,'outcome_type':mode,'format':'公众号' if mode=='writing' else LABELS.get(mode,'工作成果'),'profile_id':task.get('profile_id'),'source_ids':refs,'model_id':model,'conversation_hash':stamp,'message_count':len(task.get('messages',[]))},current['id'] if current else None,current['version'] if current else None)
            s.put(owner,'task',{**live,'content_id':content['id']},id)
            s.export_object(owner,content)
            return {'content_id':content['id'],'task_id':id}
    return jobs.start(owner,'更新工作成果' if original else '确定工作成果',run,{'action':'artifact','task_id':id,'model_id':model})

def register(app,user,error):
    @app.post('/api/tasks/{id}/outcome')
    def outcome(id:str,data:dict,u=Depends(user)):return confirm(u['id'],id,data)

    @app.post('/api/content/{id}/write')
    @jobs.serialized
    def write(id:str,data:dict,u=Depends(user)):
        owner=u['id'];source=s.get(owner,id)
        if source['kind']!='content' or source.get('archived') or not source.get('body','').strip():error(400,'请先确定工作成果')
        if data.get('version')!=source['version']:error(409,'成果已变化，请保存当前修改后继续')
        brief=str(data.get('brief','')).strip()
        if not brief or len(brief)>4000:error(400,'请说明采用哪个选题、文章要求（4000字以内）')
        key=s.digest(str((id,source['version'],brief)))
        existing=next((t for t in s.list_(owner,'task') if t.get('handoff_key')==key and not t.get('archived')),None)
        if existing:return existing
        refs=source.get('source_ids',[])
        return s.export_object(owner,s.put(owner,'task',{'title':brief[:160],'mode':'writing','messages':[],'source_ids':refs,'profile_id':source.get('profile_id'),'upstream_content_id':id,'upstream_version':source['version'],'upstream_body':source['body'],'handoff_key':key,'reference_scope':{'mode':'selected','modules':[],'folder_ids':[],'item_ids':refs,'excluded_ids':[]}}))
