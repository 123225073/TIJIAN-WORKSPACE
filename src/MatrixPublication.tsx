import {useCallback,useEffect,useRef,useState} from 'react';
import {Send,RefreshCw} from 'lucide-react';
import {api} from './api';
import {matrixChannels} from './flow-navigation';
import AssetPicker,{AssetThumbnail} from './AssetPicker';
import type {Asset} from './ResourcePreview';

export type PublicationItem={platform:string;content_id:string;content_version:number};
type PlanItem=PublicationItem&{title:string;ready:boolean;reason?:string;plan_key:string;destination?:string;account_id?:string;cover_asset_id?:string;summary?:string;checkable?:boolean;receipt?:{status:string;url?:string}};
type PublicationJob={id:string;status:string;progress?:string;error?:string;result?:{items:(PublicationItem&{receipt?:{status:string;url?:string};error?:string})[]}};
const states:Record<string,string>={published:'已发布',publishing:'平台正在处理',accepted:'发布服务已接收',draft:'平台草稿已建立',sending:'正在提交',unknown:'结果待核查',uncertain:'结果待核查',failed:'发布失败',removed:'已下架'};
const label=(id:string)=>matrixChannels.find(row=>row.id===id)?.label||id;
const message=(error:unknown)=>error instanceof Error?error.message:'请求未完成，请刷新查看';

