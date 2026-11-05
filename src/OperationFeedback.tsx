import {useEffect,useRef,useState} from 'react';
import {api,Item} from './api';
import Markdown from './Markdown';
import './feedback.css';
import TaskCenter from './TaskCenter';
import {activityTitle,taskActive,taskNeedsAttention} from './taskActivity';
import {joinTaskScope,readTaskScopes,savedBatchScopes,scopeHasActive,taskUnresolved,visibleScopeTasks,type TaskScopes} from './taskScopes';
export const activeJob=(j?:Item)=>!!j&&['queued','running'].includes(j.status);
export function JobFeedback({job,preview=false,collapsible=false}:{job?:Item;preview?:boolean;collapsible?:boolean}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(!activeJob(job))return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[job?.id,job?.status]);
 if(!job)return null;
 const active=activeJob(job),status=active?(job.progress|| (job.status==='queued'?'正在排队…':'正在处理…')):job.status==='done'?'已完成':job.error||job.progress||'已停止';
 const output=preview&&job.stream_text?<div className="stream-preview"><Markdown text={job.stream_text}/></div>:null;
 return <div className={'inline-job '+(job.status==='failed'?'failed':'')} role="status" aria-live="polite"><span>{active&&<i className="working-dot"/>}{status}{active&&job.started_at?' · '+Math.max(0,Math.floor((clock-Date.parse(job.started_at))/1000))+' 秒':''}</span>{active&&<div className="activity-track" aria-label="任务正在处理"><i/></div>}{job.status==='done'&&job.result?.text&&<small>{job.result.text}</small>}{job.stream_note&&<small>{job.stream_note}</small>}{collapsible?<details className="job-process"><summary>过程与实时输出{active?' · 持续更新':''}</summary><ol>{(job.progress_history||[]).map((step:any,i:number)=><li key={i}>{step.text}</li>)}</ol>{output||<small>{active?'收到回复后，会在这里逐步显示。':'本次过程已结束。'}</small>}<small>这里显示执行进度和回复草稿。</small></details>:output}{active&&<button className="quiet" onClick={()=>void api('/jobs/'+job.id+'/cancel',{}).catch(()=>{})}>停止</button>}</div>
}

