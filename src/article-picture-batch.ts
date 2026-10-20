import {api,getToken} from './api';
import {pictureStyles} from './picture-styles';
import {parseArticleProduction,productionBookmark,replaceProductionInstructions} from './article-production';

export type PictureSlot={id:string;label:string;synthetic:boolean;status:string;prompt?:string;job_id?:string;draft_id?:string;version?:number;request_id:string;run_id?:string;asset_id?:string;error?:string;attempt:number};
export type PictureBatch={style_id?:string;style_prompt?:string;id:string;owner?:string;content_id:string;content_version:number;flow_id?:string;source_ids?:string[];base:string;planned:string;expected:string;model_id:string;brand_id:string;profile_id:string;status:'saving'|'ready'|'setup_failed';slots:PictureSlot[];error?:string;applied:string[]};
export type BatchSession={owner:string;token:string};
// Never persist credentials. Capture once when the owning editor mounts, not at
// the start of each poll (a poll may race logout/login before React unmounts).
const accountCheck=(key:string,session:BatchSession,b?:PictureBatch|null)=>{
 if(getToken()!==session.token||!key.startsWith('article-picture-batch:'+session.owner+':')||(b?.owner&&b.owner!==session.owner))throw Error('账号已切换，原账号三图任务已暂停；重新登录原账号后可核查。');
};
const sessionAPI=(key:string,session:BatchSession)=>async(path:string,body?:any,method?:string,received?:(result:any)=>void)=>{
 accountCheck(key,session);const result=await api(path,body,method);
 // This response belongs to the captured request token. Persist its identity to
 // the original owner's key even after logout, then stop before any next call.
 received?.(result);accountCheck(key,session);return result;
};
export const batchKey=(owner:string,id:string)=>'article-picture-batch:'+owner+':'+id;
export const readBatch=(key:string):PictureBatch|null=>JSON.parse(localStorage.getItem(key)||'null');
const write=(key:string,batch:PictureBatch)=>{localStorage.setItem(key,JSON.stringify(batch));window.dispatchEvent(new CustomEvent('article-picture-batch',{detail:key}))};
export const batchBlocksSingle=(key:string)=>{const b=readBatch(key);return !!b&&b.status!=='setup_failed'&&(b.status==='saving'||b.slots.some(s=>!['succeeded','failed'].includes(s.status)))};
const singlePending=(key:string)=>JSON.parse(localStorage.getItem(key.replace('article-picture-batch:','article-picture:'))||'{}').pending;
const assertSingleClear=(key:string)=>{if(singlePending(key))throw Error('原单图任务尚未结束，请先核查单图任务。')};
const flights=new Map<string,{tail:Promise<any>;operations:Map<string,Promise<any>>}>();
// The lease outlives React. Web Locks also serialize same-origin desktop windows.
function exclusive<T>(key:string,operation:string,fn:()=>Promise<T>):Promise<T>{
 const queue=flights.get(key)||{tail:Promise.resolve(),operations:new Map<string,Promise<any>>()};
 if(queue.operations.has(operation))return queue.operations.get(operation)!;
 const promise=queue.tail.catch(()=>{}).then(async()=>navigator.locks?await navigator.locks.request(key,fn):await fn()).finally(()=>{
  queue.operations.delete(operation);if(queue.tail===promise)flights.delete(key);
 });
 queue.tail=promise;queue.operations.set(operation,promise);flights.set(key,queue);return promise;
}

