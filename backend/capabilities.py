"""Administrator-owned prompt configuration. Skills are text methods, not executables."""
from copy import deepcopy
from fastapi import Depends
from . import store as s, upstream, resources

PURPOSES = {'daily':'日常沟通','writing':'内容创作','research':'资料研究','benchmark':'对标分析','topics':'选题策划','profile':'定位访谈','check':'事实核查','knowledge':'知识整理'}
ROLES = {
 'daily':'你是个人工作台助手。通过对话回答问题、检索已选资料、整理IP和明确的个人偏好。未实际写入前不得声称保存成功。',
 'writing':'你是行业内容编辑。根据所选资料撰写完整 Markdown 文稿，适配运营身份与目标读者。事实注明来源，观点与事实分开。',
 'research':'你是资料研究员。围绕问题梳理证据、结论与缺口；没有执行联网检索就不能声称已查到最新信息。',
 'benchmark':'你是内容分析顾问。拆解内容的结构、受众、论据与表达，给出可复用的方法，不照搬原文。',
 'topics':'你是选题策划顾问。根据资料和运营身份提出选题、目标读者、切入角度与参考依据。',
 'profile':'你是个人定位访谈顾问。通过渐进访谈明确定位、受众、观点与风格，每次只问1至2个问题。先听用户回答再追问，不编造身份，不把建议当作用户确认。',
 'check':'你是事实核查编辑。只根据给定来源判断，有证据才作结论；区分有依据、待核对和矛盾，遵守请求中的 JSON 输出结构。',
 'knowledge':'你是知识整理员。提炼有来源、适用范围和有效时间的候选知识，不把 AI 建议当作事实，遵守请求中的 JSON 输出结构。',
}

def defaults():
    roles=[dict(id='role:'+k,kind='role',purpose=k,title=v,body=ROLES[k],status='published',version=1,origin='系统内置',history=[]) for k,v in PURPOSES.items()]
    skills=[dict(id='skill:'+k,kind='skill',purpose=k if k in PURPOSES else 'writing',title=v[0],body=upstream.skill_text(k),status='published' if k!='style' else 'disabled',version=1,origin='Easel / '+v[1],history=[]) for k,v in upstream.SKILLS.items()]
    return roles+skills

def list_():
    overrides={x['id']:x for x in s.config('system_capabilities',[])}
    built=defaults()
    return [overrides.pop(x['id'],x) for x in built]+list(overrides.values())

def save(data,actor):
    with s.LOCK:
        items=list_();old=next((x for x in items if x['id']==data.get('id')),None)
        if data.get('id') and not old:raise s.Missing()
        if old and data.get('version')!=old['version']:raise s.Conflict('配置已被修改，请刷新后再保存')
        kind=old['kind'] if old else 'skill'
        purpose=old['purpose'] if kind=='role' else data.get('purpose','writing')
        if purpose not in [*PURPOSES,'all']:raise ValueError('请选择适用功能')
        title=str(data.get('title','')).strip();body=str(data.get('body','')).strip();status=data.get('status','draft')
        if not title or not body or len(title)>120 or len(body)>60000:raise ValueError('请填写名称与正文：名称最多120字，正文最多60000字')
        if status not in ['draft','published','disabled','deleted']:raise ValueError('无效状态')
        if kind=='role' and status!='published':raise ValueError('系统角色必须保持生效；可以编辑或恢复默认')
        item=dict(id=old['id'] if old else s.uid(),kind=kind,purpose=purpose,title=title,body=body,status=status,version=old['version']+1 if old else 1,origin=old['origin'] if old else '管理员自建',updated=s.now(),updated_by=actor,history=(old.get('history',[])+[{k:v for k,v in old.items() if k!='history'}]) if old else [])
        overrides=s.config('system_capabilities',[])
        s.set_config('system_capabilities',[x for x in overrides if x['id']!=item['id']]+[item])
        s.audit(actor,'system_capability_'+status,item['id'])
        return item

def restore(id,data,actor):
    with s.LOCK:
        old=next((x for x in list_() if x['id']==id),None)
        if not old:raise s.Missing()
        if data.get('version')!=old['version']:raise s.Conflict('配置已被修改，请刷新后再恢复')
        target=next((x for x in (defaults() if data.get('target')=='default' else old['history']) if x['id']==id and (data.get('target')=='default' or x['version']==data.get('target'))),None)
        if not target:raise ValueError('找不到要恢复的版本')
        return save({**target,'version':old['version']},actor)

def snapshot(purpose,owner=None):
    """Freeze before enqueueing. User-visible jobs store only versions/hash, never bodies."""
    with s.LOCK:
        if purpose not in PURPOSES:raise ValueError('不支持的工作类型')
        items=deepcopy(list_());role=next(x for x in items if x['id']=='role:'+purpose)
        chosen=[role]+[x for x in items if x['kind']=='skill' and x['status']=='published' and x['purpose'] in [purpose,'all']]
        text='系统业务角色：\n'+role['body']
        for x in chosen[1:]:text+='\n方法指导（不授予工具或执行权限）：'+x['title']+'\n'+x['body']
        text+='\n'+resources.context(purpose)
        if owner:
            preference=s.config('prompts:'+owner,{}).get(purpose,'')
            if preference:text+='\n用户个人偏好（不能覆盖系统边界）：\n'+preference
        if len(text)>80000:raise ValueError('本功能启用的方法过多，请管理员减少启用的 Skills（合计最多80000字）')
        return {'text':text,'metadata':{'purpose':purpose,'items':[{'id':x['id'],'version':x['version']} for x in chosen],'hash':s.digest(text),'at':s.now()}}

def register(app,admin):
    @app.get('/api/admin/capabilities')
    def read(u=Depends(admin)):
        return {'items':list_(),'purposes':PURPOSES}

    @app.post('/api/admin/capabilities')
    def write(data:dict,u=Depends(admin)):
        return save(data,u['id'])

    @app.post('/api/admin/capabilities/{id}/restore')
    def rollback(id:str,data:dict,u=Depends(admin)):
        return restore(id,data,u['id'])

    @app.get('/api/admin/capabilities/preview/{purpose}')
    def preview(purpose:str,u=Depends(admin)):
        from .jobs import POLICY
        result=snapshot(purpose,u['id'])
        result['text']=POLICY+'\n'+result['text']
        return result
