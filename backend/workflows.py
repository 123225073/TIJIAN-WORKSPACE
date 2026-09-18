import re
from fastapi import Depends
from . import store as s,jobs,network,upstream,gateway as g,library

DEFAULTS={
 'daily':'日常沟通与内部工作台协作。资料检索遵循所选范围，写入前展示待写入结果。',
 'writing':'根据所选资料撰写可编辑文稿。适配运营身份和目标读者，事实标明来源，观点与事实分开。',
 'research':'围绕问题梳理资料、证据与缺口，给出清楚的结论。未联网检索时不声称已查到最新信息。',
 'benchmark':'分析所选内容的结构、受众、论据和表达方式，给出可借鉴的方法，不照搬原文。',
 'topics':'根据资料和运营身份提出选题、目标读者、切入角度和参考依据。',
 'profile':'通过简短访谈明确定位、受众、观点与风格，每次只问1至2个问题；不把假设当作真实身份。'}

def infer(text):
    for mode,words in [('profile',['定位','访谈']),('benchmark',['对标','拆解','仿写']),('topics',['选题','选几个主题']),('writing',['写一','写稿','文稿','创作','脚本'])]:
        if any(w in text for w in words):return mode
    return 'research'

def register(app,user,error):
    @app.post('/api/tasks/{id}/profile')
    @jobs.serialized
    def save_task_profile(id:str,data:dict,u=Depends(user)):
        owner=u['id'];task=s.get(owner,id)
        if task['kind']!='task' or task.get('archived'):error(400,'请选择有效对话')
        if task['version']!=data.get('task_version'):error(409,'对话已更新，请重新打开保存窗口核对')
        if not any(m.get('role')=='assistant' and m.get('text','').strip() for m in task.get('messages',[])):error(400,'请先完成定位沟通')
        if any(j.get('task_id')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):error(409,'请等待对话完成后保存')
        fields={k:str(data.get(k,'')).strip() for k in ['title','position','audience','style','body']}
        if not fields['title'] or not fields['body']:error(400,'请填写身份名称和定位方案')
        if len(fields['title'])>160 or any(len(v)>60000 for v in fields.values()):error(400,'身份内容过长')
        old=s.get(owner,data['profile_id']) if data.get('profile_id') else None
        if old and (old['kind']!='profile' or old.get('archived')):error(400,'请选择有效身份')
        if old and old['version']!=data.get('profile_version'):error(409,'身份已被修改，请重新核对后保存')
        if not old and any(x.get('positioning_task_id')==id and not x.get('archived') for x in s.list_(owner,'profile')):error(409,'此对话已有身份，请选择更新已有身份')
        return s.put(owner,'profile',{**(old or {}),**fields,'status':'accepted','positioning_task_id':id,'positioning_task_version':task['version'],'positioning_confirmed_at':s.now()},old['id'] if old else None,old['version'] if old else None)

    @app.get('/api/prompts')
    def prompts(u=Depends(user)):
        return {'defaults':DEFAULTS,'overrides':s.config('prompts:'+u['id'],{})}

    @app.put('/api/prompts')
    def save_prompts(data:dict,u=Depends(user)):
        if any(k not in DEFAULTS or not isinstance(v,str) or len(v)>12000 for k,v in data.items()):error(400,'提示词类型无效或超过12000字符')
        s.set_config('prompts:'+u['id'],data);return {'ok':True}

    @app.post('/api/tasks/open')
    def open_task(data:dict,u=Depends(user)):
        text=str(data.get('title','')).strip()
        if not text:error(400,'请输入目标')
        mode=data.get('mode') or 'auto';mode=infer(text) if mode=='auto' else mode
        if mode not in DEFAULTS:error(400,'工作类型无效')
        refs=data.get('source_ids',[]);jobs.contextual_ids(u['id'],refs,data.get('profile_id'))
        scope=library.normalize_scope(u['id'],data.get('reference_scope'),refs)
        with s.LOCK:
            key=s.digest(str((text,mode,sorted(refs),data.get('profile_id') or '',scope)))
            old=next((x for x in s.list_(u['id'],'task') if (x.get('entry_key')==key or (x.get('title')==text[:60] and x.get('mode')==mode and sorted(x.get('source_ids',[]))==sorted(refs) and (x.get('profile_id') or '')==(data.get('profile_id') or ''))) and not x.get('archived')),None)
            if old:return old
            return s.export_object(u['id'],s.put(u['id'],'task',{'title':text[:160],'messages':[],'mode':mode,'source_ids':refs,'reference_scope':scope,'profile_id':data.get('profile_id'),'entry_key':key,'created':s.now()}))

    @app.post('/api/objects/{id}/trash')
    @jobs.serialized
    def trash(id:str,u=Depends(user)):
        obj=s.get(u['id'],id)
        if obj['kind']=='folder' and any(not x.get('archived') and (x.get('folder_id')==id or x.get('parent_id')==id) for x in s.list_(u['id'])):error(409,'文件夹还有内容，请先移动条目或子文件夹；不会连带删除资料')
        if obj['kind']=='weread_subscription' and any(j.get('input',{}).get('subscription_id')==id and (j.get('status') in ['queued','running'] or j['id'] in jobs.CANCEL) for j in s.list_(u['id'],'job')):error(409,'请先暂停免费订阅并等待当前检查停止')
        if obj['kind']=='job' and (obj.get('status') in ['running','queued'] or id in jobs.CANCEL):error(409,'请先取消并等待执行任务停止')
        if obj['kind'] in ['wechat_article','source','knowledge','memory','task','content'] and any((j.get('status') in ['running','queued'] or j['id'] in jobs.CANCEL) and (id in j.get('input',{}).get('article_ids',[]) or id in j.get('input',{}).get('source_ids',[])) for j in s.list_(u['id'],'job')):error(409,'资料正在被任务使用，请先等待或取消任务')
        if any(j.get('task_id')==id and j.get('status') in ['running','queued'] for j in s.list_(u['id'],'job')):error(409,'会话仍在执行，请先取消')
        return s.put(u['id'],obj['kind'],{**obj,'archived':True,'trashed_at':s.now()},id,obj['version'])

    @app.post('/api/objects/{id}/restore')
    def restore(id:str,u=Depends(user)):
        obj=s.get(u['id'],id)
        return s.put(u['id'],obj['kind'],{**obj,'archived':False,'trashed_at':None},id,obj['version'])

    @app.post('/api/tasks/{id}/distill')
    @jobs.serialized
    def distill(id:str,u=Depends(user)):
        owner=u['id'];task=s.get(owner,id)
        if task['kind']!='task' or task.get('archived'):error(400,'请选择有效对话')
        if not task.get('messages'):error(400,'这段对话暂无内容')
        model=g.select(owner,'knowledge');version=task['version']
        def run(progress,event):
            progress('整理本次对话的一份知识摘要')
            answer=g.generate(model,[{'role':'system','content':jobs.POLICY},{'role':'user','content':'将下面对话整理成一份Markdown摘要，区分用户确认事项、AI建议和未验证内容，保留时间与适用范围，不虚构外部事实。\n'+s.object_body(task)}])
            if event.is_set():return {'cancelled':True}
            with s.LOCK:
                current=s.get(owner,id)
                if current.get('archived'):raise ValueError('对话已删除，未保存摘要')
                previous=next((x for x in s.list_(owner,'source') if x.get('distilled_task')==id and not x.get('archived')),None)
                if previous and previous.get('body')!=previous.get('generated_body'):raise ValueError('已有摘要已手工修改，请先另存，避免覆盖你的编辑')
                obj=s.put(owner,'source',{'title':'对话摘要 · '+task['title'],'body':answer,'generated_body':answer,'source_ids':[id],'distilled_task':id,'task_version':version,'source_type':'手动提炼的对话摘要','status':'ready'},previous['id'] if previous else None)
                obj=s.export_object(owner,obj)
            return {'source_id':obj['id']}
        if any(j.get('input',{}).get('distilled_task')==id and j.get('status') in ['queued','running'] for j in s.list_(owner,'job')):error(409,'正在提炼这段对话')
        return jobs.start(owner,'提炼对话摘要',run,{'distilled_task':id})

    @app.post('/api/import/batch')
    def batch(data:dict,u=Depends(user)):
        urls=list(dict.fromkeys(re.findall(r'https?://[^\s<>]+',str(data.get('urls','')))))
        if not urls or len(urls)>100:error(400,'请提供1至100个链接，每行一个')
        benchmark=data.get('benchmark_id')
        if benchmark and s.get(u['id'],benchmark)['kind']!='benchmark':error(400,'请选择对标账号')
        if benchmark and s.get(u['id'],benchmark).get('platform') in ('抖音','douyin'):error(400,'抖音主页不是文章正文，请到对标作品库获取作品并下载媒体')
        def run(progress,event):
            from .app import import_text
            results=[]
            for i,url in enumerate(urls):
                if event.is_set():break
                progress(f'正在采集 {i+1}/{len(urls)}；成功 '+str(sum(x['status']=='done' for x in results)))
                try:
                    article=network.article(url)
                    if data.get('expected_publisher_biz') and article.get('publisher_biz')!=data['expected_publisher_biz']:
                        raise ValueError('原文发布账号与所选博主不一致或无法核实，未保存此文章')
                    obj=import_text({**article,'benchmark_id':benchmark,'source_type':'批量采集','acquisition_origin':'manual_url','acquisition_provider':'public'},u)
                    results.append({'url':url,'status':'done','source_id':obj['id'],'title':obj['title']})
                except Exception as e:results.append({'url':url,'status':'failed','reason':str(e) if isinstance(e,ValueError) else '读取失败：请检查网络或平台登录限制'})
            success=sum(x['status']=='done' for x in results)
            result={'items':results,'success':success,'failed':len(results)-success,'total':len(urls)}
            s.put(u['id'],'collection',{'title':'批量采集结果','benchmark_id':benchmark,**result})
            if not success and not event.is_set():raise ValueError('没有采集成功的文章，请查看采集记录中的失败原因')
            return result
        return jobs.start(u['id'],'批量采集文章',run,{**data,'action':'batch','trigger':'manual_url'})

    return {'batch':batch,'distill':distill}
