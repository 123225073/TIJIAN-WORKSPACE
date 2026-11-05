import {api,getToken} from './api';
import {imagePlan} from './image-parameters';
import {readerArticleText} from './wechat-rich';
import {imageStyleTemplates,pictureStyleById,socialStyles} from './picture-styles';

type Slot={index:number;status:string;request_id:string;prompt?:string;job_id?:string;draft_id?:string;version?:number;run_id?:string;asset_id?:string;error?:string;attempt:number};
export type SocialBatch={id:string;owner:string;content_id:string;flow_id:string;body:string;title:string;brand_id:string;profile_id:string;ratio:string;actual_ratio?:string;parameter_notice?:string;style:string;style_prompt?:string;purpose?:'article'|'social';model_id:string;options:any;slots:Slot[];attached:string[]};
type Session={owner:string;token:string};
export const socialBatchKey=(owner:string,id:string)=>'social-picture-batch:'+owner+':'+id;
export const readSocialBatch=(key:string):SocialBatch|null=>JSON.parse(localStorage.getItem(key)||'null');
const write=(key:string,value:SocialBatch)=>{localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new CustomEvent('social-picture-batch',{detail:key}))};
const check=(key:string,session:Session,batch?:SocialBatch|null)=>{if(session.token!==getToken()||key!==socialBatchKey(session.owner,batch?.content_id||key.slice(key.lastIndexOf(':')+1))||batch&&batch.owner!==session.owner)throw Error('账号已切换，配图任务已暂停。请返回原账号查看。')};
const flights=new Map<string,Promise<unknown>>();
function exclusive<T>(key:string,fn:()=>Promise<T>):Promise<T>{
 const previous=flights.get(key)||Promise.resolve();
 const promise=previous.catch(()=>{}).then(async()=>navigator.locks?await navigator.locks.request(key,fn):await fn()).finally(()=>{if(flights.get(key)===promise)flights.delete(key)});
 flights.set(key,promise);return promise;
}
export const socialBatchActive=(batch:SocialBatch|null)=>!!batch?.slots.some(s=>!['succeeded','failed'].includes(s.status));
export async function startSocialBatch(key:string,content:any,ratio:string,count:number,styleId:string,session:Session,purpose:'article'|'social'='social'){return exclusive(key,async()=>{
 check(key,session);const prior=readSocialBatch(key);if(socialBatchActive(prior))return prior;
 const body=readerArticleText(String(content.body||content.text||'')).trim();if(!body)throw Error('请先填写文案正文，再生成配图。');
 if(body.length>30000)throw Error('正文超过 30000 字符，请先精简配图依据。');
 if(!['3:4','1:1','4:3','9:16','16:9'].includes(ratio)||![1,2,3,4,6,9].includes(count))throw Error('请选择有效的尺寸和数量。');
 const style=(purpose==='article'?imageStyleTemplates:socialStyles).find(s=>s.id===styleId);if(!style)throw Error('请选择配图风格。');
 const catalog=await api('/studio/catalog');check(key,session);
 const tool=catalog.tools?.find((t:any)=>t.id==='text_image'),model=tool?.models?.find((m:any)=>m.id===tool.binding&&m.configured);
 if(!model||tool.enabled===false)throw Error('请先在设置中配置默认生图模型。');
 const plan=imagePlan(model.options||{},{requested_ratio:ratio});
 const batch:SocialBatch={id:crypto.randomUUID(),owner:session.owner,content_id:content.id,flow_id:content.flow_id||'',body,title:content.title||'文案配图',brand_id:content.brand_id||'',profile_id:content.profile_id||'',ratio,actual_ratio:plan.actual||'模型默认',parameter_notice:plan.notice,style:styleId,style_prompt:style.prompt,...(purpose==='article'?{purpose}:{}),model_id:model.id,options:plan.options,slots:Array.from({length:count},(_,index)=>({index,status:'new',request_id:crypto.randomUUID(),attempt:1})),attached:[]};
 write(key,batch);return batch;
})}
const draftsPath=(b:SocialBatch)=>b.flow_id?'/studio/flows/'+encodeURIComponent(b.flow_id)+'/drafts':'/studio/drafts';
const title=(b:SocialBatch,s:Slot)=>`独立配图 ${b.id} ${s.index+1} ${s.attempt}`;
const batchStylePrompt=(b:SocialBatch)=>b.style_prompt||(b.purpose==='article'?pictureStyleById(b.style).prompt:(socialStyles.find(s=>s.id===b.style)||socialStyles[0]).prompt);
export function socialPicturePrompt(b:SocialBatch,index:number){
 if(b.purpose==='article'){
  const count=b.slots.length;
  const role=count===1?'用一个清晰的行业场景概括文章最核心的观点。':index===0?'文章开篇配图：用一个真实可理解的行业场景呈现读者关心的问题。':index===count-1?'文章结尾配图：以不同于开篇的构图呈现文章结论或可执行的下一步。':`正文第 ${index} 幅配图：按照全文顺序选择一个不同重点，用人物动作、设备关系、流程或对照场景说明。`;
  return `为这篇电梯行业文章制作 ${count} 幅配图中的第 ${index+1} 幅。${role}\n${batchStylePrompt(b)}\n整组使用上述风格并保持统一色板、材质和笔触。先理解全文，再为当前图片选择与正文相关的一个清晰主题，避免每张重复封面。画面有明确主体、自然的空间关系、舒适留白和鲜明的层次；适合嵌入公众号或品牌文章，避免海报式大字、密集小字及装饰性伪文字。设备结构和施工动作应合理；没有资料支持时不画具体品牌、价格、数字、资质、项目证据或技术结论。生成示意图不能冒充真实项目照片。只返回不超过1200字的具体画面提示词。`;
 }
 const style=socialStyles.find(s=>s.id===b.style)||socialStyles[0];
 const count=b.slots.length;
 const role=count===1?'唯一图片：用一个清晰的视觉主题概括全文核心，不堆砌所有信息。':index===0?'封面：提炼全文最值得读者关心的一个真实问题或收获，设计醒目的短标题和与内容有关的主体。':index===count-1?'结尾：聚焦文末结论或读者可以执行的下一步，避免重复封面。':`内页：按全文内容顺序提炼第 ${index} 个不同重点；一个画面只讲一个信息，用适合内容的步骤、对比、清单或场景图解。`;
 return `基于提供的完整文案，为小红书制作一组 ${count} 张图中的第 ${index+1} 张。${role}\n${style.prompt}\n先理解全文并规划每页不同重点，再只输出当前页的具体画面提示词；所选段落仅供定位，全文事实和限制优先。明确画面主体、主次层级、留白、视线顺序、色彩对比和安全边距，手机缩略图也应辨认主体。图中文字只放必要的少量准确短句，避免密集小字、长段落、装饰性伪文字；重要联系方式、长数字和复杂事实留在正文，不要伪造。不要将每页画成同一张重复封面，不凭空增加品牌、价格、数字、资质、案例或结论。返回不超过1200字的画面提示词。`;
}
const acceptPrompt=(slot:Slot,job:any)=>{
 if(job.id)slot.job_id=job.id;
 if(job.status==='done'){
  const prompt=job.result?.suggested_prompt;
  if(typeof prompt!=='string'||!prompt.trim()||Array.from(prompt.trim()).length>1200){slot.status='failed';slot.error='提示词结果无效或过长，未提交生图。';return}
  slot.prompt=prompt.trim();slot.status='prompt_ready';slot.error='';
 }else if(['failed','cancelled','interrupted','expired'].includes(job.status)){slot.status='failed';slot.error=job.error||'画面准备未完成。'}
 else slot.status=slot.job_id?'prompt_pending':'prompt_unknown';
};
export function advanceSocialBatch(key:string,session:Session){return exclusive(key,async()=>{
 const b=readSocialBatch(key);check(key,session,b);if(!b)return null;
 const call=async(path:string,body?:any,method?:string)=>{check(key,session,b);return api(path,body,method)};
 for(const slot of b.slots){
  if(['succeeded','failed'].includes(slot.status))continue;
  try{
   if(slot.status==='new'){
    slot.status='prompt_submitting';write(key,b);
    const chars=Array.from(b.body),offset=Math.floor(Math.max(0,chars.length-1000)*(b.slots.length===1?0:slot.index/(b.slots.length-1))),start=chars.slice(0,offset).join('').length,end=start+chars.slice(offset,offset+1000).join('').length;
    const job=await call('/studio/text/article-illustration-prompt',{content_id:b.content_id,body:b.body,start,end,idea:socialPicturePrompt(b,slot.index),style:batchStylePrompt(b)});
    acceptPrompt(slot,job);write(key,b);check(key,session,b);
   }else if(slot.status==='prompt_pending'&&slot.job_id){acceptPrompt(slot,await call('/jobs/'+slot.job_id));write(key,b);check(key,session,b)}
   else if(['prompt_submitting','prompt_unknown'].includes(slot.status)){slot.status='prompt_unknown';slot.error='画面准备结果待核对，未重复请求；请到当前任务记录核查。';write(key,b);continue}
   if(['prompt_pending','prompt_unknown','failed'].includes(slot.status))continue;
   if(slot.status==='prompt_ready'){
    slot.status='draft_pending';write(key,b);
    const draft=await call(draftsPath(b),{tool:'text_image',title:title(b,slot),input:{prompt:slot.prompt},model_id:b.model_id,options:b.options,brand_id:b.brand_id,profile_id:b.profile_id,source_ids:[]});
    slot.draft_id=draft.id;slot.version=draft.version;slot.status='prepared';write(key,b);check(key,session,b);
   }else if(slot.status==='draft_pending'){
    const drafts=await call(draftsPath(b));check(key,session,b);
    const matches=drafts.items?.filter((d:any)=>d.title===title(b,slot)&&d.model_id===b.model_id&&(d.flow_id||'')===b.flow_id&&d.input?.prompt===slot.prompt)||[];
    if(matches.length===1){slot.draft_id=matches[0].id;slot.version=matches[0].version;slot.status='prepared';slot.error='';write(key,b)}
    else{slot.error='正在核对原草稿，未重复提交；已生成素材会保留。';write(key,b);continue}
   }
   let run:any;
   if(slot.status==='prepared'){
    slot.status='submitting';write(key,b);
    const result=await call('/studio/generate',{draft_id:slot.draft_id,version:slot.version,request_id:slot.request_id,confirmed:true,...(b.flow_id?{flow_id:b.flow_id}:{})});
    run=result.run||result;slot.run_id=run.id;write(key,b);check(key,session,b);
   }else{
    if(!slot.run_id){const runs=await call('/studio/runs');check(key,session,b);slot.run_id=runs.items?.find((r:any)=>r.request_id===slot.request_id&&r.draft_id===slot.draft_id)?.id}
    if(!slot.run_id){slot.status='unknown';slot.error='原请求暂未查到，正在保留并核对任务，不会重复生成。';write(key,b);continue}
    const raw=await call('/studio/runs/'+slot.run_id+'/refresh',undefined,'POST');run=raw.run||raw;check(key,session,b);
   }
   if(run.status==='succeeded'){
    if(b.flow_id)await call(draftsPath(b));
    const assets=await call('/studio/assets');check(key,session,b);
    const image=assets.items?.find((a:any)=>run.asset_ids?.includes(a.id)&&a.asset_type==='image'&&a.status==='ready'&&(!b.flow_id||a.flow_id===b.flow_id));
    if(image){slot.asset_id=image.id;slot.status='succeeded';slot.error=''}else{slot.status='archive_failed';slot.error='图片已生成，正在读取素材。'}
   }else if(['failed','interrupted','cancelled','expired'].includes(run.status)){slot.status='failed';slot.error=run.error||'生成未完成，可仅重试这一项。'}
   else{slot.status=run.status||'unknown';slot.error=run.error||''}
   write(key,b);
  }catch(e:any){
   check(key,session,b);
   if([400,403,404,422].includes(e.status)&&['draft_pending','submitting','prompt_submitting'].includes(slot.status)&&e.message!=='媒体请求失败，请检查字段、素材及服务配置'){slot.status='failed'}
   else if(slot.status==='prompt_submitting')slot.status='prompt_unknown';
   slot.error=e.message||'进度读取失败，原任务已保留';write(key,b);
  }
 }
 return b;
})}
export function markSocialAttached(key:string,ids:string[],session:Session){return exclusive(key,async()=>{const b=readSocialBatch(key);check(key,session,b);if(b){b.attached=[...new Set([...b.attached,...ids])];write(key,b)}})}
export function retrySocialFailed(key:string,session:Session){return exclusive(key,async()=>{const b=readSocialBatch(key);check(key,session,b);if(!b)return;for(const s of b.slots)if(s.status==='failed'){s.status=s.prompt?'prompt_ready':'new';s.attempt++;s.request_id=crypto.randomUUID();delete s.draft_id;delete s.version;delete s.run_id;delete s.job_id;s.error=''}write(key,b)})}
