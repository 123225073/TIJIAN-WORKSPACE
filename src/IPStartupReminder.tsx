import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,UserRound} from 'lucide-react';
import './ip-guide.css';

/** Dismissal lasts only for this app opening and this signed-in workspace. */
export default function IPStartupReminder({t,route:providedRoute}:{t:any;route?:string}){
 const [dismissed,setDismissed]=useState(false);
 const [route,setRoute]=useState(location.hash);
 const dialog=useRef<HTMLDialogElement>(null),id=useId();
 const ready=t.state?.complete!==false;
 const completed=(t.list?.('profile')||[]).some((p:any)=>!p.archived&&p.status==='accepted');
 const inGuide=(providedRoute??route).replace(/^#/,'').split('?')[0]==='studio/ip-guide';
 const show=ready&&!completed&&!dismissed&&!inGuide;
 useEffect(()=>{const change=()=>setRoute(location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
 useEffect(()=>{if(inGuide)setDismissed(true)},[inGuide]);
 useEffect(()=>{if(!show)return;const previous=document.activeElement as HTMLElement|null,node=dialog.current;node?.showModal();return()=>{node?.close();if(previous?.isConnected)previous.focus({preventScroll:true})}},[show]);
 if(!show)return null;
 return <dialog ref={dialog} className="ip-startup-reminder" aria-labelledby={id+'-title'} aria-describedby={id+'-intro '+id+'-progress'} onCancel={event=>{event.preventDefault();setDismissed(true)}} onKeyDown={event=>{if(event.key!=='Tab')return;const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),first=buttons[0],last=buttons[buttons.length-1];if(!first){event.preventDefault();return}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}>
  <div className="ip-reminder-content"><div className="ip-reminder-icon"><UserRound size={27} aria-hidden="true"/></div><span className="ip-reminder-eyebrow">个人 IP 定位</span><h2 id={id+'-title'}>先让梯世界认识你</h2>
  <p id={id+'-intro'}>把你的业务、客户和真实优势整理成一份个人定位报告，后续选题、文章和视频就能围绕同一个方向创作。</p>
  <div className="ip-reminder-progress" id={id+'-progress'}><strong>12 个问题，一步步完成</strong><span>不清楚的可以先跳过；回答会保存，下次可接着填写。完成后先阅读报告，由你确认建立 IP。</span></div>
  <div className="ip-reminder-actions"><button type="button" className="ip-reminder-primary" onClick={()=>{setDismissed(true);location.hash='studio/ip-guide'}}>开始 IP 定位 <ArrowRight size={16} aria-hidden="true"/></button><button type="button" onClick={()=>setDismissed(true)}>稍后再做</button></div>
  <p className="ip-reminder-footnote">也可以稍后从“我的 IP”继续，不影响使用工作台。</p></div>
 </dialog>;
}
