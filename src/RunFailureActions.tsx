import {useRef, useState} from 'react';
import {RotateCcw, Trash2} from 'lucide-react';
import {StudioModal} from './AssetPicker';
import {api} from './api';
import './run-failure-actions.css';

type FailedRun = {id:string; can_delete_failure?:boolean; can_retry_failure?:boolean; retry_run_id?:string};
type Action = 'retry' | 'delete';

export default function RunFailureActions({run, disabled, onResult}: {
 run:FailedRun; disabled?:boolean; onResult:(id:string, retry?:any)=>void;
}){
 const [action,setAction]=useState<Action|null>(null);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 if(!run.can_delete_failure)return null;
 const close=()=>{if(!lock.current)setAction(null)};
 const submit=async()=>{
  if(!action||lock.current||disabled)return;
  lock.current=true;setPending(true);setError('');
  try{
   const path='/studio/runs/'+encodeURIComponent(run.id);
   const next=action==='retry'?await api(path+'/retry',{confirmed:true}):undefined;
   if(action==='delete')await api(path,undefined,'DELETE');
   setAction(null);
   onResult(run.id,next);
  }catch(e){setError(e instanceof Error?e.message:'处理失败，请稍后重试。')}
  finally{lock.current=false;setPending(false)}
 };
 return <div className="st-failure-actions">
  {run.can_retry_failure&&<button type="button" disabled={disabled} onClick={()=>{setError('');setAction('retry')}}><RotateCcw size={15}/>重跑原任务</button>}
  <button type="button" disabled={disabled} onClick={()=>{setError('');setAction('delete')}}><Trash2 size={15}/>删除失败记录</button>
  {run.retry_run_id&&<small>已发起重跑，请查看新的生成记录。</small>}
  {action&&<StudioModal title={action==='retry'?'确认重跑原任务':'确认删除失败记录'} onClose={close}>
   <div className="st-failure-dialog" aria-busy={pending}>
    <p>{action==='retry'?'沿用这次失败任务提交时的文稿、素材和参数。确认后会提交一条新任务，可能产生新的服务费用。':'这条失败记录将从列表移除，原草稿和素材仍可继续使用。'}</p>
    {error&&<p className="st-alert" role="alert">{error}</p>}
    <div><button type="button" disabled={pending} onClick={close}>取消</button><button type="button" className="st-primary" disabled={pending||disabled} onClick={()=>void submit()}>{pending?'正在处理…':action==='retry'?'确认重跑':'确认删除'}</button></div>
   </div>
  </StudioModal>}
 </div>;
}
