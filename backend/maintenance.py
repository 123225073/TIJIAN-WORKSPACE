from datetime import datetime,timezone
from . import store as s

def inspect(owner):
    objects=s.list_(owner);issues=[x for x in objects if x['kind']=='issue'];created=[]
    def note(key,title,body,refs):
        if any(i.get('maintenance_key')==key for i in issues):return
        created.append(s.put(owner,'issue',{'type':'maintenance','maintenance_key':key,'title':title,'body':body,'source_ids':refs,'status':'pending'})['id'])
    seen={};today=datetime.now(timezone.utc).date().isoformat()
    for x in objects:
        if x.get('archived'):continue
        if x['kind'] in ['knowledge','memory']:
            end=str(x.get('valid_to',''))
            if len(end)>=10 and end[:10]<today:
                note('expiry:'+x['id']+':'+end,'有效期已结束：'+x['title'],'这条记录适用于历史时期，请核对是否需要补充现状。历史知识仍保留，引用时必须注明有效时间。',[x['id']])
            for ref in x.get('source_ids',[]):
                source=next((i for i in objects if i['id']==ref),None)
                if not source or source.get('file_missing'):
                    note('missing:'+x['id']+':'+ref,'知识依据需要检查：'+x['title'],'原始来源缺失或文件被移走。请恢复来源、补充证据，或暂时停止AI引用。',[x['id']])
        if x['kind']=='source' and len(x.get('body',''))>50:
            key=s.digest(x['body'].strip())
            if key in seen:note('duplicate:'+key,'发现重复资料：'+x['title'],'两份资料正文相同。原文均已保留，可在原始资料中停用重复副本，避免重复引用。',[seen[key],x['id']])
            else:seen[key]=x['id']
    record={'at':s.now(),'checked':len(objects),'created':len(created),'issue_ids':created}
    s.set_config('maintenance:'+owner,record)
    return record
