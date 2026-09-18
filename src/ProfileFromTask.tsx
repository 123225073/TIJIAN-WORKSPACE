import {useState} from 'react';
import {api,type Item} from './api';
import Markdown from './Markdown';
const labels:Record<string,string>={title:'身份名称',position:'定位一句话',audience:'目标受众',style:'表达偏好',views:'主要观点',body:'完整方案'};
export function ProfileFromTask({t,task,mode,modelId,onSaved}:{t:any;task:Item;mode:string;modelId:string;onSaved?:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const p=task.agent_proposal;
 const running=t.list('job').some((j:Item)=>j.task_id===task.id&&['queued','running'].includes(j.status));
 const action=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn();await t.refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const prepare=()=>action(()=>api('/tasks/'+task.id+'/agent/prepare-profile',{model_id:modelId||undefined}));
 const apply=async(fields?:any)=>{const saved=await api('/tasks/'+task.id+'/agent/apply',{proposal_id:p.id,...(fields?{fields}:{})});if(p.kind==='profile')onSaved?.(saved.id);t.setToast('已写入'+(p.kind==='profile'?'我的 IP':'个人记忆'));return saved};
 const edit=()=>t.setForm({title:'微调 AI 整理结果',description:'所有栏目已由 AI 梳理。可以直接保存，或只修改不准确的部分。',fields:Object.entries(p.fields).map(([key,value])=>({key,value,label:p.kind==='memory'?(key==='title'?'记忆标题':'记忆内容'):labels[key],type:['style','views','body'].includes(key)?'textarea':'text',required:['title','body'].includes(key)})),submit:'确认写入',action:async(fields:any)=>{await apply(fields);await t.refresh()}});
 if(!p&&mode!=='profile')return null;
 return <section className="agent-result" aria-label="工作台操作结果">
 {!p?<><div className="agent-result-heading"><strong>定位整理助手</strong><button disabled={running||busy||!task.messages?.length} onClick={prepare}>{running?'正在处理…':'梳理已有对话'}</button></div><p>新访谈会自动梳理。已有对话也可直接整理，各栏目由 AI 自动填写。</p>{task.agent_error&&<p role="alert">整理失败：{task.agent_error}。对话已保留，可重试。</p>}</>:p.status==='applied'?<div className="agent-result-heading"><strong>已写入{p.kind==='profile'?'我的 IP':'个人记忆'}</strong><a href={p.kind==='profile'?'#identity':'#knowledge/memory/'+p.result_id}>查看结果 →</a></div>:p.status==='dismissed'?<p>本次整理已忽略，档案未修改。可以继续沟通调整。</p>:<>
 <div className="agent-result-heading"><strong>{p.kind==='profile'?'IP 身份':'个人记忆'} · 待写入</strong><span>{p.target_id?'更新 '+(t.get(p.target_id)?.title||'已有档案'):'新建档案'}</span></div>
 <p>AI 已按完整对话整理。核对下方内容后即可写入，无需重新填写。</p>
 <dl className="agent-fields">{Object.entries(p.fields).filter(([k])=>k!=='body').map(([k,v])=><div key={k}><dt>{p.kind==='memory'?'记忆标题':labels[k]}</dt><dd>{String(v)||'对话尚未明确'}</dd></div>)}</dl>
 <details><summary>查看完整{p.kind==='profile'?'定位方案':'记忆内容'}</summary><Markdown text={p.fields.body}/></details>
 {p.notes?.length>0&&<ul className="agent-notes">{p.notes.map((n:string,i:number)=><li key={i}>{n}</li>)}</ul>}
 <div className="button-row"><button className="primary" disabled={busy||running} onClick={()=>action(()=>apply())}>{busy?'写入中…':'确认写入'}</button><button disabled={busy||running} onClick={edit}>微调内容</button><button disabled={busy||running} onClick={()=>action(()=>api('/tasks/'+task.id+'/agent/dismiss',{proposal_id:p.id}))}>暂不写入</button></div>
 </>}{error&&<p role="alert" className="form-error">{error}</p>}
 </section>
}
