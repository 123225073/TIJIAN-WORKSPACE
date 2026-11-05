import {useEffect,useRef,useState} from 'react';
import {FolderOpen,ImagePlus,RefreshCw,Sparkles,Upload} from 'lucide-react';
import {api,getToken} from './api';
import AssetPicker,{AssetThumbnail} from './AssetPicker';
import {batchBlocksSingle,batchKey} from './article-picture-batch';
import {advanceSocialBatch,markSocialAttached,readSocialBatch,retrySocialFailed,socialBatchActive,socialBatchKey,startSocialBatch,type SocialBatch} from './social-picture-batch';
import './article-image-rail.css';

type Props={content:any;owner:string;save:()=>Promise<any>;getBody:()=>string;onInsert:(asset:any,caption:string,place:string)=>Promise<void>;disabled?:boolean;onCapture?:()=>void};
const labels:Record<string,string>={new:'准备画面',prompt_submitting:'构思画面',prompt_pending:'构思画面',prompt_unknown:'原请求待核查',prompt_ready:'画面已准备',draft_pending:'准备生图',prepared:'准备提交',submitting:'提交中',queued:'排队中',preparing:'准备中',running:'生成中',unknown:'原任务待核查',archive_failed:'读取已生成图片',failed:'生成失败',succeeded:'已完成'};
const ratios=[['4:3','横图'],['16:9','宽屏'],['1:1','方图'],['3:4','竖图']];
const readIds=(key:string):string[]=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(x=>typeof x==='string'):[]}catch{return []}};

