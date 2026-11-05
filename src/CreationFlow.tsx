import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,Plus} from 'lucide-react';
import {profileScope,profileChoiceKey,readProfileChoice,writeProfileChoice,resolveProfileId,latestProfileId,flowProfileInitial,profileUnavailable,unavailableProfileOption} from './profile-defaults';
import {api,getToken} from './api';
import FlowDeliverables from './FlowDeliverables';
import ContentMatrix,{type MatrixView} from './ContentMatrix';
import ArticleEditor from './ArticleEditor';
import './creation-flow.css';
import {creationChannels,matrixChannels,findBranchDraft,mergeFlowDrafts,FLOW_PREPARE_SAVE,type FlowPrepareSave} from './flow-navigation';

const tools=[['text','文案创作','text'],['image','图片创作','text_image'],['video','AI 视频','text_video'],['avatar/text','数字人视频','text_avatar'],['audio/tts','文本配音','tts'],['compose','素材成片','compose']] as const;
const channels=[...matrixChannels,...creationChannels.filter(c=>!matrixChannels.some(p=>p.id===String(c.id)))];
const flowFields=['brand_id','profile_id','content_id','visual_id','cover_id','video_id','audio_id','brief','last_draft','last_draft_tool','topic_id','stage','tool_path','platform','assembled','creation_channel'];
const flowSignature=(value:any)=>JSON.stringify(flowFields.map(key=>value?.[key]??''));
// Transfer the just-validated default flow to its canonical route once. Explicit
// revisits still read the server; neither local drafts nor old responses qualify.
let canonicalRestore:{owner:string;scope:string;session:string;value:any;expires:number}|undefined;

