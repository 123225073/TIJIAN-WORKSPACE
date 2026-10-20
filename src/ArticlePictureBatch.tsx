import {useEffect,useRef,useState} from 'react';
import {StudioModal} from './AssetPicker';
import {getToken} from './api';
import {AssetThumbnail} from './AssetPicker';
import {pictureStyles} from './picture-styles';
import './picture-batch.css';
import {advanceBatch,applyBatch,batchKey,readBatch,retryFailedPictures,startBatch,type PictureBatch} from './article-picture-batch';

const labels:Record<string,string>={new:'等待准备',prompt_submitting:'准备提示词',prompt_pending:'准备提示词',prompt_unknown:'提示词待核查',prompt_ready:'提示词已采用',draft_submitting:'保存配图草稿',prepared:'准备提交',submitting:'提交中',queued:'排队中',preparing:'准备中',running:'生成中',unknown:'原任务待核查',archive_failed:'素材待核查',failed:'失败',succeeded:'已完成'};
export default function ArticlePictureBatch({content,owner,save,getBody,onApply,disabled=false}:{content:any;owner:string;save:()=>Promise<any>;getBody:()=>string;onApply:(expected:string,next:string)=>void;disabled?:boolean}){
 const key=batchKey(owner,content.id),[batch,setBatch]=useState<PictureBatch|null>(null),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [styleId,setStyleId]=useState(pictureStyles[0].id),[checking,setChecking]=useState(false),[checked,setChecked]=useState('');
 const refs=useRef({save,getBody,onApply});refs.current={save,getBody,onApply};const live=useRef(true),working=useRef(false);
 const session=useRef({owner,token:getToken()}).current;
 const refresh=()=>{try{setBatch(readBatch(key))}catch{setError('三图进度读取失败，请检查本机存储。')}};
 const pass=async():Promise<'updated'|'busy'|'failed'|'closed'>=>{
  if(working.current)return 'busy';working.current=true;
  try{const current=await advanceBatch(key,session);if(!live.current)return 'closed';await applyBatch(key,()=>refs.current.getBody(),(expected,next)=>{if(!live.current)throw Error('文章已关闭，重新打开后回填');refs.current.onApply(expected,next)},session);const failure=current?.slots.find(s=>s.error&&!['failed','succeeded'].includes(s.status));if(failure){setError(failure.error||'进度暂未更新，请稍后重试。');return 'failed'}setError('');return 'updated'}
  catch(e:any){if(live.current)setError(e.message);return 'failed'}finally{working.current=false;if(live.current)refresh()}
 };
 useEffect(()=>{
  live.current=true;refresh();void pass();const timer=setInterval(()=>void pass(),1800);
  const changed=(e:Event)=>{if(e instanceof StorageEvent?e.key===key:(e as CustomEvent).detail===key)refresh()};
  window.addEventListener('article-picture-batch',changed);window.addEventListener('storage',changed);
  return()=>{live.current=false;clearInterval(timer);window.removeEventListener('article-picture-batch',changed);window.removeEventListener('storage',changed)};
 },[key]);
 const start=async()=>{if(busy)return;setOpen(true);setError('');setBusy(true);try{await startBatch(key,content,refs.current.save,session,styleId);await pass()}catch(e:any){if(live.current)setError(e.message)}finally{if(live.current){setBusy(false);refresh()}}};
 const check=async()=>{if(checking)return;setChecking(true);setError('');setChecked('');try{const result=await pass();if(result==='updated')setChecked('已刷新 · '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'；生成中的图片会自动更新。');else if(result==='busy')setChecked('正在更新生成进度，请稍候。')}finally{setChecking(false)}};
 const retry=async()=>{setError('');try{await retryFailedPictures(key,session);await pass()}catch(e:any){setError(e.message)}};
 return <div className="md-toolbar" data-article-picture-batch>
  <button className="st-primary" disabled={disabled||busy} onClick={()=>setOpen(true)}>{batch&&batch.status!=='setup_failed'?'查看三图进度':'一键配图 · 3张'}</button><small>按用量计费 · 先保存文章，再生成开头、中段、结尾三张图</small>
  {open&&<StudioModal title="文章三图" onClose={()=>setOpen(false)}><div className="picture-batch-body">
   {(!batch||batch.status==='setup_failed')?<><p>先选择三张配图统一使用的风格。AI 会结合正文制作开头、中段和结尾配图。</p><div className="picture-style-grid" role="radiogroup" aria-label="文章配图风格">{pictureStyles.map(style=><button type="button" role="radio" aria-checked={styleId===style.id} key={style.id} onClick={()=>setStyleId(style.id)}><strong>{style.title}</strong><span>{style.description}</span></button>)}</div><p className="picture-batch-note">按服务用量计费。开始后会保存当前文章；三张图使用同一种风格，完成后回填正文并保留在素材库。</p><button className="st-primary" disabled={busy} onClick={()=>void start()}>{busy?'正在准备…':'使用所选风格，生成 3 张配图'}</button></>:<><p>统一风格：{pictureStyles.find(style=>style.id===batch.style_id)?.title||'清晰行业插画'} · 进度自动更新，关闭后仍可重新查看。</p><p className="picture-batch-note">“刷新生成进度”只查询原任务，不会重复生成或再次收费。</p></>}
   {batch?.status==='saving'&&<p role="status">正在保存正文；若重启后仍停留在此状态，请先核对文章保存结果，尚未提交配图。</p>}
   {batch?.slots.map(s=><section key={s.id} className="ap-run-status"><strong>{s.label}配图 · {labels[s.status]||s.status}</strong>{s.error&&<p>{s.error}</p>}{s.asset_id&&<><div className="picture-batch-preview"><AssetThumbnail asset={{id:s.asset_id,title:s.label+'配图',file_url:'/api/studio/assets/'+s.asset_id+'/file'}}/></div><small>点击放大 · 已保留在素材库{batch.applied.includes(s.asset_id)?' · 已回填正文':' · 等待回填'}</small></>}</section>)}
   {batch?.status==='saving'&&<button disabled={busy} onClick={()=>void start()}>继续保存并配图</button>}
   {batch?.status==='ready'&&<button disabled={busy||checking} onClick={()=>void check()}>{checking?'正在刷新…':'刷新生成进度'}</button>}
   {batch?.slots.some(s=>s.status==='failed')&&<button onClick={()=>void retry()}>重试失败项 · 按用量计费</button>}
   {checked&&<p role="status">{checked}</p>}
   {(error||batch?.error)&&<p role="alert" className="ap-error">{error||batch?.error}</p>}
   {batch?.slots.some(s=>s.asset_id)&&<a href="#studio/assets">去素材库使用已生成图片</a>}
   {!!batch?.applied.length&&<p role="status">已回填 {batch.applied.length} 张图片，正文已暂存本机，请保存修改。</p>}
  </div></StudioModal>}
 </div>;
}
