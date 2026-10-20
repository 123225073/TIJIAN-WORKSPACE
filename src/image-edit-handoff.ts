import {api,getToken} from './api';

export type EditImageSource={url:string;title:string};
export type ImageEditHandoffPreparation={route:string;tasks:Promise<unknown>[];claimed:boolean};
export const IMAGE_EDIT_PREPARE='image-edit-before-handoff';
const IMAGE_PATH=/^\/api\/(?:studio\/assets\/[a-f0-9]{32}(?:[a-f0-9]{32})?\/(?:file|thumbnail)|illustrations\/[a-f0-9]{32}\/file)$/;
const MAX_IMPORTED_IMAGE_BYTES=25*1024*1024;

/** Prefer a stable original reference, never the thumbnail's temporary Blob URL. */
export function editImageSource(image:HTMLImageElement):EditImageSource{
 const original=image.dataset.originalSrc||image.dataset.localImage||(image.closest('[data-wa-image]') as HTMLElement|null)?.dataset.waImage;
 const url=original||image.currentSrc||image.src;
 if(!url)throw Error('这张图片没有可读取的原图，请先上传原图。');
 return {url,title:(image.alt||'图片').trim().slice(0,90)};
}
const assertSession=(session:string)=>{if(!session||getToken()!==session)throw Error('登录状态已变化，请重新打开图片菜单。')};

export async function openImageEditor(source:EditImageSource){
 const session=getToken(),originRoute=location.hash;
 assertSession(session);
 // Only the visible editor registers a save. Hidden retained editors stay idle.
 const preparation:ImageEditHandoffPreparation={route:originRoute,tasks:[],claimed:false};
 window.dispatchEvent(new CustomEvent(IMAGE_EDIT_PREPARE,{detail:preparation}));
 await Promise.all(preparation.tasks);assertSession(session);
 if(location.hash!==originRoute)throw Error('页面已切换，请在当前图片上重新打开菜单。');
 let imageId='',blob:Blob|undefined;
 const parsed=new URL(source.url,location.href);
 if(parsed.origin===location.origin&&IMAGE_PATH.test(parsed.pathname)){
  const asset=/^\/api\/studio\/assets\/([a-f0-9]{32}(?:[a-f0-9]{32})?)\/(?:file|thumbnail)$/.exec(parsed.pathname);
  if(asset){
   const response=await fetch('/api/studio/assets/'+asset[1]+'/file',{headers:{Authorization:'Bearer '+session}});
   if(!response.ok)throw Error('原图读取失败，请检查素材是否仍可用（HTTP '+response.status+'）。');
   if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('原图文件格式不可用，请重新选择图片。');
   const original=await response.blob();if(!original.size)throw Error('原图文件为空，请重新上传。');
   imageId=asset[1];
  }else{
   const result=await api(parsed.pathname.slice(4));assertSession(session);
   if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(result.data_uri||''))throw Error('这张文章配图的原图暂不可读取，请重新选择。');
   blob=await (await fetch(result.data_uri)).blob();
  }
 }else if((source.url.startsWith('blob:')&&parsed.origin===location.origin)||/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/.test(source.url)){
  try{const response=await fetch(source.url);if(!response.ok)throw Error();blob=await response.blob()}catch{throw Error('图片预览已失效，请重新打开原图后再试。')}
 }else if(parsed.origin===location.origin||parsed.protocol==='https:'){
  let response:Response;
  try{response=await fetch(parsed.href,{mode:'cors',credentials:parsed.origin===location.origin?'same-origin':'omit'})}catch{throw Error('浏览器无法读取这张原图，请先下载原图，再上传到图片编辑。')}
  if(!response.ok)throw Error('原图读取失败（HTTP '+response.status+'），请先下载原图，再上传到图片编辑。');
  if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('原图链接没有返回图片文件，请下载原图后上传。');
  if(Number(response.headers.get('content-length'))>MAX_IMPORTED_IMAGE_BYTES)throw Error('原图超过 25 MB，请缩小图片后上传。');
  blob=await response.blob();
 }else throw Error('这张图片没有可验证的本地原图，请先下载原图，再上传到图片编辑。');
 assertSession(session);
 if(blob){
  if(!blob.size||!blob.type.startsWith('image/'))throw Error('原图文件为空或格式不可用，请重新选择。');
  if(blob.size>MAX_IMPORTED_IMAGE_BYTES)throw Error('原图超过 25 MB，请缩小图片后上传。');
  const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'} as Record<string,string>)[blob.type];
  if(!extension)throw Error('此原图格式暂不支持编辑，请转换为 PNG、JPG 或 WebP 后上传。');
  const form=new FormData();form.append('file',new File([blob],'图片编辑原图.'+extension,{type:blob.type}));
  const raw=await api('/studio/upload',form);assertSession(session);const image=raw.asset||raw;
  if(!image.id||image.asset_type!=='image'||image.status!=='ready')throw Error('原图未能导入编辑素材，尚未新建草稿。');
  imageId=image.id;
 }
 if(location.hash!==originRoute)throw Error('页面已切换，图片已保留在素材库，请重新选择。');
 const draft=await api('/studio/drafts',{tool:'image_edit',title:'图片编辑 · '+(source.title||'新原图'),input:{image_id:imageId,image_ids:[imageId],prompt:'',edit_marks:[],image_layers:[]},options:{},source_ids:[]});
 assertSession(session);
 if(!draft.id||draft.tool!=='image_edit')throw Error('图片编辑草稿未能正确创建，请到图片创作的草稿记录查看。');
 if(location.hash!==originRoute)throw Error('页面已切换，新建的图片编辑稿已保留，可到图片创作的草稿记录打开。');
 // A separate, saved draft protects the active composition and all prior prompts.
 location.hash='studio/image?mode=image_edit&draft='+encodeURIComponent(draft.id);
 return draft;
}
