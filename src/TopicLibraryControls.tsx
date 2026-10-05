import {Fragment, useEffect, useMemo, useState} from 'react';
import {Archive, ArrowRight, Pencil, RotateCcw, Search, Trash2} from 'lucide-react';
import {api} from './api';
import './topic-library-controls.css';

export type LibraryTopic = {
 id:string; version:number; title:string; source_ids:string[]; updated:string; angle?:string; rationale?:string; audience?:string;
 origin?:string; next_action?:string; status?:string; archived?:boolean; deleted?:boolean;
 delivery_count?:number; flow_count?:number; created?:string;
};
export type LibraryDelivery = {id:string; topic_id:string; title?:string};
export type TopicLibraryControlsProps = {
 topics:LibraryTopic[]; // Pass the list loaded with include_archived=true.
 deliveries:LibraryDelivery[];
 onRefresh:()=>Promise<unknown>|unknown;
 onOpenTopic:(topic:LibraryTopic)=>void;
 onAddTopic?:()=>void;
};

type View = 'active'|'archived'|'deleted';
type Draft = {title:string; angle:string; rationale:string; audience:string; next_action:string};
const actions=[['create','待创作'],['rework','二次创作'],['hold','暂缓'],['done','已完成']];
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

export default function TopicLibraryControls({topics,deliveries,onRefresh,onOpenTopic,onAddTopic}:TopicLibraryControlsProps){
 const [view,setView]=useState<View>('active');
 const [search,setSearch]=useState('');
 const [deletedTopics,setDeletedTopics]=useState<LibraryTopic[]>([]);
 const [selected,setSelected]=useState<string[]>([]);
 const [editing,setEditing]=useState('');
 const [draft,setDraft]=useState<Draft>({title:'',angle:'',rationale:'',audience:'',next_action:'create'});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [deletedLoading,setDeletedLoading]=useState(false);
 const fetchDeleted=async():Promise<boolean>=>{
  setDeletedLoading(true);
  try{const result=await api<{items:LibraryTopic[]}>('/studio/topics?include_deleted=true');setDeletedTopics(result.items||[]);return true}
  catch(e){setError('读取回收区失败：'+message(e));return false}
  finally{setDeletedLoading(false)}
 };
 useEffect(()=>{if(view==='deleted')void fetchDeleted()},[view]);
 const rows=useMemo(()=>{
  const source=view==='deleted'?deletedTopics:topics.filter(x=>!x.deleted&&!!x.archived===(view==='archived'));
  const term=search.trim().toLocaleLowerCase();
  return source.filter(x=>!term||[x.title,x.angle,x.rationale,x.audience,x.origin].some(v=>String(v||'').toLocaleLowerCase().includes(term)));
 },[topics,deletedTopics,view,search]);
 const chosen=rows.filter(x=>selected.includes(x.id));
 const allSelected=rows.length>0&&rows.every(x=>selected.includes(x.id));
 const switchView=(next:View)=>{setView(next);setSelected([]);setEditing('');setError('');setNotice('')};
 const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):current.length>=100?(setError('每次最多处理100条选题'),current):[...current,id]);
 const toggleAll=()=>{if(!allSelected&&rows.length>100)setError('每次最多处理100条选题，已选择当前列表前100条');setSelected(allSelected?[]:rows.slice(0,100).map(x=>x.id))};
 const startEdit=(topic:LibraryTopic)=>{
  setEditing(topic.id);setSelected([]);setError('');setNotice('');
  setDraft({title:topic.title,angle:topic.angle||'',rationale:topic.rationale||'',audience:topic.audience||'',next_action:topic.next_action||'create'});
 };
 const saveEdit=async(topic:LibraryTopic)=>{
  if(!draft.title.trim()){setError('请填写选题标题');return}
  setBusy(true);setError('');setNotice('');
  try{
   await api('/studio/topics/'+encodeURIComponent(topic.id),{version:topic.version,...draft},'PATCH');
   await onRefresh();setEditing('');setNotice('选题已保存');
  }catch(e){setError('保存失败：'+message(e))}
  finally{setBusy(false)}
 };
 const batch=async(action:'archive'|'delete'|'restore')=>{
  if(!chosen.length)return;
  const linked=chosen.reduce((sum,x)=>sum+(x.delivery_count||0)+(x.flow_count||0),0);
  const label=action==='archive'?'归档':action==='delete'?'移入回收区':'恢复';
  const warning=action==='delete'?'选题记录会保留在回收区，可随时恢复；关联的发布稿和创作历史会保留。':action==='archive'?'归档后可在“已归档”中恢复；关联的发布稿和创作历史会保留。':'恢复后选题重新出现在可用列表。';
  if(!window.confirm(`确定${label}这 ${chosen.length} 条选题吗？${linked?`其中关联 ${linked} 条发布稿或创作记录。`:''}\n${warning}`))return;
  setBusy(true);setError('');setNotice('');
  let applied=false;
  try{
   await api('/studio/topics/batch',{action,items:chosen.map(x=>({id:x.id,version:x.version}))});
   applied=true;
   await onRefresh();
   setSelected([]);setNotice(`已${label} ${chosen.length} 条选题`);
   if(view==='deleted'&&!(await fetchDeleted()))setNotice('');
  }catch(e){setError(applied?`选题已${label}，但列表刷新失败：${message(e)}`:`${label}失败：${message(e)}。列表可能已变化，请刷新后重试。`)}
  finally{setBusy(false)}
 };
 const linkedTitles=(topic:LibraryTopic)=>deliveries.filter(d=>d.topic_id===topic.id).map(d=>d.title).filter(Boolean).join('、');
 return <section className="tlc" aria-label="选题库列表管理">
  <div className="tlc-toolbar">
   <div className="tlc-views" role="group" aria-label="选题状态">
    <button type="button" className={view==='active'?'is-active':''} onClick={()=>switchView('active')}>可用选题</button>
    <button type="button" className={view==='archived'?'is-active':''} onClick={()=>switchView('archived')}>已归档</button>
    <button type="button" className={view==='deleted'?'is-active':''} onClick={()=>switchView('deleted')}>回收区</button>
   </div>
   <label className="tlc-search"><Search size={16}/><span className="tlc-sr">搜索选题</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索选题、来源或理由"/></label>
   {view==='active'&&onAddTopic&&<button type="button" className="tlc-add" onClick={onAddTopic}>找题 / 添加选题</button>}
  </div>
  {(error||notice)&&<p className={error?'tlc-error':'tlc-notice'} role={error?'alert':'status'}>{error||notice}</p>}
  <div className="tlc-batch">
   <span>{chosen.length?`已选 ${chosen.length} 条`:`${rows.length} 条选题`}</span>
   {view==='active'&&<button type="button" disabled={busy||!chosen.length} onClick={()=>void batch('archive')}><Archive size={15}/>批量归档</button>}
   {view!=='deleted'&&<button type="button" disabled={busy||!chosen.length} onClick={()=>void batch('delete')}><Trash2 size={15}/>批量删除 · 可恢复</button>}
   {view!=='active'&&<button type="button" disabled={busy||!chosen.length} onClick={()=>void batch('restore')}><RotateCcw size={15}/>批量恢复</button>}
  </div>
  <div className="tlc-scroll"><table className="tlc-table"><thead><tr>
   <th className="tlc-check"><input type="checkbox" aria-label="选择当前列表全部选题" checked={allSelected} disabled={!rows.length||busy} onChange={toggleAll}/></th>
   <th>日期</th><th>选题与角度</th><th>来源</th><th>推荐理由</th><th>关联内容</th><th>下一步</th><th>操作</th>
  </tr></thead><tbody>{rows.map(topic=><Fragment key={topic.id}><tr>
   <td className="tlc-check"><input type="checkbox" aria-label={'选择选题 '+topic.title} checked={selected.includes(topic.id)} disabled={busy} onChange={()=>toggle(topic.id)}/></td>
   <td>{topic.created?new Date(topic.created).toLocaleDateString('zh-CN'):'—'}</td>
   <td className="tlc-title"><strong>{topic.title}</strong><small>{topic.angle||'尚未填写切入角度'}</small></td>
   <td>{topic.origin||'自己添加'}</td>
   <td className="tlc-rationale">{topic.rationale||'待补充'}</td>
   <td>{topic.delivery_count||topic.flow_count?<><strong>{topic.delivery_count||0} 份发布稿 · {topic.flow_count||0} 项创作</strong><small>{linkedTitles(topic)||'关联记录已保留'}</small></>:'未创作'}</td>
   <td>{view==='deleted'?'待恢复':view==='archived'?'已归档':actions.find(x=>x[0]===(topic.next_action||'create'))?.[1]||'待创作'}</td>
   <td className="tlc-row-actions">{view==='active'&&<><button type="button" disabled={busy} onClick={()=>startEdit(topic)}><Pencil size={14}/>编辑</button><button type="button" disabled={busy} onClick={()=>onOpenTopic(topic)}>发布稿<ArrowRight size={14}/></button></>}</td>
  </tr>{editing===topic.id&&view==='active'&&<tr key={topic.id+'-edit'}><td colSpan={8}><div className="tlc-editor" aria-label={'编辑选题 '+topic.title}>
   <div className="tlc-editor-head"><strong>直接编辑选题</strong><span>修改会保存到选题库；已有发布稿与历史版本保留。</span></div>
   <div className="tlc-form">
    <label>选题标题<input value={draft.title} maxLength={200} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <label>下一步<select value={draft.next_action} onChange={e=>setDraft({...draft,next_action:e.target.value})}>{actions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>切入角度<textarea rows={2} maxLength={3000} value={draft.angle} onChange={e=>setDraft({...draft,angle:e.target.value})}/></label>
    <label>适用受众<input value={draft.audience} maxLength={3000} onChange={e=>setDraft({...draft,audience:e.target.value})}/></label>
    <label className="tlc-wide">推荐理由<textarea rows={3} maxLength={3000} value={draft.rationale} onChange={e=>setDraft({...draft,rationale:e.target.value})}/></label>
   </div><div className="tlc-editor-actions"><button type="button" disabled={busy||!draft.title.trim()} onClick={()=>void saveEdit(topic)}>保存选题</button><button type="button" disabled={busy} onClick={()=>setEditing('')}>取消</button></div>
  </div></td></tr>}</Fragment> )}</tbody></table></div>
  {!rows.length&&<p className="tlc-empty">{deletedLoading?'正在读取回收区…':view==='deleted'?'回收区为空':view==='archived'?'暂无归档选题':'暂无符合条件的选题'}</p>}
  <p className="tlc-foot">{view==='deleted'?'回收区中的选题可恢复；关联发布稿和历史记录始终保留。':'选择多条可批量处理；单条选题可在本列表直接编辑。'}</p>
 </section>;
}
