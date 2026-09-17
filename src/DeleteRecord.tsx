import {useState} from 'react';
import {api,type Item} from './api';

export function DeleteRecord({item,t,onDeleted}:{item:Item;t:any;onDeleted?:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=item.kind==='job'&&['queued','running'].includes(item.status);
 return <span className="record-delete"><button disabled={busy||active} title={active?'请先取消正在执行的任务':'移入回收站，可在资料管理恢复'} onClick={async()=>{setBusy(true);setError('');try{await api('/objects/'+item.id+'/trash',{});onDeleted?.();await t.refresh?.()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?'正在删除…':'删除记录'}</button>{error&&<small className="form-error" role="alert">{error}</small>}</span>;
}
