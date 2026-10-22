import {ArrowLeft,Check,MessageCircle,FileText,ShieldCheck} from 'lucide-react';
import {useState} from 'react';
import ArchiveInterview from './ArchiveInterview';
import './ip-guide.css';

export default function IPGuide({t,query=''}:{t:any;query?:string}){
 const params=new URLSearchParams(query),taskId=params.get('task')||'',targetId=params.get('target')||'',sessionId=params.get('session')||'';
 const [stage,setStage]=useState(0),[sessionTarget,setSessionTarget]=useState('');
 const target=(targetId||sessionTarget)?t.get?.(targetId||sessionTarget):undefined;
 const back=()=>{location.hash=taskId?'task/'+encodeURIComponent(taskId):'studio/brand'};
 if(t.state?.complete===false)return <section className="ip-guide-page" aria-label="IP 定位引导"><p role="status">正在恢复定位进度…</p></section>;
 if(targetId&&(!target||target.archived||target.kind!=='profile'))return <section className="ip-guide-page"><h1>原 IP 不可用</h1><p>请从“我的 IP”重新选择要完善的档案。</p><button onClick={back}>返回</button></section>;
 return <section className="ip-guide-page" aria-label="IP 定位引导">
  <header className="ip-guide-heading"><button onClick={back}><ArrowLeft size={16}/>{taskId?'返回 Agent 对话':'返回我的 IP'}</button><span>进度自动保存</span></header>
  <div className="ip-guide-intro"><span className="ip-guide-kicker">PERSONAL IP / AGENT</span><h1>{target?'完善个人 IP 定位':'建立你的个人 IP'}</h1><p>跟随 Agent 说清实际情况，最后得到一份可直接阅读、用于创作的定位报告。</p></div>
  <ol className="ip-guide-steps" aria-label="定位步骤">{[[MessageCircle,'沟通定位'],[FileText,'生成报告'],[ShieldCheck,'确认保存']].map(([Icon,label],index)=>{const Mark=Icon as typeof Check;return <li key={String(label)} className={index===stage?'current':index<stage?'complete':''} aria-current={index===stage?'step':undefined}><span>{index<stage?<Check size={17}/>:<Mark size={17}/>}</span><strong>{label as string}</strong><small>{['逐题回答，可随时继续','大标题与章节正文','核对后建立档案'][index]}</small></li>})}</ol>
  <ArchiveInterview t={t} type="profile" target={target} embedded sourceTaskId={taskId} sessionId={sessionId} modelId={params.get('model')||''} onStageChange={setStage} onSessionChange={session=>setSessionTarget(session.target_id||'')} onClose={back} onApplied={profile=>{t.setToast?.('个人 IP 报告已保存');location.hash='studio/brand?profile='+encodeURIComponent(profile.id)}}/>
 </section>;
}
