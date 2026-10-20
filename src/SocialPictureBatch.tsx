import {useEffect,useRef,useState} from 'react';
import {AssetThumbnail,StudioModal} from './AssetPicker';
import {getToken} from './api';
import {socialStyles} from './picture-styles';
import {advanceSocialBatch,markSocialAttached,readSocialBatch,retrySocialFailed,socialBatchActive,socialBatchKey,startSocialBatch,type SocialBatch} from './social-picture-batch';
import './picture-batch.css';

const labels:Record<string,string>={new:'准备中',prompt_submitting:'AI 构思画面',prompt_pending:'AI 构思画面',prompt_ready:'画面已准备',prompt_unknown:'画面准备待核对',draft_pending:'准备画面',prepared:'等待提交',submitting:'提交中',queued:'排队中',preparing:'准备中',running:'生成中',unknown:'正在核对原任务',archive_failed:'正在读取图片',succeeded:'已完成',failed:'生成失败'};
export default function SocialPictureBatch({content,owner,disabled,onImages}:{content:any;owner:string;disabled:boolean;onImages:(ids:string[])=>Promise<void>}){
 const key=socialBatchKey(owner,content.id),session=useRef({owner,token:getToken()}).current;
 const [batch,setBatch]=useState<SocialBatch|null>(null),[open,setOpen]=useState(false),[setup,setSetup]=useState(false),[ratio,setRatio]=useState('3:4'),[count,setCount]=useState(4),[style,setStyle]=useState(socialStyles[0].id),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 const live=useRef(true),working=useRef(false),callbacks=useRef({onImages,disabled});callbacks.current={onImages,disabled};
 const refresh=()=>{try{setBatch(readSocialBatch(key))}catch{setError('配图进度读取失败，请检查本机存储。')}};
 const pass=async():Promise<'updated'|'busy'|'failed'|'closed'>=>{
  if(working.current)return 'busy';working.current=true;
  try{
   const current=await advanceSocialBatch(key,session);
   if(!live.current)return 'closed';if(!current)return 'updated';
   const ids=current.slots.filter(s=>s.asset_id&&!current.attached.includes(s.asset_id)).map(s=>s.asset_id!);
   if(ids.length&&!callbacks.current.disabled){await callbacks.current.onImages(ids);if(live.current)await markSocialAttached(key,ids,session)}
   const failure=current.slots.find(s=>s.error&&!['failed','succeeded'].includes(s.status));if(failure){setError(failure.error||'进度暂未更新，请稍后重试。');return 'failed'}setError('');return 'updated';
  }catch(e:any){if(live.current)setError(e.message);return 'failed'}finally{working.current=false;if(live.current)refresh()}
 };
 useEffect(()=>{live.current=true;refresh();void pass();const timer=setInterval(()=>void pass(),2000);const changed=(e:Event)=>{if(e instanceof StorageEvent?e.key===key:(e as CustomEvent).detail===key)refresh()};window.addEventListener('social-picture-batch',changed);window.addEventListener('storage',changed);return()=>{live.current=false;clearInterval(timer);window.removeEventListener('social-picture-batch',changed);window.removeEventListener('storage',changed)}},[key]);
 const start=async()=>{if(busy)return;setBusy(true);setError('');setFeedback('');try{await startSocialBatch(key,content,ratio,count,style,session);setSetup(false);await pass()}catch(e:any){setError(e.message)}finally{setBusy(false);refresh()}};
 const check=async()=>{setBusy(true);setError('');setFeedback('');try{const result=await pass();if(result==='updated')setFeedback('已刷新生成进度 · '+new Date().toLocaleTimeString('zh-CN',{hour12:false}));else if(result==='busy')setFeedback('正在更新生成进度，请稍候。')}finally{setBusy(false)}};
 return <><button type="button" className="st-primary" disabled={disabled||!content.id} onClick={()=>{setSetup(!batch);setOpen(true)}}>一键配图{socialBatchActive(batch)?' · 查看进度':''}</button>
 {open&&<StudioModal title="小红书一键配图" onClose={()=>setOpen(false)}><div className="picture-batch-body">
  <p>根据当前文案制作一组配图。图片与正文分别保存，生成后不会插入文章。</p>
  {(setup||!batch)?<><div className="picture-batch-parameters"><label>尺寸 / 比例<select aria-label="一键配图尺寸" disabled={busy} value={ratio} onChange={e=>setRatio(e.target.value)}>{['3:4','1:1','4:3','9:16','16:9'].map(r=><option key={r} value={r}>{r}{r==='3:4'?' · 推荐竖图':''}</option>)}</select></label><label>数量<select aria-label="一键配图数量" disabled={busy} value={count} onChange={e=>setCount(Number(e.target.value))}>{[1,2,3,4,6,9].map(n=><option key={n} value={n}>{n} 张</option>)}</select></label><label>风格<select aria-label="一键配图风格" disabled={busy} value={style} onChange={e=>setStyle(e.target.value)}>{socialStyles.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label></div><p className="picture-batch-note">默认 3:4、4 张、清爽知识卡片；同组图片使用统一风格。使用设置中的默认生图模型，按服务用量计费；实际尺寸以模型支持范围为准。</p><button className="st-primary" disabled={busy||disabled||!String(content.body||content.text||'').trim()} onClick={()=>void start()}>{busy?'正在准备…':`按当前文案生成 ${count} 张图片`}</button></>:<><p>提交比例 {batch.actual_ratio||batch.ratio}{batch.options.size?' · '+batch.options.size.replace(/[x*]/,' × '):''} · {batch.slots.length} 张 · {socialStyles.find(s=>s.id===batch.style)?.title} · 自动更新进度</p>{batch.parameter_notice&&<p role="status" className="parameter-adjustment">{batch.parameter_notice}</p>}{batch.slots.map(s=><section className="ap-run-status" key={s.index}><strong>{String(s.index+1).padStart(2,'0')} / {batch.slots.length} · {labels[s.status]||s.status}</strong>{s.asset_id&&<div className="picture-batch-preview"><AssetThumbnail asset={{id:s.asset_id,title:`配图 ${s.index+1}`,file_url:'/api/studio/assets/'+s.asset_id+'/file'}}/></div>}{s.error&&<p>{s.error}</p>}{s.asset_id&&<small>点击图片放大、滚轮缩放 · 已保留在素材库{batch.attached.includes(s.asset_id)?' · 已加入文案配图':''}</small>}</section>)}<button disabled={busy} onClick={()=>void check()}>{busy?'正在刷新…':'刷新生成进度'}</button>{batch.slots.some(s=>s.status==='failed')&&<button disabled={busy||disabled} onClick={async()=>{setBusy(true);setError('');try{await retrySocialFailed(key,session);await pass()}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>仅重试失败图片 · 按用量计费</button>}{!socialBatchActive(batch)&&<button disabled={busy||disabled} onClick={()=>{setSetup(true);setFeedback('')}}>再制作一组</button>}<p className="picture-batch-note">关闭后会保留原任务，重新打开查看进度不会重复生成。完成的图片可在文案配图区域调整顺序和下载。</p></>}
  {feedback&&<p role="status">{feedback}</p>}{error&&<p role="alert">{error}</p>}
 </div></StudioModal>}</>;
}
