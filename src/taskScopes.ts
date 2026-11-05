import type {Item} from './api';
import {taskActive} from './taskActivity';

export type TaskScope={id:string;title:string;route:string;created:string;members:string[];operations:string[];pending?:boolean;unresolved?:boolean;summary?:string;labels?:Record<string,string>};
export type TaskScopes={current:string;groups:TaskScope[]};
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
export function readTaskScopes(owner:string):TaskScopes{
 try{const value=JSON.parse(localStorage.getItem('task-center-scopes:'+owner)||'null');if(value&&Array.isArray(value.groups))return {current:String(value.current||''),groups:value.groups.filter((x:any)=>x&&typeof x.id==='string'&&Array.isArray(x.members)&&Array.isArray(x.operations))};}catch{}
 return {current:'',groups:[]};
}
export function joinTaskScope(state:TaskScopes,scope:TaskScope,activate=false):TaskScopes{
 const previous=state.groups.find(x=>x.id===scope.id);
 const item={...previous,...scope,labels:{...previous?.labels,...scope.labels},members:unique([...(previous?.members||[]),...scope.members]),operations:unique([...(previous?.operations||[]),...scope.operations])};
 return {current:activate||!state.current?item.id:state.current,groups:[item,...state.groups.filter(x=>x.id!==item.id)]};
}
export function savedBatchScopes(owner:string):TaskScope[]{
 const scopes:TaskScope[]=[];
 for(let index=0;index<localStorage.length;index++){
  const key=localStorage.key(index)||'';if(!key.startsWith('social-picture-batch:'+owner+':')&&!key.startsWith('article-picture-batch:'+owner+':'))continue;
  try{const batch=JSON.parse(localStorage.getItem(key)||'null');if(!batch?.id||batch.owner&&batch.owner!==owner||!Array.isArray(batch.slots))continue;
   const pending=batch.slots.some((slot:any)=>!['succeeded','failed'].includes(slot.status)),done=batch.slots.filter((slot:any)=>slot.status==='succeeded').length;
   const labels:Record<string,string>={};for(const [index,slot] of batch.slots.entries()){if(slot.job_id)labels[slot.job_id]=`配图 ${index+1} · 构思`;if(slot.run_id)labels[slot.run_id]=`配图 ${index+1} · 生成`}
   scopes.push({id:batch.id,title:`生成 ${batch.slots.length} 张${batch.purpose==='article'?'文章':'图文'}配图`,route:batch.flow_id?'studio/flow?work='+encodeURIComponent(batch.flow_id)+'&step=4':'studio/text',created:batch.activity_created||'',members:unique(batch.slots.flatMap((slot:any)=>[slot.job_id,slot.run_id])),operations:[],pending,summary:`${done} / ${batch.slots.length} 张已完成`,labels});
  }catch{}
 }
 return scopes;
}
export const taskUnresolved=(task:Item)=>taskActive(task)||['unknown','archive_failed'].includes(task.status);
export function scopeHasActive(scope:TaskScope,tasks:Item[]){return !!scope.pending||tasks.some(task=>(scope.members.includes(task.id)||scope.operations.includes(task.id))&&taskUnresolved(task));}
