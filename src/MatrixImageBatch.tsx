import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,ImagePlus,LoaderCircle,RefreshCw,Sparkles,TriangleAlert} from 'lucide-react';
import {api,getToken} from './api';
import {advanceSocialBatch,readSocialBatch,socialBatchActive,socialBatchKey,startSocialBatch} from './social-picture-batch';
import {socialStyles} from './picture-styles';
import {readerArticleText} from './wechat-rich';
import {batchBlocksSingle,batchKey} from './article-picture-batch';
import './matrix-image-batch.css';

type Target={platform:string;label:string;content_id:string};
type BatchItem=Target&{content_version:number;snapshot:any;batch_id?:string;prior_batch_id?:string;status:string;done:number;total:number;error?:string;existing:number};
type Manifest={id:string;owner:string;flow_id:string;topic_id:string;created:string;items:BatchItem[]};
export const matrixImageManifestKey=(owner:string,flow:string,topic:string)=>`matrix-image-batch:${owner}:${flow}:${topic}`;
const readManifest=(key:string,owner:string,flow:string,topic:string):Manifest|null=>{try{const item=JSON.parse(localStorage.getItem(key)||'null');return item?.owner===owner&&item.flow_id===flow&&item.topic_id===topic&&Array.isArray(item.items)?item:null}catch{return null}};
const readBatch=(key:string)=>{try{return readSocialBatch(key)}catch{return null}};
const unfinished=(item:BatchItem)=>!['done','failed'].includes(item.status);

