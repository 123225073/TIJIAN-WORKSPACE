import {useEffect,useRef,useState} from 'react';
import {api,Item} from './api';
import Markdown from './Markdown';
import './feedback.css';
export const activeJob=(j?:Item)=>!!j&&['queued','running'].includes(j.status);
export function JobFeedback({job,preview=false,collapsible=false}:{job?:Item;preview?:boolean;collapsible?:boolean}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(!activeJob(job))return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[job?.id,job?.status]);
 if(!job)return null;
 const active=activeJob(job),status=active?(job.progress|| (job.status==='queued'?'正在排队…':'正在处理…')):job.status==='done'?'已完成':job.error||job.progress||'已停止';
 const output=preview&&job.stream_text?<div className="stream-preview"><Markdown text={job.stream_text}/></div>:null;
 return <div className={'inline-job '+(job.status==='failed'?'failed':'')} role="status" aria-live="polite"><span>{active&&<i className="working-dot"/>}{status}{active&&job.started_at?' · '+Math.max(0,Math.floor((clock-Date.parse(job.started_at))/1000))+' 秒':''}</span>{active&&<div className="activity-track" aria-label="任务正在处理"><i/></div>}{job.status==='done'&&job.result?.text&&<small>{job.result.text}</small>}{job.stream_note&&<small>{job.stream_note}</small>}{collapsible?<details className="job-process"><summary>过程与实时输出{active?' · 持续更新':''}</summary><ol>{(job.progress_history||[]).map((step:any,i:number)=><li key={i}>{step.text}</li>)}</ol>{output||<small>{active?'收到回复后，会在这里逐步显示。':'本次过程已结束。'}</small>}<small>这里显示执行进度和回复草稿。</small></details>:output}{active&&<button className="quiet" onClick={()=>void api('/jobs/'+job.id+'/cancel',{}).catch(()=>{})}>停止</button>}</div>
}

// Covers write API operations, including forms and pages that do not own a job panel.
export default function OperationFeedback({route,jobs,onJob,onComplete,userId}:{route:string;jobs:Item[];onJob:(j:Item)=>void;onComplete:()=>void;userId:string}){
 const storageKey='operations:'+userId;
 const [ops,setOps]=useState<any[]>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'[]')}catch{return []}}),known=useRef(new Map<string,Item>()),callbacks=useRef({onJob,onComplete});callbacks.current={onJob,onComplete};
 useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify(ops.filter(o=>o.job).map(o=>({...o,job:{id:o.job.id,kind:'job',status:o.job.status}}))))},[ops,storageKey]);
 useEffect(()=>{jobs.forEach(j=>known.current.set(j.id,j))},[jobs]);
 useEffect(()=>{
  const listen=(e:Event)=>{const x=(e as CustomEvent).detail;setOps(rows=>[x,...rows.filter(r=>r.id!==x.id&&!(r.route===x.route&&(x.error&&r.error===x.error||r.path&&r.path===x.path&&!r.pending&&!activeJob(r.job))))].slice(0,8));if(x.job){known.current.set(x.job.id,x.job);callbacks.current.onJob(x.job)}};
  window.addEventListener('operation',listen);let stopped=false,timer:any;
  const tick=async()=>{await Promise.all([...known.current.values()].filter(activeJob).map(async old=>{try{const j=await api<Item>('/jobs/'+old.id);known.current.set(j.id,j);if(stopped)return;callbacks.current.onJob(j);if(!activeJob(j))callbacks.current.onComplete()}catch{}}));if(!stopped)timer=setTimeout(tick,700)};void tick();
  return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('operation',listen)};
 },[]);
 useEffect(()=>{const timer=setInterval(()=>setOps(rows=>{const now=Date.now(),next=rows.filter(x=>{const j=jobs.find(v=>v.id===x.job?.id)||x.job;return x.pending||activeJob(j)||x.error||now-(j?.finished_at?Date.parse(j.finished_at):x.at||now)<7000});return next.length===rows.length?rows:next}),1000);return()=>clearInterval(timer)},[jobs]);
 const pageOps=ops.filter(x=>x.route===route),latestError=pageOps.find(x=>x.error);
 const visible=pageOps.filter(x=>!x.error||x===latestError).slice(0,3);
 if(!visible.length)return null;
 return <section className="page-operations" aria-label="本页操作进度">{visible.map(x=>{const j=x.job&&(jobs.find(v=>v.id===x.job.id)||x.job);const dedicated=j&&(j.task_id&&route==='task/'+j.task_id||route.startsWith('studio/topics')&&['studio_topics','studio_delivery'].includes(j.input?.action));if(dedicated)return null;return <div key={x.id} className={x.error?'operation-error':''}><strong>{x.label}</strong>{j?<JobFeedback job={j} preview={activeJob(j)&&!j.task_id}/>:<span role={x.error?'alert':'status'}>{x.pending&&<i className="working-dot"/>}{x.error|| (x.pending?'正在处理，请稍候…':'已完成')}</span>}{x.error&&<button className="quiet operation-recover" onClick={()=>window.dispatchEvent(new CustomEvent('operation-recover',{cancelable:true,detail:{path:x.path,error:x.error,route}}))}>定位并处理</button>}{!x.pending&&!activeJob(j)&&<button className="quiet" onClick={()=>setOps(v=>v.filter(o=>o.id!==x.id))}>收起</button>}</div>})}</section>
}
