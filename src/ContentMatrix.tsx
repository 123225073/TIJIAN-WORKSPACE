import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,RefreshCw,Sparkles} from 'lucide-react';
import {api,getToken} from './api';
import {matrixChannels} from './flow-navigation';
import {PublishAccounts} from './MatrixPublish';
import MatrixPublication from './MatrixPublication';
import PlatformIcon from './PlatformIcon';
import ArticleRichEditor from './ArticleRichEditor';
import Markdown from './Markdown';
import MatrixImageBatch from './MatrixImageBatch';

type Master={id:string;flow_id:string;topic_id:string;body:string;platforms:string[];version:number};
type MatrixRun={id:string;draft_id:string;status:string;platform:string;master_version?:number;content_id?:string;content_version?:number;content?:any;title?:string;error?:string};
type MasterJob={id:string;status:string;progress?:string;error?:string;stream_text?:string;stream_note?:string;result?:{body?:string;master?:Master};input:{version:number;direct?:boolean}};
type MatrixState={master:Master;runs:MatrixRun[];master_job?:MasterJob|null};
type Changes=Pick<Master,'body'|'platforms'|'version'>;
export type MatrixView='master'|'platforms'|'creation'|'publish'|'accounts';
const working=(run:{status:string})=>['queued','running'].includes(run.status);
const labels:Record<string,string>={queued:'等待生成',running:'正在创作',done:'稿件已生成',failed:'生成失败',cancelled:'已取消',interrupted:'已中断'};
const msg=(error:unknown)=>error instanceof Error?error.message:String(error);