/** Each platform keeps its own frozen article and existing idempotent image batch. */
export default function MatrixImageBatch({flowId,topicId,targets,disabled=false}:{flowId:string;topicId:string;targets:Target[];disabled?:boolean}){
 const [session,setSession]=useState<{owner:string;token:string}|null>(null),[manifest,setManifest]=useState<Manifest|null>(null),[proposal,setProposal]=useState<BatchItem[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef<Manifest|null>(null),mounted=useRef(true),lock=useRef(false),requestLock=useRef(false);
 const key=session?matrixImageManifestKey(session.owner,flowId,topicId):'';
 const valid=()=>!!session&&session.token===getToken()&&mounted.current;
 const legacyPending=(id:string)=>{if(!session)return false;const single=JSON.parse(localStorage.getItem('article-picture:'+session.owner+':'+id)||'{}');return batchBlocksSingle(batchKey(session.owner,id))||!!single.pending};
 const write=(value:Manifest)=>{if(!valid())return;localStorage.setItem(key,JSON.stringify(value));current.current=value;setManifest(value)};
 const patch=(id:string,change:Partial<BatchItem>)=>{const value=current.current;if(value)write({...value,items:value.items.map(item=>item.content_id===id?{...item,...change}:item)})};
 useEffect(()=>{mounted.current=true;const token=getToken();let live=true;void api('/auth/me').then(result=>{if(live&&token===getToken())setSession({owner:result.user.id,token})}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;mounted.current=false}},[]);
 const drive=async()=>{
  if(!session||!valid()||lock.current||!current.current)return;lock.current=true;
  const queue=current.current.items.filter(unfinished);let index=0;
  const worker=async()=>{while(index<queue.length&&valid()){
   const item=queue[index++],batchKey=socialBatchKey(session.owner,item.content_id);
   try{
    if(legacyPending(item.content_id))throw Error('此平台原配图任务仍在运行，请在文章配图区核查，未重复生成。');
    let batch=readBatch(batchKey);
    if(batch&&socialBatchActive(batch)&&batch.body!==readerArticleText(item.snapshot.body).trim())throw Error('此平台正在为另一版正文配图，请先打开平台核查原任务。');
    if(item.batch_id&&batch?.id!==item.batch_id)throw Error('原配图批次已变化，请打开此平台核查；未重复生成。');
    if(!item.batch_id){
     if(batch&&batch.id!==item.prior_batch_id)throw Error('此平台出现了另一组配图，请先打开核查；本次未重复生成。');
     if(!batch||(!socialBatchActive(batch)&&batch.id===item.prior_batch_id)){
      // Keep old article pictures visible before replacing the latest batch.
      if(batch?.purpose==='article'){
       const historyKey='article-image-rail:'+session.owner+':'+item.content_id;
       const old=JSON.parse(localStorage.getItem(historyKey)||'[]');localStorage.setItem(historyKey,JSON.stringify([...new Set([...(Array.isArray(old)?old:[]),...batch.slots.flatMap(slot=>slot.asset_id?[slot.asset_id]:[])])]));
      }
      batch=await startSocialBatch(batchKey,item.snapshot,'16:9',3,item.platform==='xiaohongshu'?(socialStyles.find(style=>style.id==='photo')||socialStyles[0]).id:'auto',session,item.platform==='xiaohongshu'?'social':'article');
     }
     if(!batch)throw Error('配图任务尚未创建，请重新核查。');
     patch(item.content_id,{batch_id:batch.id,status:'running',total:batch.slots.length});
    }
    if(!valid())return;
    if(socialBatchActive(batch))await advanceSocialBatch(batchKey,session);
    if(!valid())return;batch=readBatch(batchKey);
    if(!batch||batch.id!==(current.current?.items.find(row=>row.content_id===item.content_id)?.batch_id))throw Error('原批次已变化，未重复生成。');
    const done=batch.slots.filter(slot=>slot.status==='succeeded').length,failed=batch.slots.filter(slot=>slot.status==='failed');
    patch(item.content_id,{done,total:batch.slots.length,status:socialBatchActive(batch)?'running':failed.length?'failed':'done',error:failed.length?`${failed.length} 张未完成，请在此平台配图区处理。`:batch.slots.find(slot=>slot.error)?.error||''});
   }catch(e:any){if(valid())patch(item.content_id,{status:'failed',error:e.message||'配图未完成，原任务已保留。'})}
  }};
  try{await Promise.all([worker(),worker()])}finally{lock.current=false}
 };
 useEffect(()=>{if(!session)return;const saved=readManifest(key,session.owner,flowId,topicId);current.current=saved;setManifest(saved);setProposal(null);void drive();const timer=setInterval(()=>void drive(),2500);return()=>clearInterval(timer)},[key]);
 const prepare=async()=>{
  if(!session||!valid()||requestLock.current)return;requestLock.current=true;setBusy(true);setError('');
  try{
   const response=await api('/state/updates?ids='+encodeURIComponent(targets.map(item=>item.content_id).join(',')));if(!valid())return;
   const items=targets.map(target=>{
    const content=response.items.find((item:any)=>item.id===target.content_id&&item.kind==='content'&&!item.archived);
    if(!content||content.flow_id!==flowId||!String(content.body||content.text||'').trim())throw Error(target.label+'还没有可用的已保存正文，请先保存文稿。');
    if(legacyPending(content.id))throw Error(target.label+'原配图任务仍在运行，请先在平台配图区核查，避免重复生成。');
    const prior=readBatch(socialBatchKey(session.owner,content.id));
    if(prior&&socialBatchActive(prior)&&prior.body!==readerArticleText(String(content.body||content.text||'')).trim())throw Error(target.label+'正在为另一版正文配图，请先核查原任务；本次未生成新图片。');
    return {...target,content_version:content.version,snapshot:{id:content.id,version:content.version,flow_id:flowId,body:String(content.body||content.text||''),title:content.title,brand_id:content.brand_id||'',profile_id:content.profile_id||''},prior_batch_id:prior?.id,...(socialBatchActive(prior)?{batch_id:prior!.id}:{}),status:'new',done:0,total:prior&&socialBatchActive(prior)?prior.slots.length:3,existing:new Set([...(content.image_asset_ids||[]),...(prior?.slots.flatMap(slot=>slot.asset_id?[slot.asset_id]:[])||[])]).size};
   });
   setProposal(items);
  }catch(e:any){if(valid())setError(e.message||'文稿读取失败，请稍后重试。')}finally{requestLock.current=false;if(mounted.current)setBusy(false)}
 };
 const start=()=>{if(!session||!proposal||!valid())return;write({id:crypto.randomUUID(),owner:session.owner,flow_id:flowId,topic_id:topicId,created:new Date().toISOString(),items:proposal});setProposal(null);void drive()};
 const running=!!manifest?.items.some(unfinished),done=manifest?.items.filter(item=>item.status==='done').length||0,failed=manifest?.items.filter(item=>item.status==='failed').length||0;
 return <section className="matrix-image-batch" aria-label="所有平台批量配图"><div className="mib-heading"><div><ImagePlus size={17}/><strong>平台配图</strong><span>各读各的文稿 · 每个平台 3 张 · 16:9</span></div><button type="button" disabled={!session||disabled||busy||running||!targets.length} onClick={()=>void prepare()}><Sparkles size={14}/>{busy?'正在核对文稿…':running?'各平台配图中…':'为所有平台配图'}</button></div>
  {proposal&&<div className="mib-confirm"><strong>将为 {proposal.length} 个平台准备配图</strong><p>新生成 {proposal.filter(item=>!item.batch_id).length*3} 张，将调用已配置的模型并按用量计费。已有进行中批次会继续核查；正文保持不变。</p><ul>{proposal.map(item=><li key={item.platform}>{item.label} · 文稿 v{item.content_version}{item.batch_id?' · 继续原任务':item.existing?` · 已有 ${item.existing} 张图片，本次新增 3 张`:' · 新生成 3 张'}</li>)}</ul><div><button type="button" onClick={()=>setProposal(null)}>取消</button><button className="primary" type="button" onClick={start}>确认并开始配图</button></div></div>}
  {error&&<p className="mib-error" role="alert">{error}</p>}
  {manifest&&<div className="mib-progress" aria-live="polite"><div><span>{done} / {manifest.items.length} 个平台完成{failed?` · ${failed} 个需处理`:''}</span><button type="button" disabled={busy||lock.current} onClick={()=>void drive()}><RefreshCw size={12}/>核查进度</button></div><ul>{manifest.items.map(item=><li key={item.content_id}>{item.status==='done'?<CheckCircle2 size={13}/>:item.status==='failed'?<TriangleAlert size={13}/>:<LoaderCircle size={13} className="spin"/>}<strong>{item.label}</strong><span>{item.done} / {item.total} 张{item.status==='failed'?' · 需处理':''}</span>{item.error&&<small>{item.error}</small>}</li>)}</ul><small>图片保留在各平台右侧配图区；可切换平台查看和插入。</small></div>}
 </section>;
}
