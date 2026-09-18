import {useState} from 'react';
import {api,type Item} from './api';
import Markdown from './Markdown';
import {fullTime} from './AcquisitionMeta';

export const knowledgeJob=(j:Item)=>['knowledge','synthesis'].includes(j.input?.action);
export const knowledgePath=(item:Item)=>['source','knowledge','memory','issue'].includes(item.kind)?'#knowledge/'+(item.kind==='issue'?'issues':item.kind)+'/'+item.id:item.kind==='task'?'#task/'+item.id:item.kind==='profile'?'#identity':['content','plan'].includes(item.kind)?'#content':item.kind==='news'?'#radar':['benchmark','wechat_article'].includes(item.kind)?'#benchmark':'#review';
export const linkedReferences=(text:string,get:(id:string)=>Item|undefined)=>text.replace(/\[([a-f0-9]{32})\](?!\()/g,(_match,id)=>{const x=get(id);return x?'['+x.title.replace(/[\[\]\\]/g,'')+']('+knowledgePath(x)+')':_match});
export function ExtractKnowledge({item,t}:{item:Item;t:any}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=t.list('job').find((j:Item)=>knowledgeJob(j)&&['queued','running'].includes(j.status)&&j.input?.source_ids?.includes(item.id));
 return <span className="extract-action"><button disabled={busy} onClick={async()=>{
  if(running){location.hash='knowledge/job/'+running.id;return}
  setBusy(true);setError('');
  try{const j=await api<Item>('/synthesis/run',{source_ids:[item.id],force:true});await t.refresh();location.hash='knowledge/job/'+j.id;t.setToast('已提交整理；普通结果自动保存，冲突或不确定事项需要核对')}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }}>{busy?'正在提交…':running?'查看提炼进度':'整理为 Wiki / 记忆'}</button>{error&&<small role="alert" className="form-error">{error}</small>}</span>;
}
export function KnowledgeJobResult({job,get}:{job:Item;get:(id:string)=>Item|undefined}){
 const active=['queued','running'].includes(job.status);
 const ids=[...new Set<string>([...(job.result?.issue_ids||[]),...(job.result?.existing_issue_ids||[])])];
 const rows=ids.map(get).filter((x):x is Item=>!!x&&!x.archived);
 return <section className="knowledge-progress" aria-label="知识提炼结果">
  <div role="status" aria-live="polite"><strong>{active?'正在提炼知识…':job.status==='done'?'提炼结束':job.status==='failed'?'提炼失败':'提炼已停止'}</strong><p>{active?(job.progress+'。可以离开页面，返回后继续查看。'):job.error||job.result?.summary||(ids.length?`共 ${ids.length} 条结果，请查看下方内容与保存状态。`:'本次没有新增建议。请检查原始正文，只有标题或链接不能代替文章内容。')}</p></div>
  <small>开始 {fullTime(job.started_at||job.created)}{job.finished_at&&` · 结束 ${fullTime(job.finished_at)}`}</small>
  <div className="knowledge-links">{job.input?.source_ids?.map((id:string)=>{const x=get(id);return x&&!x.archived?<a key={id} href={knowledgePath(x)}>返回来源：{x.title}</a>:<span key={id}>来源已移入回收站</span>})}</div>
  {(job.result?.saved_ids||[]).map((id:string)=>{const x=get(id);return x&&!x.archived?<article className="knowledge-candidate" key={id}><span className="badge">已自动保存 · {x.kind==='memory'?'个人记忆':'Wiki'}</span><h3>{x.title}</h3><a className="knowledge-cta" href={knowledgePath(x)}>查看内容、来源与版本 →</a></article>:<p key={id}>已保存结果目前不可用。</p>})}
  {job.result?.remaining>0&&<p>尚有 {job.result.remaining} 段未整理，可在设置中立即继续；启用夜间整理后会在下一次运行处理。</p>}
  {rows.map(x=>{const saved=get(x.result_id);return <article key={x.id} className="knowledge-candidate"><div className="knowledge-card-heading"><span className="badge">{x.status==='pending'?'待确认':x.status==='rejected'?'已忽略':saved&&!saved.archived?'已保存'+(saved.kind==='memory'?'为个人记忆':'为知识'):'结果已移入回收站'}</span><strong>{x.title}</strong></div><Markdown text={x.body||''}/>{x.status==='pending'?<a className="knowledge-cta" href={knowledgePath(x)}>查看依据并确认保存 →</a>:saved&&!saved.archived?<a className="knowledge-cta" href={knowledgePath(saved)}>查看已保存内容 →</a>:null}</article>})}
  {ids.length>rows.length&&<p>其中 {ids.length-rows.length} 条建议已删除；可在资料管理的回收站查看。</p>}
  {active&&<p>普通内容自动进入 Wiki 或个人记忆；只有冲突、不确定或涉及手动修改的结果需要核对。</p>}
 </section>;
}