export default function CreationFlow({t,route='flow',embeddedRoute='',editor,bootstrap}:{t:any;route?:string;embeddedRoute?:string;editor?:ReactNode;bootstrap?:()=>Promise<any>}){
 const owner=t.state.user.id,params=new URLSearchParams(route.split('?')[1]||''),workId=params.get('work')||'';
 const storage='studio-flow:'+owner+(workId?':'+workId:'');
 const [flow,setFlow]=useState<any>(()=>{try{return JSON.parse(localStorage.getItem(storage)||'{}')}catch{return {}}});
 const flowRef=useRef(flow),version=useRef(0),dirty=useRef(false),queue=useRef(Promise.resolve()),savedSignature=useRef('');
 const revision=useRef(0),saving=useRef(0),launchLock=useRef(false),draftsRef=useRef<any[]>([]),draftsReady=useRef(false);
 const profiles=t.list?.('profile')||[],profileReady=t.state.complete!==false,profileKey=profileChoiceKey(profileScope(t.state),'flow:'+(workId||flow.id||'new'));
 const saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [works,setWorks]=useState<any[]>([]),[assets,setAssets]=useState<any[]>([]),[topics,setTopics]=useState<any[]>([]);
 const [drafts,setDrafts]=useState<any[]>([]);
 const [allProfileTopics,setAllProfileTopics]=useState(false);
 const [openLinkedContent,setOpenLinkedContent]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[dataLoaded,setDataLoaded]=useState(false),[topicsLoaded,setTopicsLoaded]=useState(false);
 useEffect(()=>{let live=true;const session=getToken(),readRevision=revision.current,transfer=canonicalRestore;canonicalRestore=undefined;
 const read=transfer&&transfer.owner===owner&&transfer.scope===profileScope(t.state)&&transfer.session===getToken()&&transfer.value.id===workId&&transfer.expires>Date.now()?Promise.resolve(transfer.value):workId?(bootstrap?bootstrap():api('/studio/flows/'+encodeURIComponent(workId)+'/bootstrap')).then(r=>r.flow):api('/studio/flow');
 void read.then(r=>{
  if(!live||session!==getToken())return;
  if(!workId&&r.id){canonicalRestore={owner,scope:profileScope(t.state),session:getToken(),value:r,expires:Date.now()+5000};params.set('work',r.id);location.hash='studio/flow?'+params.toString();return}
  // A route refresh may finish after an edit or save. It cannot rewind this
  // shell's current snapshot or the optimistic version used by its next write.
  if(loaded&&(readRevision!==revision.current||dirty.current||saving.current>0||(r.version||0)<version.current))return;
  const local=flowRef.current,restored=local.id===r.id&&local.version===r.version&&local.local_updated_at&&new Date(local.local_updated_at)>new Date(r.updated||0)?{...r,...local,id:r.id||local.id}:r;
  version.current=r.version||0;savedSignature.current=flowSignature(r);dirty.current=restored!==r;flowRef.current=restored;setFlow(restored);setLoaded(true);
  const runId=new URLSearchParams(embeddedRoute.split('?')[1]||'').get('run');
  void t.refreshItems?.([r.id,...flowFields.filter(key=>key.endsWith('_id')).map(key=>r[key]),...(/^[a-f0-9]{32,64}$/.test(runId||'')?[runId]:[])].filter(Boolean));
 }).catch((e:Error)=>{if(live)setError(e.message)});return()=>{live=false}},[workId,embeddedRoute]);
 // An explicit work ID is already enough to start owned supporting reads. Do
 // not serialize the asset shelf and topic list behind the flow restore trip.
 const relatedReady=!!workId||loaded;
 useEffect(()=>{if(!relatedReady)return;let live=true;const draftsAtRead=draftsRef.current;const reads=[
  api('/studio/flows').then(r=>{if(live)setWorks(r.items||[])}),
  api('/studio/assets').then(r=>{if(live)setAssets(r.items||[])}),
  api('/studio/topics').then(r=>{if(live){setTopics(r.items||[]);setTopicsLoaded(true)}}),
  ...(workId?[(bootstrap?bootstrap():api('/studio/flows/'+encodeURIComponent(workId)+'/bootstrap')).then(r=>{if(live){draftsRef.current=mergeFlowDrafts(r.items||[],draftsRef.current,draftsAtRead);draftsReady.current=true;setDrafts(draftsRef.current)}})]:[]),
 ];void Promise.allSettled(reads).then(results=>{if(!live)return;const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')setError('部分资料读取失败，请刷新后重试：'+String(failed.reason));setDataLoaded(true)});return()=>{live=false}},[workId,relatedReady,embeddedRoute]);
 useEffect(()=>{if(!loaded||!dirty.current)return;clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>{
  dirty.current=false;const snapshot=flowRef.current;
  queue.current=queue.current.catch(()=>{}).then(async()=>{saving.current++;revision.current++;try{const saved=await api('/studio/flow',{...snapshot,version:version.current});const explicit=readProfileChoice(profileKey);if(explicit!==undefined)writeProfileChoice(profileChoiceKey(profileScope(t.state),'flow:'+saved.id),explicit);version.current=saved.version;savedSignature.current=flowSignature(snapshot);if(flowRef.current.local_updated_at===snapshot.local_updated_at){flowRef.current={...flowRef.current,id:saved.id,version:saved.version,local_updated_at:saved.updated};localStorage.setItem(storage,JSON.stringify(flowRef.current));setFlow(flowRef.current)}setWorks(v=>[saved,...v.filter(x=>x.id!==saved.id)])}catch(e:any){dirty.current=true;setError('流程已暂存本机，服务端保存失败：'+e.message)}finally{saving.current--;revision.current++}});
 },650);return()=>clearTimeout(saveTimer.current)},[flow,loaded]);
 const change=(values:any)=>{if(Object.keys(values).every(key=>flowRef.current[key]===values[key]))return;revision.current++;dirty.current=true;const next={...flowRef.current,...values,local_updated_at:new Date().toISOString()};flowRef.current=next;setFlow(next);try{localStorage.setItem(storage,JSON.stringify(next))}catch{setError('本机保存失败，请检查存储空间')}};
 useEffect(()=>{if(!loaded||!profileReady)return;const existing=flowProfileInitial(flowRef.current,readProfileChoice(profileKey));const next=resolveProfileId(profiles,existing);if(next!==(flowRef.current.profile_id||''))change({profile_id:next})},[loaded,profileReady,profileKey,flow.profile_id,latestProfileId(profiles)]);
 const chooseProfile=(value:string)=>{try{writeProfileChoice(profileKey,value);change({profile_id:value})}catch{setError('身份选择暂存失败，请在离开前保存作品')}};
 const checkProfile=()=>{if(!profileReady)throw new Error('身份档案尚未加载，请稍候');if(profileUnavailable(profiles,flowRef.current.profile_id||''))throw new Error('原 IP 已删除或不可用，请重新选择')};
 const persistNow=async(values:any={})=>{
  clearTimeout(saveTimer.current);revision.current++;saving.current++;
  try{
   await queue.current;
   const before=flowRef.current,next={...before,...values},writeRevision=revision.current;
   if(next.id&&savedSignature.current===flowSignature(next)){dirty.current=false;return next}
   const saved=await api('/studio/flow',{...next,version:version.current});
   const explicit=readProfileChoice(profileKey);if(explicit!==undefined)writeProfileChoice(profileChoiceKey(profileScope(t.state),'flow:'+saved.id),explicit);
   const laterChanges=revision.current===writeRevision?{}:Object.fromEntries(flowFields.filter(k=>flowRef.current[k]!==before[k]).map(k=>[k,flowRef.current[k]]));
   version.current=saved.version;savedSignature.current=flowSignature(next);dirty.current=Object.keys(laterChanges).length>0;
   flowRef.current={...next,...laterChanges,id:saved.id,version:saved.version,local_updated_at:dirty.current?flowRef.current.local_updated_at:saved.updated};
   setFlow(flowRef.current);setWorks(v=>[saved,...v.filter(x=>x.id!==saved.id)]);
   try{localStorage.setItem(storage,JSON.stringify(flowRef.current))}catch{setError('本机保存失败，请检查存储空间')}
   return saved;
  }finally{saving.current--;revision.current++}
 };
 useEffect(()=>{const prepare=(event:Event)=>{const detail=(event as CustomEvent<FlowPrepareSave>).detail;if(!detail||detail.claimed||!loaded||detail.flowId!==flowRef.current.id)return;detail.claimed=true;detail.tasks.push(Promise.resolve().then(()=>persistNow()).then(()=>{}))};window.addEventListener(FLOW_PREPARE_SAVE,prepare);return()=>window.removeEventListener(FLOW_PREPARE_SAVE,prepare)},[loaded,workId]);
 const stage=editor?4:Math.max(1,Math.min(5,Number(params.get('step')??flow.stage??1)||1));
 const view:MatrixView=editor?'creation':params.get('view')==='accounts'?'accounts':stage===2?'master':stage===3?'platforms':stage===4?'creation':'publish';
 const channel=channels.find(c=>c.id===flow.creation_channel)||matrixChannels[1];
 const choice=tools.find(x=>x[0]===(flow.tool_path||'text'))||tools[0];
 const topic=topics.find(x=>x.id===flow.topic_id);
 const contents=(t.list?.('content')||[]).filter((x:any)=>!x.archived);
 const ownContents=contents.filter((x:any)=>x.flow_id===flow.id);
 const ownAssets=assets.filter(x=>x.flow_id===flow.id&&x.status==='ready'&&!x.archived&&!x.deleted);
 const selectedSource=ownContents.find((x:any)=>x.id===flow.content_id);
 const profileTopics=topics.filter(x=>flow.profile_id&&x.profile_id===flow.profile_id&&!x.archived&&(!x.platform||['wechat','公众号'].includes(x.platform))).sort((a,b)=>{const ai=Number(a.source_candidate_index),bi=Number(b.source_candidate_index);return (ai>0?ai:Number.MAX_SAFE_INTEGER)-(bi>0?bi:Number.MAX_SAFE_INTEGER)});
 const returnRoute=(id:string,step:number,master=false)=>'studio/flow?work='+encodeURIComponent(id)+'&step='+step+(master?'&view=master':'');
 const ensureTopic=async()=>{checkProfile();if(!topicsLoaded)throw new Error('选题数据尚未就绪，请刷新后重试');const current=topics.find(x=>x.id===flowRef.current.topic_id);if(current)return current.id;const brief=String(flowRef.current.brief||'').trim();if(!brief)throw new Error('请先写下主题或从选题库选择');const made=await api('/studio/topics',{title:brief.slice(0,200),angle:'从内容矩阵继续完善',source_ids:[],profile_id:flowRef.current.profile_id||'',origin:'内容矩阵',origin_ref:'flow:'+brief.slice(0,150),status:'selected'});setTopics(v=>[made,...v.filter(x=>x.id!==made.id)]);change({topic_id:made.id});return made.id};
 const nextTopic=async()=>{setBusy(true);setError('');try{const topicId=await ensureTopic();const saved=await persistNow({topic_id:topicId,stage:2});location.hash=returnRoute(saved.id,2,true)}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const launch=async(selected=choice,step=2,convertSpeech=false,channelId:string=channel.id,master?:{body:string;version:number})=>{if(launchLock.current)return;launchLock.current=true;setBusy(true);setError('');try{
  if(!loaded)throw new Error('正在恢复流程，请稍候');
  const topicId=await ensureTopic(),current=flowRef.current;
  const branch=channels.find(c=>c.id===channelId)||matrixChannels[1];
  const [path,,tool]=selected,brief=topics.find(x=>x.id===topicId)?.title||current.brief||'';
  const speech=current.id&&current.content_id&&(['text_avatar','tts'].includes(tool)||convertSpeech)?await api('/studio/flows/'+encodeURIComponent(current.id)+'/speech?content_id='+encodeURIComponent(current.content_id)):null;
  if(convertSpeech&&!speech?.conversion_input)throw new Error('请先选入要改写的文稿');
  const input=tool==='text'?(convertSpeech?speech.conversion_input:{brief:master?brief+'\n\n母版 v'+master.version+'，作为事实和观点的参考资料。按'+branch.label+'表达习惯重新写。\n'+master.body:brief,format:branch.format,target_words:branch.words}):['text_avatar','tts'].includes(tool)?{text:speech?speech.text:brief}:tool==='compose'?{scenes:(current.video_id||current.cover_id||current.visual_id)?[{asset_id:current.video_id||current.cover_id||current.visual_id,length:5,...(current.audio_id?{audio_id:current.audio_id}:{})}]:[]}:{prompt:brief};
  // An existing work already has a stable return address. Create the draft
  // first, then save the selected tool and draft ID together in one flow write.
  const workId=current.id||(await persistNow({topic_id:topicId,stage:step,tool_path:path})).id;
  const title=branch.label+' · '+String(brief).slice(0,55);
  // Wait for the initial authoritative list before deciding that a branch is absent.
  if(!draftsReady.current){const draftsAtRead=draftsRef.current;const r=await api('/studio/flows/'+encodeURIComponent(workId)+'/drafts');draftsRef.current=mergeFlowDrafts(r.items||[],draftsRef.current,draftsAtRead);draftsReady.current=true;setDrafts(draftsRef.current)}
  const existing=!convertSpeech&&!master?findBranchDraft(draftsRef.current,workId,topicId,branch.id,tool):null;
  const draft=existing||await api('/studio/flows/'+encodeURIComponent(workId)+'/drafts',{title,tool,input,...(!convertSpeech?{topic_id:topicId,creation_channel:branch.id}:{}),brand_id:current.brand_id||'',profile_id:current.profile_id||'',source_ids:current.content_id?[current.content_id]:[],...(tool==='text'?{}:{options:{}})});
  // Register synchronously before saving/navigating: a slow list must not erase
  // the new draft, and the next click must see it without waiting for React.
  draftsRef.current=mergeFlowDrafts([draft],draftsRef.current);setDrafts(draftsRef.current);
  await persistNow({topic_id:topicId,stage:step,tool_path:path,creation_channel:branch.id,last_draft:draft.id,last_draft_tool:path});
  location.hash='studio/'+path+'?draft='+encodeURIComponent(draft.id)+'&mode='+encodeURIComponent(tool)+'&return='+encodeURIComponent(returnRoute(workId,step));
 }catch(e:any){setError(e.message)}finally{launchLock.current=false;setBusy(false)}};
 const resumeDraft=async()=>{const path=flowRef.current.last_draft_tool,draftId=flowRef.current.last_draft,selected=tools.find(x=>x[0]===path);if(!draftId||!selected)return;setBusy(true);setError('');try{const saved=await persistNow({stage:2,tool_path:path});location.hash='studio/'+path+'?draft='+encodeURIComponent(draftId)+'&mode='+encodeURIComponent(selected[2])+'&return='+encodeURIComponent(returnRoute(saved.id,2))}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const showMatrixView=async(view:MatrixView)=>{
  setError('');
  try{
   if(!flowRef.current.id)return;
   if(dirty.current)await persistNow();
   const step={master:2,platforms:3,creation:4,publish:5,accounts:5}[view];
   location.hash=returnRoute(flowRef.current.id,step)+(view==='accounts'?'&view=accounts':'');
  }catch(e:any){setError(e.message)}
 };
 const openMatrixEditor=async(platform:string,master:{body:string;version:number},run?:{id:string;draft_id:string})=>{
  if(!run){void launch(tools[0],4,false,platform,master);return}
  if(launchLock.current)return;
  launchLock.current=true;setBusy(true);setError('');
  try{
   const saved=await persistNow({stage:2,tool_path:'text',creation_channel:platform,last_draft:run.draft_id,last_draft_tool:'text'});
   location.hash='studio/text?draft='+encodeURIComponent(run.draft_id)+'&run='+encodeURIComponent(run.id)+'&mode=text&return='+encodeURIComponent(returnRoute(saved.id,4));
  }catch(e:any){setError(e.message)}finally{launchLock.current=false;setBusy(false)}
 };
 const openTopics=async()=>{setBusy(true);setError('');try{const saved=await persistNow({stage:1});location.hash='studio/topics?return='+encodeURIComponent(returnRoute(saved.id,1))}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const switchWork=async(id:string)=>{if(id===flowRef.current.id)return;setBusy(true);setError('');try{if(dirty.current)await persistNow();location.hash='studio/flow?work='+encodeURIComponent(id)}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const newWork=async()=>{if(!profileReady){setError('身份档案尚未加载，请稍候');return}setBusy(true);setError('');try{if(dirty.current)await persistNow();const made=await api('/studio/flow',{new:true,version:0,brief:'',stage:0,profile_id:latestProfileId(profiles)});location.hash='studio/flow?work='+encodeURIComponent(made.id)}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 if(!loaded)return <div className="cf-page cf-restoring" aria-busy={!error}><header className="cf-head"><div className="cf-title"><h1>内容矩阵</h1></div><p className="cf-restore-status" role="status">{error?'作品读取失败':'正在恢复内容矩阵…'}</p></header>{error&&<p className="cf-error" role="alert">{error}<button type="button" onClick={()=>location.reload()}>重新读取</button></p>}</div>;
 return <div className={'cf-page cf-continuous cf-matrix-page'+(stage===1?' cf-setup-page':' cf-document-page')+(editor?' cf-with-editor':'')}><header className="cf-head"><div className="cf-title"><h1>内容矩阵</h1>{!dataLoaded&&<span className="cf-data-loading" role="status">正在读取作品…</span>}</div><div className="cf-work-controls"><label>当前作品<select aria-label="切换当前作品" value={flow.id||''} disabled={busy} onChange={e=>void switchWork(e.target.value)}>{flow.id&&!works.some(x=>x.id===flow.id)&&<option value={flow.id}>{flow.brief||'当前作品'}</option>}{!flow.id&&<option value="">尚未建立作品</option>}{works.map(x=><option key={x.id} value={x.id}>{x.brief||'未命名作品'}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>void newWork()}><Plus size={15}/>新建作品</button></div>
 <div className="cf-overview" aria-label="本次作品概览"><span>{topic?.title||flow.brief||'尚未确定主题'}</span><span>{profiles.find((p:any)=>p.id===flow.profile_id)?.title||'身份暂不指定'}</span><small>作品与草稿随账户保存</small></div></header>
 {flow.source_task_id&&<p className="cf-source-link">来自 AI 对话文稿 v{flow.source_version} · 这件作品独立保存 <a href={'#task/'+encodeURIComponent(flow.source_task_id)}>返回原对话 →</a></p>}
 <div className="cf-workspace"><section className={'cf-detail'+(!editor&&stage===1?' cf-topic-detail':'')} aria-label="当前步骤编辑" tabIndex={0}>
 <div className="cf-detail-top"><strong>{stage===1?'IP 与选题':view==='master'?'内容母版':view==='platforms'?'选择平台':view==='creation'?'平台创作':'发布与账号'}</strong></div>
 {error&&<p className="cf-error" role="alert">{error}</p>}
 {stage===1?(<div className="cf-step-body cf-topic-step"><div className="cf-topic-fields"><section className="matrix-setup-section"><h2 id="matrix-identity-heading">以谁的身份表达？</h2><label className="cf-identity-choice"><select aria-labelledby="matrix-identity-heading" value={flow.profile_id||''} disabled={!profileReady||busy} onChange={e=>chooseProfile(e.target.value)}><option value="">先不指定</option>{unavailableProfileOption(profiles,flow.profile_id||'',profileReady).map(p=><option key={p.value} value={p.value}>{p.label}</option>)}{profiles.map((p:any)=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label></section>{!!profileTopics.length&&<section className="cf-profile-topics matrix-setup-section" aria-label="当前IP推荐选题"><h2>30 天选题 · 公众号创作</h2><div>{profileTopics.slice(0,allProfileTopics?profileTopics.length:4).map((x:any,index:number)=><button key={x.id} aria-pressed={flow.topic_id===x.id} onClick={()=>change({topic_id:x.id,brief:x.title,assembled:'no'})}><strong><span className="cf-topic-number">{String(index+1).padStart(2,'0')}</span>{x.title}</strong>{x.angle&&<small>{x.angle}</small>}</button>)}</div>{profileTopics.length>4&&<button onClick={()=>setAllProfileTopics(!allProfileTopics)}>{allProfileTopics?'收起选题':'查看全部 '+profileTopics.length+' 个选题'}</button>}</section>}<section className="matrix-setup-section"><h2 id="matrix-topic-heading">今天想讲什么？</h2><label className="cf-topic-brief"><textarea aria-labelledby="matrix-topic-heading" rows={2} value={flow.brief||''} onChange={e=>change({brief:e.target.value,topic_id:'',assembled:'no'})} placeholder="例如：今天在世纪滨江小区做了电梯现场测量"/></label><label>从选题库选择<select value={flow.topic_id||''} onChange={e=>{const x=topics.find(v=>v.id===e.target.value);change({topic_id:e.target.value,assembled:'no',...(x?{brief:x.title}:{})})}}><option value="">{flow.brief?'使用刚才写下的想法':'请选择选题'}</option>{flow.profile_id&&<optgroup label="当前 IP 的选题">{topics.filter(x=>x.profile_id===flow.profile_id).map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</optgroup>}<optgroup label="其他选题">{topics.filter(x=>!flow.profile_id||x.profile_id!==flow.profile_id).map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</optgroup></select></label>{topic&&<p className="cf-selected">已选：{topic.title} · {topic.origin||'自己添加'}</p>}</section></div><div className="cf-actions cf-topic-actions"><button disabled={busy} onClick={()=>void openTopics()}>打开选题库 <ArrowRight size={15}/></button><button className="primary" disabled={busy||!topicsLoaded||(!flow.brief?.trim()&&!flow.topic_id)} onClick={()=>void nextTopic()}>{topicsLoaded?'确定主题，进入母版':'正在加载选题…'} <ArrowRight size={16}/></button></div></div>):(
 <ContentMatrix key={(flow.id||'')+':'+(flow.topic_id||'')} flowId={flow.id||''} topicId={flow.topic_id||''} topicTitle={topic?.title||flow.brief||''}
  view={view} editor={editor} channel={channel.id}
  editPlatform={(platform,master,run)=>void openMatrixEditor(platform,master,run)} navigate={view=>void showMatrixView(view)}
  renderContent={(content,refresh)=><ArticleEditor key={content.id} asset={content} t={t} matrixPublication onSaved={refresh}/>}
 />

 )}</section></div></div>;
}
