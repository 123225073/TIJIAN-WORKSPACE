import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Plus,Search,Table2, X} from 'lucide-react';
import {useProfileDefault,profileScope,profileUnavailable,unavailableProfileOption,flowProfileInitial,resolveProfileId,profileChoiceKey,readProfileChoice,writeProfileChoice} from './profile-defaults';
import {api} from './api';
import {JobFeedback,activeJob} from './OperationFeedback';
import {bundleOrder,bundleHidden} from './DeliveryBundle';
import PlatformPublishForm from './PlatformPublishForm';
import WechatArticleForm from './WechatArticleForm';
import WechatOptimizePage,{type OptimizeScope} from './WechatOptimizePage';
import WechatPublishPanel from './WechatPublishPanel';
import TopicAddDrawer from './TopicAddDrawer';
import TopicLibraryControls from './TopicLibraryControls';
import './topic-delivery.css';

const platforms=[['wechat','公众号'],['channels','视频号'],['douyin','抖音']] as const;
const fields:Record<string,[string,string][]>={
 wechat:[['title','文章标题'],['summary','摘要 / 分享说明'],['body','正文'],['cover_brief','封面图建议'],['keywords','关键词'],['publishing_notes','发布前核对']],
 channels:[['title','视频标题'],['caption','发布文案'],['script','口播脚本'],['shotlist','分镜脚本'],['cover_brief','封面建议'],['tags','话题标签']],
 douyin:[['title','视频标题'],['caption','发布文案'],['script','口播脚本'],['shotlist','分镜脚本'],['cover_brief','封面建议'],['tags','话题标签']],
};
const actions=[['create','待创作'],['rework','二次创作'],['hold','暂缓'],['done','已完成']] as const;
const name=(p:string)=>platforms.find(x=>x[0]===p)?.[1]||p;
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
type Topic={id:string;title:string;angle?:string;rationale?:string;audience?:string;source_ids:string[];profile_id?:string;origin?:string;next_action?:string;status?:string;delivery_count?:number;version:number;created?:string;updated:string;archived?:boolean};
type Delivery={id:string;topic_id:string;platform:string;version:number;updated:string;status:string;[key:string]:any};
type Asset={id:string;title:string;asset_type:string;status:string};
type SuggestedTopic={index:number;title:string;angle:string;rationale:string;audience:string;selected:boolean;discarded:boolean;confirmed:boolean};
type TopicReview={jobId:string;loaded:boolean;items:SuggestedTopic[];profile_choice?:{scope:string;value:string}};
const reviewStorage=(owner:string)=>'tijian-topic-review:'+owner;
const readReview=(owner:string):TopicReview|null=>{try{const value=JSON.parse(localStorage.getItem(reviewStorage(owner))||'null');return value?.jobId&&Array.isArray(value.items)?value:null}catch{return null}};

