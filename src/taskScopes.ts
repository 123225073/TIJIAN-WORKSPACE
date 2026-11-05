import type {Item} from './api';
import {taskActive} from './taskActivity';

export type PictureTaskSlot={id:string;title:string;status:string;job_id?:string;run_id?:string;error?:string};
export type TaskScope={id:string;title:string;route:string;created:string;members:string[];operations:string[];pending?:boolean;unresolved?:boolean;summary?:string;labels?:Record<string,string>;slots?:PictureTaskSlot[]};
export type TaskScopes={current:string;groups:TaskScope[]};
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
export function readTaskScopes(owner:string):TaskScopes{
 try{const value=JSON.parse(localStorage.getItem('task-center-scopes:'+owner)||'null');if(value&&Array.isArray(value.groups))return {current:String(value.current||''),groups:value.groups.filter((x:any)=>x&&typeof x.id==='string'&&Array.isArray(x.members)&&Array.isArray(x.operations))};}catch{}
 return {current:'',groups:[]};
}
export function joinTaskScope(state:TaskScopes,scope:TaskScope,activate=false):TaskScopes{
 const previous=state.groups.find(x=>x.id===scope.id);
 const item={...previous,...scope,created:scope.created||previous?.created||'',labels:{...previous?.labels,...scope.labels},members:unique([...(previous?.members||[]),...scope.members]),operations:unique([...(previous?.operations||[]),...scope.operations])};
 return {current:activate||!state.current?item.id:state.current,groups:[item,...state.groups.filter(x=>x.id!==item.id)]};
}
export function savedBatchScopes(owner:string):TaskScope[]{
 const scopes:TaskScope[]=[];
 for(let index=0;index<localStorage.length;index++){
  const key=localStorage.key(index)||'';if(!key.startsWith('social-picture-batch:'+owner+':')&&!key.startsWith('article-picture-batch:'+owner+':'))continue;
  try{const batch=JSON.parse(localStorage.getItem(key)||'null');if(!batch?.id||batch.owner&&batch.owner!==owner||!Array.isArray(batch.slots))continue;
   const pending=batch.slots.some((slot:any)=>!['succeeded','failed'].includes(slot.status)),done=batch.slots.filter((slot:any)=>slot.status==='succeeded').length;
   const labels:Record<string,string>={};for(const [index,slot] of batch.slots.entries()){if(slot.job_id)labels[slot.job_id]=`配图 ${index+1} · 构思`;if(slot.run_id)labels[slot.run_id]=`配图 ${index+1} · 生成`}
   scopes.push({id:batch.id,title:`生成 ${batch.slots.length} 张${batch.purpose==='article'?'文章':'图文'}配图`,route:batch.flow_id?'studio/flow?work='+encodeURIComponent(batch.flow_id)+'&step=4':'studio/text',created:batch.activity_created||'',members:unique(batch.slots.flatMap((slot:any)=>[slot.job_id,slot.run_id])),operations:[],pending,summary:`${done} / ${batch.slots.length} 张已完成`,labels,slots:batch.slots.map((slot:any,index:number)=>({id:batch.id+':image:'+index,title:`配图 ${index+1}`,status:slot.status,job_id:slot.job_id,run_id:slot.run_id,error:slot.error}))});
  }catch{}
 }
 return scopes;
}
// Planning and rendering are stages of one requested image, not separate user tasks.
export function visibleScopeTasks(scope:TaskScope,tasks:Item[]):Item[]{
 if(!scope.slots)return tasks.filter(item=>scope.members.includes(item.id)||scope.operations.includes(item.id)).map(item=>({...item,display_title:scope.labels?.[item.id]}));
 return scope.slots.map(slot=>{
  const job=tasks.find(item=>item.id===slot.job_id),run=tasks.find(item=>item.id===slot.run_id),children=[job,run].filter(Boolean) as Item[];
  const effectiveStatus=run&&['succeeded','failed','unknown','archive_failed','cancelled','expired'].includes(run.status)?run.status:!run&&job&&['failed','interrupted','cancelled'].includes(job.status)?job.status:slot.status;
  const terminal=['succeeded','failed','unknown','archive_failed','cancelled','expired','interrupted'].includes(effectiveStatus);
  const status=terminal?effectiveStatus:slot.status==='new'||slot.status==='prepared'?'queued':'running';
  const times=(field:string)=>children.map(item=>item[field]).filter((value:any)=>typeof value==='string'&&Number.isFinite(Date.parse(value))).sort((a:string,b:string)=>Date.parse(a)-Date.parse(b));
  const starts=times('started_at'),created=times('created');
  const progress=status==='succeeded'?'图片已就绪':slot.error||(terminal?run?.progress||job?.progress:'')||(!slot.run_id&&/prompt/.test(slot.status)?'正在构思画面':slot.run_id?run?.progress||'正在生成图片':slot.status==='new'?'等待开始':'正在准备图片');
  return {id:slot.id,kind:'image_task',title:slot.title,version:1,updated:run?.updated||job?.updated||scope.created,status,display_title:slot.title,activity_route:scope.route,created:created[0]||scope.created,started_at:starts[0],finished_at:['succeeded','failed','cancelled','expired','interrupted'].includes(status)?(run?run.finished_at:job?.finished_at):undefined,error:slot.error||(['failed','unknown','archive_failed'].includes(status)?run?.error||job?.error:undefined),progress,progress_history:children.map(item=>({text:(item===job?'画面构思':'图片生成')+' · '+(item.progress||item.status),at:item.finished_at||item.started_at||item.created}))} as Item;
 });
}
export const taskUnresolved=(task:Item)=>taskActive(task)||['unknown','archive_failed'].includes(task.status);
export function scopeHasActive(scope:TaskScope,tasks:Item[]){return !!scope.pending||tasks.some(task=>(scope.members.includes(task.id)||scope.operations.includes(task.id))&&taskUnresolved(task));}