export default function MatrixPublication({flowId,items,dirty=false,compact=false}:{flowId:string;items:PublicationItem[];dirty?:boolean;compact?:boolean}){
 const [rows,setRows]=useState<PlanItem[]>([]),[accounts,setAccounts]=useState<any[]>([]),[account,setAccount]=useState('');
 const [cover,setCover]=useState(''),[assets,setAssets]=useState<Asset[]>([]),[picker,setPicker]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<PublicationJob>();
 const lock=useRef(false),request=useRef<{key:string;id:string}|undefined>(undefined),mounted=useRef(true),loadSequence=useRef(0);
 const signature=JSON.stringify(items),hasWechat=items.some(item=>item.platform==='wechat');
 const running=!!job&&['queued','running'].includes(job.status);
 const accountHref='#studio/flow?work='+encodeURIComponent(flowId)+'&step=5&view=accounts';
 const load=useCallback(async(check=false)=>{
  const sequence=++loadSequence.current;
  if(!items.length){setRows([]);return}
  const result=await api('/studio/matrix-publication/'+(check?'status':'preview'),{flow_id:flowId,
   items:items.map(item=>item.platform==='wechat'?{...item,account_id:account,...(cover?{cover_asset_id:cover}:{})}:item)});
  if(mounted.current&&sequence===loadSequence.current)setRows(result.items);
 },[flowId,signature,account,cover]);
 const needsStatus=rows.some(row=>row.checkable&&row.receipt?.status==='publishing');
 useEffect(()=>{
  if(!needsStatus||running)return;
  const timer=window.setTimeout(()=>void load(true).catch(e=>{if(mounted.current)setError(message(e))}),5000);
  return()=>clearTimeout(timer);
 },[needsStatus,running,load,rows]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  let active=true;
  if(hasWechat)void Promise.all([api('/wechat-publish/accounts'),api('/studio/assets?asset_type=image')]).then(([a,b])=>{
   if(!active)return;
   const enabled=a.items.filter((row:any)=>row.enabled);
   setAccounts(a.items);if(enabled.length===1)setAccount(enabled[0].id);
   setAssets(b.items||[]);
  }).catch(e=>{if(active)setError(message(e))});
  void api('/studio/matrix-publication/jobs?flow_id='+encodeURIComponent(flowId)).then(result=>{
   if(active)setJob(result.items[0]);
  }).catch(e=>{if(active)setError(message(e))});
  return()=>{active=false};
 },[flowId,hasWechat]);
 useEffect(()=>{let active=true;setRows([]);void load().catch(e=>{if(active)setError(message(e))});return()=>{active=false;loadSequence.current++}},[load]);
 useEffect(()=>{
  if(!running)return;
  let active=true,timer:number;
  const poll=async()=>{try{
   const result=await api('/studio/matrix-publication/jobs?flow_id='+encodeURIComponent(flowId));
   if(!active)return;
   const current=result.items.find((row:any)=>row.id===job?.id);
   if(current){setJob(current);if(!['queued','running'].includes(current.status))await load()}
  }catch(e){if(active)setError(message(e))}finally{if(active)timer=window.setTimeout(poll,1400)}};
  timer=window.setTimeout(poll,800);return()=>{active=false;clearTimeout(timer)};
 },[running,job?.id,load,flowId]);
 const publish=async(selected:PlanItem[])=>{
  if(lock.current||running||dirty||!selected.length)return;
  const details=selected.map(row=>`${label(row.platform)} · ${row.title} · v${row.content_version}\n${row.destination}`).join('\n\n');
  if(!window.confirm(`确认发布以下 ${selected.length} 份稿件？\n\n${details}\n\n公众号会同步草稿并提交公开发布，结果以平台回执为准。`))return;
  lock.current=true;setBusy(true);setError('');
  try{
   const key=JSON.stringify(selected.map(row=>row.plan_key));
   if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
   const value=await api('/studio/matrix-publication/publish',{flow_id:flowId,items:selected,confirmed:true,request_id:request.current.id});
   if(mounted.current){setJob(value);request.current=undefined}
  }catch(e){if(mounted.current)setError(message(e))}finally{lock.current=false;if(mounted.current)setBusy(false)}
 };
 const eligible=rows.filter(row=>row.ready);
 const coverAsset=assets.find(row=>row.id===cover);
 return <section className={'matrix-publication'+(compact?' compact':'')} aria-label={compact?'发布当前平台稿件':'发布所选平台'}>
  {!compact&&<header><div><h2>发布所选平台</h2><p>逐个平台核对文稿和账号，也可以一次提交全部已就绪稿件。</p></div><button className="primary" disabled={busy||running||dirty||!eligible.length} onClick={()=>void publish(eligible)}><Send size={15}/>一键发布全部就绪平台{eligible.length?` · ${eligible.length}`:''}</button></header>}
  {hasWechat&&<div className="matrix-wechat-options">
   <label>公众号账号<select value={account} disabled={busy||running} onChange={e=>setAccount(e.target.value)}><option value="">请选择发布账号</option>{accounts.filter(row=>row.enabled).map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
   <button type="button" disabled={busy||running} onClick={()=>setPicker(true)}>{coverAsset?'更换公众号封面':'选择公众号封面'}</button>{coverAsset&&<div className="matrix-cover"><AssetThumbnail asset={coverAsset}/></div>}
  </div>}
  {!items.length&&<p>所选平台还没有生成文稿，请先完成平台创作。</p>}
  {rows.map(row=><div className="matrix-publication-row" key={row.platform}>
   <div><strong>{label(row.platform)}</strong>{!compact&&<p>{row.title} <small>v{row.content_version}</small></p>}<small>{row.receipt?(states[row.receipt.status]||row.receipt.status):row.ready?'已就绪 · '+row.destination:row.reason}</small></div>
   <div>{row.receipt?.url&&/^https:\/\//i.test(row.receipt.url)&&<a href={row.receipt.url} target="_blank" rel="noreferrer">查看发布结果 ↗</a>}<button className="primary" disabled={busy||running||dirty||!row.ready} onClick={()=>void publish([row])}><Send size={14}/>{row.receipt?'已有发布记录':'发布到'+label(row.platform)}</button></div>
  </div>)}
  {dirty&&<p role="status">请先保存文稿修改，再提交当前版本。</p>}
  {job&&<div role="status" className="matrix-publication-status">
   {running&&<p>{job.progress||'正在等待发布'}</p>}{job.error&&<p>{job.error}</p>}
   {job.result?.items.filter(row=>items.some(item=>item.platform===row.platform&&item.content_id===row.content_id&&item.content_version===row.content_version)&&!rows.some(current=>current.platform===row.platform&&current.receipt)).map(row=><p key={row.platform}>{label(row.platform)} · {row.error||states[row.receipt?.status||'']||row.receipt?.status}</p>)}
  </div>}
  {error&&<p className="cf-error" role="alert">{error}</p>}
  <footer><a href={accountHref}>管理发布账号</a><button disabled={busy||running} onClick={()=>{setError('');void load(true).catch(e=>setError(message(e)))}}><RefreshCw size={14}/>刷新发布状态</button></footer>
  {picker&&<AssetPicker items={assets} onClose={()=>setPicker(false)} onSelect={item=>{setCover(item.id);setPicker(false)}}/>}
 </section>;
}