/** Reuse existing instructions; new instructions exist only in the batch snapshot. */
export function planPictures(body:string,batchId:string){
 if(!body.trim()||body.length>30000)throw Error('请先完成并保存正文（最多 30000 字符）。');
 const existing=parseArticleProduction(body).instructions.filter(b=>b.kind==='illustration');
 if(existing.length>3)throw Error('正文已有超过三处配图指令，请先保留本次需要的三处，或使用单图配图。');
 if(new Set(existing.map(b=>b.id)).size!==existing.length)throw Error('正文配图编号重复，请先修正。');
 const paragraphs=Array.from(body.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g)).filter(m=>m[0].trim()&&!parseArticleProduction(body).instructions.some(b=>m.index!<b.end&&m.index!+m[0].length>b.start));
 if(!paragraphs.length&&!existing.length)throw Error('正文中没有可用于配图的段落。');
 const labels=['开头','中段','结尾'];
 const slots:PictureSlot[]=existing.map((b,i)=>({id:b.id,label:labels[i],synthetic:false,status:'new',request_id:crypto.randomUUID(),attempt:1}));
 const additions:{at:number;text:string}[]=[];
 for(let i=slots.length;i<3;i++){
  const id='batch-'+batchId.replace(/-/g,'')+'-'+i;
  const paragraph=paragraphs[Math.min(paragraphs.length-1,Math.floor((paragraphs.length-1)*i/2))];
  const at=i===0?0:i===2?body.length:paragraph?paragraph.index!+paragraph[0].length:Math.floor(body.length/2);
  // Every prompt carries the complete saved body plus a bounded, distinct target.
  const excerpt=(paragraph?.[0]||existing[i%existing.length]?.prompt||'').slice(0,1000);
  additions.push({at,text:`\n\n:::article-production illustration ${id}\n图片内容建议：为文章${labels[i]}制作一张配图。${i===0?'概括主题，引出阅读。':i===1?'解释正文核心内容，帮助理解。':'总结观点，呼应结尾。'}参考段落：${excerpt}\n:::end-article-production\n\n`});
  slots.push({id,label:labels[i],synthetic:true,status:'new',request_id:crypto.randomUUID(),attempt:1});
 }
 let planned=body;for(const a of additions.sort((a,b)=>b.at-a.at))planned=planned.slice(0,a.at)+a.text+planned.slice(a.at);
 // Legacy IDs encode offsets. Remap from original blocks before validating the
 // augmented snapshot; never search by text (identical legacy cards are valid).
 existing.forEach((block,i)=>{if(block.syntax!=='explicit')slots[i].id='legacy-'+(block.start+additions.filter(a=>a.at<=block.start).reduce((n,a)=>n+a.text.length,0))});
 if(planned.length>30000)throw Error('正文较长，加入配图上下文后超过上限，请先缩短正文。');
 // Validate every stable target before any model request.
 slots.forEach(s=>{productionBookmark(planned,s.id);const prompt=parseArticleProduction(planned).instructions.find(b=>b.id===s.id)!.prompt;if(!prompt.trim()||Array.from(prompt).length>2000)throw Error('每处配图要求需为 1–2000 字，请先调整正文中的配图指令。')});return {planned,slots};
}

export function batchResult(batch:PictureBatch){
 const completed=batch.slots.filter(s=>s.status==='succeeded'&&s.asset_id);
 if(!completed.length)return batch.base;
 let result=replaceProductionInstructions(batch.planned,completed.map(s=>({bookmark:productionBookmark(batch.planned,s.id),imageMarkdown:`![${s.label}配图](/api/studio/assets/${s.asset_id}/file)`})));
 // Unfinished newly-planned instructions never leak into the article.
 const remove=new Set(batch.slots.filter(s=>s.synthetic&&!s.asset_id).map(s=>s.id));
 for(const block of parseArticleProduction(result).instructions.filter(b=>remove.has(b.id)).sort((a,b)=>b.start-a.start))result=result.slice(0,block.start)+result.slice(block.end);
 return result;
}

export function startBatch(key:string,content:any,save:()=>Promise<any>,session:BatchSession,styleId=pictureStyles[0].id){return exclusive(key,'start',async()=>{
 accountCheck(key,session);const call=sessionAPI(key,session);
 assertSingleClear(key);
 const previous=readBatch(key);accountCheck(key,session,previous);if(previous&&previous.status==='ready')return previous;
 const style=pictureStyles.find(s=>s.id===styleId)||pictureStyles[0];
 const b:PictureBatch={style_id:style.id,style_prompt:style.prompt,id:crypto.randomUUID(),owner:session.owner,content_id:content.id,content_version:0,base:'',planned:'',expected:'',model_id:'',brand_id:'',profile_id:'',status:'saving',slots:[],applied:[]};
 write(key,b); // A remount cannot start another save/draft while this request is in flight.
 try{
  accountCheck(key,session);const saved=await save();accountCheck(key,session);if(saved.id!==content.id)throw Error('保存结果与当前文章不一致。');
  const base=String(saved.body??saved.text??'');const plan=planPictures(base,b.id);
  const catalog=await call('/studio/catalog'),tool=catalog.tools?.find((t:any)=>t.id==='text_image');
  if(!tool?.binding||tool.enabled===false||!tool.models?.some((m:any)=>m.id===tool.binding&&m.configured))throw Error('请先在设置中配置默认生图模型。');
  Object.assign(b,{content_version:saved.version,flow_id:saved.flow_id||content.flow_id||'',source_ids:saved.kind==='content'?[saved.id]:[],base,expected:base,...plan,model_id:tool.binding,brand_id:saved.brand_id||'',profile_id:saved.profile_id||'',status:'ready'});write(key,b);
 }catch(e:any){accountCheck(key,session);b.status='setup_failed';b.error=e.message;write(key,b);throw e}
 return b;
})}

