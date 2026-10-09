import {useId,useState} from 'react';
import {Pencil} from 'lucide-react';
import {api} from './api';
import {StudioModal} from './AssetPicker';
import type {Asset} from './ResourcePreview';
import './asset-rename.css';

export default function AssetRename({asset}:{asset:Asset}){
 const [open,setOpen]=useState(false);
 if(!asset.resource_renamable)return null;
 return <><button type="button" className="st-asset-rename" aria-label={'重命名：'+(asset.title||asset.name||'资产')} onClick={e=>{e.preventDefault();e.stopPropagation();setOpen(true)}}><Pencil size={13}/>改名</button>{open&&<RenameDialog asset={asset} onClose={()=>setOpen(false)}/>}</>;
}
function RenameDialog({asset,onClose}:{asset:Asset;onClose:()=>void}){
 const field=useId(),[title,setTitle]=useState(asset.title||asset.name||''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const label=asset.asset_type==='avatar'?'形象名称':'声音名称';
 const save=async()=>{if(saving||!title.trim())return;setSaving(true);setError('');try{const updated=await api('/studio/assets/'+encodeURIComponent(asset.id),{title:title.trim(),version:asset.version},'PATCH');window.dispatchEvent(new CustomEvent('studio-asset-renamed',{detail:updated}));onClose()}catch(e){const message=e instanceof Error?e.message:'改名未保存，请稍后重试';setError(message);if(message.includes('资产已更新')){try{const list=await api('/studio/assets'),latest=(list.items||[]).find((item:Asset)=>item.id===asset.id);if(latest){window.dispatchEvent(new CustomEvent('studio-asset-renamed',{detail:latest}));setError('当前名称已更新为“'+latest.title+'”。你的输入已保留，请核对后再次保存。')}}catch{}}}finally{setSaving(false)}};
 return <StudioModal title={'修改'+label} onClose={()=>{if(!saving)onClose()}}><form className="st-rename-form" onSubmit={e=>{e.preventDefault();void save()}}><label htmlFor={field}>{label}</label><input id={field} autoFocus required maxLength={200} value={title} disabled={saving} placeholder={'输入便于识别的'+label} onFocus={e=>e.currentTarget.select()} onChange={e=>setTitle(e.target.value)}/><small>改名后，选择列表和我的 IP 会同步显示新名称。</small>{error&&<p role="alert">{error}</p>}<div className="st-dialog-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="st-primary" disabled={saving||!title.trim()||title.trim()===(asset.title||asset.name||'')}>{saving?'正在保存…':'保存名称'}</button></div></form></StudioModal>;
}