export default function ContentMatrix({flowId,topicId,topicTitle,view,editor,channel,editPlatform,navigate,renderContent}:{
 flowId:string;topicId:string;topicTitle:string;view:MatrixView;editor?:ReactNode;channel?:string;
 editPlatform:(platform:string,master:Master,run?:MatrixRun)=>void;navigate:(view:MatrixView)=>void;
 renderContent:(content:any,refresh:()=>void)=>ReactNode;
}){
 const [state,setState]=useState<MatrixState>(),[changes,setChanges]=useState<Changes>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[failed,setFailed]=useState<Record<string,string>>({});
 const [active,setActive]=useState(channel||''),[editingMaster,setEditingMaster]=useState(false),[recovery,setRecovery]=useState<Changes[]>([]);
 const lock=useRef(false),keys=useRef<Record<string,string>>({}),alive=useRef(true),lastMasterJob=useRef('');
 const storage='tijian-matrix:'+flowId+':'+topicId,path='/studio/flows/'+encodeURIComponent(flowId)+'/matrix';
 const read=useCallback(async(discard=false)=>{
  if(!flowId||!topicId)return;
  const session=getToken(),value=await api<MatrixState>(path);
  if(!alive.current||session!==getToken()||value.master.topic_id!==topicId)return;
  setState(current=>current&&current.master.version>value.master.version?{...value,master:current.master}:value);
  setChanges(current=>{
   const master=value.master,job=value.master_job;
   if(!current){
    // A completed historical job must not overwrite edits restored after a restart.
    if(job?.status==='done')lastMasterJob.current=job.id;
    try{const local=JSON.parse(localStorage.getItem(storage)||'null');if(local&&typeof local.body==='string'&&Array.isArray(local.platforms)&&Number.isInteger(local.version))return local}catch{}
   }
   const completed=job?.status==='done'&&job.result?.master&&job.id!==lastMasterJob.current;
   if(completed){lastMasterJob.current=job.id;if(!current||current.version===job.input.version)return {body:master.body,platforms:current?.platforms||master.platforms,version:master.version}}
   if(discard)return {body:master.body,platforms:master.platforms,version:master.version};
   if(current)return current;
   const proposal=!master.body&&job?.status==='done'&&!job.input.direct&&job.input.version===master.version?job.result?.body:'';
   return {body:proposal||master.body,platforms:master.platforms,version:master.version};
  });
 },[flowId,topicId,path,storage]);
 useEffect(()=>{alive.current=true;void read().catch(e=>{if(alive.current)setError(msg(e))});return()=>{alive.current=false}},[read,!!editor]);
 const master=state?.master,masterJob=state?.master_job,writing=!!masterJob&&working(masterJob);
 const conflict=!!master&&!!changes&&changes.version!==master.version&&!writing;
 const reconcile=(local:boolean)=>{
  if(!master||!changes)return;
  try{
   const recovery=JSON.parse(localStorage.getItem(storage+':recovery')||'[]');
   const retained=[...recovery,{...(local?master:changes),saved_at:new Date().toISOString()}].slice(-5);
   localStorage.setItem(storage+':recovery',JSON.stringify(retained));setRecovery(retained);
   setChanges(local?{...changes,version:master.version}:{body:master.body,platforms:master.platforms,version:master.version});setError('');
  }catch{setError('保留另一份文稿失败，请先复制本机正文')}
 };
 useEffect(()=>{try{setRecovery(JSON.parse(localStorage.getItem(storage+':recovery')||'[]'))}catch{}},[storage]);
 const activeRuns=writing||!!state?.runs.some(working);
 useEffect(()=>{
  if(!activeRuns)return;
  let live=true,timer:number;
  const poll=async()=>{try{await read()}catch(e){if(live)setError(msg(e))}finally{if(live)timer=window.setTimeout(poll,writing?650:1800)}};
  timer=window.setTimeout(poll,500);return()=>{live=false;clearTimeout(timer)};
 },[activeRuns,writing,read]);
 useEffect(()=>{if(changes)try{localStorage.setItem(storage,JSON.stringify(changes))}catch{setError('母版暂存失败，请保存后再离开')}},[changes,storage]);
 const dirty=!!master&&!!changes&&(changes.body!==master.body||JSON.stringify(changes.platforms)!==JSON.stringify(master.platforms));
 const perform=async(fn:()=>Promise<void>)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{await fn()}catch(e){if(alive.current)setError(msg(e))}finally{lock.current=false;if(alive.current)setBusy(false)}
 };
 const save=async()=>{
  if(!master||!changes)throw Error('请等待母版加载');
  if(!dirty)return master;
  const value=await api<Master>(path,{...changes,topic_id:topicId},'PUT');
  if(alive.current){setState(old=>old?{...old,master:value}:old);setChanges({body:value.body,platforms:value.platforms,version:value.version})}
  return value;
 };
 const writeMaster=()=>void perform(async()=>{
  if(changes?.body.trim()&&!window.confirm('重新生成将替换当前正文，已保存的历史版本可恢复。确认重新生成？'))return;
  const saved=await save(),key='master:'+saved.version;
  const request_id=keys.current[key]||(keys.current[key]=crypto.randomUUID());
  const job=await api<MasterJob>(path+'/write-master',{topic_id:topicId,version:saved.version,request_id,direct:true});
  delete keys.current[key];
  if(alive.current){setEditingMaster(false);setState(old=>old?{...old,master_job:job}:old)}
 });
 const generate=(platforms:string[])=>void perform(async()=>{
  const current=await save();
  if(!current.body.trim()||!platforms.length)throw Error('请先生成母版，并选择要创作的平台');
  if(!window.confirm(`为 ${platforms.length} 个平台创作文稿？将调用已配置的写作模型。`))return;
  const operationGroup={groupId:crypto.randomUUID(),groupTitle:`创作 ${platforms.length} 个平台文稿`,groupRoute:location.hash.slice(1)};
  const responses=await Promise.allSettled(platforms.map(async platform=>{
   const key=current.version+':'+platform,request_id=keys.current[key]||(keys.current[key]=crypto.randomUUID());
   await api(path+'/generate',{platform,master_version:current.version,topic_id:topicId,request_id},undefined,operationGroup);delete keys.current[key];
  }));
  if(!alive.current)return;
  setFailed(old=>({...old,...Object.fromEntries(responses.map((result,index)=>[platforms[index],result.status==='rejected'?msg(result.reason):'']))}));
  await read();navigate('creation');
 });
 const picked=changes?.platforms||[],selected=matrixChannels.filter(item=>picked.includes(item.id));
 const shown=selected.find(item=>item.id===active)||selected[0];
 const runs=state?.runs||[],pending=(id:string)=>runs.some(run=>run.platform===id&&working(run));
 const latest=(id:string)=>runs.find(run=>run.platform===id&&run.content_id&&run.status==='done');
 const publicationItems=selected.flatMap(item=>{const run=latest(item.id);return run?.content_id&&run.content_version?[{platform:item.id,content_id:run.content_id,content_version:run.content_version}]:[]});
 if(!flowId||!topicId)return <p className="cf-step-body">先在「IP 与选题」中确定主题。</p>;
 return <div className={'cf-matrix matrix-view-'+view+(editor?' cf-matrix-embedded':'')}>
  {error&&<p className="cf-error" role="alert">{error}<button onClick={()=>void perform(()=>read())}>重新读取</button></p>}
  {conflict&&<section className="matrix-master-conflict" role="alert"><strong>母版已在其他窗口更新，本机修改仍然保留。</strong><p>选择要继续使用的版本；另一份将保存在本机恢复记录中。</p><button onClick={()=>reconcile(false)}>采用服务器稿</button><button onClick={()=>reconcile(true)}>保留本机稿，继续编辑</button></section>}
  {!master||!changes?<p role="status">正在读取文稿…</p>:view==='master'&&!editor?<>
   <header className="matrix-document-header"><div><h2>{topicTitle}</h2><p>内容母版 · 各平台共用的文章底稿</p></div><div>
    {!!changes.body&&!writing&&<button disabled={busy} onClick={()=>setEditingMaster(!editingMaster)}>{editingMaster?'阅读文章':'编辑正文'}</button>}
    <button className="primary" disabled={busy||writing} onClick={writeMaster}><Sparkles size={15}/>{writing?'正在写作…':changes.body?'重新生成':'按选题生成文章'}</button>
   </div></header>
   {writing&&<p role="status" className="matrix-writing-status">{masterJob?.progress||'正在等待首段内容'}{masterJob?.stream_note?' · '+masterJob.stream_note:''}<button disabled={busy} onClick={()=>void perform(async()=>{await api('/jobs/'+masterJob!.id+'/cancel',{});await read()})}>停止生成</button></p>}
   {masterJob&&['failed','interrupted','cancelled'].includes(masterJob.status)&&<p className="cf-error" role="alert">{masterJob.error||labels[masterJob.status]}{masterJob.stream_text&&<button onClick={()=>{setChanges({...changes,body:masterJob.stream_text!});setEditingMaster(true)}}>继续编辑已输出内容</button>}</p>}
   <article className="matrix-master-paper" aria-label="母版正文" aria-busy={writing}>
    {writing?<Markdown text={masterJob?.stream_text||'正在根据选题组织文章…'} textOnly/>:editingMaster?<ArticleRichEditor value={changes.body} onChange={body=>setChanges({...changes,body})} onDropAsset={()=>{}} onDropFiles={()=>{}} fontSize="16" lineHeight="1.9" paragraphGap="16" accent="forest"/>:changes.body?<Markdown text={changes.body} textOnly/>:<div className="matrix-master-empty"><h3>从这个选题写出一篇完整文章</h3><p>点击右上角「按选题生成文章」，正文将在这里逐段显示。</p><button onClick={()=>setEditingMaster(true)}>直接撰写正文</button></div>}
   </article>
   <footer className="cf-matrix-actions"><span>{changes.body.length} 字 · {writing?'生成后自动保存':dirty?'有待保存修改':master.version?'已保存 v'+master.version:'尚未生成'}</span><button disabled={busy||writing||!dirty} onClick={()=>void perform(async()=>{await save()})}>保存修改</button><button className="primary" disabled={busy||writing||!changes.body.trim()} onClick={()=>void perform(async()=>{await save();navigate('platforms')})}>下一步，选择平台 <ArrowRight size={15}/></button></footer>
   {!!recovery.length&&<details className="matrix-master-recovery"><summary>本机保留的其他版本 · {recovery.length}</summary>{recovery.map((row,index)=><details key={index}><summary>保留正文 v{row.version}</summary><pre>{row.body}</pre></details>)}</details>}
  </>:view==='platforms'&&!editor?<>
   <header className="matrix-document-header"><div><h2>这篇内容准备发到哪里？</h2><p>选择图文平台，下一步将根据各平台的读者和表达方式分别创作。</p></div></header>
   <div className="cf-matrix-cards" aria-label="选择生成平台">{matrixChannels.map(item=><label key={item.id} data-picked={picked.includes(item.id)}><input type="checkbox" checked={picked.includes(item.id)} disabled={busy} onChange={e=>setChanges({...changes,platforms:e.target.checked?[...picked,item.id]:picked.filter(id=>id!==item.id)})}/><PlatformIcon platform={item.id} size={23}/><strong>{item.label}</strong><small>{item.description}</small><span className="matrix-platform-length">建议约 {item.words} 字</span></label>)}</div>
   <footer className="cf-matrix-actions"><span>已选择 {picked.length} 个平台</span><button className="primary" disabled={busy||!picked.length||!changes.body.trim()} onClick={()=>void perform(async()=>{await save();navigate('creation')})}>下一步，平台创作 <ArrowRight size={15}/></button></footer>
  </>:view==='publish'||view==='accounts'?<>
   <nav className="matrix-publish-tabs" aria-label="发布与账号"><button aria-pressed={view==='publish'} onClick={()=>navigate('publish')}>发布作品</button><button aria-pressed={view==='accounts'} onClick={()=>navigate('accounts')}>账号管理</button></nav>
   {view==='accounts'?<PublishAccounts embedded/>:<MatrixPublication flowId={flowId} items={publicationItems}/>}
  </>:<>
   {!editor&&<header className="matrix-document-header"><div><h2>平台文稿</h2><p>基于母版 v{master.version}，为 {selected.length} 个平台分别创作。文稿下方可单独发布。</p></div><button className="primary" disabled={busy||!selected.some(item=>!pending(item.id))} onClick={()=>generate(selected.filter(item=>!pending(item.id)).map(item=>item.id))}><Sparkles size={15}/>{publicationItems.length?'重新生成所选文稿':'生成所选平台文稿'}</button></header>}
   <MatrixImageBatch key={flowId+':'+topicId} flowId={flowId} topicId={topicId} targets={selected.flatMap(item=>{const run=latest(item.id);return run?.content_id?[{platform:item.id,label:item.label,content_id:run.content_id}]:[]})} disabled={busy}/>
   <nav className="cf-matrix-tabs" aria-label="平台文稿">{selected.map(item=>{const run=runs.find(run=>run.platform===item.id);return <button type="button" key={item.id} aria-pressed={shown?.id===item.id} onClick={()=>{setActive(item.id);if(editor&&item.id!==channel)editPlatform(item.id,master,latest(item.id))}}><PlatformIcon platform={item.id} size={17}/>{item.label}<small>{run?labels[run.status]: '待生成'}</small></button>})}</nav>
   {!selected.length&&<p>请先在「选择平台」中勾选要创作的平台。</p>}
   {!editor&&shown&&<section className="matrix-platform-document" aria-label={shown.label+'文稿'}>
    <header><h3>{shown.label}</h3><p>{shown.description}</p><button disabled={busy||pending(shown.id)} onClick={()=>generate([shown.id])}>{latest(shown.id)?'重新生成此平台':'生成此平台文稿'}</button></header>
    {failed[shown.id]&&<p role="alert" className="cf-error">{failed[shown.id]}</p>}
    {pending(shown.id)&&<p role="status">正在按{shown.label}的特点创作，完成后正文会显示在下方。</p>}
    {latest(shown.id)?.content?renderContent(latest(shown.id)!.content,()=>void read().catch(e=>setError(msg(e)))):<div className="matrix-platform-empty">点击「生成所选平台文稿」，完成后可直接阅读和编辑。</div>}
   </section>}
   {editor&&<div className="cf-inline-editor">{editor}</div>}
   {!editor&&<footer className="cf-matrix-actions"><button onClick={()=>navigate('platforms')}>调整平台选择</button><button disabled={busy} onClick={()=>void perform(read)}><RefreshCw size={14}/>刷新稿件</button><button className="primary" onClick={()=>navigate('publish')}>下一步，发布与账号 <ArrowRight size={15}/></button></footer>}
  </>}
 </div>;
}