const activeRun=['queued','preparing','submitting','running','unknown','archive_failed'];
function acceptJob(s:PictureSlot,j:any){
 if(j?.id)s.job_id=j.id;
 if(j.status==='done'){
  const prompt=j.result?.suggested_prompt;
  if(typeof prompt!=='string'||!prompt.trim()){s.status='failed';s.error='AI 未返回有效提示词';return}
  s.prompt=prompt.trim();s.status='prompt_ready';s.error='';
 }else if(['failed','cancelled','interrupted'].includes(j.status)){s.status='failed';s.error=j.error||'提示词准备失败'}
 else{s.status=s.job_id?'prompt_pending':'prompt_unknown'}
}
const draftsPath=(b:PictureBatch)=>b.flow_id?'/studio/flows/'+encodeURIComponent(b.flow_id)+'/drafts':'/studio/drafts';
async function acceptRun(b:PictureBatch,s:PictureSlot,raw:any,call:ReturnType<typeof sessionAPI>){
 const run=raw.run||raw;if(run.id)s.run_id=run.id;
 if(run.status==='succeeded'){
  // Existing scoped read reconciles completed run/assets back to their draft's flow.
  if(b.flow_id)await call(draftsPath(b));
  const assets=await call('/studio/assets');const pic=assets.items?.find((a:any)=>run.asset_ids?.includes(a.id)&&a.status==='ready'&&a.asset_type==='image');
  if(!pic){s.status='archive_failed';s.error='任务已完成，素材尚未读取，请核查原任务';return}
  if(!/^[a-f0-9]{32,64}$/.test(pic.id))throw Error('返回的图片引用无效');
  if(b.flow_id&&pic.flow_id!==b.flow_id){s.status='archive_failed';s.error='图片作品归属尚未核清，请核查原任务';return}
  s.asset_id=pic.id;s.status='succeeded';s.error='';
 }else if(['failed','interrupted'].includes(run.status)){s.status='failed';s.error=run.error||'配图生成失败'}
 else{s.status=activeRun.includes(run.status)?run.status:'unknown';s.error=run.error||''}
}
const draftTitle=(b:PictureBatch,s:PictureSlot)=>`文章三图 ${b.id} ${s.id} ${s.attempt}`;
/** One bounded pass. A lost response is reconciled by reads, never a new POST. */
export function advanceBatch(key:string,session:BatchSession){return exclusive(key,'advance',async()=>{
 accountCheck(key,session);const call=sessionAPI(key,session),b=readBatch(key);accountCheck(key,session,b);if(!b||b.status!=='ready')return b;
 for(const s of b.slots){
  try{
   if(s.status==='new'){
    assertSingleClear(key);const target=productionBookmark(b.planned,s.id);
    s.status='prompt_submitting';write(key,b);
    const selection=Array.from(target.raw).slice(0,1000).join('');
    const job=await call('/studio/text/article-illustration-prompt',{content_id:b.content_id,body:b.planned,start:target.start,end:target.start+selection.length,instruction_id:s.id,idea:`文章${s.label}配图，三张保持一致的插画风格`,style:(b.style_prompt||pictureStyles[0].prompt)+' 不虚构品牌、价格或数据。三张配图保持统一风格。'},undefined,job=>{acceptJob(s,job);write(key,b)});
    acceptJob(s,job);write(key,b);
   }else if(s.status==='prompt_pending'&&s.job_id){acceptJob(s,await call('/jobs/'+s.job_id));write(key,b)}
   else if(s.status==='prompt_submitting'){s.status='prompt_unknown';s.error='提示词请求响应丢失，暂不重复提交；请先核查任务记录。';write(key,b)}
   if(s.status==='prompt_ready'){
    assertSingleClear(key);s.status='draft_submitting';write(key,b);
    const draft=await call(draftsPath(b),{tool:'text_image',title:draftTitle(b,s),input:{prompt:s.prompt},model_id:b.model_id,options:{},brand_id:b.brand_id,profile_id:b.profile_id,source_ids:b.source_ids||[]},undefined,draft=>{s.draft_id=draft.id;s.version=draft.version;s.status='prepared';write(key,b)});
    s.draft_id=draft.id;s.version=draft.version;s.status='prepared';write(key,b);
   }else if(s.status==='draft_submitting'){
    const drafts=await call(draftsPath(b));const matches=drafts.items?.filter((d:any)=>d.title===draftTitle(b,s)&&d.model_id===b.model_id&&d.input?.prompt===s.prompt&&(d.flow_id||'')===(b.flow_id||''))||[];
    if(matches.length===1){s.draft_id=matches[0].id;s.version=matches[0].version;s.status='prepared';s.error='';write(key,b)}
    else{s.error='原生图草稿尚未核清，不会另建草稿';write(key,b)}
   }
   if(s.status==='prepared'){
    assertSingleClear(key);s.status='submitting';write(key,b);
    await acceptRun(b,s,await call('/studio/generate',{draft_id:s.draft_id,version:s.version,request_id:s.request_id,confirmed:true,...(b.flow_id?{flow_id:b.flow_id}:{})},undefined,result=>{const run=result.run||result;if(run.id)s.run_id=run.id;write(key,b)}),call);accountCheck(key,session);write(key,b);
   }else if(activeRun.includes(s.status)){
    if(!s.run_id){const runs=await call('/studio/runs');const run=runs.items?.find((r:any)=>r.request_id===s.request_id&&r.draft_id===s.draft_id);if(run)s.run_id=run.id}
    if(s.run_id)await acceptRun(b,s,await call('/studio/runs/'+s.run_id+'/refresh',undefined,'POST'),call);
    else{s.status='unknown';s.error='原请求暂未查到，不会重复生成';}accountCheck(key,session);write(key,b);
   }
  }catch(e:any){
   // Explicit draft rejection is not a lost response. It is safe to offer a
   // fresh preparation on an explicit retry; unknown responses stay locked.
   if(s.status==='draft_submitting'&&[400,403,404,422].includes(e.status)){s.status='failed';s.error=e.message;write(key,b)}
   if(['prompt_submitting','submitting'].includes(s.status)&&e.status===400&&e.message!=='媒体请求失败，请检查字段、素材及服务配置'){s.status='failed';s.error=e.message;write(key,b)}
   accountCheck(key,session);s.error=e.message;if(s.status==='prompt_submitting')s.status='prompt_unknown';else if(s.status==='submitting')s.status='unknown';write(key,b)
  }
 }
 return b;
})}

