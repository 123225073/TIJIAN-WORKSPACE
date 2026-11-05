import {useEffect,useRef,useState} from 'react';
import {api,Item} from './api';
import Markdown from './Markdown';
import './feedback.css';
import TaskCenter from './TaskCenter';
import {taskActive} from './taskActivity';
export const activeJob=(j?:Item)=>!!j&&['queued','running'].includes(j.status);
export function JobFeedback({job,preview=false,collapsible=false}:{job?:Item;preview?:boolean;collapsible?:boolean}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(!activeJob(job))return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[job?.id,job?.status]);
 if(!job)return null;
 const active=activeJob(job),status=active?(job.progress|| (job.status==='queued'?'正在排队…':'正在处理…')):job.status==='done'?'已完成':job.error||job.progress||'已停止';
 const output=preview&&job.stream_text?<div className="stream-preview"><Markdown text={job.stream_text}/></div>:null;
 return <div className={'inline-job '+(job.status==='failed'?'failed':'')} role="status" aria-live="polite"><span>{active&&<i className="working-dot"/>}{status}{active&&job.started_at?' · '+Math.max(0,Math.floor((clock-Date.parse(job.started_at))/1000))+' 秒':''}</span>{active&&<div className="activity-track" aria-label="任务正在处理"><i/></div>}{job.status==='done'&&job.result?.text&&<small>{job.result.text}</small>}{job.stream_note&&<small>{job.stream_note}</small>}{collapsible?<details className="job-process"><summary>过程与实时输出{active?' · 持续更新':''}</summary><ol>{(job.progress_history||[]).map((step:any,i:number)=><li key={i}>{step.text}</li>)}</ol>{output||<small>{active?'收到回复后，会在这里逐步显示。':'本次过程已结束。'}</small>}<small>这里显示执行进度和回复草稿。</small></details>:output}{active&&<button className="quiet" onClick={()=>void api('/jobs/'+job.id+'/cancel',{}).catch(()=>{})}>停止</button>}</div>
}

// One observer owns operation progress; closing the center never changes execution.
export default function OperationFeedback({route,jobs,onJob,onComplete,userId}:{route:string;jobs:Item[];onJob:(j:Item)=>void;onComplete:()=>void;userId:string}){
 const storageKey='task-center-operations:'+userId;
 const [open,setOpen]=useState(false),[error,setError]=useState(''),[records,setRecords]=useState<Item[]>([]);
 const [ops,setOps]=useState<Item[]>(()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'[]').map((x:Item)=>x.pending&&!x.linked_id?{...x,pending:false,finished_at:undefined,error:'页面已重载，未取得此操作的最终状态；请回到创作页面核查。'}:x)}catch{return []}});
 const known=useRef(new Map<string,Item>()),retired=useRef(new Set<string>()),requestStarts=useRef(new Map<string,string>()),callbacks=useRef({onJob,onComplete});callbacks.current={onJob,onComplete};
 const alive=useRef(true),openRef=useRef(false),hasShown=useRef(false);
 const merge=(items:Item[])=>{for(const item of items){const previous=known.current.get(item.id);if(previous&&Number(item.version||0)<Number(previous.version||0))continue;known.current.set(item.id,{...previous,...item})}setRecords([...known.current.values()])};
 const restore=async()=>{const before=new Set(known.current.keys());try{const response=await api<{items:Item[]}>('/studio/activity');if(alive.current){const ids=new Set(response.items.map(x=>x.id));for(const id of before)if(!ids.has(id)){known.current.delete(id);retired.current.add(id)}merge(response.items);setError('')}}catch{if(alive.current)setError('暂时无法更新任务记录，请稍后刷新。')}};
 useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(ops.slice(0,40)))},[ops,storageKey]);
 useEffect(()=>{merge(jobs.filter(x=>['job','studio_run'].includes(x.kind)&&!retired.current.has(x.id)))},[jobs]);
 useEffect(()=>{
  alive.current=true;void restore();let timer:ReturnType<typeof setTimeout>;
  const show=()=>{hasShown.current=true;openRef.current=true;setOpen(true);void restore()};
  const listen=(event:Event)=>{const x=(event as CustomEvent).detail;if(!x?.id)return;
   const at=new Date(x.at||Date.now()).toISOString();if(x.pending&&!requestStarts.current.has(x.id))requestStarts.current.set(x.id,at);const started=requestStarts.current.get(x.id);if(!x.pending)requestStarts.current.delete(x.id);
   const item=x.job||x.run,meaningful=item||/generate|optimize|illustration|\/send$/.test(x.path||'')||/导出|生成|构思|撰写|优化/.test(x.label||'');
   if(!meaningful&&!x.error)return;
   setOps(previous=>{const old=previous.find(row=>row.id===x.id);
    const record={id:x.id,kind:'operation',title:x.label,activity_label:x.label,activity_route:x.route,operation_path:x.path?.split('?')[0],pending:!!x.pending,error:x.error,created:old?.created||started||at,started_at:old?.started_at||started,...(!x.pending?{finished_at:at}:{}),...(item?{linked_id:item.id}:{}),version:1,updated:at} as Item;
    return [record,...previous.filter(row=>row.id!==x.id)].slice(0,40)});
   if(item){retired.current.delete(item.id);const enriched={...item,activity_label:x.label,activity_route:x.route,operation_path:x.path};merge([enriched]);callbacks.current.onJob(item)}
   if(meaningful&&x.pending&&!hasShown.current){hasShown.current=true;openRef.current=true;setOpen(true)}
  };
  window.addEventListener('task-center-open',show);window.addEventListener('operation',listen);
  const tick=async()=>{const ids=[...known.current.values()].filter(taskActive).map(x=>x.id).slice(0,100);
   if(ids.length)try{const response=await api<{items:Item[]}>('/state/updates?ids='+encodeURIComponent(ids.join(',')));if(alive.current){let completed=false;const received=new Set(response.items.map(x=>x.id));for(const id of ids)if(!received.has(id)){known.current.delete(id);retired.current.add(id)}for(const item of response.items){if(!['job','studio_run'].includes(item.kind))continue;const old=known.current.get(item.id);if(old&&taskActive(old)&&!taskActive(item))completed=true;callbacks.current.onJob(item)}merge(response.items.filter(x=>['job','studio_run'].includes(x.kind)));if(completed)callbacks.current.onComplete()}}catch{if(alive.current&&openRef.current)setError('暂时无法更新进度；任务仍会继续，请稍后刷新。')}
   if(alive.current)timer=setTimeout(tick,1500);
  };void tick();
  return()=>{alive.current=false;clearTimeout(timer);window.removeEventListener('task-center-open',show);window.removeEventListener('operation',listen)};
 },[userId]);
 const metadata=new Map(ops.filter(x=>x.linked_id).map(x=>[x.linked_id,x]));
 const tasks=[...records.filter(x=>!x.archived).map(item=>{const op=metadata.get(item.id);return op?{...item,activity_label:op.activity_label,activity_route:op.activity_route,operation_path:op.operation_path}:item}),...ops.filter(x=>!x.linked_id)].sort((a,b)=>Number(taskActive(b))-Number(taskActive(a))||Date.parse(b.created||b.started_at||'')-Date.parse(a.created||a.started_at||'')).slice(0,80);
 useEffect(()=>{window.dispatchEvent(new CustomEvent('task-center-summary',{detail:{active:tasks.filter(taskActive).length}}))},[records,ops]);
 return <TaskCenter open={open} tasks={tasks} error={error} onClose={()=>{openRef.current=false;setOpen(false)}} onRefresh={()=>void restore()}/>;
}
