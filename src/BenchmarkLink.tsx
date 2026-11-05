import {useEffect,useRef,useState,type FormEvent} from 'react';
import {FileText,Film,Link2,Sparkles,ArrowUpRight} from 'lucide-react';
import {api,type Item} from './api';

type Source=Item & {benchmark_link_kind:'article'|'video';benchmark_corrected?:string};
type LinkState={items:Source[];job:Item|null};
const waiting=(job:Item|null)=>job?.status==='queued'||job?.status==='running';
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';

export default function BenchmarkLink({tikhubReady}:{tikhubReady:boolean}){
 const [kind,setKind]=useState<'article'|'video'>('article'),[link,setLink]=useState('');
 const [paid,setPaid]=useState(false),[state,setState]=useState<LinkState>({items:[],job:null});
 const [selected,setSelected]=useState(''),[variant,setVariant]=useState<'raw'|'corrected'>('raw');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(false),opened=useRef(false);
 const source=state.items.find(item=>item.id===selected)||state.items[0];
 const effectiveVariant=variant==='corrected'&&source?.benchmark_corrected?'corrected':'raw';
 const running=waiting(state.job);
 const isDouyin=/https:\/\/(?:www\.|v\.)?douyin\.com\//i.test(link)||/https:\/\/www\.iesdouyin\.com\//i.test(link);

 useEffect(()=>{
  let mounted=true;
  opened.current=true;
  void api<LinkState>('/benchmark-api/link').then(next=>{
   if(!mounted)return;
   setState(next);
   if(next.job?.input?.operation==='collect'){
    setLink(next.job.input.url||'');
    setKind(next.job.input.kind==='video'?'video':'article');
   }
  }).catch(e=>{if(mounted)setError(errorText(e))});
  return()=>{mounted=false;opened.current=false};
 },[]);

 useEffect(()=>{
  if(!running||!state.job)return;
  let mounted=true;
  let timer:number;
  const poll=async()=>{
   try{
    const next=await api<LinkState>('/benchmark-api/link');
    if(!mounted)return;
    setState(next);
    if(!waiting(next.job)&&next.job?.result?.source_id){
     setSelected(next.job.result.source_id);
     setVariant(next.job.input?.operation==='correct'?'corrected':'raw');
    }
   }catch(e){if(mounted)setError(errorText(e))}
   finally{if(mounted)timer=window.setTimeout(poll,1400)}
  };
  timer=window.setTimeout(poll,1000);
  return()=>{mounted=false;window.clearTimeout(timer)};
 },[running,state.job?.id]);

 const act=async(fn:()=>Promise<void>)=>{
  if(active.current||running)return;
  active.current=true;setBusy(true);setError('');
  try{await fn()}catch(e){if(opened.current)setError(errorText(e))}
  finally{active.current=false;if(opened.current)setBusy(false)}
 };
 const collect=(event:FormEvent)=>{
  event.preventDefault();
  const provider=kind==='video'&&isDouyin&&paid;
  void act(async()=>{
   const job=await api<Item>('/benchmark-api/link',{kind,url:link,tikhub:provider,confirmed:provider,request_id:crypto.randomUUID()});
   if(opened.current){setState(old=>({...old,job}));setPaid(false)}
  });
 };
 const correct=()=>{
  if(!source||!window.confirm('使用写作模型校对文稿，本次调用可能计费。继续吗？'))return;
  void act(async()=>{
   const job=await api<Item>('/benchmark-api/link/'+encodeURIComponent(source.id)+'/correct',{confirmed:true,request_id:crypto.randomUUID()});
   if(opened.current)setState(old=>({...old,job}));
  });
 };
 const rewrite=()=>{
  if(!source)return;
  void act(async()=>{
   const ref=await api<{source_id:string}>('/benchmark-api/link/'+encodeURIComponent(source.id)+'/reference',
    {version:source.version,variant:effectiveVariant});
   const draft=await api<Item>('/studio/text/drafts',{
    title:('二创 · '+source.title).slice(0,200),source_ids:[ref.source_id],
    input:{brief:'参考《'+source.title+'》的选题、受众与表达方法，结合我的观点和实际资料，重新创作独立内容。仅采用原文有依据的事实，明确标记待核查内容。',
     format:source.benchmark_link_kind==='video'?'短视频脚本':'公众号文章'},
   });
   if(opened.current)location.hash='studio/text?draft='+encodeURIComponent(draft.id);
  });
 };

 return <section className="bv-link" aria-labelledby="benchmark-link-title">
  <div className="bv-section-head"><div><span className="bv-link-kicker">单篇作品</span><h2 id="benchmark-link-title">链接对标</h2><p>在本页后台获取公开文章正文或转写视频口播，完成后可校对和二创。</p></div></div>
  <form onSubmit={collect}>
   <div className="bv-link-options" aria-label="作品类型">
    <button type="button" aria-pressed={kind==='article'} disabled={busy||running} onClick={()=>{setKind('article');setPaid(false)}}><FileText size={16}/>文章</button>
    <button type="button" aria-pressed={kind==='video'} disabled={busy||running} onClick={()=>setKind('video')}><Film size={16}/>视频</button>
   </div>
   <div className="bv-link-input"><label><span>公开作品链接</span><input value={link} onChange={e=>{setLink(e.target.value);setPaid(false)}} placeholder="粘贴 HTTPS 链接或包含链接的分享文字" maxLength={4500} disabled={busy||running} required/></label><button type="submit" className="bv-link-primary" disabled={!link.trim()||busy||running}><Link2 size={16}/>获取原始文稿</button></div>
   {kind==='video'&&<p className="bv-link-hint">支持公开媒体直链和能读取视频文件的公开页面。语音识别在本机进行。</p>}
   {kind==='video'&&isDouyin&&<label className="bv-fee-consent"><input type="checkbox" disabled={!tikhubReady||busy||running} checked={paid} onChange={e=>setPaid(e.target.checked)}/>{tikhubReady?'使用 TikHub 解析抖音分享链接，同意本次最多一次付费调用':'抖音分享页可使用 TikHub 解析，请先在后台配置服务'}</label>}
  </form>
  {running&&<p className="bv-link-hint" role="status">{state.job?.progress||'正在处理…'}，离开页面后可恢复进度。</p>}
  {(error||(!running&&state.job?.error))&&<p className="bv-link-error" role="alert">{error||state.job?.error}</p>}
  {source&&<div className="bv-link-result">
   <div className="bv-link-result-top">
    <label><span>已获取文稿</span><select aria-label="已获取文稿" value={source.id} onChange={e=>{setSelected(e.target.value);setVariant('raw')}}>{state.items.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {/^(?:https?):\/\//i.test(source.url||'')&&<a href={source.url} target="_blank" rel="noreferrer">打开原作品 <ArrowUpRight size={14}/></a>}
   </div>
   <div className="bv-link-result-actions"><div className="bv-link-options" aria-label="文稿版本"><button type="button" aria-pressed={effectiveVariant==='raw'} onClick={()=>setVariant('raw')}>{source.benchmark_link_kind==='video'?'原始转写':'原始正文'}</button>{source.benchmark_corrected&&<button type="button" aria-pressed={effectiveVariant==='corrected'} onClick={()=>setVariant('corrected')}>AI 校对稿</button>}</div><div className="bv-link-options"><button type="button" disabled={busy||running||!!source.benchmark_corrected} onClick={correct}><Sparkles size={15}/>AI 校对</button><button type="button" className="bv-link-primary" disabled={busy||running} onClick={rewrite}>用此版本二创 <ArrowUpRight size={15}/></button></div></div>
   <article className="bv-link-text" aria-label={effectiveVariant==='corrected'?'AI 校对稿':'原始文稿'}>{effectiveVariant==='corrected'?source.benchmark_corrected:source.body}</article>
  </div>}
 </section>;
}
