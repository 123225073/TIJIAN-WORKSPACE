import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,CheckCircle2,Clock3,LoaderCircle,TriangleAlert,X} from 'lucide-react';
import type {Item} from './api';
import type {TaskScope} from './taskScopes';
import {activityRoute,activityTitle,taskActive,taskElapsed,taskNeedsAttention,taskStatus,taskTime} from './taskActivity';
import './task-center.css';

const timeLabel=(value:unknown)=>taskTime(value)===null?'未记录':new Date(value as string).toLocaleString('zh-CN',{hour12:false});
const displayTitle=(task:Item)=>task.display_title||activityTitle(task);
export default function TaskCenter({open,tasks,error,onClose,onRefresh,scopeTitle='',scopeSummary='',scopes=[],currentScope='',onScope}:{open:boolean;tasks:Item[];error:string;onClose:()=>void;onRefresh:()=>void;scopeTitle?:string;scopeSummary?:string;scopes?:TaskScope[];currentScope?:string;onScope?:(id:string)=>void}){
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState(''),[now,setNow]=useState(Date.now());
 const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),previousFocus=useRef<HTMLElement|null>(null);
 const active=tasks.filter(taskActive),attention=tasks.filter(taskNeedsAttention);
 const visible=tasks.filter(task=>filter==='active'?taskActive(task):filter==='attention'?taskNeedsAttention(task):true);
 const task=visible.find(x=>x.id===selected)||visible[0];
 useEffect(()=>{setFilter('all');setSelected('')},[currentScope]);
 useEffect(()=>{if(!open)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[open]);
 useEffect(()=>{if(!open)return;previousFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();close.current?.focus();return()=>{dialog.current?.close();previousFocus.current?.focus()}},[open]);
 if(!open)return null;
 return createPortal(<dialog ref={dialog} className="task-center" aria-labelledby="task-center-title" onCancel={event=>{event.preventDefault();onClose()}}>
  <header className="task-center-head"><div><span className="task-center-eyebrow">工作进度</span><h2 id="task-center-title">当前任务</h2><p>关闭后继续执行，随时从右上角重新打开。</p></div><button ref={close} className="quiet task-center-close" onClick={onClose} aria-label="关闭任务进度"><X size={19}/><span>关闭</span></button></header>
  <nav className="task-center-filters" aria-label="筛选任务">{[['all','本次阶段',tasks.length],['active','进行中',active.length],['attention','需处理',attention.length]].map(([id,label,count])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(String(id))}>{label}<b>{count}</b></button>)}<button className="quiet task-center-refresh" onClick={onRefresh}>刷新记录</button></nav>
  {scopeTitle&&<div className="task-center-scope"><div><strong>{scopeTitle}</strong><span>{scopeSummary||'仅展示本次操作的任务，关闭后仍可继续查看。'}</span></div>{scopes.length>1&&<label>切换未完成操作<select aria-label="切换未完成操作" value={currentScope} onChange={event=>onScope?.(event.target.value)}>{scopes.map(scope=><option key={scope.id} value={scope.id}>{scope.title}</option>)}</select></label>}</div>}
  {error&&<p className="task-center-error" role="alert">{error}</p>}
  <div className="task-center-body"><aside className="task-center-list" aria-label="任务记录">{visible.map(item=><button key={item.id} aria-pressed={task?.id===item.id} onClick={()=>setSelected(item.id)}><span className={'task-center-symbol '+(taskActive(item)?'active':taskNeedsAttention(item)?'attention':'complete')}>{taskActive(item)?<LoaderCircle size={18} className="spin"/>:taskNeedsAttention(item)?<TriangleAlert size={18}/>:<CheckCircle2 size={18}/>}</span><span><strong>{displayTitle(item)}</strong><small>{taskStatus(item)} · {taskElapsed(item,now)}</small></span></button>)}{!visible.length&&<p className="task-center-empty">{filter==='active'?'目前没有正在执行的任务':filter==='attention'?'目前没有需要处理的任务':'本次还没有执行阶段。开始写作或生成图片后，进度会显示在这里。'}</p>}</aside>
  <section className="task-center-detail" aria-label="任务详情">{task?<><div className="task-center-task-head"><span className={'task-center-status '+(taskActive(task)?'active':taskNeedsAttention(task)?'attention':'complete')}>{taskActive(task)&&<i className="working-dot"/>}{taskStatus(task)}</span><h3>{displayTitle(task)}</h3>{!task.display_title&&task.title&&task.title!==activityTitle(task)&&!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(task.title)&&<p>{task.title}</p>}</div><dl className="task-center-times"><div><dt><Clock3 size={16}/>{taskActive(task)?'已用时间':'执行耗时'}</dt><dd data-task-elapsed={task.id}>{taskElapsed(task,now)}</dd></div><div><dt>开始时间</dt><dd>{timeLabel(task.started_at)}</dd></div><div><dt>{taskActive(task)?'提交时间':'结束时间'}</dt><dd>{timeLabel(taskActive(task)?task.created:task.finished_at)}</dd></div></dl>
  <div className={'task-center-stage '+(task.error?'has-error':'')} role="status"><strong>{task.error?'需要处理':'当前进度'}</strong><p>{task.error||task.progress||taskStatus(task)}</p>{task.kind==='studio_run'&&task.batch&&<small>{task.batch.filter((x:any)=>x.status==='succeeded').length} / {task.batch.length} 项已完成</small>}</div>
  {!!task.progress_history?.length&&<details className="task-center-history"><summary>执行记录 · {task.progress_history.length} 个阶段</summary><ol>{task.progress_history.map((entry:any,index:number)=><li key={index}><span>{entry.text}</span><time>{timeLabel(entry.at)}</time></li>)}</ol></details>}
  <footer className="task-center-task-footer"><button onClick={()=>{location.hash=activityRoute(task);onClose()}}>回到创作页面<ArrowUpRight size={15}/></button><small>{taskElapsed(task,now)==='未记录'?'该历史任务没有完整的执行时间记录。':'耗时来自实际执行记录，完成后停止计时。'}</small></footer></>:<div className="task-center-blank"><Clock3 size={36}/><p>本次操作的进度与用时会显示在这里</p></div>}</section></div>
 </dialog>,document.body);
}
