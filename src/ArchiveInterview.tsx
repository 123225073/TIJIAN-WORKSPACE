import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {sendKey} from './inputKeys';
import IPReport from './IPReport';
import {ipGuideRoute} from './ip-guide-route';
import './ip-questionnaire.css';
import type {IPQuestion,IPQuestionnaireSchema} from './IPQuestionnaire';

const labels:Record<string,string>={title:'名称',industry:'行业与业务',products:'产品与服务',audience:'目标受众',facts:'真实优势与事实',style:'表达风格',contact:'联系方式',restrictions:'表达限制',body:'完整定位策划报告',position:'身份定位',views:'观点与边界',channels:'渠道账号',agency_brands:'代理品牌与业务'};
type Props={t:any;type:string;target?:any;onClose:()=>void;embedded?:boolean;sourceTaskId?:string;sessionId?:string;modelId?:string;onStageChange?:(stage:number)=>void;onSessionChange?:(session:any)=>void;onApplied?:(profile:any)=>void};
export default function ArchiveInterview({t,type,target,onClose,embedded=false,sourceTaskId='',sessionId='',modelId='',onStageChange,onSessionChange,onApplied}:Props){
 const [session,setSession]=useState<any>(null),[items,setItems]=useState<any[]>([]),[answer,setAnswer]=useState(''),[fields,setFields]=useState<any>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [questions,setQuestions]=useState<IPQuestion[]>([]),[editing,setEditing]=useState(''),[editAnswer,setEditAnswer]=useState(''),[showAnswered,setShowAnswered]=useState(false),[hint,setHint]=useState(''),[starting,setStarting]=useState(embedded);
 const lock=useRef(false),root=useRef<HTMLElement>(null),alive=useRef(true),fieldsDraft=useRef('');
 const answerKey=(s:any)=>'interview-answer:'+t.state.user.id+':'+s.id;
 const reportKey=(s:any)=>'interview-report:'+t.state.user.id+':'+s.id;
 const answerStage=(s:any)=>s.questionnaire_version?s.question_index:s.messages?.length;
 const readAnswer=(s:any)=>{const raw=localStorage.getItem(answerKey(s));if(!raw)return '';try{const draft=JSON.parse(raw);if(draft&&typeof draft==='object'&&typeof draft.answer==='string'){if(draft.stage===answerStage(s))return draft.answer;localStorage.removeItem(answerKey(s));return ''}}catch{}return raw};
 const choose=(s:any)=>{
  if(!s)throw Error('未找到访谈，请重新打开定位引导');
  if(!alive.current)return;
  if(embedded&&new URLSearchParams(location.hash.split('?')[1]||'').get('session')!==s.id)history.replaceState(history.state,'','#'+ipGuideRoute({task:s.source_task_id||sourceTaskId,target:s.target_id||target?.id||'',session:s.id,model:modelId}));
  setSession(s);setEditing('');setHint('');setError('');
  onSessionChange?.(s);
  let values=s.fields||{};
  try{const cached=JSON.parse(localStorage.getItem(reportKey(s))||'null');if(s.status==='review'&&cached?.version===s.version)values=cached.fields;setAnswer(readAnswer(s))}catch{setAnswer('')}
  setFields(values);fieldsDraft.current=JSON.stringify(values);
 };
 const load=async()=>{const r=await api('/studio/interviews');if(alive.current)setItems(r.items);return r.items};
 const poll=async(j:any)=>{let job=j;while(['queued','running'].includes(job.status)){await new Promise(r=>setTimeout(r,900));if(!alive.current)return;job=await api('/jobs/'+j.id)}if(job.status!=='done')throw new Error(job.error||'本轮未完成，请重试')};
 const resume=async(s:any)=>{choose(s);if(s.active_job){await poll(s.active_job);if(alive.current){const rows=await load();choose(rows.find((v:any)=>v.id===s.id))}}};
 const run=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e:any){if(alive.current)setError(e.message)}finally{lock.current=false;if(alive.current)setBusy(false)}};
 const start=async()=>{
  if(embedded&&sessionId){const rows=await load();const selected=rows.find((s:any)=>s.id===sessionId&&s.type===type);if(!selected)throw Error('这份定位引导不存在或已不可用');if(sourceTaskId&&selected.source_task_id!==sourceTaskId)throw Error('定位引导不属于当前对话，请从原对话重新打开');if(target?.id&&selected.target_id!==target.id)throw Error('定位引导的目标 IP 已变化，请重新打开');await resume(selected);return}
  const s=await api('/studio/interviews',{type,target_id:target?.id||'',...(sourceTaskId?{source_task_id:sourceTaskId}:{}),...(modelId?{model_id:modelId}:{})});
  if(embedded){const rows=await load();await resume(rows.find((row:any)=>row.id===s.id)||s)}else{choose(s);if(!s.questionnaire_version)await turn(s,false,'')}
 };
 useEffect(()=>{
  alive.current=true;const previous=document.activeElement as HTMLElement|null;if(!embedded)root.current?.focus();
  void run(async()=>{try{if(embedded)await start();else await load()}finally{if(alive.current)setStarting(false)}});
  return()=>{alive.current=false;if(!embedded)previous?.focus()};
 },[]);
 useEffect(()=>{if(type==='profile')void api<IPQuestionnaireSchema>('/studio/ip-questionnaire').then(s=>{if(alive.current)setQuestions(s.questions)}).catch(e=>{if(alive.current)setError(e.message)})},[type]);
 useEffect(()=>{onStageChange?.(session?.status==='review'||session?.status==='applied'?2:session?.question_index===12?1:0)},[session?.status,session?.question_index]);
 useEffect(()=>{if(session?.status!=='review'||JSON.stringify(fields)===fieldsDraft.current)return;try{localStorage.setItem(reportKey(session),JSON.stringify({version:session.version,fields}))}catch{setError('报告修改暂存失败，请保持页面打开并确认保存')}},[fields,session?.id,session?.version]);
 const changeAnswer=(value:string)=>{setAnswer(value);if(session)try{localStorage.setItem(answerKey(session),JSON.stringify({stage:answerStage(session),answer:value}))}catch{setError('回答暂存失败，请勿关闭页面')}};
 const turn=async(s:any,summary=false,value=answer)=>{
  const j=await api('/studio/interviews/'+s.id+'/turn',{version:s.version,answer:value,summarize:summary,request_id:crypto.randomUUID(),...(summary&&modelId?{model_id:modelId}:{})});
  if(j.result?.correction_required){setHint(j.result.message);setShowAnswered(true);return}
  await poll(j);if(!alive.current)return;
  localStorage.removeItem(answerKey(s));const rows=await load();const next=rows.find((v:any)=>v.id===s.id);choose(next);
  if(!summary&&embedded&&next?.status==='ready_report')await turn(next,true,'');
 };
 const fixed=session?.questionnaire_version==='ip-positioning-12-v1',waiting=fixed&&session?.status==='ready_report';
 const available=items.filter(x=>x.type===type&&x.target_id===(target?.id||'')&&x.status!=='applied'&&!x.source_task_id);
 const beginEdit=(key:string)=>{setEditing(key);setHint('');try{setEditAnswer(localStorage.getItem(answerKey(session)+':edit:'+key)??session.answers[key])}catch{setEditAnswer(session.answers[key])}};
 const changeEdit=(value:string)=>{setEditAnswer(value);try{localStorage.setItem(answerKey(session)+':edit:'+editing,value)}catch{setError('修正内容暂存失败，请先保存修改')}};
 const saveEdit=()=>run(async()=>{const key=editing;await api('/studio/interviews/'+session.id+'/turn',{version:session.version,request_id:crypto.randomUUID(),question_id:key,answer:editAnswer});localStorage.removeItem(answerKey(session)+':edit:'+key);const rows=await load();choose(rows.find((x:any)=>x.id===session.id));setHint('回答已修改，答题进度不变。已有报告需重新生成后再确认。')});
 const apply=()=>run(async()=>{const saved=await api('/studio/interviews/'+session.id+'/apply',{version:session.version,fields});localStorage.removeItem(reportKey(session));if(alive.current)setSession({...session,status:'applied',applied_id:saved.id});try{await t.refresh()}catch{t.setToast?.('报告已保存，列表刷新失败，请重新打开我的 IP')}if(!alive.current)return;if(onApplied)onApplied(saved);else onClose()});
 const regenerate=()=>run(async()=>{const updated=await api('/studio/interviews',{type,target_id:session.target_id||'',...(session.source_task_id||sourceTaskId?{source_task_id:session.source_task_id||sourceTaskId}:{}),...(modelId||session.model_id?{model_id:modelId||session.model_id}:{})});choose(updated);if(updated.question_index===12)await turn(updated,true,'');else setHint('原档案已更新，已开启新的补充引导；历史回答仍保留。')});
 const fieldEditors=<div className="st-interview-fields">{Object.entries(fields).filter(([k])=>type!=='profile'||k!=='body').map(([k,v])=><label key={k}>{labels[k]||k}<textarea aria-label={labels[k]||k} value={String(v)} disabled={busy} onChange={e=>setFields({...fields,[k]:e.target.value})}/></label>)}</div>;
 const content=<section ref={root} tabIndex={-1} className={'st-interview'+(type==='profile'?' ip-questionnaire-dialog':'')+(embedded?' ip-guided-interview':'')} role={embedded?'region':'dialog'} aria-modal={embedded?undefined:true} aria-label={embedded?'Agent 定位工作区':'AI 访谈建档'}>
  <header><div><small>{type==='profile'?'Agent · 个人 IP 定位':'AI 访谈 · 品牌资料'}</small><h2>{type==='profile'?(session?.status==='review'?'核对你的个人 IP 报告':session?.status==='applied'?'个人 IP 报告已保存':'把你的实际情况说清楚'):target?'补充现有档案':'聊一聊，建立你的档案'}</h2></div>{!embedded&&<button disabled={busy} onClick={onClose}>关闭</button>}</header>
  {!session&&<>{starting?<p role="status">正在恢复 Agent 引导…</p>:<><p>{type==='profile'?'回答会自动保存，不清楚的可标为待确认。':'回答后由 AI 整理，你确认后再写入档案。'}</p><button className="st-primary" disabled={busy} onClick={()=>void run(start)}>{embedded?'重新打开引导':type==='profile'?'开始十二题定位':'开始 AI 访谈'}</button>{!embedded&&available.map(x=><button key={x.id} disabled={busy} onClick={()=>void run(()=>resume(x))}>继续上次访谈 · {x.questionnaire_version?`${Math.min(x.question_index||0,12)}/12 题 · `:''}{new Date(x.updated).toLocaleString()}</button>)}</>}</>}
  {hint&&<p role="status">{hint}</p>}
  {session&&<>{session.status==='applied'?<><p>报告和定位资料已保存，可用于后续选题与创作。</p><a className="ip-guide-result-link" href={'#studio/brand?profile='+encodeURIComponent(session.applied_id)}>查看个人 IP 报告 →</a></>:<>
   {fixed?<><p className="ip-interview-progress">{session.question_index<12?`第 ${session.question_index+1} / 12 题`:'12 / 12 题已完成'}</p><progress aria-label="定位沟通进度" max={12} value={session.question_index}/>{session.report_invalidated&&<p role="status">回答已修改，旧定位报告已失效，请重新生成。</p>}{session.question_index>0&&<details open={showAnswered} onToggle={e=>setShowAnswered(e.currentTarget.open)}><summary>回答记录 · 查看或修改</summary><div className="st-interview-chat">{questions.slice(0,session.question_index).map((q,index)=><article key={q.key}><strong>{index+1}. {q.label}</strong><p>{session.answers[q.key]}</p><button disabled={busy||Boolean(editing)} onClick={()=>beginEdit(q.key)}>修改第 {index+1} 题</button></article>)}</div></details>}{session.status==='interview'&&!editing&&<div className="ip-current-question"><span>Agent 引导</span><h3>{questions[session.question_index]?.question||session.messages.at(-1)?.content}</h3>{questions[session.question_index]?.reference&&<p>{questions[session.question_index].reference}</p>}</div>}</>:<div className="st-interview-chat">{session.messages.map((m:any,i:number)=><article key={i} className={m.role}><strong>{m.role==='user'?'你':'AI 顾问'}</strong><p>{m.content}</p></article>)}</div>}
   {editing?<><label>修改回答：{questions.find(q=>q.key===editing)?.label}<textarea autoFocus aria-label="修正回答" value={editAnswer} readOnly={busy} maxLength={4000} rows={4} onChange={e=>changeEdit(e.target.value)} onKeyDown={e=>sendKey(e,()=>{if(!lock.current&&editAnswer.trim())void saveEdit()},changeEdit)}/></label><p>修改后保持当前进度，已有报告需要重新生成。</p><div className="st-inline"><button className="st-primary" disabled={busy||!editAnswer.trim()} onClick={()=>void saveEdit()}>保存本题修改</button><button disabled={busy} onClick={()=>setEditing('')}>取消修改</button></div></>:session.status==='review'?<>
    {type==='profile'?<IPReport title={fields.title} body={fields.body||''} onBodyChange={value=>setFields({...fields,body:value})} disabled={busy}>{fieldEditors}</IPReport>:fieldEditors}
    {fixed&&session.topic_candidates?.length>0&&<details><summary>配套选题建议 · {session.topic_candidates.length} 条</summary><ol>{session.topic_candidates.map((topic:any,index:number)=><li key={index}><strong>{topic.title}</strong><p>{topic.angle}</p></li>)}</ol></details>}
    <footer className="ip-guide-confirm"><p>{session.target_id?'确认后更新“'+(session.original?.title||target?.title||'所选 IP')+'”的定位报告。':'核对定位与待确认项后保存到“我的 IP”。'}</p><button className="st-primary" disabled={busy} onClick={()=>void apply()}>{type==='profile'?(session.target_id?'确认报告，更新此 IP':'确认报告，建立 IP'):'确认更新到品牌资料'}</button>{fixed?<button disabled={busy} title="重新生成将替换当前未保存的报告修改" onClick={()=>void regenerate()}>重新整理报告</button>:<button disabled={busy} onClick={()=>setSession({...session,status:'interview'})}>继续补充</button>}</footer>
   </>:waiting?<div className="ip-guide-report-ready"><h3>定位沟通已完成</h3><p>Agent 将整理为一份完整报告，包含定位、客户、内容方向与 30 天计划。</p><button className="st-primary" disabled={busy} onClick={()=>void run(()=>turn(session,true,''))}>生成完整定位报告</button></div>:<><label className="ip-answer-label">你的情况<textarea onKeyDown={e=>sendKey(e,()=>{if(!lock.current&&answer.trim())void run(()=>turn(session))},changeAnswer)} aria-label="访谈回答" placeholder="如实填写；Enter 发送，Ctrl + Enter 换行" value={answer} readOnly={busy} maxLength={fixed?4000:10000} onChange={e=>changeAnswer(e.target.value)} rows={5}/></label><div className="st-inline"><button className="st-primary" disabled={busy||!answer.trim()} onClick={()=>void run(()=>turn(session))}>{fixed?(session.question_index===11?'保存最后一题':'保存回答，下一题'):'发送回答'}</button>{fixed?<button disabled={busy} onClick={()=>void run(()=>turn(session,false,'不知道【待确认】'))}>不知道，标为待确认</button>:<button disabled={busy} onClick={()=>void run(()=>turn(session,true))}>结束并整理</button>}</div></>}
  </>}</>}
  {busy&&<p role="status">{starting?'正在恢复引导…':fixed&&session?.status==='interview'?'正在保存回答…':waiting?'Agent 正在撰写报告，完成后会显示在这里。可以返回，稍后继续查看。':'正在处理，请稍候…'}</p>}{error&&<div className="st-alert" role="alert"><p>{error}</p>{session&&<button disabled={busy} onClick={()=>void run(async()=>{const rows=await load();await resume(rows.find((row:any)=>row.id===session.id))})}>重新读取当前进度</button>}</div>}
 </section>;
 return embedded?content:<div className="st-modal-backdrop">{content}</div>;
}