export default function TopicDelivery({t,page}:{t:any;page:string}){
 const params=new URLSearchParams(page.split('?')[1]||''),wanted=params.get('topic')||'',returnTo=params.get('return')||'',fromFlow=returnTo.startsWith('studio/flow');
 const flowParams=new URLSearchParams(returnTo.split('?')[1]||''),flowStep=Number(flowParams.get('step')||4),flowWork=flowParams.get('work')||'';
 const [topics,setTopics]=useState<Topic[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[assets,setAssets]=useState<Asset[]>([]),[flow,setFlow]=useState<any>({}),[loaded,setLoaded]=useState(false);
 const [selected,setSelected]=useState(wanted),[platform,setPlatform]=useState(params.get('platform')||'wechat'),[delivery,setDelivery]=useState<Delivery|null>(null);
 const [search,setSearch]=useState(''),[showArchived,setShowArchived]=useState(false),[showAdd,setShowAdd]=useState(false),[drawerMode,setDrawerMode]=useState<'ai'|'manual'>('ai'),[newTitle,setNewTitle]=useState(''),[newAngle,setNewAngle]=useState(''),[newRationale,setNewRationale]=useState('');
 const [brief,setBrief]=useState(''),[sourceIds,setSourceIds]=useState<string[]>(params.get('source')?[params.get('source')!]:[]),[topicCount,setTopicCount]=useState(5);
 const profiles=t.list?.('profile')||[],profileReady=t.state?.complete!==false&&(!fromFlow||flow.id===flowWork);
 const selectionScope=profileScope(t.state),selectionContext='topics:'+(fromFlow?'flow:'+flowWork:'standalone');
 const originProfile=fromFlow&&flow.id===flowWork?flowProfileInitial(flow,readProfileChoice(profileChoiceKey(selectionScope,'flow:'+flowWork))):undefined;
 const [profileId,chooseProfile]=useProfileDefault(profiles,selectionScope,selectionContext,originProfile,profileReady);
 const genericChosen=profileId===''&&(readProfileChoice(profileChoiceKey(selectionScope,selectionContext))===''||originProfile==='');
 const checkProfile=()=>{if(!profileReady){setError('身份档案尚未加载，请稍候');return false}if(profileUnavailable(profiles,profileId)){setError('原 IP 已删除或不可用，请重新选择');return false}return true};
 const owner=t.state?.user?.id||'guest',reviewOwner=owner+':'+(fromFlow?'flow:'+flowWork:'standalone');
 const inDeliveryScope=(x:Delivery)=>fromFlow?!!flowWork&&x.flow_id===flowWork:!x.flow_id&&!x.task_id;
 const deliveryJobKey=(id:string)=>'tijian-delivery-job:'+owner+':'+id;
 const optimizationJobKey=(id:string)=>'tijian-optimization-job:'+owner+':'+id;
 const optimizationRequestKey=(id:string)=>'tijian-optimization-request:'+owner+':'+id;
 const coverApplied=useRef(false),editRevision=useRef(0),latestDraft=useRef<Delivery|null>(null),refreshedJobs=useRef(new Set<string>()),openedOptimizationJobs=useRef(new Set<string>());
 const key=(id:string)=>'tijian-delivery-draft:'+owner+':'+id;
 const [review,setReview]=useState<TopicReview|null>(()=>readReview(reviewOwner));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[syncingGenerated,setSyncingGenerated]=useState(false),[job,setJob]=useState<any>(()=>(t.list?.('job')||[]).find((j:any)=>j.id===readReview(reviewOwner)?.jobId)||null);
 const [optimizationJob,setOptimizationJob]=useState<any>(null),[optimizeScope,setOptimizeScope]=useState<OptimizeScope>('all'),[showOptimize,setShowOptimize]=useState(false),[optimizationError,setOptimizationError]=useState('');
 const topicJob=job?.input?.action==='studio_topics',topicRunning=activeJob(job)&&topicJob;
 const reviewItems=review?.items.filter(x=>!x.discarded&&!x.confirmed)||[],selectedCount=reviewItems.filter(x=>x.selected).length,removedCount=review?.items.filter(x=>x.discarded&&!x.confirmed).length||0;
 const updateReview=(next:TopicReview)=>{setReview(next);try{localStorage.setItem(reviewStorage(reviewOwner),JSON.stringify(next))}catch{setError('候选选题暂存失败，请在离开前确认需要入库的选题')}};
 const editSuggestion=(index:number,changes:Partial<SuggestedTopic>)=>{if(review)updateReview({...review,items:review.items.map(x=>x.index===index?{...x,...changes}:x)})};
 const selectAllSuggestions=()=>{if(review)updateReview({...review,items:review.items.map(x=>!x.discarded&&!x.confirmed?{...x,selected:true}:x)})};
 const sources=(t.list?.('source')||[]).filter((x:any)=>!x.archived),active=topics.find(x=>x.id===selected&&!x.archived);
 const related=deliveries.filter(x=>x.topic_id===selected&&inDeliveryScope(x)),sourceName=(x:Topic)=>x.origin||'自己添加';
 const newKey='new:'+selected+':'+platform+':'+(flowWork||'standalone');
 const source=fromFlow&&flow.id===flowWork&&flow.topic_id===selected&&flow.content_id?t.get?.(flow.content_id):null;
 const sourceBody=String(source?.body||''),sourceExcerpt=sourceBody.replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/[#*`>]/g,'').replace(/\s+/g,' ').trim().slice(0,105);
 const visual=String(flow.topic_id===selected?flow.visual_id||'':''),imageTag=visual?`![文章配图](/api/studio/assets/${visual}/file)`:'';
 const wechatBody=sourceBody&&visual&&!sourceBody.includes(visual)?(/\n\s*\n/.test(sourceBody)?sourceBody.replace(/\n\s*\n/,'\n\n'+imageTag+'\n\n'):sourceBody+'\n\n'+imageTag):sourceBody;
 const starter:Delivery={id:'',topic_id:selected,platform,version:0,updated:'',status:'draft',title:platform==='wechat'?(source?.title||active?.title||'').slice(0,32):active?.title||'',summary:platform==='wechat'?String(source?.summary||sourceExcerpt).slice(0,120):'',body:platform==='wechat'?wechatBody:'',caption:platform==='wechat'?'':source?.title||'',script:platform==='wechat'?'':source?.body||'',shotlist:'',cover_brief:platform==='wechat'&&sourceExcerpt?`围绕“${source?.title||active?.title||'文章主题'}”制作封面，画面呼应正文内容：${sourceExcerpt}`:'',keywords:'',tags:'',publishing_notes:'',cover_asset_id:params.get('cover_asset')||(flow.topic_id===selected?flow.cover_id:'')||'',video_asset_id:platform==='wechat'?'':(flow.topic_id===selected?flow.video_id:'')||'',wechat_style:{font_size:'16',line_height:'1.8',paragraph_gap:'12',accent:'forest'},bundle_order:['title','copy','cover','video'],bundle_hidden:[]};
 try{const cached=JSON.parse(localStorage.getItem(key(newKey))||'null');if(cached?.values)Object.assign(starter,cached.values)}catch{/* Keep the original, editable template. */}
 const currentDelivery=delivery||starter;
 const currentDeliveryJob=job?.input?.action==='studio_delivery'&&job.input.delivery_id===currentDelivery.id?job:null;
 const currentOptimizationJob=optimizationJob?.input?.delivery_id===currentDelivery.id?optimizationJob:null;
 const deliveryRunning=activeJob(currentDeliveryJob);
 const generationLocked=deliveryRunning||syncingGenerated||activeJob(currentOptimizationJob);
 const visible=useMemo(()=>topics.filter(x=>!!x.archived===showArchived&&(!search||[x.title,x.angle,x.rationale,x.origin].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())))),[topics,showArchived,search]);
 const ready=(purpose:string)=>!!t.state?.models?.some((m:any)=>m.id===(t.state?.bindings?.[purpose]||t.state?.bindings?.writing)&&m.capability==='text'&&m.published);
 const load=async()=>{const [a,b,c]=await Promise.all([api('/studio/topics?include_archived=true'),api('/studio/deliveries'+(fromFlow?'?flow_id='+encodeURIComponent(flowWork):'')),api('/studio/assets')]);setTopics(a.items||[]);setDeliveries(b.items||[]);setAssets(c.items||[]);setLoaded(true);return b.items||[]};
 useEffect(()=>{void load().catch(e=>setError(msg(e)))},[]);
 useEffect(()=>{const jobId=review?.jobId;if(!jobId||job?.id===jobId||activeJob(job))return;void api('/jobs/'+jobId).then(setJob).catch(e=>setError(msg(e)))},[review?.jobId]);
 useEffect(()=>{if(!topicJob||job.status!=='done'||!Array.isArray(job.result?.suggestions)||review?.jobId!==job.id||review?.loaded)return;updateReview({jobId:job.id,loaded:true,...(review?.profile_choice?{profile_choice:review.profile_choice}:{}),items:job.result.suggestions.map((x:any,index:number)=>({index,title:x.title||'',angle:x.angle||'',rationale:x.rationale||'',audience:x.audience||'',selected:false,discarded:false,confirmed:false}))})},[job?.id,job?.status,review?.jobId,review?.loaded]);
 useEffect(()=>{if(!fromFlow)return;if(!flowWork){setError('缺少流程编号，请从一站式创作重新打开');return}let live=true;void api('/studio/flow?work_id='+encodeURIComponent(flowWork)).then(r=>{if(live)setFlow(r)}).catch(e=>{if(live)setError(msg(e))});return()=>{live=false}},[flowWork,fromFlow]);
 useEffect(()=>{const found=deliveries.find(x=>x.topic_id===selected&&x.platform===platform&&inDeliveryScope(x));setDelivery(found?restore(found):null)},[selected,platform,deliveries,fromFlow,flowWork]);
 useEffect(()=>{if(!currentDelivery.id||currentDeliveryJob)return;const jobId=localStorage.getItem(deliveryJobKey(currentDelivery.id));if(jobId)void api('/jobs/'+jobId).then(setJob).catch(()=>localStorage.removeItem(deliveryJobKey(currentDelivery.id)))},[currentDelivery.id,currentDeliveryJob?.id]);
 useEffect(()=>{
  if(!currentDelivery.id||busy)return;
  const id=currentDelivery.id,jobId=localStorage.getItem(optimizationJobKey(id));
  if(jobId){
   void api('/jobs/'+jobId).then((found:any)=>{
    if(found?.input?.delivery_id!==id)return;
    setOptimizationJob(found);setOptimizationError('');setOptimizeScope(found.input.scope||'all');
    if(!openedOptimizationJobs.current.has(found.id)){openedOptimizationJobs.current.add(found.id);setShowOptimize(true)}
   }).catch(()=>localStorage.removeItem(optimizationJobKey(id)));
   return;
  }
  const raw=localStorage.getItem(optimizationRequestKey(id));if(!raw)return;
  try{
   const pending=JSON.parse(raw);if(!pending.request_id)return;
   void api('/studio/deliveries/'+id+'/optimizations/by-request/'+encodeURIComponent(pending.request_id)).then((found:any)=>{
    if(localStorage.getItem(optimizationRequestKey(id))!==raw)return;
    setOptimizationJob(found);setOptimizationError('');setOptimizeScope(found.input?.scope||'all');
    localStorage.setItem(optimizationJobKey(id),found.id);localStorage.removeItem(optimizationRequestKey(id));
    if(!openedOptimizationJobs.current.has(found.id)){openedOptimizationJobs.current.add(found.id);setShowOptimize(true)}
   }).catch(()=>{
    if(localStorage.getItem(optimizationRequestKey(id))!==raw)return;
    setOptimizationError('上次优化任务尚未查到。可再次点击开始优化；相同要求会沿用任务编号，避免重复提交。');setOptimizeScope(pending.scope||'all');
    const pendingKey='pending:'+pending.request_id;
    if(!openedOptimizationJobs.current.has(pendingKey)){openedOptimizationJobs.current.add(pendingKey);setShowOptimize(true)}
   });
  }catch{localStorage.removeItem(optimizationRequestKey(id))}
 },[currentDelivery.id,busy]);
 useEffect(()=>{if(!currentOptimizationJob||!activeJob(currentOptimizationJob))return;let live=true,inFlight=false;const tick=async()=>{if(inFlight)return;inFlight=true;try{const next=await api('/jobs/'+currentOptimizationJob.id);if(live)setOptimizationJob(next)}catch(e){if(live)setOptimizationError(msg(e))}finally{inFlight=false}};const timer=setInterval(()=>void tick(),700);return()=>{live=false;clearInterval(timer)}},[currentOptimizationJob?.id,currentOptimizationJob?.status]);
 useEffect(()=>{const cover=params.get('cover_asset');if(!cover||coverApplied.current||!loaded||!topics.length||selected!==wanted)return;const found=deliveries.find(x=>x.topic_id===selected&&x.platform===platform&&inDeliveryScope(x));const next={...(found?restore(found):starter),cover_asset_id:cover};coverApplied.current=true;setDelivery(next);try{localStorage.setItem(key(next.id||newKey),JSON.stringify({version:next.version,values:{...Object.fromEntries([...fields[platform].map(([k])=>k),'cover_asset_id','video_asset_id'].map(k=>[k,next[k]||''])),...(platform==='wechat'?{wechat_style:next.wechat_style}:{}),bundle_order:bundleOrder(next),bundle_hidden:bundleHidden(next)}}))}catch{setError('新封面已选中，但本机暂存失败，请立即保存发布稿')}const clean=new URLSearchParams(page.split('?')[1]||'');clean.delete('cover_asset');history.replaceState(null,'','#studio/topics?'+clean.toString())},[loaded,topics.length,deliveries,selected,platform]);
 useEffect(()=>{if(!job||(!activeJob(job)&&!(job.status==='done'&&job.result?.delivery_id&&!refreshedJobs.current.has(job.id))))return;let live=true,inFlight=false;const tick=async()=>{if(inFlight)return;inFlight=true;try{const next=activeJob(job)?await api('/jobs/'+job.id):job;if(!live)return;if(next.status==='done'&&next.result?.delivery_id&&!refreshedJobs.current.has(next.id)){setSyncingGenerated(true);const all=await load();if(!live)return;const item=all.find((x:Delivery)=>x.id===next.result.delivery_id);if(!item||item.version<next.result.version)throw new Error('生成已完成，但新版草稿尚未载入，请刷新页面');const hasLocalChanges=!!localStorage.getItem(key(item.id));refreshedJobs.current.add(next.id);setDelivery(current=>current?.id===item.id?restore(item):current);setNotice(hasLocalChanges?'AI 已保存新版草稿；本机未保存的修改仍在编辑区，请核对后保存。':'AI 已写入新的可编辑草稿版本，请核对正文；尚未发布。')}else if(next.status==='done'&&next.result?.suggestions)setNotice('候选选题已生成，请筛选并确认入库。');else if(next.status==='failed'||next.status==='cancelled')setError(next.error||'任务未完成，原稿已保留');if(activeJob(job))setJob(next)}catch(e){if(live)setError(msg(e))}finally{if(live)setSyncingGenerated(false);inFlight=false}};void tick();if(!activeJob(job))return()=>{live=false};const timer=setInterval(()=>void tick(),700);return()=>{live=false;clearInterval(timer)}},[job?.id,job?.status,job?.result?.delivery_id]);
 const restore=(item:Delivery)=>{try{const cached=JSON.parse(localStorage.getItem(key(item.id))||'null');if(!cached?.values||!Number.isInteger(cached.version)||cached.version>item.version)return item;if(cached.version===item.version)return {...item,...cached.values};const dirtyFields:Array<string>=Array.isArray(cached.dirty_fields)?cached.dirty_fields:Object.keys(cached.values);const values=Object.fromEntries(dirtyFields.filter(field=>Object.prototype.hasOwnProperty.call(cached.values,field)).map(field=>[field,cached.values[field]]));const merged={...item,...values};try{localStorage.setItem(key(item.id),JSON.stringify({version:item.version,values:Object.fromEntries(Object.keys(cached.values).map(field=>[field,merged[field]])),dirty_fields:dirtyFields}))}catch{setError('本机暂存失败，请及时保存')}return merged}catch{return item}};
 const act=async(fn:()=>Promise<any>,success:string)=>{setBusy(true);setError('');setNotice('');try{const value=await fn();setNotice(success);return value}catch(e){setError(msg(e));return null}finally{setBusy(false)}};
 const open=(x:Topic)=>{setSelected(x.id);setPlatform('wechat');location.hash='studio/topics?topic='+encodeURIComponent(x.id)+(fromFlow?'&return='+encodeURIComponent(returnTo):'')};
 const back=()=>{setSelected('');setDelivery(null);location.hash='studio/topics'+(fromFlow?'?return='+encodeURIComponent(returnTo):'')};
 const useInFlow=async()=>{if(!active||!fromFlow)return;await act(async()=>{const current=await api('/studio/flow'+(flowWork?'?work_id='+encodeURIComponent(flowWork):''));if(flowWork&&current.id!==flowWork)throw new Error('当前作品已切换，请重新选择');await api('/studio/flow',{...current,brief:active.title,topic_id:active.id,assembled:'no',stage:flowStep,version:current.version});location.hash=returnTo},'已选入当前作品')};
 const add=async()=>{if(!checkProfile())return;const item=await act(()=>api('/studio/topics',{title:newTitle,angle:newAngle,rationale:newRationale,source_ids:sourceIds,profile_id:profileId,origin:sourceIds.length?'用户从已保存资料提取':'用户手动添加',next_action:'create',status:'idea'}),'选题已保存');if(item){if(genericChosen)writeProfileChoice(profileChoiceKey(selectionScope,'topic:'+item.id),'');setShowAdd(false);setNewTitle('');setNewAngle('');setNewRationale('');await load();open(item)}};
 const generateTopics=async()=>{if(busy||activeJob(job)||!checkProfile())return;if(reviewItems.length&&!confirm('还有未确认的候选选题。重新生成后会替换当前候选，继续吗？'))return;const result=await act(()=>api('/studio/topics/generate',{brief,source_ids:sourceIds,profile_id:profileId,count:topicCount,request_id:crypto.randomUUID()}),'找题任务已提交，正在生成候选');if(result){updateReview({jobId:result.id,loaded:false,items:[],...(genericChosen?{profile_choice:{scope:selectionScope,value:''}}:{})});setJob(result)}};
 const confirmSuggestions=async()=>{if(!review||!selectedCount)return;const chosen=reviewItems.filter(x=>x.selected);const result=await act(()=>api('/studio/topics/generate/'+review.jobId+'/confirm',{items:chosen.map(({index,title,angle,rationale,audience})=>({index,title,angle,rationale,audience}))}),'已将 '+chosen.length+' 条选题加入选题库');if(result){if(review.profile_choice?.scope===selectionScope&&review.profile_choice.value==='')for(const item of result.items||[])writeProfileChoice(profileChoiceKey(selectionScope,'topic:'+item.id),'');updateReview({...review,items:review.items.map(x=>chosen.some(y=>y.index===x.index)?{...x,selected:false,confirmed:true}:x)});await load()}};
 const restoreTopic=async(x:Topic)=>{const result=await act(()=>api('/studio/topics/'+x.id+'/restore',{}),'选题已恢复');if(result){await load();setShowArchived(false);open(result)}};
 const cacheDelivery=(next:Delivery,changedField?:string)=>{try{const storageKey=key(next.id||newKey),previous=JSON.parse(localStorage.getItem(storageKey)||'null');const dirtyFields=previous?.version===next.version?(Array.isArray(previous.dirty_fields)?previous.dirty_fields:Object.keys(previous.values||{})):[];if(changedField&&!dirtyFields.includes(changedField))dirtyFields.push(changedField);localStorage.setItem(storageKey,JSON.stringify({version:next.version,values:{...Object.fromEntries([...fields[next.platform].map(([k])=>k),'cover_asset_id','video_asset_id'].map(k=>[k,next[k]||''])),...(next.platform==='wechat'?{wechat_style:next.wechat_style}:{}),bundle_order:bundleOrder(next),bundle_hidden:bundleHidden(next)},dirty_fields:dirtyFields}))}catch{setError('本机暂存失败，请及时保存')}};
 const updateDelivery=(field:string,value:any)=>{const next={...currentDelivery,[field]:value};editRevision.current+=1;latestDraft.current=next;setDelivery(next);cacheDelivery(next,field)};
 const deliveryBody=(item:Delivery)=>({...Object.fromEntries(fields[item.platform].map(([k])=>[k,item[k]||''])),cover_asset_id:item.cover_asset_id||'',...(item.platform==='wechat'?{wechat_style:item.wechat_style||{font_size:'16',line_height:'1.8',paragraph_gap:'12',accent:'forest'}}:{video_asset_id:item.video_asset_id||''}),bundle_order:bundleOrder(item),bundle_hidden:bundleHidden(item)});
 const persistDelivery=async(item:Delivery,force=false):Promise<Delivery>=>{if(item.id){if(!inDeliveryScope(item))throw new Error('平台稿不属于当前创作范围，请重新打开');if(!force&&!localStorage.getItem(key(item.id)))return item;return api('/studio/deliveries/'+item.id,{version:item.version,...deliveryBody(item)},'PATCH')}if(!active)throw new Error('选题尚未加载');if(fromFlow&&(!flowWork||flow.id!==flowWork))throw new Error('当前作品尚未读取完成，请稍候');if(fromFlow&&flow.topic_id!==active.id)throw new Error('请先将此选题选入当前作品，再准备平台稿');return api('/studio/deliveries',{topic_id:active.id,platform,...(fromFlow?{flow_id:flowWork}:{}),...deliveryBody(item)})};
 const clearDraft=(item:Delivery)=>{localStorage.removeItem(key(item.id||newKey));localStorage.removeItem(key(newKey))};
 const createCover=()=>{const inherited=fromFlow?originProfile:flowProfileInitial(active||{},readProfileChoice(profileChoiceKey(selectionScope,'topic:'+selected))),coverProfile=resolveProfileId(profiles,inherited,profileReady);const target=new URLSearchParams({topic:selected,platform});if(fromFlow)target.set('return',returnTo);const article=String(currentDelivery.body||'').replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/[#*`>]/g,'').replace(/\s+/g,' ').trim().slice(0,420);const prompt=platform==='wechat'?`制作公众号文章封面。标题：${currentDelivery.title||active?.title||''}。文章内容：${article||'正文待补充'}。画面建议：${currentDelivery.cover_brief||'根据文章核心问题选择贴切场景；保留清晰的标题留白，不添加未经证实的品牌或数据。'}`:currentDelivery.cover_brief?.trim()||currentDelivery.title||active?.title||'';const route=new URLSearchParams({mode:'text_image',cover:'1',cover_session:crypto.randomUUID(),cover_prompt:prompt,...(coverProfile||inherited===''?{profile_id:coverProfile}:{}),return:'studio/topics?'+target.toString()});location.hash='studio/image?'+route.toString()};
 const applySaved=(item:Delivery,result:Delivery,revision:number)=>{if(editRevision.current===revision){clearDraft(item);latestDraft.current=null;setDelivery(result);return true}const latest=latestDraft.current;if(latest){const merged=item.id?restore(result):{...result,...deliveryBody(latest)};if(!item.id){const values=deliveryBody(merged);localStorage.removeItem(key(newKey));try{localStorage.setItem(key(result.id),JSON.stringify({version:result.version,values,dirty_fields:Object.keys(values)}))}catch{setError('本机暂存失败，请及时保存')}}latestDraft.current=merged;setDelivery(merged)}setNotice('保存期间有新的修改，已在本机保留；请再次保存。');return false};
 const openOptimize=(scope:OptimizeScope)=>{setOptimizeScope(scope);setOptimizationError('');setShowOptimize(true)};
 const startOptimize=async(scope:OptimizeScope,instruction:string)=>{
  if(busy||generationLocked)return;
  setOptimizationError('');setBusy(true);
  const item=currentDelivery,revision=editRevision.current;
  try{
   const saved=await persistDelivery(item);if(!applySaved(item,saved,revision))return;
   const storageKey=optimizationRequestKey(saved.id);
   let pending:any;try{pending=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{pending=null}
   if(!pending||pending.version!==saved.version||pending.scope!==scope||pending.instruction!==instruction)
    pending={request_id:crypto.randomUUID(),version:saved.version,scope,instruction};
   localStorage.setItem(storageKey,JSON.stringify(pending));
   let task:any;
   try{task=await api('/studio/deliveries/'+saved.id+'/optimize',{version:saved.version,scope,instruction,request_id:pending.request_id})}
   catch(e){
    const status=(e as Error&{status?:number}).status;
    if(status&&status>=400&&status<500){localStorage.removeItem(storageKey);throw e}
    try{task=await api('/studio/deliveries/'+saved.id+'/optimizations/by-request/'+encodeURIComponent(pending.request_id))}
    catch{throw new Error('提交状态尚未确认。请再次点击开始优化；相同要求会沿用任务编号，避免重复扣费。')}
   }
   setOptimizationJob(task);setOptimizationError('');setOptimizeScope(scope);
   openedOptimizationJobs.current.add(task.id);
   localStorage.setItem(optimizationJobKey(saved.id),task.id);localStorage.removeItem(storageKey);
  }catch(e){setOptimizationError(msg(e))}finally{setBusy(false)}
 };
 const applyOptimization=async()=>{if(!currentOptimizationJob||currentOptimizationJob.status!=='done'||busy)return;if(localStorage.getItem(key(currentDelivery.id))){setOptimizationError('发布稿有尚未保存的修改。请先保留或保存这些修改，再重新发起 AI 优化。');return}setBusy(true);setOptimizationError('');try{const result=await api('/studio/deliveries/'+currentDelivery.id+'/optimizations/'+currentOptimizationJob.id+'/apply',{version:currentDelivery.version});clearDraft(currentDelivery);localStorage.removeItem(optimizationJobKey(currentDelivery.id));setDelivery(result);setOptimizationJob(null);setShowOptimize(false);setNotice('AI 优化结果已应用到发布稿，请核对后同步公众号。');await load()}catch(e){setOptimizationError(msg(e))}finally{setBusy(false)}};
 const save=async()=>{const item=currentDelivery,revision=editRevision.current;const result=await act(()=>persistDelivery(item,true),'发布稿已保存；尚未发布');if(result){applySaved(item,result,revision);await load()}};
 const saveAndReturn=async()=>{if(!fromFlow)return;const item=currentDelivery,revision=editRevision.current;if(localStorage.getItem(key(item.id||newKey))){const result=await act(()=>persistDelivery(item),'发布稿已保存；尚未发布');if(!result||!applySaved(item,result,revision))return}location.hash=returnTo};
 const download=()=>{const item=currentDelivery;const visible=bundleOrder(item).filter(k=>!bundleHidden(item).includes(k)&&!(item.platform==='wechat'&&k==='video'));const asset=(id:string)=>assets.find(x=>x.id===id)?.title||'待选择';const section:Record<string,string>={title:`## 标题\n${item.title||'待补充'}`,copy:`## ${item.platform==='wechat'?'正文':'口播脚本'}\n${item[item.platform==='wechat'?'body':'script']||'待补充'}`,cover:`## 封面图片\n${asset(item.cover_asset_id)}`,video:`## 成片视频\n${asset(item.video_asset_id)}`};const extra=fields[item.platform].filter(([k])=>!['title','body','script'].includes(k));const lines=[`# ${item.title||active?.title||'平台发布稿'}`,`平台：${name(item.platform)}`,'状态：可编辑草稿，尚未发布','素材文件需单独导出。','',...visible.map(k=>section[k]),...extra.map(([k,label])=>`## ${label}\n${item[k]||'待补充'}`)];const url=URL.createObjectURL(new Blob([lines.join('\n\n')],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(item.title||'平台发布稿').replace(/[\\/:*?"<>|]/g,'_').slice(0,80)+'.md';a.click();setNotice('文稿已开始下载；素材文件需单独导出。');setTimeout(()=>URL.revokeObjectURL(url),1000)};
 return <main className="td-page"><header className="td-head"><div><small>{fromFlow?'一站式创作 / 第 '+(flowStep+1)+' 步 / 选题与交付':'选题库 / CONTENT PLAN'}</small><h1>{active?fromFlow&&flowStep===1?'选择本次作品的主题':'从选题到平台交付':'所有选题，一张表管理'}</h1><p>{active?'按平台准备完整可编辑的发布内容。':'行业线索、对标样本、AI 建议和自己的想法都留在这里，方便复用与二次创作。'}</p></div>{fromFlow&&<button className="td-flow-return" disabled={busy} onClick={()=>void saveAndReturn()}>{delivery||localStorage.getItem(key(newKey))?'保存并返回':'返回'}第 {flowStep+1} 步 · {flowStep===1?'选好主题':'平台交付'} <ArrowRight size={15}/></button>}</header>{error&&<p className="td-error" role="alert">{error}</p>}{notice&&<p className="td-notice" role="status">{notice}</p>}{activeJob(job)&&(!currentDeliveryJob||platform!=='wechat')&&<section className="td-job-status" aria-label="AI 任务进度"><strong>{topicRunning?'正在生成选题建议':deliveryRunning?'正在生成平台交付稿':'AI 任务正在处理'}</strong><JobFeedback job={job}/></section>}
 {active?<><button className="td-back" onClick={back}><ArrowLeft size={16}/>返回选题列表</button><div className="td-topic-heading"><div><small>选题 · v{active.version} · {sourceName(active)}</small><h2>{active.title}</h2><p>{active.angle||'尚未填写切入角度'}</p></div>{fromFlow?<button className="td-primary" disabled={busy} onClick={()=>void useInFlow()}>用于当前作品，返回第 {flowStep+1} 步 <ArrowRight size={15}/></button>:<span>{related.length} 份交付稿</span>}</div><p className="td-topic-edit-hint">选题内容请返回选题库列表修改，这里只处理平台发布稿。</p>
  {(!fromFlow||flowStep===4)&&<section className="td-publish"><div className="td-publish-head"><div><small>平台发布准备</small><h2>{name(platform)}发布稿</h2><p>按发布时填写的内容排列，所有字段都能修改。</p></div><div className="td-platforms">{platforms.map(([key,label])=><button key={key} disabled={generationLocked} className={platform===key?'active':''} onClick={()=>setPlatform(key)}>{label}</button>)}</div>{related.filter(x=>x.platform===platform).length>1&&<label className="td-version-picker">历史版本 <select aria-label="选择发布稿版本" disabled={generationLocked} value={delivery?.id||related.find(x=>x.platform===platform)?.id||""} onChange={e=>{const chosen=related.find(x=>x.id===e.target.value);if(chosen)setDelivery(restore(chosen))}}>{related.filter(x=>x.platform===platform).map((item,index)=><option key={item.id} value={item.id}>版本 {item.version} · {new Date(item.updated).toLocaleString("zh-CN")}{index===0?"（最新）":""}</option>)}</select></label>}</div>{generationLocked&&<p className="td-notice" role="status">AI 优化正在后台处理这份稿件；完成后可在独立页面审核。</p>}{currentOptimizationJob&&<button type="button" className="td-optimize-resume" onClick={()=>{setOptimizeScope(currentOptimizationJob.input?.scope||'all');setShowOptimize(true)}}>{activeJob(currentOptimizationJob)?'查看 AI 优化进度':'查看 AI 优化结果'}</button>}<div inert={generationLocked}>{platform==='wechat'?<WechatArticleForm draft={currentDelivery} assets={assets} busy={busy} generating={generationLocked} onChange={updateDelivery} onSave={()=>void save()} onDownload={download} onOptimize={openOptimize} onCreateCover={createCover} onAssetsChanged={async()=>{const value=await api('/studio/assets');setAssets(value.items||[])}} worksHref={'studio/works?return='+encodeURIComponent('studio/'+page)}/>:<PlatformPublishForm draft={currentDelivery} assets={assets} busy={busy} onChange={updateDelivery} onSave={()=>void save()} onDownload={download} onCreateCover={createCover} worksHref={'studio/works?return='+encodeURIComponent('studio/'+page)}/>}</div>{platform==='wechat'&&<WechatPublishPanel delivery={currentDelivery} dirty={!!localStorage.getItem(key(currentDelivery.id||newKey))}/>}</section>}</>:<><TopicLibraryControls topics={topics} deliveries={deliveries} onRefresh={load} onOpenTopic={open} onAddTopic={()=>{setDrawerMode('ai');setShowAdd(true)}}/></>}
 {showAdd&&<TopicAddDrawer profileId={profileId} profiles={[...unavailableProfileOption(profiles,profileId,profileReady).map(p=>({id:p.value,title:p.label})),...profiles]} onProfileChange={chooseProfile} profileReady={profileReady} mode={drawerMode} setMode={setDrawerMode} close={()=>setShowAdd(false)} brief={brief} setBrief={setBrief} count={topicCount} setCount={setTopicCount} sources={sources} sourceIds={sourceIds} setSourceIds={setSourceIds} title={newTitle} setTitle={setNewTitle} angle={newAngle} setAngle={setNewAngle} rationale={newRationale} setRationale={setNewRationale} busy={busy} job={topicJob?job:null} ready={ready('topics')} reviewLoaded={!!review?.loaded} candidates={reviewItems} removedCount={removedCount} generate={()=>void generateTopics()} add={()=>void add()} confirm={()=>void confirmSuggestions()} selectAll={selectAllSuggestions} edit={editSuggestion}/>}
 {showOptimize&&platform==='wechat'&&<WechatOptimizePage scope={optimizeScope} original={currentOptimizationJob?.result?.original||currentDelivery} job={currentOptimizationJob} busy={busy} error={optimizationError} onClose={()=>setShowOptimize(false)} onNew={()=>{if(currentDelivery.id)localStorage.removeItem(optimizationJobKey(currentDelivery.id));setOptimizationJob(null);setOptimizationError('')}} onStart={(scope,instruction)=>void startOptimize(scope,instruction)} onApply={()=>void applyOptimization()} onStop={()=>{if(currentOptimizationJob)void api('/jobs/'+currentOptimizationJob.id+'/cancel',{}).then(setOptimizationJob).catch(e=>setOptimizationError(msg(e)))}}/>}
 </main>;
}
