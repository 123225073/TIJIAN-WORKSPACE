import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import './article-recovery.css';

type Fields=Record<string,any>;
const same=(a:Fields,b:Fields)=>JSON.stringify(a)===JSON.stringify(b);
export function useArticleDraft({content,key,fields,path,refresh}:{content:any;key:string;fields:(row:any)=>Fields;path:string;refresh:()=>Promise<any>}){
 const initial=useRef<any>(null);
 if(!initial.current){let cache:any;try{cache=JSON.parse(localStorage.getItem(key)||'null');if(!cache&&key.startsWith('platform-draft:'))cache=JSON.parse(localStorage.getItem(key.replace('platform-draft:','draft:'))||'null')}catch{}const server=fields(content);initial.current={values:{...server,...(cache?.values??cache?.fields??(cache?.body!==undefined?{body:cache.body}:{}))},baseline:cache?.baseline&&typeof cache.baseline==='object'?{...server,...cache.baseline}:typeof cache?.baseline==='string'?{...server,body:cache.baseline}:server,known:!!cache?.baseline||!cache,version:cache?.version??content.version,recovery:cache?.recovery||[]}}
 const [draft,setDraft]=useState(initial.current),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState<any>(null);
 const current=useRef(draft),flight=useRef<Promise<any>|null>(null);current.current=draft;
 const persist=(next:any)=>{current.current=next;setDraft(next);try{localStorage.setItem(key,JSON.stringify({...next,fields:next.values,body:next.values.body}))}catch{setError('本机草稿暂存失败，请及时保存或复制正文')}};
 const change=(name:string,value:any)=>{persist({...current.current,values:{...current.current.values,[name]:value}});setNotice('')};
 const accept=(row:any)=>{
  const d=current.current,server=fields(row);
  if(row.version<=d.version)return;
  if(same(d.values,d.baseline)||same(server,d.values)){persist({...d,values:server,baseline:server,version:row.version,known:true});setConflict(null)}
  else if(d.known&&same(server,d.baseline)){persist({...d,version:row.version});setConflict(null)}
  else setConflict({row,fields:server});
 };
 useEffect(()=>{accept(content)},[content.version]);
 const latestServer=async()=>{const r=await api('/state/updates?ids='+content.id);const row=r.items.find((x:any)=>x.id===content.id);if(!row)throw Error('稿件不可用，请检查是否已删除');return row};
 const compare=async()=>{try{const row=await latestServer();accept(row);if(row.version!==current.current.version)setConflict({row,fields:fields(row)})}catch(e:any){setError(e.message)}};
 const save=()=>{
  if(flight.current)return flight.current;
  setSaving(true);setError('');
  flight.current=(async()=>{try{
   const row=await latestServer(),server=fields(row);let d=current.current;
   if(row.version!==d.version){
    if((d.known&&same(server,d.baseline))||same(server,d.values)){d={...d,baseline:server,version:row.version,known:true};persist(d)}
    else{setConflict({row,fields:server});throw Error('稿件存在外部修改，请在版本比较中选择保留的内容')}
   }
   if(same(d.values,d.baseline)){setNotice('已保存稿件 v'+d.version);return row}
   const submitted={...d.values};let saved:any;
   try{saved=await api(path,{version:d.version,...submitted},'PATCH')}catch(e:any){if(e.status===409){const latest=await latestServer();setConflict({row:latest,fields:fields(latest)})}throw e}
   persist({...current.current,baseline:submitted,version:saved.version,known:true});setConflict(null);setNotice('已保存稿件 v'+saved.version);
   try{await refresh()}catch{setNotice('已保存稿件 v'+saved.version+'；页面同步暂未完成，可继续编辑')}
   if(!same(current.current.values,submitted))throw Error('保存期间文稿又有修改，请核对并再次保存后继续');
   return saved;
  }catch(e:any){setError(e.message);throw e}finally{setSaving(false);flight.current=null}})();
  return flight.current;
 };
 const resolve=async(useLocal:boolean)=>{
  if(!conflict)return;
  const d=current.current,server=conflict.fields;
  const recovery=[...d.recovery,{version:useLocal?conflict.row.version:d.version,fields:useLocal?server:d.values,label:useLocal?'服务器版本':'本地版本'}].slice(-8);
  persist({...d,values:useLocal?d.values:server,baseline:server,version:conflict.row.version,known:true,recovery});setConflict(null);setError('');setNotice(useLocal?'已采用本地稿，将按最新版本保存':'已采用服务器稿；原本地稿可恢复');
  if(useLocal)await save();
 };
 const restore=(index:number)=>{const d=current.current;persist({...d,values:d.recovery[index].fields});setNotice('已恢复到编辑区，请核对后保存')};
 return {values:draft.values,version:draft.version,dirty:!same(draft.values,draft.baseline),saving,error,notice,conflict,recovery:draft.recovery,change,save,resolve,restore,compare,setNotice};
}

export function ArticleDraftFeedback({draft,id}:{draft:ReturnType<typeof useArticleDraft>;id:string}){
 const run=(fn:()=>Promise<any>)=>void fn().catch(()=>{});
 return <div className="article-draft-feedback" data-error-target={id} tabIndex={-1}>
  {draft.error&&<p role="alert">{draft.error} <button type="button" onClick={()=>run(draft.compare)}>查看版本并解决</button><button type="button" onClick={()=>run(draft.save)}>重试保存</button></p>}
  {draft.notice&&<p role="status">{draft.notice}</p>}
  {draft.conflict&&<section className="article-conflict" role="region" aria-label="稿件保存冲突" tabIndex={-1}><strong>版本比较 · 本地修改和服务器稿均已保留</strong><div className="article-conflict-columns">{[['本地草稿 v'+draft.version,draft.values],['服务器稿 v'+draft.conflict.row.version,draft.conflict.fields]].map(([label,values])=><div key={String(label)}><h4>{String(label)}</h4>{Object.entries(values as Fields).filter(([,v])=>v).map(([k,v])=><pre key={k}><small>{({title:'标题',author:'作者',image_asset_ids:'配图素材',body:'正文',summary:'摘要',cover_brief:'封面建议',cover_asset_id:'封面素材',wechat_style:'排版设置'} as any)[k]||k}</small>{typeof v==='object'?JSON.stringify(v,null,2):String(v)}</pre>)}</div>)}</div><div className="article-recovery-actions"><button type="button" disabled={draft.saving} onClick={()=>run(()=>draft.resolve(true))}>保留本地稿，按新版本保存</button><button type="button" disabled={draft.saving} onClick={()=>run(()=>draft.resolve(false))}>采用服务器稿，保留本地备份</button></div><small>可继续编辑或复制两侧内容整理；保存仍会检查是否发生新的外部修改。</small></section>}
  {!!draft.recovery.length&&<details><summary>可恢复的版本 · {draft.recovery.length}</summary>{draft.recovery.map((x:any,i:number)=><div key={i}><span>{x.label} v{x.version}</span><details><summary>查看保留内容</summary><pre>{Object.values(x.fields).filter(v=>typeof v==='string').join('\n\n')}</pre></details><button type="button" onClick={()=>draft.restore(i)}>恢复到编辑区</button></div>)}</details>}
 </div>;
}