export function retryFailedPictures(key:string,session:BatchSession){return exclusive(key,'retry',async()=>{
 accountCheck(key,session);
 const b=readBatch(key);if(!b||b.status!=='ready')return;
 accountCheck(key,session,b);
 assertSingleClear(key);
 for(const s of b.slots)if(s.status==='failed'){
  // Explicit retry only; completed/unknown members keep every original identifier.
  s.status=s.prompt?'prompt_ready':'new';s.request_id=crypto.randomUUID();s.attempt++;delete s.draft_id;delete s.version;delete s.run_id;delete s.job_id;s.error='';
 }
 write(key,b);return b;
})}

export function applyBatch(key:string,getBody:()=>string,apply:(expected:string,next:string)=>void,session:BatchSession){return exclusive(key,'apply',async()=>{
 accountCheck(key,session);
 const b=readBatch(key);if(!b||b.status!=='ready')return;
 accountCheck(key,session,b);
 const ids=b.slots.filter(s=>s.status==='succeeded'&&s.asset_id).map(s=>s.asset_id!);
 if(!ids.length||ids.every(id=>b.applied.includes(id)))return;
 const next=batchResult(b),current=getBody();
 if(current!==b.expected&&current!==next)throw Error('正文已变化，已完成图片保留在素材库；为避免覆盖修改，未自动回填。');
 apply(current,next);
 b.expected=next;b.applied=ids;write(key,b);
})}
