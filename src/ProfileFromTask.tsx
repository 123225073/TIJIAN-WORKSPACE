import {useEffect,useRef,useState} from 'react';
import {api,type Item} from './api';
import Markdown from './Markdown';
import './profile-from-task.css';
import {ipGuideRoute} from './ip-guide-route';
const labels:Record<string,string>={title:'身份名称',position:'定位一句话',audience:'目标受众',style:'表达偏好',views:'主要观点',body:'完整方案'};
export function ProfileFromTask({t,task,mode,modelId,onSaved}:{t:any;task:Item;mode:string;modelId:string;onSaved?:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const p=task.agent_proposal;
 const [target,setTarget]=useState(p?.target_id||task.profile_id||''),recovery=useRef<HTMLDetailsElement>(null);
 const [writeMode,setWriteMode]=useState<'create'|'update'>(p?.operation==='update'||p?.target_id?'update':'create');
 useEffect(()=>{setError('');setTarget(p?.target_id||task.profile_id||'');setWriteMode(p?.operation==='update'||p?.target_id?'update':'create')},[task.id,p?.id]);
 useEffect(()=>{const recover=(event:Event)=>{const e=event as CustomEvent<{path:string;error:string;route:string}>;
  const path=e.detail?.path?.replace(/^\/api/,'')||'';
  if(!path.startsWith('/tasks/'+task.id+'/')||!(/\/agent\//.test(path)||path.endsWith('/profile'))||e.detail.route.split('?')[0]!=='task/'+task.id)return;
  e.preventDefault();setError(e.detail.error||'请重新整理并核对新增或更新目标');if(recovery.current)recovery.current.open=true;requestAnimationFrame(()=>{recovery.current?.scrollIntoView({block:'nearest',behavior:'smooth'});recovery.current?.querySelector('button')?.focus()});
 };window.addEventListener('operation-recover',recover);return()=>window.removeEventListener('operation-recover',recover)},[task.id]);
 const running=t.list('job').some((j:Item)=>j.task_id===task.id&&['queued','running'].includes(j.status));
 const stale=p?.status==='pending'&&(p.task_version!==undefined&&p.task_version!==task.version||p.kind==='profile'&&!p.operation);
 const bindingChanged=p?.kind==='profile'&&p.status==='pending'&&(writeMode!==p.operation||writeMode==='update'&&target!==p.target_id);
 const action=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn();await t.refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const prepare=(operation?:string,targetId?:string)=>action(()=>api('/tasks/'+task.id+'/agent/prepare-profile',{model_id:modelId||undefined,...(operation?{operation}:{}),...(targetId?{target_id:targetId}:{})}));
 const apply=async(fields?:any)=>{const saved=await api('/tasks/'+task.id+'/agent/apply',{proposal_id:p.id,task_version:p.task_version,...(fields?{fields}:{})});if(p.kind==='profile')onSaved?.(saved.id);t.setToast(p.kind==='profile'?(p.operation==='create'?'已新增 IP：':'已更新 IP：')+saved.title:'已写入个人记忆');return saved};
 const edit=()=>t.setForm({title:'微调 AI 整理结果',description:'所有栏目已由 AI 梳理。可以直接保存，或只修改不准确的部分。',fields:Object.entries(p.fields).map(([key,value])=>({key,value,label:p.kind==='memory'?(key==='title'?'记忆标题':'记忆内容'):labels[key],type:['style','views','body'].includes(key)?'textarea':'text',required:['title','body'].includes(key)})),submit:'确认写入',action:async(fields:any)=>{await apply(fields);await t.refresh()}});
 if(p?.kind==='profile'||!p&&mode==='profile')return <section className="agent-result" aria-label="IP 定位引导入口"><div className="agent-result-heading"><strong>{p?.status==='applied'?'个人 IP 报告':'Agent · 个人 IP 定位'}</strong>{p?.status==='applied'?<a href={'#studio/brand?profile='+encodeURIComponent(p.result_id)}>查看已保存档案 →</a>:<a className="button primary" href={'#'+ipGuideRoute({task:task.id,target:p?.operation==='update'?p.target_id:'',session:task.ip_interview_id||'',model:modelId})}>进入 Agent 引导 →</a>}</div>{p?.status!=='applied'&&<p>定位资料将在统一步骤中核对，再整理成完整报告。已有对话会作为背景保留。</p>}</section>;
 if(!p)return null;
 return <section className="agent-result" aria-label="工作台操作结果">
 {!p?<><div className="agent-result-heading"><strong>定位整理助手</strong><button disabled={running||busy||!task.messages?.length} onClick={()=>prepare()}>{running?'正在处理…':'梳理已有对话'}</button></div><p>新访谈会自动梳理。已有对话也可直接整理，各栏目由 AI 自动填写。</p>{task.agent_error&&<p role="alert">整理失败：{task.agent_error}。对话已保留，可重试。</p>}</>:p.status==='applied'?<div className="agent-result-heading"><strong>{p.kind==='profile'?(p.operation==='create'?'已新增 IP':'已更新 IP'):'已写入个人记忆'}</strong><a href={p.kind==='profile'?'#studio/brand?profile='+p.result_id:'#knowledge/memory/'+p.result_id}>查看结果 →</a></div>:p.status==='dismissed'?<p>本次整理已忽略，档案未修改。可以继续沟通调整。</p>:<>
 <div className="agent-result-heading"><strong>{p.kind==='profile'?'IP 身份':'个人记忆'} · 待写入</strong><span className="profile-write-target">{p.target_id?'更新 '+(t.get(p.target_id)?.title||'已有档案'):'新增 '+p.fields.title}</span></div>
 {p.kind==='profile'&&p.reference_profile_id&&!p.target_id&&<p className="profile-reference">参考定位：{t.get(p.reference_profile_id)?.title||'已有 IP'} · 确认后建立独立档案</p>}
 <p>AI 已按完整对话整理。核对下方内容后即可写入，无需重新填写。</p>
 <dl className="agent-fields">{Object.entries(p.fields).filter(([k])=>k!=='body').map(([k,v])=><div key={k}><dt>{p.kind==='memory'?'记忆标题':labels[k]}</dt><dd>{String(v)||'对话尚未明确'}</dd></div>)}</dl>
 <details><summary>查看完整{p.kind==='profile'?'定位方案':'记忆内容'}</summary><Markdown text={p.fields.body}/></details>
 {p.notes?.length>0&&<ul className="agent-notes">{p.notes.map((n:string,i:number)=><li key={i}>{n}</li>)}</ul>}
 {stale&&<p role="status" className="profile-stale">{!p.operation?'这是历史候选，请重新整理并核对新增或更新目标。':'对话已更新，请重新整理并核对当前候选。'}</p>}
 {!stale&&bindingChanged&&<p role="status" className="profile-stale">写入方式或更新目标已调整，请重新整理，核对新候选后再写入。</p>}
 <div className="button-row"><button className="primary" disabled={busy||running||stale||bindingChanged} onClick={()=>action(()=>apply())}>{busy?'写入中…':'确认写入'}</button><button disabled={busy||running||stale||bindingChanged} onClick={edit}>微调内容</button><button disabled={busy||running} onClick={()=>action(()=>api('/tasks/'+task.id+'/agent/dismiss',{proposal_id:p.id}))}>暂不写入</button></div>
 {p.kind==='profile'&&<details className="profile-recovery" ref={recovery} open={stale||!!error}><summary>调整写入方式</summary><div className="profile-recovery-controls">
  <div className="profile-write-tabs" role="tablist" aria-label="IP 写入方式">{(['create','update'] as const).map(operation=><button key={operation} id={'profile-write-'+task.id+'-'+operation} role="tab" aria-selected={writeMode===operation} aria-controls={'profile-write-panel-'+task.id} tabIndex={writeMode===operation?0:-1} disabled={busy||running} onClick={()=>setWriteMode(operation)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'create':e.key==='End'?'update':operation==='create'?'update':'create';setWriteMode(next);document.getElementById('profile-write-'+task.id+'-'+next)?.focus()}}>{operation==='create'?'新增 IP':'更新已有 IP'}</button>)}</div>
  <div className="profile-write-panel" id={'profile-write-panel-'+task.id} role="tabpanel" aria-labelledby={'profile-write-'+task.id+'-'+writeMode}>
   {writeMode==='create'?<><p>建立独立的 IP 档案，参考定位不会被覆盖。</p><button disabled={busy||running} onClick={()=>prepare('create')}>重新整理为新增 IP</button></>:<><label>更新目标<select aria-label="IP 更新目标" value={target} disabled={busy||running} onChange={e=>setTarget(e.target.value)}><option value="">选择已有 IP</option>{t.list('profile').filter((profile:Item)=>!profile.archived).map((profile:Item)=><option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label><p>只更新选中的 IP 档案。</p><button disabled={busy||running||!target} onClick={()=>prepare('update',target)}>重新整理为更新此 IP</button></>}
  </div><p>重新整理会生成新候选，核对后再确认写入。</p>
 </div></details>}
 </>}{error&&<p role="alert" className="form-error">{error}</p>}
 </section>
}
