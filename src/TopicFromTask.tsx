import {useEffect,useState} from 'react';
import {api,type Item} from './api';
import './profile-from-task.css';

const labels:Record<string,string>={title:'选题名称',angle:'切入角度',rationale:'依据与待核实内容',audience:'目标受众'};
// The parent only mounts this for task.topic_proposal. No parsing free text,
// autonomous tool calls, model changes, publishing or deletion happens here.
export default function TopicFromTask({t,task}:{t:any;task:Item}){
 const p=task.topic_proposal;
 const [selected,setSelected]=useState<string[]>([]),[edits,setEdits]=useState<Record<string,any>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setSelected(p?.candidates?.map((x:any)=>x.id)||[]);setEdits({});setError('')},[p?.id]);
 if(!p)return null;
 const running=t.list('job').some((j:Item)=>j.task_id===task.id&&['queued','running'].includes(j.status));
 const stale=p.status==='pending'&&p.task_version!==task.version;
 const confirm=async()=>{setBusy(true);setError('');try{
  const saved=await api('/tasks/'+task.id+'/topics/confirm',{proposal_id:p.id,task_version:p.task_version,items:selected.map(candidate_id=>({candidate_id,fields:edits[candidate_id]||{}}))});
  await t.refresh();t.setToast('已加入选题库，共 '+saved.items.length+' 条');
 }catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const edit=(candidate:any)=>{const fields={...candidate.fields,...edits[candidate.id]};t.setForm({title:'微调选题建议',fields:Object.entries(labels).map(([key,label])=>({key,label,value:fields[key]||'',type:key==='title'?'text':'textarea',required:key==='title'})),submit:'保留微调',action:async(values:any)=>{setEdits(previous=>({...previous,[candidate.id]:values}))}})};
 return <section className="agent-result" aria-label="对话选题成果"><div className="agent-result-heading"><strong>{p.status==='applied'?'选题已加入选题库':'选题建议 · 待确认'}</strong><span>{p.status==='applied'?p.result_ids.length:p.candidates.length} 条</span></div>
 {p.tool_boundary&&<p className="profile-reference">{p.tool_boundary}</p>}
 {p.hotlist_snapshot?.length>0&&<details><summary>查看本次热榜快照时间</summary>{p.hotlist_snapshot.map((board:any)=><p key={board.id}>{board.title} · 采集于 {board.fetched_at?new Date(board.fetched_at).toLocaleString():'时间未确认'}</p>)}</details>}
 {p.status==='applied'?<><p>本次确认的选题已独立保存，可在选题库继续使用。</p><a href={'#studio/topics?topic='+p.result_ids[0]}>查看选题库 →</a></>:<><p>筛选并核对后加入选题库；缺少来源的建议仍需查证。</p><div className="task-topic-candidates">{p.candidates.map((candidate:any)=>{const fields={...candidate.fields,...edits[candidate.id]};return <article className="task-topic-candidate" key={candidate.id}><label><input type="checkbox" aria-label={'选择选题 '+fields.title} checked={selected.includes(candidate.id)} disabled={busy||running||stale} onChange={e=>setSelected(previous=>e.target.checked?[...previous,candidate.id]:previous.filter(id=>id!==candidate.id))}/><h4>{fields.title}</h4></label><dl>{Object.entries(labels).filter(([key])=>key!=='title').map(([key,label])=><div key={key}><dt>{label}</dt><dd>{fields[key]||'待补充'}</dd></div>)}</dl><button disabled={busy||running||stale} onClick={()=>edit(candidate)}>微调选题</button></article>})}</div>{stale&&<p role="status" className="profile-stale">对话已更新，请在对话中重新整理选题后确认。</p>}<div className="button-row"><button className="primary" disabled={busy||running||stale||!selected.length} onClick={()=>void confirm()}>{busy?'正在保存…':'确认加入选题库'} · {selected.length} 条</button></div></>}
 {error&&<p role="alert" className="form-error">{error}</p>}</section>;
}
