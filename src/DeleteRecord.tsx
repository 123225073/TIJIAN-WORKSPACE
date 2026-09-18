import {useState} from 'react';
import {api,type Item} from './api';

export function DeleteRecord({item,t,onDeleted,compact=false}:{item:Item;t:any;onDeleted?:()=>void;compact?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=item.kind==='job'&&['queued','running'].includes(item.status);
 return <span className="record-delete"><button aria-label={'删除'+item.title} disabled={busy||active} title={active?'请先取消正在执行的任务':'移入回收站，可在资料管理恢复'} onClick={async e=>{e.stopPropagation();if(!window.confirm(`删除“${item.title}”？\n此记录将移入回收站，不再被 AI 引用；可在“资料管理 → 回收站”恢复。\n关联的其他资料和已确认知识不会一并删除。`))return;setBusy(true);setError('');try{await api('/objects/'+item.id+'/trash',{});onDeleted?.();await t.refresh?.();t.setToast?.('已移入回收站，可在资料管理恢复')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?'删除中…':compact?'删除':'删除记录'}</button>{error&&<small className="form-error" role="alert">{error}</small>}</span>;
}
