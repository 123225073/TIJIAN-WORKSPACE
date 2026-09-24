import {useEffect,useState} from 'react';
import {api} from './api';
import {sendKey} from './inputKeys';

const labels:Record<string,string>={title:'名称',industry:'行业与业务',products:'产品与服务',audience:'目标受众',facts:'真实优势与事实',style:'表达风格',contact:'联系方式',restrictions:'表达限制',body:'补充说明',position:'身份定位',views:'观点',channels:'渠道账号'};
export default function ArchiveInterview({t,type,target,onClose}:{t:any;type:string;target?:any;onClose:()=>void}){
 const [session,setSession]=useState<any>(null),[items,setItems]=useState<any[]>([]),[answer,setAnswer]=useState(''),[fields,setFields]=useState<any>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{const r=await api('/studio/interviews');setItems(r.items);return r.items};
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 const choose=(s:any)=>{setSession(s);setFields(s.fields||{});setAnswer(localStorage.getItem('interview-answer:'+t.state.user.id+':'+s.id)||'');setError('')};
 const changeAnswer=(value:string)=>{setAnswer(value);if(session)try{localStorage.setItem('interview-answer:'+t.state.user.id+':'+session.id,value)}catch{setError('回答暂存失败，请勿关闭页面')}};
 const turn=async(s:any,summary=false)=>{
  const j=await api('/studio/interviews/'+s.id+'/turn',{version:s.version,answer,summarize:summary,request_id:crypto.randomUUID()});
  let job=j;
  while(['queued','running'].includes(job.status)){await new Promise(r=>setTimeout(r,900));job=await api('/jobs/'+j.id)}
  if(job.status!=='done')throw new Error(job.error||'本轮未完成，请重试');
  localStorage.removeItem('interview-answer:'+t.state.user.id+':'+s.id);const rows=await load();choose(rows.find((v:any)=>v.id===s.id));
 };
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 return <div className="st-modal-backdrop"><section className="st-interview" role="dialog" aria-modal="true" aria-label="AI 访谈建档"><header><div><small>AI 访谈 · {type==='brand'?'品牌资料':'创作身份'}</small><h2>{target?'补充现有档案':'聊一聊，建立你的档案'}</h2></div><button disabled={busy} onClick={onClose}>关闭</button></header><p>可以随时结束问答。AI 整理后由你编辑确认，才会更新档案。</p>
 {!session&&<><button className="st-primary" disabled={busy} onClick={()=>void run(async()=>{const s=await api('/studio/interviews',{type,target_id:target?.id||''});choose(s);await turn(s)})}>开始 AI 访谈</button>{items.filter(x=>x.type===type&&x.target_id===(target?.id||'')&&x.status!=='applied').map(x=><button key={x.id} onClick={()=>choose(x)}>继续上次访谈 · {new Date(x.updated).toLocaleString()}</button>)}</>}
 {session&&<><div className="st-interview-chat">{session.messages.map((m:any,i:number)=><article key={i} className={m.role}><strong>{m.role==='user'?'你':'AI 顾问'}</strong><p>{m.content}</p></article>)}</div>{session.status==='review'?<><h3>核对整理结果</h3><div className="st-interview-fields">{Object.entries(fields).map(([k,v])=><label key={k}>{labels[k]||k}<textarea value={String(v)} onChange={e=>setFields({...fields,[k]:e.target.value})}/></label>)}</div><button className="st-primary" disabled={busy} onClick={()=>void run(async()=>{await api('/studio/interviews/'+session.id+'/apply',{version:session.version,fields});await t.refresh();onClose()})}>确认更新到{type==='brand'?'品牌资料':'创作身份'}</button><button disabled={busy} onClick={()=>setSession({...session,status:'interview'})}>继续补充</button></>:<><textarea onKeyDown={e=>sendKey(e,()=>{if(!busy&&answer.trim())void run(()=>turn(session))},changeAnswer)} aria-label="访谈回答" placeholder="Enter 发送，Ctrl + Enter 换行。暂不清楚可以直接说明。" value={answer} readOnly={busy} onChange={e=>changeAnswer(e.target.value)} rows={4}/><div className="st-inline"><button className="st-primary" disabled={busy||!answer.trim()} onClick={()=>void run(()=>turn(session))}>发送回答</button><button disabled={busy} onClick={()=>void run(()=>turn(session,true))}>没有更多信息了 · 结束并整理</button></div></>}</>}
 {busy&&<p role="status">AI 正在处理，请稍候…</p>}{error&&<p className="st-alert" role="alert">{error}</p>}</section></div>
}
