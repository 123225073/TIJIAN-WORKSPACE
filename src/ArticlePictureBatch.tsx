import {useEffect,useRef,useState} from 'react';
import {StudioModal} from './AssetPicker';
import {getToken} from './api';
import {advanceBatch,applyBatch,batchKey,readBatch,retryFailedPictures,startBatch,type PictureBatch} from './article-picture-batch';

const labels:Record<string,string>={new:'等待准备',prompt_submitting:'准备提示词',prompt_pending:'准备提示词',prompt_unknown:'提示词待核查',prompt_ready:'提示词已采用',draft_submitting:'保存配图草稿',prepared:'准备提交',submitting:'提交中',queued:'排队中',preparing:'准备中',running:'生成中',unknown:'原任务待核查',archive_failed:'素材待核查',failed:'失败',succeeded:'已完成'};
export default function ArticlePictureBatch({content,owner,save,getBody,onApply,disabled=false}:{content:any;owner:string;save:()=>Promise<any>;getBody:()=>string;onApply:(expected:string,next:string)=>void;disabled?:boolean}){
 const key=batchKey(owner,content.id),[batch,setBatch]=useState<PictureBatch|null>(null),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const refs=useRef({save,getBody,onApply});refs.current={save,getBody,onApply};const live=useRef(true),working=useRef(false);
 const session=useRef({owner,token:getToken()}).current;
 const refresh=()=>{try{setBatch(readBatch(key))}catch{setError('三图进度读取失败，请检查本机存储。')}};
 const pass=async()=>{
  if(working.current)return;working.current=true;
  try{await advanceBatch(key,session);if(live.current)await applyBatch(key,()=>refs.current.getBody(),(expected,next)=>{if(!live.current)throw Error('文章已关闭，重新打开后回填');refs.current.onApply(expected,next)},session)}
  catch(e:any){if(live.current)setError(e.message)}finally{working.current=false;if(live.current)refresh()}
 };
 useEffect(()=>{
  live.current=true;refresh();void pass();const timer=setInterval(()=>void pass(),1800);
  const changed=(e:Event)=>{if(e instanceof StorageEvent?e.key===key:(e as CustomEvent).detail===key)refresh()};
  window.addEventListener('article-picture-batch',changed);window.addEventListener('storage',changed);
  return()=>{live.current=false;clearInterval(timer);window.removeEventListener('article-picture-batch',changed);window.removeEventListener('storage',changed)};
 },[key]);
 const start=async()=>{if(busy)return;setOpen(true);setError('');setBusy(true);try{await startBatch(key,content,refs.current.save,session);await pass()}catch(e:any){if(live.current)setError(e.message)}finally{if(live.current){setBusy(false);refresh()}}};
 const retry=async()=>{setError('');try{await retryFailedPictures(key,session);await pass()}catch(e:any){setError(e.message)}};
 return <div className="md-toolbar" data-article-picture-batch>
  <button className="st-primary" disabled={disabled||busy} onClick={()=>batch&&batch.status!=='setup_failed'?setOpen(true):void start()}>{batch&&batch.status!=='setup_failed'?'查看三图进度':'一键配图 · 3张'}</button><small>按用量计费 · 先保存文章，再生成开头、中段、结尾三张图</small>
  {open&&<StudioModal title="文章三图" onClose={()=>setOpen(false)}><div className="ap-generate" style={{padding:24,overflowY:'auto'}}>
   <p>三张图分别保存进度。关闭窗口后可重新查看，已完成的图片不会重复生成。</p>
   {batch?.status==='saving'&&<p role="status">正在保存正文；若重启后仍停留在此状态，请先核对文章保存结果，尚未提交配图。</p>}
   {batch?.slots.map(s=><section key={s.id} className="ap-run-status"><strong>{s.label}配图 · {labels[s.status]||s.status}</strong>{s.error&&<p>{s.error}</p>}{s.asset_id&&<small>已保留在素材库{batch.applied.includes(s.asset_id)?' · 已回填正文':' · 等待回填'}</small>}</section>)}
   {batch?.status==='saving'&&<button disabled={busy} onClick={()=>void start()}>继续保存并配图</button>}
   {batch?.status==='ready'&&<button disabled={busy} onClick={()=>{setError('');void pass()}}>核查任务</button>}
   {batch?.slots.some(s=>s.status==='failed')&&<button onClick={()=>void retry()}>重试失败项 · 按用量计费</button>}
   {(error||batch?.error)&&<p role="alert" className="ap-error">{error||batch?.error}</p>}
   {batch?.slots.some(s=>s.asset_id)&&<a href="#studio/assets">去素材库使用已生成图片</a>}
   {!!batch?.applied.length&&<p role="status">已回填 {batch.applied.length} 张图片，正文已暂存本机，请保存修改。</p>}
  </div></StudioModal>}
 </div>;
}