// This observer keeps execution alive independently from the selected operation view.
export default function OperationFeedback({route,jobs,onJob,onComplete,userId}:{route:string;jobs:Item[];onJob:(j:Item)=>void;onComplete:()=>void;userId:string}){
 const storageKey='task-center-operations:'+userId;
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[records,setRecords]=useState<Item[]>([]);
 const [scopes,setScopes]=useState<TaskScopes>(()=>readTaskScopes(userId)),scopeRef=useRef(scopes);scopeRef.current=scopes;
 const [ops,setOps]=useState<Item[]>(()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'[]').map((x:Item)=>x.pending&&!x.linked_id?{...x,pending:false,finished_at:undefined,error:'页面已重载，未取得此操作的最终状态；请回到创作页面核查。'}:x)}catch{return []}});
 const known=useRef(new Map<string,Item>()),retired=useRef(new Set<string>()),requestStarts=useRef(new Map<string,string>()),callbacks=useRef({onJob,onComplete});callbacks.current={onJob,onComplete};
 const alive=useRef(true),openRef=useRef(false);
 const putScopes=(value:TaskScopes)=>{scopeRef.current=value;setScopes(value);localStorage.setItem('task-center-scopes:'+userId,JSON.stringify(value))};
 const merge=(items:Item[])=>{for(const item of items){const previous=known.current.get(item.id);if(previous&&Number(item.version||0)<Number(previous.version||0))continue;known.current.set(item.id,{...previous,...item})}setRecords([...known.current.values()])};
 const syncBatches=(activateNew=false)=>{let next=scopeRef.current;for(const batch of savedBatchScopes(userId))if(batch.pending||next.groups.some(group=>group.id===batch.id)){const existed=next.groups.some(group=>group.id===batch.id);next=joinTaskScope(next,batch,activateNew&&!existed)}putScopes(next)};
 const restore=async()=>{const before=new Set(known.current.keys());try{const response=await api<{items:Item[]}>('/studio/activity');const selected=scopeRef.current.groups.find(group=>group.id===scopeRef.current.current);const missing=[...new Set([...(selected?.members||[]),...scopeRef.current.groups.filter(group=>group.unresolved).flatMap(group=>group.members),...savedBatchScopes(userId).filter(group=>group.pending).flatMap(group=>group.members)])].filter(id=>!response.items.some(item=>item.id===id)).slice(0,100);if(missing.length){const linked=await api<{items:Item[]}>('/state/updates?ids='+encodeURIComponent(missing.join(',')));response.items.push(...linked.items.filter(item=>['job','studio_run'].includes(item.kind)))}if(alive.current){const ids=new Set(response.items.map(x=>x.id));for(const id of before)if(!ids.has(id)){known.current.delete(id);retired.current.add(id)}merge(response.items);syncBatches();let next=scopeRef.current;
   // Upgrade/restart recovery shows unfinished work only, never a list of historical runs.
   for(const item of response.items.filter(taskUnresolved)){if(next.groups.some(group=>group.members.includes(item.id)))continue;next=joinTaskScope(next,{id:'recovered:'+item.id,title:activityTitle(item),route:item.task_id?'task/'+item.task_id:'studio/works',created:item.created||item.started_at||'',members:[item.id],operations:[]})}
   putScopes(next);setError('')}}catch{if(alive.current)setError('暂时无法更新任务进度，请稍后刷新。')}};
 useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(ops.slice(0,100)))},[ops,storageKey]);
 useEffect(()=>{merge(jobs.filter(x=>['job','studio_run'].includes(x.kind)&&!retired.current.has(x.id)))},[jobs]);
 useEffect(()=>{
  alive.current=true;void restore();let timer:ReturnType<typeof setTimeout>;
  const show=()=>{openRef.current=true;setOpen(true);void restore()};
  const listen=(event:Event)=>{const x=(event as CustomEvent).detail;if(!x?.id)return;
   const at=new Date(x.at||Date.now()).toISOString();if(x.pending&&!requestStarts.current.has(x.id))requestStarts.current.set(x.id,at);const started=requestStarts.current.get(x.id);if(!x.pending)requestStarts.current.delete(x.id);
   const item=x.job||x.run,meaningful=item||/generate|optimize|illustration|\/send$/.test(x.path||'')||/导出|生成|构思|撰写|优化/.test(x.label||'');
   if(!meaningful)return;
   const groupId=x.group_id||x.id,previous=scopeRef.current.groups.find(group=>group.id===groupId);
   const state=item?{...scopeRef.current,groups:scopeRef.current.groups.filter(group=>!group.id.startsWith('recovered:')||!group.members.includes(item.id))}:scopeRef.current;
   if(state.current&&!state.groups.some(group=>group.id===state.current))state.current=groupId;
   putScopes(joinTaskScope(state,{id:groupId,title:x.group_title||(previous?.title|| (item?activityTitle(item):x.label)),route:x.group_route||x.route,created:previous?.created||started||at,members:item?[item.id]:[],operations:[x.id]},!previous));
   setOps(previousOps=>{const old=previousOps.find(row=>row.id===x.id);
    const record={id:x.id,kind:'operation',title:x.label,activity_label:x.label,activity_route:x.route,operation_path:x.path?.split('?')[0],pending:!!x.pending,error:x.error,created:old?.created||started||at,started_at:old?.started_at||started,...(!x.pending?{finished_at:at}:{}),...(item?{linked_id:item.id}:{}),group_id:groupId,version:1,updated:at} as Item;
    return [record,...previousOps.filter(row=>row.id!==x.id)].slice(0,100)});
   if(item){retired.current.delete(item.id);const enriched={...item,activity_label:x.label,activity_route:x.route,operation_path:x.path};merge([enriched]);callbacks.current.onJob(item)}
  };
  const batches=()=>syncBatches(true);
  window.addEventListener('task-center-open',show);window.addEventListener('operation',listen);window.addEventListener('social-picture-batch',batches);window.addEventListener('article-picture-batch',batches);
  const tick=async()=>{const ids=[...known.current.values()].filter(taskActive).map(x=>x.id).slice(0,100);
   if(ids.length)try{const response=await api<{items:Item[]}>('/state/updates?ids='+encodeURIComponent(ids.join(',')));if(alive.current){let completed=false;const received=new Set(response.items.map(x=>x.id));for(const id of ids)if(!received.has(id)){known.current.delete(id);retired.current.add(id)}for(const item of response.items){if(!['job','studio_run'].includes(item.kind))continue;const old=known.current.get(item.id);if(old&&taskActive(old)&&!taskActive(item))completed=true;callbacks.current.onJob(item)}merge(response.items.filter(x=>['job','studio_run'].includes(x.kind)));if(completed)callbacks.current.onComplete()}}catch{if(alive.current&&openRef.current)setError('暂时无法更新进度；任务仍会继续，请稍后刷新。')}
   if(alive.current)timer=setTimeout(tick,1500);
  };void tick();
  return()=>{alive.current=false;clearTimeout(timer);window.removeEventListener('task-center-open',show);window.removeEventListener('operation',listen);window.removeEventListener('social-picture-batch',batches);window.removeEventListener('article-picture-batch',batches)};
 },[userId]);
 const metadata=new Map(ops.filter(x=>x.linked_id).map(x=>[x.linked_id,x]));
 const allTasks=[...records.filter(x=>!x.archived).map(item=>{const op=metadata.get(item.id);return op?{...item,activity_label:op.activity_label,activity_route:op.activity_route,operation_path:op.operation_path}:item}),...ops.filter(x=>!x.linked_id&&x.title!=='保存操作')];
 useEffect(()=>{let changed=false;const groups=scopeRef.current.groups.map(group=>{const members=allTasks.filter(item=>group.members.includes(item.id)||group.operations.includes(item.id));if(!members.length)return group;const unresolved=members.some(taskUnresolved);if(group.unresolved===unresolved)return group;changed=true;return {...group,unresolved}});if(changed)putScopes({...scopeRef.current,groups})},[records,ops,scopes.current]);
 const current=scopes.groups.find(group=>group.id===scopes.current),tasks=current?visibleScopeTasks(current,allTasks).sort((a,b)=>Number(taskActive(b))-Number(taskActive(a))||Date.parse(b.created||b.started_at||'')-Date.parse(a.created||a.started_at||'')):[];
 const available=scopes.groups.filter(group=>group.id===scopes.current||scopeHasActive(group,allTasks)||visibleScopeTasks(group,allTasks).some(taskNeedsAttention));
 useEffect(()=>{window.dispatchEvent(new CustomEvent('task-center-summary',{detail:{active:tasks.filter(taskActive).length}}))},[records,ops,scopes]);
 return <TaskCenter open={open} tasks={tasks} error={error} scopeTitle={current?.title||''} scopeSummary={current?.slots?`${tasks.filter(item=>item.status==='succeeded').length} / ${tasks.length} 张已完成`:current?.summary||''} scopes={available} currentScope={scopes.current} onScope={id=>putScopes({...scopeRef.current,current:id})} onClose={()=>{openRef.current=false;setOpen(false)}} onRefresh={()=>void restore()}/>;
}