/** Inline article illustration workspace. Generation never changes the article. */
export default function ArticleImageRail({content,owner,save,getBody,onInsert,disabled=false,onCapture}:Props){
 const key=socialBatchKey(owner,content.id),historyKey='article-image-rail:'+owner+':'+content.id;
 const [session]=useState(()=>({owner,token:getToken()}));
 const [batch,setBatch]=useState<SocialBatch|null>(()=>readSocialBatch(key));
 const [ratio,setRatio]=useState(()=>readSocialBatch(key)?.ratio||'4:3'),[count,setCount]=useState(()=>{const saved=readSocialBatch(key)?.slots.length;return saved&&[1,2,3,4].includes(saved)?saved:3});
 const [assets,setAssets]=useState<any[]>([]),[history,setHistory]=useState(()=>readIds(historyKey));
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[library,setLibrary]=useState(false);
 const [reading,setReading]=useState(false);
 const live=useRef({content,save,getBody,onInsert,disabled,onCapture});live.current={content,save,getBody,onInsert,disabled,onCapture};
 const mounted=useRef(true),polling=useRef(false),actionLock=useRef(false),upload=useRef<HTMLInputElement>(null);
 const sameAccount=()=>{if(session.token!==getToken())throw Error('账号已切换，原账号图片仍保留；请返回原账号查看。')};
 const remember=(ids:string[])=>{
  const saved=[...new Set([...readIds(historyKey),...ids])];
  localStorage.setItem(historyKey,JSON.stringify(saved));if(mounted.current)setHistory(saved);
 };
 const readAssets=async()=>{sameAccount();const result=await api('/studio/assets');sameAccount();if(mounted.current)setAssets((result.items||[]).filter((a:any)=>a.asset_type==='image'&&a.status==='ready'));};
 const sync=()=>{
  const next=readSocialBatch(key);if(mounted.current)setBatch(next);
  if(next?.purpose==='article')remember(next.slots.flatMap(s=>s.asset_id?[s.asset_id]:[]));
 };
 const pass=async(manual=false)=>{
  if(polling.current)return;
  const current=readSocialBatch(key);if(!current||current.purpose!=='article'||(!manual&&!socialBatchActive(current)))return;
  polling.current=true;if(manual&&mounted.current)setReading(true);
  try{
   sameAccount();await advanceSocialBatch(key,session);sameAccount();sync();
   const next=readSocialBatch(key);const ids=next?.slots.flatMap(s=>s.asset_id?[s.asset_id]:[])||[];
   if(ids.length||manual)await readAssets();
   if(manual&&mounted.current){const issue=next?.slots.find(s=>s.error);setError(issue?.error||'');setFeedback(issue?'':'进度已更新。')}
  }catch(e:any){if(mounted.current)setError(e.message||'进度读取失败，原任务已保留。')}
  finally{polling.current=false;if(manual&&mounted.current)setReading(false)}
 };
 useEffect(()=>{
  mounted.current=true;void readAssets().catch(e=>{if(mounted.current)setError(e.message)});sync();void pass();
  const update=(event:Event)=>{if(event instanceof StorageEvent&&event.key!==key&&event.key!==historyKey)return;if(event instanceof CustomEvent&&event.detail!==key)return;try{sync()}catch(e:any){if(mounted.current)setError(e.message)}};
  window.addEventListener('social-picture-batch',update);window.addEventListener('storage',update);
  const timer=setInterval(()=>void pass(),2200);
  return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('social-picture-batch',update);window.removeEventListener('storage',update)};
 },[key]);
 const act=async(label:string,fn:()=>Promise<void>)=>{
  if(actionLock.current||live.current.disabled)return;actionLock.current=true;setBusy(label);setError('');setFeedback('');
  try{sameAccount();await fn();sameAccount()}
  catch(e:any){if(mounted.current)setError(e.message||'操作未完成，已生成图片仍保留。')}
  finally{actionLock.current=false;if(mounted.current)setBusy('')}
 };
 const legacyPending=()=>batchBlocksSingle(batchKey(owner,content.id))||!!JSON.parse(localStorage.getItem('article-picture:'+owner+':'+content.id)||'{}').pending;
 const generate=()=>act('generate',async()=>{
  if(legacyPending())throw Error('原配图任务尚未结束，请先在原配图入口核查进度，避免重复生成。');
  if(socialBatchActive(readSocialBatch(key)))throw Error('上一组图片仍在生成，请先等待或核查进度。');
  if(!live.current.getBody().trim())throw Error('请先完成文章正文，再生成配图。');
  const saved=await live.current.save();sameAccount();
  if(saved.id!==content.id||String(saved.body??saved.text??'')!==live.current.getBody())throw Error('正文正在变化，请保存后再生成配图。');
  // Persist completed IDs before replacing the current batch with another group.
  remember(readSocialBatch(key)?.slots.flatMap(s=>s.asset_id?[s.asset_id]:[])||[]);
  await startSocialBatch(key,saved,ratio,count,'industry',session,'article');sync();await pass();
 });
 const insert=(asset:any)=>act('insert:'+asset.id,async()=>{
  live.current.onCapture?.();sameAccount();
  await live.current.onInsert(asset,'正文配图','end');sameAccount();
  await markSocialAttached(key,[asset.id],session);sync();setLibrary(false);setFeedback('图片已插入文末，请保存文章。');
 });
 const active=batch?.purpose==='article'&&socialBatchActive(batch),finished=batch?.purpose==='article'?batch.slots.filter(s=>s.status==='succeeded').length:0;
 const failed=batch?.purpose==='article'?batch.slots.filter(s=>s.status==='failed'):[];
 const referenced=Array.from(live.current.getBody().matchAll(/\/api\/studio\/assets\/([a-f0-9]{32,64})\/file/g),m=>m[1]);
 const ids=[...new Set([...(batch?.purpose==='article'?batch.slots.flatMap(s=>s.asset_id?[s.asset_id]:[]):[]),...history,...(content.image_asset_ids||[]),...referenced])];
 const shown=ids.map(id=>assets.find(a=>a.id===id)).filter(Boolean);
 const pending=batch?.purpose==='article'?batch.slots.filter(s=>s.status!=='succeeded'):[];
 return <section className="article-image-rail" aria-label="文章配图">
  <header className="air-heading"><span className="air-icon"><ImagePlus size={20}/></span><div><h3>文章配图</h3><p>读懂文章，自动构思画面</p></div></header>
  <div className="air-settings">
   <fieldset disabled={!!busy||!!active||disabled}><legend>画面比例</legend><div className="air-ratios">{ratios.map(([value,title])=><button type="button" key={value} aria-pressed={ratio===value} onClick={()=>setRatio(value)}><span>{value}</span><small>{title}</small></button>)}</div></fieldset>
   <fieldset className="air-count" disabled={!!busy||!!active||disabled}><legend>生成数量</legend><div>{[1,2,3,4].map(n=><button type="button" key={n} aria-pressed={count===n} onClick={()=>setCount(n)}>{n} 张</button>)}</div></fieldset>
   <button type="button" className="air-generate st-primary" disabled={!!busy||!!active||disabled} onClick={()=>void generate()}><Sparkles size={16}/>{busy==='generate'?'正在准备…':active?`生成中 · ${finished}/${batch!.slots.length}`:`生成 ${count} 张配图`}</button>
   <p className="air-hint">沿用文章风格 · 默认画质 · 按用量计费</p>
  </div>
  {error&&<p className="air-message air-error" role="alert">{error}</p>}
  {feedback&&<p className="air-message" role="status">{feedback}</p>}
  {batch?.purpose==='article'&&batch.parameter_notice&&<p className="air-message">{batch.parameter_notice}</p>}
  {(!!pending.length||!!failed.length)&&<div className="air-progress" aria-live="polite">
   <div className="air-progress-title"><strong>{finished} / {batch!.slots.length} 张已完成</strong><button type="button" disabled={reading||!!busy} onClick={()=>void pass(true)}><RefreshCw size={13}/>{reading?'核查中…':'核查进度'}</button></div>
   {pending.map(slot=><div key={slot.index} className={slot.status==='failed'?'air-slot air-slot-error':'air-slot'}><span>配图 {slot.index+1}</span><span>{labels[slot.status]||'任务处理中'}</span>{slot.error&&<small>{slot.error}</small>}</div>)}
   {!!failed.length&&<button type="button" className="air-retry" disabled={!!busy||disabled} onClick={()=>void act('retry',async()=>{await retrySocialFailed(key,session);sync();await pass()})}>仅重试失败图片 · 按用量计费</button>}
  </div>}
  <div className="air-gallery-heading"><h4>配图素材 <small>{shown.length} 张</small></h4><button type="button" title="读取最新图片素材" aria-label="刷新配图素材" disabled={!!busy} onClick={()=>void act('refresh',readAssets)}><RefreshCw size={14}/></button></div>
  {shown.length?<div className="air-gallery">{shown.map((asset,index)=><article key={asset.id}>
   <div className="air-picture"><AssetThumbnail asset={asset}/><span>{String(index+1).padStart(2,'0')}</span><button type="button" aria-label={'放大配图 '+(index+1)} onClick={e=>e.currentTarget.parentElement?.querySelector('img')?.click()}>放大</button></div>
   <button type="button" className="air-insert" disabled={!!busy||disabled} onClick={()=>void insert(asset)}>{busy==='insert:'+asset.id?'正在插入…':batch?.attached.includes(asset.id)?'再次插入文末':'插入文末'}</button>
  </article>)}</div>:<div className="air-empty"><ImagePlus size={25}/><strong>图片会显示在这里</strong><p>生成后先看效果，再选图插入文章。</p></div>}
  <div className="air-library-actions"><button type="button" disabled={!!busy||disabled} onClick={()=>void act('library',async()=>{await readAssets();setLibrary(true)})}><FolderOpen size={15}/>素材库选图</button><button type="button" disabled={!!busy||disabled} onClick={()=>upload.current?.click()}><Upload size={14}/>上传</button></div>
  <input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void act('upload',async()=>{const form=new FormData();form.append('file',file);const raw=await api('/studio/upload',form);sameAccount();const asset=raw.asset||raw;if(asset.asset_type!=='image'||asset.status!=='ready')throw Error('上传结果尚未成为可用图片，请到素材库核查。');remember([asset.id]);await readAssets();setFeedback('图片已加入右侧素材，可插入文章。')})}}/>
  {library&&<AssetPicker title="为文章选择图片" items={assets} busy={!!busy} onClose={()=>setLibrary(false)} onSelect={asset=>{remember([asset.id]);setLibrary(false);setFeedback('已加入右侧配图素材，点击“插入文末”即可使用。')}}/>}
 </section>;
}
