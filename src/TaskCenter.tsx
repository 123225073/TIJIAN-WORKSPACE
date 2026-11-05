import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,CheckCircle2,ChevronDown,Clock3,LoaderCircle,RefreshCw,TriangleAlert,X} from 'lucide-react';
import type {Item} from './api';
import type {TaskScope} from './taskScopes';
import {activityRoute,activityTitle,taskActive,taskElapsed,taskNeedsAttention,taskStatus,taskTime} from './taskActivity';
import './task-center.css';

const timeLabel=(value:unknown)=>taskTime(value)===null?'尚未开始':new Date(value as string).toLocaleTimeString('zh-CN',{hour12:false});
const displayTitle=(task:Item)=>task.display_title||activityTitle(task);
const elapsedLabel=(task:Item,now:number)=>taskElapsed(task,now)==='未记录'?(taskActive(task)?'等待开始':'耗时未记录'):taskElapsed(task,now);
export default function TaskCenter({open,tasks,error,onClose,onRefresh,scopeTitle='',scopeSummary='',scopes=[],currentScope='',onScope}:{open:boolean;tasks:Item[];error:string;onClose:()=>void;onRefresh:()=>void;scopeTitle?:string;scopeSummary?:string;scopes?:TaskScope[];currentScope?:string;onScope?:(id:string)=>void}){
 const [selected,setSelected]=useState(''),[now,setNow]=useState(Date.now()),[noticeUntil,setNoticeUntil]=useState(0);
 const previous=useRef({scope:currentScope,active:false});
 const active=tasks.filter(taskActive),attention=tasks.filter(item=>!taskActive(item)&&taskNeedsAttention(item)),complete=tasks.filter(item=>!taskActive(item)&&!taskNeedsAttention(item)&&(['done','succeeded'].includes(item.status)||item.kind==='operation')).length;
 const task=tasks.find(x=>x.id===selected);
 useEffect(()=>{setSelected('')},[currentScope]);
 useEffect(()=>{if(!noticeUntil)return;const timer=setTimeout(()=>setNoticeUntil(0),Math.max(0,noticeUntil-Date.now()));return()=>clearTimeout(timer)},[noticeUntil]);
 useEffect(()=>{if(!open&&!active.length&&!noticeUntil)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[open,active.length,noticeUntil]);
 useEffect(()=>{
  const old=previous.current;previous.current={scope:currentScope,active:active.length>0};
  if(old.scope===currentScope&&old.active&&!active.length&&tasks.length){setNoticeUntil(Date.now()+6000);if(!attention.length){const timer=setTimeout(onClose,1400);return()=>clearTimeout(timer)}}
 },[currentScope,active.length,attention.length,tasks.length]);
 useEffect(()=>{if(!open)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[open,onClose]);
 const capsule=!open&&tasks.length>0&&(active.length>0||attention.length>0||now<noticeUntil);
 return createPortal(<>
  {capsule&&<button className={'task-progress-capsule '+(active.length?'is-running':attention.length?'has-error':'is-complete')} onClick={()=>window.dispatchEvent(new CustomEvent('task-center-open'))} aria-label="查看本次任务进度"><span className="task-capsule-icon">{active.length?<LoaderCircle size={19} className="spin"/>:attention.length?<TriangleAlert size={19}/>:<CheckCircle2 size={19}/>}</span><span><strong>{active.length?scopeTitle||'正在创作':attention.length?'有任务需要处理':'本次创作已完成'}</strong><small>{active.length?`${complete} / ${tasks.length} 项已完成`:attention.length?`${attention.length} 项需要核查`:`${tasks.length} 项已完成`}</small></span><ChevronDown size={16}/>{active.length>0&&<span className="task-capsule-track"><i/></span>}</button>}
  {open&&<section className="task-center" data-open="true" role="dialog" aria-modal="false" aria-labelledby="task-center-title">
   <header className="task-center-head"><div><span className="task-center-eyebrow">{active.length?'正在创作 · 可继续操作页面':'本次操作'}</span><h2 id="task-center-title">当前任务 <span>{tasks.length}</span></h2></div><button className="task-center-close" onClick={onClose} aria-label="关闭任务进度"><X size={19}/></button></header>
   <div className="task-center-scope"><strong>{scopeTitle||'暂无任务'}</strong><span>{scopeSummary||(active.length?'任务在后台继续，收起不会中断。':'进度和实际用时保留在这里。')}</span>{scopes.length>1&&<select aria-label="切换未完成操作" value={currentScope} onChange={event=>onScope?.(event.target.value)}>{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.title}</option>)}</select>}</div>
   {error&&<p className="task-center-error" role="alert">{error}</p>}
   <div className="task-center-body"><div className="task-center-list" aria-label="任务记录">{tasks.map(item=><div className="task-center-row" key={item.id}><button aria-pressed={task?.id===item.id} onClick={()=>setSelected(task?.id===item.id?'':item.id)}><span className={'task-center-symbol '+(taskActive(item)?'active':taskNeedsAttention(item)?'attention':'complete')}>{taskActive(item)?<LoaderCircle size={18} className="spin"/>:taskNeedsAttention(item)?<TriangleAlert size={18}/>:<CheckCircle2 size={18}/>}</span><span><strong>{displayTitle(item)}</strong><small>{item.progress||taskStatus(item)}</small></span><time>{elapsedLabel(item,now)}</time><ChevronDown size={15}/></button>{task?.id===item.id&&<section className="task-center-detail" aria-label="任务详情"><dl><div><dt><Clock3 size={14}/>{taskActive(task)?'已用时间':'执行耗时'}</dt><dd data-task-elapsed={task.id}>{elapsedLabel(task,now)}</dd></div><div><dt>开始时间</dt><dd>{timeLabel(task.started_at)}</dd></div>{task.finished_at&&<div><dt>结束时间</dt><dd>{timeLabel(task.finished_at)}</dd></div>}</dl>{task.error&&<p className="task-center-error" role="alert">{task.error}</p>}{!!task.progress_history?.length&&<details className="task-center-history"><summary>执行阶段</summary><ol>{task.progress_history.map((entry:any,index:number)=><li key={index}>{entry.text}</li>)}</ol></details>}<button className="task-center-return" onClick={()=>{location.hash=activityRoute(task);onClose()}}>回到创作页面<ArrowUpRight size={14}/></button></section>}</div>)}{!tasks.length&&<p className="task-center-empty">开始写作或生成图片后，本次进度会显示在这里。</p>}</div></div>
   <footer className="task-center-footer"><span>{active.length?`${active.length} 项进行中`:attention.length?`${attention.length} 项需处理`:'本次任务已结束'}</span><button onClick={onRefresh}><RefreshCw size={14}/>刷新进度</button></footer>
  </section>}
 </>,document.body);
}
