import {useEffect,useRef,useState} from 'react';
import {api,Item} from './api';
import Markdown from './Markdown';
import './feedback.css';
export const activeJob=(j?:Item)=>!!j&&['queued','running'].includes(j.status);
export function JobFeedback({job,preview=false}:{job?:Item;preview?:boolean}){
 if(!job)return null;
 const active=activeJob(job),status=active?job.progress:job.status==='done'?'已完成':job.error||job.progress||'已停止';
 return <div className={'inline-job '+(job.status==='failed'?'failed':'')} role="status"><span>{active&&<i className="working-dot"/>}{status}{active&&job.started_at?' · '+Math.max(0,Math.floor((Date.now()-Date.parse(job.started_at))/1000))+' 秒':''}</span>{job.status==='done'&&job.result?.text&&<small>{job.result.text}</small>}{job.stream_note&&<small>{job.stream_note}</small>}{preview&&job.stream_text&&<div className="stream-preview"><Markdown text={job.stream_text}/></div>}{active&&<button className="quiet" onClick={()=>void api('/jobs/'+job.id+'/cancel',{}).catch(()=>{})}>停止</button>}</div>
}

// Covers all API operations, including forms and pages that do not own a job panel.
export default function OperationFeedback({route,jobs,onJob,onComplete,userId}:{route:string;jobs:Item[];onJob:(j:Item)=>void;onComplete:()=>void;userId:string}){
 const storageKey='operations:'+userId;
 const [ops,setOps]=useState<any[]>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'[]')}catch{return []}}),known=useRef(new Map<string,Item>()),callbacks=useRef({onJob,onComplete});callbacks.current={onJob,onComplete};
 useEffect(()=>{sessionStorage.setItem(storageKey,JSON.stringify(ops.filter(o=>o.job).map(o=>({...o,job:{id:o.job.id,kind:'job',status:o.job.status}}))))},[ops,storageKey]);
 useEffect(()=>{jobs.forEach(j=>known.current.set(j.id,j))},[jobs]);
 useEffect(()=>{
  const listen=(e:Event)=>{const x=(e as CustomEvent).detail;setOps(rows=>[x,...rows.filter(r=>r.id!==x.id)].slice(0,8));if(x.job){known.current.set(x.job.id,x.job);callbacks.current.onJob(x.job)}};
  window.addEventListener('operation',listen);let stopped=false,timer:any;
  const tick=async()=>{await Promise.all([...known.current.values()].filter(activeJob).map(async old=>{try{const j=await api<Item>('/jobs/'+old.id);known.current.set(j.id,j);if(stopped)return;callbacks.current.onJob(j);if(!activeJob(j))callbacks.current.onComplete()}catch{}}));if(!stopped)timer=setTimeout(tick,250)};void tick();
  return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('operation',listen)};
 },[]);
 const visible=ops.filter(x=>x.route===route).slice(0,3);
 if(!visible.length)return null;
 return <section className="page-operations" aria-label="本页操作进度">{visible.map(x=>{const j=x.job&&(jobs.find(v=>v.id===x.job.id)||x.job);const dedicated=j&&(j.task_id&&route==='task/'+j.task_id||j.input?.action==='probe'&&route==='admin');if(dedicated)return null;return <div key={x.id}><strong>{x.label}</strong>{j?<JobFeedback job={j} preview={activeJob(j)&&!j.task_id}/>:<span role={x.error?'alert':'status'}>{x.error|| (x.pending?'正在处理…':'已完成')}</span>}{!x.pending&&!activeJob(j)&&<button className="quiet" onClick={()=>setOps(v=>v.filter(o=>o.id!==x.id))}>收起</button>}</div>})}</section>
}
