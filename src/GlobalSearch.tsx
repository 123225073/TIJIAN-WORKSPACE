import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,FileText,LoaderCircle,Search,X} from 'lucide-react';
import {api,getToken,type Item} from './api';
import {Media,assetUrl,type Asset} from './ResourcePreview';
import './radar.css';

// /api/search retains an array response; these fields are the shared UI contract.
export type SearchResult={id:string;kind:string;title:string;version:number;updated:string;category:string;
 summary:string;route:string;score:number;match_reason:string;matched_terms:string[];related_ids:string[];
 entry_id?:string;url?:string;fetched_at?:string;edit_route?:string};
type Props={onClose:()=>void;onNavigate?:(route:string,result:SearchResult)=>void;initialQuery?:string};
const detailKinds=new Set(['studio_asset','studio_run','content','hotlist','news','benchmark','plan']);
const stamp=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'时间未记录';

export default function GlobalSearch({onClose,onNavigate,initialQuery=''}:Props){
 const [query,setQuery]=useState(initialQuery),[rows,setRows]=useState<SearchResult[]>([]),[category,setCategory]=useState('全部');
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [selected,setSelected]=useState<SearchResult|null>(null),[record,setRecord]=useState<Item|null>(null),[detailLoading,setDetailLoading]=useState(false);
 const sequence=useRef(0),input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLElement>(null),detailSequence=useRef(0);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;input.current?.focus();return()=>{sequence.current++;detailSequence.current++;previous?.focus()}},[]);
 useEffect(()=>{
  const request=++sequence.current,session=getToken(),value=query.trim();setRows([]);setError('');setCategory('全部');
  if(!value){setLoading(false);return}
  setLoading(true);
  const timer=setTimeout(()=>{void api<SearchResult[]>('/search?q='+encodeURIComponent(value)).then(result=>{
   if(request===sequence.current&&session===getToken()){setRows(result);setLoading(false)}
  }).catch(e=>{if(request===sequence.current&&session===getToken()){setError((e as Error).message);setLoading(false)}})},250);
  return()=>{clearTimeout(timer);sequence.current++};
 },[query,retry]);
 useEffect(()=>{
  const request=++detailSequence.current,session=getToken();setRecord(null);
  if(!selected||selected.entry_id){setDetailLoading(false);return}
  setDetailLoading(true);setError('');
  void api<{items:Item[]}>('/state/updates?ids='+encodeURIComponent(selected.id)).then(response=>{
   if(request!==detailSequence.current||session!==getToken())return;
   const found=response.items.find(x=>x.id===selected.id&&!x.archived&&!x.deleted);
   if(!found)throw Error('该记录已删除或不再可用，请重新搜索');setRecord(found);setDetailLoading(false);
  }).catch(e=>{if(request===detailSequence.current&&session===getToken()){setError((e as Error).message);setDetailLoading(false)}});
  return()=>{detailSequence.current++};
 },[selected,retry]);
 const navigate=(result:SearchResult,route=result.route)=>{if(onNavigate)onNavigate(route,result);else location.hash=route;onClose()};
 const open=(result:SearchResult)=>{if(detailKinds.has(result.kind)){setSelected(result);setError('')}else navigate(result)};
 const change=(value:string)=>{sequence.current++;setRows([]);setError('');setLoading(!!value.trim());setQuery(value)};
 const categories=['全部',...new Set(rows.map(x=>x.category))],visible=rows.filter(x=>category==='全部'||x.category===category);
 const text=record?.body||record?.text||record?.fields?.body||record?.fields?.script||record?.generation?.input?.text||record?.generation?.input?.prompt||selected?.summary;
 return <div className="global-search-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section ref={dialog} className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" onKeyDown={e=>{
   if(e.key==='Escape'){e.stopPropagation();if(selected)setSelected(null);else onClose()}
   if(e.key==='Tab'){
    const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input')||[]),first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
   }
  }}>
   <header className="global-search-input"><Search size={20}/><input ref={input} aria-label="搜索资料与作品" maxLength={200} value={query} placeholder="搜索关键词，例如：结婚、适老化、电梯更新" onChange={e=>{setSelected(null);change(e.target.value)}}/><button className="icon-button" aria-label="关闭搜索" onClick={onClose}><X size={18}/></button></header>
   {error&&<div className="global-search-error" role="alert"><span>{error}</span><button onClick={()=>setRetry(v=>v+1)}>重试</button></div>}
   {selected?<div className="global-search-detail">
    <button className="global-search-back" onClick={()=>{setSelected(null);setError('')}}><ArrowLeft size={15}/>返回结果</button>
    <p className="global-search-meta">{selected.category} · {selected.entry_id?'榜单获取 '+stamp(selected.fetched_at):stamp(selected.updated)}</p><h2>{selected.title}</h2>
    {detailLoading?<p role="status"><LoaderCircle size={16} className="spin"/>读取所选记录…</p>:<>
     {record?.kind==='studio_asset'&&assetUrl(record as Asset)&&<div className="global-search-media"><Media asset={record as Asset}/></div>}
     <p className="global-search-body">{text||'该记录没有可显示的文字内容。'}</p>
     {selected.entry_id&&<p className="global-search-meta">热榜发现线索；摘要未作为原文事实核查。</p>}
     <div className="global-search-detail-actions">{selected.url&&<a className="button" href={selected.url} target="_blank" rel="noopener noreferrer">打开来源<ArrowUpRight size={15}/></a>}
      {selected.edit_route&&<button onClick={()=>navigate(selected,selected.edit_route)}>继续编辑原稿<ArrowUpRight size={15}/></button>}
      <button onClick={()=>navigate(selected)}>打开所在页面<ArrowUpRight size={15}/></button></div>
    </>}
   </div>:<>
    <div className="global-search-status" role="status">{loading?<><LoaderCircle size={15} className="spin"/>正在搜索…</>:query.trim()?`${rows.length===50?'前 ':''}${rows.length} 条匹配 · 标题优先，其次内容和相关词`:'输入关键词，搜索已保存的资料、对话、草稿和作品'}</div>
    {!!rows.length&&<nav className="global-search-categories" aria-label="搜索结果类别">{categories.map(label=><button key={label} aria-pressed={category===label} onClick={()=>setCategory(label)}>{label}<span>{label==='全部'?rows.length:rows.filter(x=>x.category===label).length}</span></button>)}</nav>}
    <div className="global-search-results">{visible.map(result=><button className="global-search-result" key={result.id+':'+(result.entry_id||'')} onClick={()=>open(result)}>
     <FileText size={18}/><span><strong>{result.title}</strong><small>{result.category} · {result.match_reason}{result.related_ids.length>1?` · 已合并 ${result.related_ids.length} 条关联记录`:''}</small><p>{result.summary}</p></span><ArrowUpRight size={16}/>
    </button>)}{!loading&&!error&&query.trim()&&!rows.length&&<p className="global-search-empty">没有找到匹配内容。可换用更短或更具体的关键词。</p>}</div>
   </>}
   <footer className="global-search-footer">仅搜索本地已保存内容 · 相关词匹配会明确标注 <kbd>Esc 关闭</kbd></footer>
  </section>
 </div>
}
