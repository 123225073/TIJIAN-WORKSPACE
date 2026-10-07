"""Media-aware portable backups without provider credentials, URLs or remote task authority."""
import io
from pathlib import Path
from fastapi import UploadFile
from . import media_studio as media, store as s

KINDS={'studio_flow','studio_interview','studio_brand','studio_text_draft','studio_profile_proposal','studio_draft','studio_run','studio_asset','benchmark_api_account','benchmark_api_item','benchmark_api_analysis'}
LIMIT=95_000_000

def export(owner,records,archive):
    output=[];total=0
    for record in records:
        kind=record['kind'];item=dict(record)
        if kind in {'studio_asset','studio_run'}:
            item=media._public(record)
            for field in ('task_id','file_url','thumbnail_url','original_file_url'):
                item.pop(field,None)
        if kind=='studio_asset' and record.get('local_file'):
            path=media._path(owner,record['local_file'])
            if not path.is_file():raise ValueError('备份包含缺失的媒体文件，请先检查素材库')
            total+=path.stat().st_size
            if total>LIMIT:raise ValueError('媒体总量超过便携备份95MB上限，请先逐项下载媒体；原文件仍保留在本机数据目录')
            key='studio-media/'+record['id']+path.suffix
            archive.write(path,key);item['backup_media']=key
            if record.get('original_file'):
                original=media._path(owner,record['original_file'])
                if not original.is_file():raise ValueError('备份包含缺失的原始图片，请先检查素材库')
                total+=original.stat().st_size
                if total>LIMIT:raise ValueError('媒体与原图总量超过便携备份95MB上限，请先逐项下载媒体')
                key='studio-original/'+record['id']+original.suffix
                archive.write(original,key);item['backup_original']=key
        output.append(item)
    return output

def validate(records,archive):
    total=0
    for item in records:
        for field,prefix in (('backup_media','studio-media/'),('backup_original','studio-original/')):
            key=item.get(field)
            if not key:continue
            expected=prefix+item['id']+Path(key).suffix
            if item.get('kind')!='studio_asset' or key!=expected or Path(key).suffix.lower() not in media.EXTENSIONS or field=='backup_original' and not item.get('backup_media'):
                raise ValueError('备份中的媒体路径不合法')
            try:info=archive.getinfo(key)
            except KeyError:raise ValueError('备份缺少媒体文件') from None
            total+=info.file_size
            if total>LIMIT:raise ValueError('媒体备份超过95MB上限')

def import_assets(owner,records,archive,ids):
    restored={}
    for item in records:
        if item.get('kind')!='studio_asset' or not item.get('backup_media'):continue
        key=item['backup_media']
        uploaded=media.upload(owner,UploadFile(io.BytesIO(archive.read(key)),filename=Path(key).name))
        if item.get('backup_original'):
            original=media._path(owner,s.uid()+Path(item['backup_original']).suffix)
            original.write_bytes(archive.read(item['backup_original']))
            current=s.get(owner,uploaded['id'])
            s.put(owner,'studio_asset',{**current,'original_file':original.name,'image_adjustment':item.get('image_adjustment')},uploaded['id'])
        ids[item['id']]=uploaded['id'];restored[item['id']]=s.get(owner,uploaded['id'])
    return restored

def restored_data(kind,data,restored=None):
    data={k:v for k,v in data.items() if k not in {'backup_media','backup_original','original_file','original_file_url','thumbnail_url','remote','provider_resource_id','service_scope','snapshot','result','busy_until','task_id','request_id','local_file','file_url','last_fetch','last_job_id'}}
    if kind=='studio_asset':
        if restored:
            data={**data,**restored,'title':data.get('title',restored['title'])}
        else:data.update(status='unavailable',compat=[],error='此云端形象或声音需在原服务中重新关联；备份不携带供应商授权')
    if kind=='studio_run':
        data.update(status='succeeded' if data.get('status')=='succeeded' else 'interrupted',task_id=None,restored=True,error='备份记录不恢复远端任务查询或自动重试')
    if kind=='studio_text_draft':data.update(job_ids=[],job_versions={})
    if kind=='studio_profile_proposal':data.update(status='pending')
    return data
