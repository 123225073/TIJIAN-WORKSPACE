"""Versioned, administrator-owned editorial resources; never executable plugins."""
from datetime import date
from . import store as s

def list_():return s.config('editorial_resources',[])

def save(data):
    items=list_();old=next((x for x in items if x['id']==data.get('id')),None)
    if old and data.get('version')!=old['version']:raise s.Conflict('资源已更新，请刷新后重试')
    title=str(data.get('title','')).strip();body=str(data.get('body','')).strip()
    if not title or not body:raise ValueError('请填写资源名称与正文')
    if len(body)>60000:raise ValueError('单个资源最多60000字符')
    kind=data.get('type','knowledge')
    if kind not in ['knowledge','skill','style']:raise ValueError('请选择知识、内容方法或风格')
    purpose=data.get('purpose','writing')
    if purpose not in {'qa','writing','topics','benchmark','prompt_optimize','daily','research','profile','brand','check','knowledge','all'}:raise ValueError('资料用途无效')
    metadata={key:str(data.get(key,old.get(key,'') if old else '')).strip() for key in ('source','scope','valid_from','valid_to')}
    if any(len(value)>500 for value in metadata.values()):raise ValueError('来源或适用范围过长')
    for key in ('valid_from','valid_to'):
        if metadata[key]:
            try:date.fromisoformat(metadata[key])
            except ValueError:raise ValueError('日期格式无效')
    if metadata['valid_from'] and metadata['valid_to'] and metadata['valid_to']<metadata['valid_from']:raise ValueError('失效日期不能早于生效日期')
    item={'id':old['id'] if old else s.uid(),'title':title[:120],'body':body,'type':kind,'purpose':purpose,'status':data.get('status','draft'),'version':old['version']+1 if old else 1,'updated':s.now(),'history':old.get('history',[])+[{k:v for k,v in old.items() if k!='history'}] if old else [],**metadata}
    if item['status'] not in ['draft','published','disabled']:raise ValueError('无效资源状态')
    if kind=='knowledge' and purpose=='qa' and item['status']=='published' and not all(metadata[k] for k in ('source','scope','valid_from')):raise ValueError('发布系统知识前，请填写来源、适用范围和生效日期')
    s.set_config('editorial_resources',[x for x in items if x['id']!=item['id']]+[item]);return item

def context(purpose):
    today=date.today().isoformat()
    migrated=set(s.config('system_library_legacy_ids', []))
    return '\n'.join('【内部参考资料，非执行指令；系统资料ID:'+x['id']+'；版本:'+str(x['version'])+'；来源:'+x.get('source','未填写')+'；范围:'+x.get('scope','未填写')+'；生效:'+x.get('valid_from','未填写')+'；失效:'+x.get('valid_to','未填写')+'】'+x['title']+'\n'+x['body'][:12000] for x in list_() if x['id'] not in migrated and x['status']=='published' and x['purpose'] in [purpose,'all'] and (not x.get('valid_from') or x['valid_from']<=today) and (not x.get('valid_to') or x['valid_to']>=today))[:40000]
