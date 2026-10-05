import {useEffect,useRef,useState,type ClipboardEvent,type DragEvent,type PointerEvent} from 'react';
import {ClipboardPaste,Download,Expand,Image as ImageIcon,MousePointer2,Move,Save,Sparkles,Trash2,Upload,X} from 'lucide-react';
import {api,getToken} from './api';
import {AssetThumbnail} from './AssetPicker';
import {pastedImages,readClipboardImages} from './image-clipboard';
import './image-edit-workspace.css';

export type Region={x:number;y:number;width:number;height:number}; // Legacy selection uses percentages.
export type EditMark={id:string;x:number;y:number;width:number;height:number;instruction:string};
export type ImageLayer={id:string;asset_id:string;x:number;y:number;width:number;height:number};
type Asset={id:string;asset_type:string;status:string;title?:string;file_url?:string;width?:number;height?:number};
type Props={
 assets:Asset[];selected:string;references:string[];maxReferences:number;
 region?:Region|null;onRegion?:(value:Region|null)=>void;onSelect:(id:string)=>void;
 onReferences:(ids:string[])=>void;onUploaded:()=>Promise<void>;
 marks?:EditMark[];onMarks?:(marks:EditMark[])=>void;
 layers?:ImageLayer[];onLayers?:(layers:ImageLayer[])=>void;
 onComposite?:(blob:Blob,sourceId:string,placedLayers:ImageLayer[])=>Promise<boolean>;
 resultAssets?:Asset[];resultStatus?:string;onUseResult?:(id:string)=>void;worksHref?:string;
 prompt?:string;onPrompt?:(value:string)=>void;onGenerate?:()=>void;canGenerate?:boolean;
 generating?:boolean;generationStatus?:string;generationError?:string;
};
type DropTarget='primary'|'reference'|'layer';
type UploadMode='primary'|'reference'|'layer';
type Rect={x:number;y:number;width:number;height:number};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const unique=(ids:string[])=>[...new Set(ids.filter(Boolean))];
const uid=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);
const label=(asset:Asset|undefined)=>asset?.title||'图片素材';
const percent=(value:number)=>Math.round(value*100);

async function assetBlob(asset:Asset,signal?:AbortSignal):Promise<Blob>{
 if(!asset.file_url)throw Error('素材缺少原图文件地址');
 const url=new URL(asset.file_url,window.location.href);
 const local=url.origin===window.location.origin;
 const headers:HeadersInit=local&&url.pathname.startsWith('/api/')?{Authorization:'Bearer '+getToken()}:{};
 const response=await fetch(url.href,{headers,credentials:local?'same-origin':'omit',mode:'cors',signal});
 if(!response.ok)throw Error('图片读取失败（HTTP '+response.status+'）');
 const blob=await response.blob();
 if(!blob.size)throw Error('图片文件为空');
 return blob;
}
async function bitmapOf(asset:Asset):Promise<ImageBitmap>{
 try{return await createImageBitmap(await assetBlob(asset))}
 catch(cause){throw Error(label(asset)+'无法用于合成：'+((cause as Error).message||'图片解码失败'))}
}
function normalizedRect(a:{x:number;y:number},b:{x:number;y:number}):Rect{
 return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
}

export default function ImageEditWorkspace({
 assets,selected,references,maxReferences,region,onRegion,onSelect,onReferences,onUploaded,
 marks:controlledMarks,onMarks,layers:controlledLayers,onLayers,onComposite,resultAssets=[],resultStatus,onUseResult,worksHref,
 prompt='',onPrompt,onGenerate,canGenerate=false,generating=false,generationStatus='',generationError=''
}:Props){
 const [internalMarks,setInternalMarks]=useState<EditMark[]>([]);
 const [internalLayers,setInternalLayers]=useState<ImageLayer[]>([]);
 const marks=controlledMarks??internalMarks;
 const layers=controlledLayers??internalLayers;
 const emitMarks=(next:EditMark[])=>{if(onMarks)onMarks(next);else setInternalMarks(next)};
 const emitLayers=(next:ImageLayer[])=>{if(onLayers)onLayers(next);else setInternalLayers(next)};
 const [url,setUrl]=useState('');
 const [layerUrls,setLayerUrls]=useState<Record<string,string>>({});
 const [preview,setPreview]=useState('');
 const [error,setError]=useState('');
 const [progress,setProgress]=useState('');
 const [uploading,setUploading]=useState(false);
 const [compositing,setCompositing]=useState(false);
 const [downloading,setDownloading]=useState(false);
 const [showAssets,setShowAssets]=useState(false);
 const [dragTarget,setDragTarget]=useState<DropTarget|null>(null);
 const [pending,setPending]=useState<{primary:string;auxiliary:string[]}|null>(null);
 const [draftRect,setDraftRect]=useState<Rect|null>(null);
 const [activeMark,setActiveMark]=useState('');
 const [activeLayer,setActiveLayer]=useState('');
 const [workflow,setWorkflow]=useState<'ai'|'composite'>('ai');
 const [naturalSize,setNaturalSize]=useState<{width:number;height:number}|null>(null);
 const area=useRef<HTMLDivElement>(null);
 const stageRef=useRef<HTMLDivElement>(null);
 const [stageSize,setStageSize]=useState({width:0,height:0});
 const activeNote=useRef<HTMLTextAreaElement>(null);
 const file=useRef<HTMLInputElement>(null);
 const uploadMode=useRef<UploadMode>('primary');
 const uploadLock=useRef(false);
 const pasteButton=useRef<HTMLButtonElement>(null);
 const pastePosition=useRef({x:.5,y:.5});
 const drawing=useRef<{x:number;y:number;fromMarkId?:string}|null>(null);
 const manipulating=useRef<{id:string;mode:'move'|'resize';at:{x:number;y:number};initial:ImageLayer}|null>(null);
 const manipulatingMark=useRef<{id:string;handle:'move'|'nw'|'ne'|'sw'|'se';at:{x:number;y:number};initial:EditMark}|null>(null);
 const lastDrop=useRef<{id:string;x:number;y:number;time:number}|null>(null);
 const downloadUrls=useRef<string[]>([]);
 const pictures=assets.filter(asset=>asset.asset_type==='image'&&asset.status==='ready');
 const current=pictures.find(asset=>asset.id===selected);
 const auxiliary=unique(references.filter(id=>id!==selected));
 const limit=Math.max(1,Number.isFinite(maxReferences)?Math.floor(maxReferences):1);
 const chosen=selected?[selected,...auxiliary]:[];
 const effectiveLimit=Math.max(1,limit-(marks.length&&limit>1?1:0));
 const canAddReference=!!selected&&chosen.length<effectiveLimit;
 const referenceLimitMessage=marks.length&&limit>1?'区域标注需预留 1 张说明图；请减少参考图至 '+(effectiveLimit-1)+' 张':'当前模型最多使用 '+limit+' 张图片（含主原图）';
 const layerAssetIds=unique(layers.map(item=>item.asset_id));
 const layerSourceKey=JSON.stringify(layerAssetIds.map(id=>[id,assets.find(a=>a.id===id)?.file_url]));
 const sourceRatio=naturalSize?naturalSize.width/naturalSize.height:current?.width&&current?.height?current.width/current.height:1;
 const imageWidth=stageSize.width&&stageSize.height?Math.max(1,Math.min(stageSize.width-4,(stageSize.height-4)*sourceRatio)):undefined;

 useEffect(()=>{
  const stage=stageRef.current;
  if(!stage)return;
  const observer=new ResizeObserver(([entry])=>setStageSize({width:entry.contentRect.width,height:entry.contentRect.height}));
  observer.observe(stage);
  return()=>observer.disconnect();
 },[current?.id]);

 useEffect(()=>{
  setNaturalSize(null);
  setUrl('');
  if(!current?.file_url)return;
  const controller=new AbortController();
  let object='';
  assetBlob(current,controller.signal).then(blob=>{
   if(controller.signal.aborted)return;
   object=URL.createObjectURL(blob);setUrl(object);
  }).catch(cause=>{if(!controller.signal.aborted)setError((cause as Error).message||'原图读取失败')});
  return()=>{controller.abort();if(object)URL.revokeObjectURL(object)};
 },[current?.id,current?.file_url]);

 useEffect(()=>{
  const controller=new AbortController();
  const objects:string[]=[];
  setLayerUrls({});
  for(const id of layerAssetIds){
   const asset=assets.find(item=>item.id===id);
   if(!asset){setError('插入对象的素材已不存在：'+id);continue}
   assetBlob(asset,controller.signal).then(blob=>{
    if(controller.signal.aborted)return;
    const object=URL.createObjectURL(blob);objects.push(object);
    setLayerUrls(previous=>({...previous,[id]:object}));
   }).catch(cause=>{if(!controller.signal.aborted)setError(label(asset)+'读取失败：'+((cause as Error).message||'未知错误'))});
  }
  return()=>{controller.abort();objects.forEach(object=>URL.revokeObjectURL(object))};
 },[layerSourceKey]);

 useEffect(()=>{
  if(!pending||selected!==pending.primary)return;
  onReferences(pending.auxiliary);setPending(null);
 },[pending,selected,onReferences]);
 useEffect(()=>{
  if(!preview)return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setPreview('')};
  document.addEventListener('keydown',close);
  return()=>document.removeEventListener('keydown',close);
 },[preview]);
 useEffect(()=>()=>{downloadUrls.current.forEach(object=>URL.revokeObjectURL(object))},[]);
 useEffect(()=>{if(activeMark)activeNote.current?.focus()},[activeMark]);

 const point=(clientX:number,clientY:number)=>{
  const bounds=area.current?.getBoundingClientRect();
  if(!bounds||!bounds.width||!bounds.height)return {x:0,y:0};
  return {x:clamp((clientX-bounds.left)/bounds.width),y:clamp((clientY-bounds.top)/bounds.height)};
 };
 const clearForNewPrimary=()=>{emitMarks([]);emitLayers([]);setActiveMark('');setActiveLayer('');onRegion?.(null)};
 const selectPrimary=(id:string)=>{
  if(!pictures.some(asset=>asset.id===id)){setError('只能选择已保存的图片作为原图');return}
  if(id===selected)return;
  setError('');setProgress('');clearForNewPrimary();onSelect(id);
 };
 const addReference=(id:string)=>{
  if(!pictures.some(asset=>asset.id===id)){setError('只能使用已保存的图片作为参考图');return}
  if(!selected){selectPrimary(id);return}
  if(id===selected||auxiliary.includes(id))return;
  if(!canAddReference){setError(referenceLimitMessage);return}
  setError('');onReferences([...auxiliary,id]);
 };
 const makeLayer=(asset:Asset,x:number,y:number):ImageLayer=>{
  const baseRatio=naturalSize?naturalSize.width/naturalSize.height:current?.width&&current?.height?current.width/current.height:1;
  const objectRatio=asset.width&&asset.height?asset.height/asset.width:1;
  const width=.28;
  const height=Math.min(.8,Math.max(.04,width*objectRatio*baseRatio));
  return {id:uid(),asset_id:asset.id,x:Math.min(clamp(x-width/2),1-width),y:Math.min(clamp(y-height/2),1-height),width,height};
 };
 const addLayer=(id:string,x:number,y:number)=>{
  const asset=pictures.find(item=>item.id===id);
  if(!asset){setError('只能将已保存的图片插入画布');return}
  if(id===selected){setError('请拖入另一张图片作为插入对象');return}
  if(layers.length>=16){setError('画布最多可放置 16 个图片对象');return}
  const now=Date.now(),last=lastDrop.current;
  if(last&&last.id===id&&Math.abs(last.x-x)<.005&&Math.abs(last.y-y)<.005&&now-last.time<350)return;
  lastDrop.current={id,x,y,time:now};
  const next=makeLayer(asset,x,y);
  emitLayers([...layers,next]);setActiveLayer(next.id);setError('');setProgress('已插入画布对象；拖动定位，拖右下角调整大小。');
 };
 const openUpload=(mode:UploadMode)=>{
  if(uploadLock.current)return;
  uploadMode.current=mode;file.current?.click();
 };
 const upload=async(files:File[],mode:UploadMode,position={x:.5,y:.5})=>{
  if(!files.length||uploadLock.current)return;
  if(files.some(item=>! /\.(png|jpe?g|webp)$/i.test(item.name))){setError('请上传 PNG、JPG 或 WebP 图片');return}
  if(mode==='reference'&&selected&&!canAddReference){setError(referenceLimitMessage);return}
  if(mode==='layer'&&current&&layers.length+files.length>16){setError('画布最多可放置 16 个图片对象，请减少本次上传数量');return}
  uploadLock.current=true;setUploading(true);setError('');setProgress('准备上传 '+files.length+' 张图片…');
  const uploaded:Asset[]=[];let uploadError='';
  try{
   for(let i=0;i<files.length;i++){
    setProgress('正在上传第 '+(i+1)+' / '+files.length+' 张：'+files[i].name);
    try{
     const data=new FormData();data.append('file',files[i]);
     const result=await api('/studio/upload',data);
     const asset=result.asset||result;
     if(!asset.id||asset.asset_type!=='image'||asset.status!=='ready')throw Error('上传未返回可用的图片素材');
     uploaded.push(asset);
    }catch(cause){uploadError='第 '+(i+1)+' 张上传失败：'+((cause as Error).message||'未知错误');break}
   }
   if(uploaded.length){
    await onUploaded();
    if(mode==='layer'&&current){
     const xDirection=position.x>.6?-1:1;
     const yDirection=position.y>.6?-1:1;
     const additions=uploaded.map((asset,index)=>makeLayer(asset,clamp(position.x+xDirection*.07*(index%4)),clamp(position.y+yDirection*.07*Math.floor(index/4))));
     emitLayers([...layers,...additions]);setActiveLayer(additions.at(-1)!.id);
     setProgress('已在画布上添加 '+additions.length+' 个图片对象；可拖动定位并调整大小。');
    }else{
    const ids=uploaded.map(asset=>asset.id);
    const primary=mode==='primary'||!selected?ids[0]:selected;
    const additions=mode==='primary'||!selected?ids.slice(1):ids;
    const oldAuxiliary=mode==='primary'?auxiliary.filter(id=>id!==primary):auxiliary;
    const requested=unique([...(mode==='primary'?additions:oldAuxiliary),...(mode==='primary'?oldAuxiliary:additions)].filter(id=>id!==primary));
    const nextAuxiliary=requested.slice(0,effectiveLimit-1);
    const skipped=ids.filter(id=>id!==primary&&!nextAuxiliary.includes(id)).length;
    if(primary!==selected){clearForNewPrimary();onSelect(primary);setPending({primary,auxiliary:nextAuxiliary})}
    else onReferences(nextAuxiliary);
    setProgress('已保存 '+uploaded.length+' 张图片'+(skipped?'；'+skipped+' 张超过当前模型上限，已留在素材栏':'，已加入编辑区'));
    }
   }
   if(uploadError){if(!uploaded.length)setProgress('');setError(uploadError)}
  }catch(cause){setProgress('');setError('图片已上传，但素材列表刷新失败：'+((cause as Error).message||'未知错误'))}
  finally{uploadLock.current=false;setUploading(false);if(file.current)file.current.value=''}
 };
 const pasteMode=():UploadMode=>!selected?'primary':'layer';
 const paste=(event:ClipboardEvent<HTMLElement>)=>{
  if(uploadLock.current)return;
  const files=pastedImages(event.clipboardData);
  if(!files.length)return;
  event.preventDefault();
  void upload(files,pasteMode(),pastePosition.current);
 };
 const pasteFromButton=async()=>{
  pasteButton.current?.focus();
  if(uploadLock.current)return;
  try{await upload(await readClipboardImages(),pasteMode(),pastePosition.current)}
  catch(cause){setError((cause as Error).message?.startsWith('剪贴板')?(cause as Error).message:'无法直接读取剪贴板图片；请先复制截图，再聚焦“粘贴截图”按钮并按 Ctrl+V')}
 };
 const drop=(event:DragEvent<HTMLElement>,target:'primary'|'reference'|'stage')=>{
  event.preventDefault();event.stopPropagation();setDragTarget(null);
  if(uploadLock.current)return;
  const id=event.dataTransfer.getData('application/x-tijian-asset');
  if(id){
   if(target==='reference')addReference(id);
   else if(target==='stage'&&current){{const p=point(event.clientX,event.clientY);addLayer(id,p.x,p.y)}}
   else selectPrimary(id);
   return;
  }
  const files=Array.from(event.dataTransfer.files);
  if(files.length){
   const mode=target==='stage'&&current?'layer':target==='reference'?'reference':'primary';
   const position=mode==='layer'&&area.current?point(event.clientX,event.clientY):{x:.5,y:.5};
   void upload(files,mode,position);
  }
  else setError('请拖入本地图片，或拖入素材栏中的图片卡片');
 };
 const dragOver=(event:DragEvent<HTMLElement>,target:DropTarget)=>{
  event.preventDefault();event.dataTransfer.dropEffect='copy';
  if(target==='layer')setDragTarget('layer');
  else setDragTarget(target);
 };
 const leave=(event:DragEvent<HTMLElement>)=>{
  if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragTarget(null);
 };
 const beginMark=(event:PointerEvent<HTMLElement>)=>{
  if(event.button!==0)return;
  event.preventDefault();
  drawing.current={...point(event.clientX,event.clientY)};
  setDraftRect({x:drawing.current.x,y:drawing.current.y,width:0,height:0});
  event.currentTarget.setPointerCapture(event.pointerId);
 };
 const moveMark=(event:PointerEvent<HTMLElement>)=>{
  if(!drawing.current)return;
  const next=normalizedRect(drawing.current,point(event.clientX,event.clientY));
  setDraftRect(next);
  onRegion?.({x:next.x*100,y:next.y*100,width:next.width*100,height:next.height*100});
 };
 const endMark=(event:PointerEvent<HTMLElement>)=>{
  if(!drawing.current)return;
  const rect=normalizedRect(drawing.current,point(event.clientX,event.clientY));
  drawing.current=null;setDraftRect(null);
  if(rect.width<.01||rect.height<.01){onRegion?.(null);return}
  if(marks.length>=12){setError('最多可标记 12 处修改区域');onRegion?.(null);return}
  const mark:EditMark={id:uid(),...rect,instruction:''};
  emitMarks([...marks,mark]);setActiveMark(mark.id);
  onRegion?.({x:rect.x*100,y:rect.y*100,width:rect.width*100,height:rect.height*100});
 };
 const addDefaultMark=()=>{
  if(!current)return;
  if(marks.length>=12){setError('最多可标记 12 处修改区域');return}
  const offset=(marks.length%6)*.05;
  const mark:EditMark={id:uid(),x:.12+offset,y:.14+offset,width:.28,height:.22,instruction:''};
  emitMarks([...marks,mark]);setActiveMark(mark.id);setError('');
 };
 const beginLayer=(event:PointerEvent<HTMLDivElement>,item:ImageLayer,mode:'move'|'resize')=>{
  if(event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  manipulating.current={id:item.id,mode,at:point(event.clientX,event.clientY),initial:item};
  setActiveLayer(item.id);event.currentTarget.setPointerCapture(event.pointerId);
 };
 const moveLayer=(event:PointerEvent<HTMLDivElement>)=>{
  const action=manipulating.current;
  if(!action)return;
  const p=point(event.clientX,event.clientY),dx=p.x-action.at.x,dy=p.y-action.at.y;
  const initial=action.initial;
  const next=action.mode==='move'
   ?{...initial,x:Math.max(0,Math.min(1-initial.width,initial.x+dx)),y:Math.max(0,Math.min(1-initial.height,initial.y+dy))}
   :{...initial,width:Math.max(.02,Math.min(1-initial.x,initial.width+dx)),height:Math.max(.02,Math.min(1-initial.y,initial.height+dy))};
  emitLayers(layers.map(item=>item.id===action.id?next:item));
 };
 const endLayer=()=>{manipulating.current=null};
 const updateLayer=(id:string,patch:Partial<ImageLayer>)=>{
  emitLayers(layers.map(item=>{
   if(item.id!==id)return item;
   const width=Math.max(.02,Math.min(1,patch.width??item.width));
   const height=Math.max(.02,Math.min(1,patch.height??item.height));
   const x=Math.max(0,Math.min(1-width,patch.x??item.x));
   const y=Math.max(0,Math.min(1-height,patch.y??item.y));
   return {...item,x,y,width,height};
  }));
 };
 const updateMark=(id:string,patch:Partial<EditMark>)=>{
  emitMarks(marks.map(item=>{
   if(item.id!==id)return item;
   const width=Math.max(.01,Math.min(1,patch.width??item.width));
   const height=Math.max(.01,Math.min(1,patch.height??item.height));
   const x=Math.max(0,Math.min(1-width,patch.x??item.x));
   const y=Math.max(0,Math.min(1-height,patch.y??item.y));
   return {...item,x,y,width,height};
  }));
 };
 const beginManipulateMark=(event:PointerEvent<HTMLElement>,item:EditMark,handle:'move'|'nw'|'ne'|'sw'|'se')=>{
  if(event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  manipulatingMark.current={id:item.id,handle,at:point(event.clientX,event.clientY),initial:item};
  setActiveMark(item.id);event.currentTarget.setPointerCapture(event.pointerId);
 };
 const moveManipulateMark=(event:PointerEvent<HTMLElement>)=>{
  const action=manipulatingMark.current;
  if(!action)return;
  event.preventDefault();event.stopPropagation();
  const p=point(event.clientX,event.clientY),dx=p.x-action.at.x,dy=p.y-action.at.y;
  const base=action.initial;
  let x=base.x,y=base.y,right=base.x+base.width,bottom=base.y+base.height;
  if(action.handle==='move'){
   x=Math.max(0,Math.min(1-base.width,base.x+dx));y=Math.max(0,Math.min(1-base.height,base.y+dy));
   right=x+base.width;bottom=y+base.height;
  }else{
   if(action.handle.includes('w'))x=Math.max(0,Math.min(right-.01,base.x+dx));
   else right=Math.max(x+.01,Math.min(1,right+dx));
   if(action.handle.includes('n'))y=Math.max(0,Math.min(bottom-.01,base.y+dy));
   else bottom=Math.max(y+.01,Math.min(1,bottom+dy));
  }
  emitMarks(marks.map(item=>item.id===action.id?{...item,x,y,width:right-x,height:bottom-y}:item));
 };
 const endManipulateMark=()=>{manipulatingMark.current=null};
 const saveComposite=async()=>{
  if(!current||compositing||!layers.length)return;
  setCompositing(true);setError('');setProgress('正在按原图尺寸合成…');
  const opened:ImageBitmap[]=[];
  try{
   const base=await bitmapOf(current);opened.push(base);
   const canvas=document.createElement('canvas');
   canvas.width=base.width;canvas.height=base.height;
   const ctx=canvas.getContext('2d');
   if(!ctx)throw Error('当前环境无法创建图片画布');
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   ctx.drawImage(base,0,0,canvas.width,canvas.height);
   for(const item of layers){
    const asset=pictures.find(candidate=>candidate.id===item.asset_id);
    if(!asset)throw Error('插入对象的素材已不存在：'+item.asset_id);
    const image=await bitmapOf(asset);opened.push(image);
    ctx.drawImage(image,item.x*canvas.width,item.y*canvas.height,item.width*canvas.width,item.height*canvas.height);
   }
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('合成图编码失败')),'image/png'));
   if(onComposite){
    const applied=await onComposite(blob,selected,layers);
    setProgress(applied?'合成图已保存。':'合成图已存入素材库；画布期间发生变化，当前编辑已保留。');
   }else{
    const object=URL.createObjectURL(blob);downloadUrls.current.push(object);
    const anchor=document.createElement('a');anchor.href=object;anchor.download='图片合成-'+Date.now()+'.png';anchor.click();
    window.setTimeout(()=>{URL.revokeObjectURL(object);downloadUrls.current=downloadUrls.current.filter(item=>item!==object)},1500);
    setProgress('合成图已下载到本机。');
   }
  }catch(cause){setProgress('');setError('合成失败：'+((cause as Error).message||'未知错误')+'。请检查图片地址、鉴权或跨域访问。')}
  finally{opened.forEach(image=>image.close());setCompositing(false)}
 };
 const previewAsset=assets.find(asset=>asset.id===preview)||resultAssets.find(asset=>asset.id===preview);
 const legacyRegion=!marks.length&&region?{x:region.x/100,y:region.y/100,width:region.width/100,height:region.height/100}:null;
 const selectedMark=marks.find(item=>item.id===activeMark)||marks.at(-1);
 const downloadAsset=async(asset:Asset|undefined)=>{
  if(!asset||downloading)return;
  setDownloading(true);setError('');
  try{
   const blob=await assetBlob(asset),object=URL.createObjectURL(blob);downloadUrls.current.push(object);
   const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type]||'png';
   const name=(asset.title||'图片作品').replace(/[\\/:*?"<>|]/g,'-').replace(/\.(png|jpe?g|webp|gif)$/i,'');
   const anchor=document.createElement('a');anchor.href=object;anchor.download=name+'.'+extension;anchor.click();
   window.setTimeout(()=>{URL.revokeObjectURL(object);downloadUrls.current=downloadUrls.current.filter(item=>item!==object)},30000);
  }catch(cause){setError('下载失败：'+((cause as Error).message||'请重试'))}
  finally{setDownloading(false)}
 };

  return <section className="ie-workspace" aria-label="图片编辑工作区">
   <header className="ie-heading"><div><span>图片编辑 / 原图工作区</span><h2>{workflow==='ai'?'标注区域，AI 重新生成':'摆放素材，保存合成图'}</h2><p>{workflow==='ai'?'在原图上框选、拖动和缩放区域；每处备注会显示在画面上，提交后生成一张新图。':'把图片对象拖到画面指定位置，调整大小后按原图尺寸合成，不调用 AI。'}</p></div><div className="ie-heading-actions"><nav className="ie-workflow-tabs" aria-label="选择图片编辑方式"><button type="button" aria-pressed={workflow==='ai'} onClick={()=>setWorkflow('ai')}>标注后 AI 重绘</button><button type="button" aria-pressed={workflow==='composite'} onClick={()=>setWorkflow('composite')}>图片叠加合成</button></nav></div></header>
   <div className="ie-canvas-toolbar"><div className="ie-current"><strong>当前原图</strong><span title={current&&label(current)}>{current?label(current):'尚未选择'}</span></div><div className="ie-toolbar-actions"><button type="button" disabled={uploading} onClick={()=>openUpload('primary')}><Upload size={14}/>{current?'更换原图':'上传原图'}</button><button ref={pasteButton} type="button" className="ie-paste-button" disabled={uploading} onClick={()=>void pasteFromButton()} onPaste={paste} title={!current?'复制截图后点击，作为原图':'复制截图后点击，作为可移动的图片对象'}><ClipboardPaste size={14}/>粘贴截图</button><button type="button" disabled={uploading||!current} onClick={()=>openUpload('layer')} title="放入画布，在两种模式中都可使用"><ImageIcon size={14}/>添加图片对象</button>{workflow==='ai'&&limit>1&&<button type="button" disabled={uploading||!canAddReference} onClick={()=>openUpload('reference')}>添加参考图</button>}{workflow==='ai'&&<button type="button" disabled={!marks.length} onClick={()=>{emitMarks([]);setActiveMark('');onRegion?.(null)}}><Trash2 size={14}/>清空标注</button>}<button type="button" aria-expanded={showAssets} onClick={()=>setShowAssets(value=>!value)}>图片素材</button><button type="button" disabled={!current} onClick={()=>setPreview(selected)}><Expand size={14}/>预览</button></div></div>
   {current?<div ref={stageRef} tabIndex={0} className={'ie-stage'+(dragTarget?' is-dragging':'')} onPointerDownCapture={event=>{pastePosition.current=area.current?point(event.clientX,event.clientY):{x:.5,y:.5};stageRef.current?.focus()}} onPaste={paste} onDragOver={event=>dragOver(event,'layer')} onDragLeave={leave} onDrop={event=>drop(event,'stage')} aria-label="原图画布，可拖入图片作为可见画布对象">
   <div className="ie-canvas-image" style={imageWidth?{width:imageWidth}:undefined}>{url?<><img src={url} alt={label(current)} draggable={false} onLoad={event=>setNaturalSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError('原图无法显示，请检查图片文件')}/>
    <div ref={area} className="ie-overlay">
      {workflow==='ai'&&<><div className="ie-hit" role="img" aria-label="拖动框选要修改的画面区域" onPointerDown={beginMark} onPointerMove={moveMark} onPointerUp={endMark} onPointerCancel={()=>{drawing.current=null;setDraftRect(null)}}/>
      {marks.map((item,index)=><div key={item.id} aria-label={'编辑区域 '+(index+1)+'，可拖动和拉角缩放'} className={'ie-mark'+(selectedMark?.id===item.id?' is-active':'')} style={{left:item.x*100+'%',top:item.y*100+'%',width:item.width*100+'%',height:item.height*100+'%'}} onPointerDown={event=>beginManipulateMark(event,item,'move')} onPointerMove={moveManipulateMark} onPointerUp={endManipulateMark} onPointerCancel={endManipulateMark}>
       <b>{index+1}</b>{item.instruction.trim()&&<span className="ie-mark-caption" title={item.instruction}>{item.instruction}</span>}
       {(['nw','ne','sw','se'] as const).map(handle=><span key={handle} className={'ie-mark-handle ie-mark-handle-'+handle} role="button" tabIndex={0} aria-label={'调整区域 '+(index+1)+' 的'+({nw:'左上',ne:'右上',sw:'左下',se:'右下'} as Record<string,string>)[handle]+'角'} onPointerDown={event=>beginManipulateMark(event,item,handle)} onPointerMove={moveManipulateMark} onPointerUp={endManipulateMark} onPointerCancel={endManipulateMark} onKeyDown={event=>{const step=event.shiftKey?.03:.01;if(event.key==='ArrowLeft')updateMark(item.id,{width:item.width-step});else if(event.key==='ArrowRight')updateMark(item.id,{width:item.width+step});else if(event.key==='ArrowUp')updateMark(item.id,{height:item.height-step});else if(event.key==='ArrowDown')updateMark(item.id,{height:item.height+step});else return;event.preventDefault();event.stopPropagation()}}/>)}
      </div>)}
      {(draftRect||legacyRegion)&&<span className="ie-selection" style={{left:((draftRect||legacyRegion)!.x*100)+'%',top:((draftRect||legacyRegion)!.y*100)+'%',width:((draftRect||legacyRegion)!.width*100)+'%',height:((draftRect||legacyRegion)!.height*100)+'%'}}/>}</>}
      {layers.map((item,index)=><div key={item.id} className={'ie-layer'+(activeLayer===item.id?' is-active':'')} style={{left:item.x*100+'%',top:item.y*100+'%',width:item.width*100+'%',height:item.height*100+'%'}} onPointerDown={event=>beginLayer(event,item,'move')} onPointerMove={moveLayer} onPointerUp={endLayer} onPointerCancel={endLayer} aria-label={'插入对象 '+(index+1)+'，拖动调整位置'}>
      {layerUrls[item.asset_id]?<img src={layerUrls[item.asset_id]} alt={label(pictures.find(asset=>asset.id===item.asset_id))} draggable={false}/>:<span className="ie-layer-loading">加载中</span>}
      <span className="ie-layer-index">{index+1}</span><div className="ie-layer-resize" role="button" tabIndex={0} aria-label={'调整插入对象 '+(index+1)+' 大小'} onPointerDown={event=>beginLayer(event,item,'resize')} onKeyDown={event=>{const step=event.shiftKey?.05:.01;if(event.key==='ArrowRight')updateLayer(item.id,{width:item.width+step});else if(event.key==='ArrowLeft')updateLayer(item.id,{width:item.width-step});else if(event.key==='ArrowDown')updateLayer(item.id,{height:item.height+step});else if(event.key==='ArrowUp')updateLayer(item.id,{height:item.height-step});else return;event.preventDefault();event.stopPropagation()}}/>
     </div>)}
    </div></>:<span className="ie-loading">{error||'正在打开原图…'}</span>}</div>
    {dragTarget&&<span className="ie-drop-label">松开后在此处插入可见图片对象，不会替换原图</span>}
   </div>:<div className={'ie-empty'+(dragTarget?' is-dragging':'')} tabIndex={0} onPaste={paste} onDragOver={event=>dragOver(event,'primary')} onDragLeave={leave} onDrop={event=>drop(event,'primary')}><ImageIcon size={31}/><strong>先选一张要修改的原图</strong><span>上传、拖入图片，或点击“粘贴截图”；也可点此处后按 Ctrl+V。</span></div>}
  {!!resultAssets.length&&<section className="ie-latest-result"><header><strong>最近修改结果</strong><small>{resultStatus||'已生成'} · {resultAssets.length} 张</small></header><div className="ie-result-rail" aria-label="最近修改图片，可横向滚动">{resultAssets.map((asset,index)=><article className="ie-result-card" key={asset.id}><button type="button" className="ie-result-preview" onClick={()=>setPreview(asset.id)} aria-label={'预览修改结果 '+(index+1)}><AssetThumbnail asset={asset}/></button><div className="ie-result-actions"><button type="button" disabled={downloading} onClick={()=>void downloadAsset(asset)}><Download size={14}/>下载</button>{onUseResult&&<button type="button" onClick={()=>onUseResult(asset.id)}>作为原图编辑</button>}</div></article>)}</div></section>}
  <div className="ie-bottom">
   <input ref={file} type="file" accept="image/*" multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);void upload(files,uploadMode.current);event.target.value=''}}/>
    <p className="ie-instruction"><MousePointer2 size={15}/>{workflow==='ai'?'空白处拖动新建标注；拖动标注框可移动，拉四角可缩放；图上的备注只作为 AI 修改指引。':'把图片拖进画面并调整位置和尺寸；保存时按画面原样合成。'}</p>
    <div className="ie-edit-grid">
      {workflow==='ai'&&<><section className="ie-edit-panel ie-overall"><header><strong>整图共同要求（可选）</strong><small>与下方区域标注一同提交</small></header><textarea aria-label="整图共同要求" placeholder="例如：保持原有角色和构图；只调整标注位置。" maxLength={1500} value={prompt} onChange={event=>onPrompt?.(event.target.value)}/></section>
      <section className="ie-edit-panel">
      <header><strong>修改区域</strong><button type="button" disabled={!current||marks.length>=12} onClick={addDefaultMark}>+ 添加区域</button></header>
     {marks.length?<><div className="ie-mark-tabs">{marks.map((item,index)=><button type="button" key={item.id} className={selectedMark?.id===item.id?'is-active':''} aria-pressed={selectedMark?.id===item.id} onClick={()=>setActiveMark(item.id)}>区域 {index+1}{item.instruction.trim()?' ✓':''}</button>)}</div><div className="ie-mark-list">{marks.filter(item=>item.id===selectedMark?.id).map(item=>{const index=marks.indexOf(item);return <article key={item.id} className="is-active">
      <div><b>区域 {index+1}</b><small>{percent(item.x)}%, {percent(item.y)}% · {percent(item.width)}% × {percent(item.height)}%</small><button type="button" title="删除区域" aria-label={'删除区域 '+(index+1)} onClick={event=>{event.stopPropagation();emitMarks(marks.filter(mark=>mark.id!==item.id));if(activeMark===item.id)setActiveMark('');onRegion?.(null)}}><Trash2 size={14}/></button></div>
      <details className="ie-coordinates"><summary>精确调整选区</summary><div className="ie-layer-fields"><label>左 <input aria-label={'区域 '+(index+1)+' 左边距'} type="number" min="0" max="100" value={percent(item.x)} onChange={event=>updateMark(item.id,{x:Number(event.target.value)/100})}/>%</label><label>上 <input aria-label={'区域 '+(index+1)+' 上边距'} type="number" min="0" max="100" value={percent(item.y)} onChange={event=>updateMark(item.id,{y:Number(event.target.value)/100})}/>%</label><label>宽 <input aria-label={'区域 '+(index+1)+' 宽度'} type="number" min="1" max="100" value={percent(item.width)} onChange={event=>updateMark(item.id,{width:Number(event.target.value)/100})}/>%</label><label>高 <input aria-label={'区域 '+(index+1)+' 高度'} type="number" min="1" max="100" value={percent(item.height)} onChange={event=>updateMark(item.id,{height:Number(event.target.value)/100})}/>%</label></div></details>
      <textarea ref={activeNote} aria-label={'区域 '+(index+1)+' 的修改说明'} placeholder="例如：把此处的门改为深灰色…" maxLength={300} value={item.instruction} onChange={event=>emitMarks(marks.map(mark=>mark.id===item.id?{...mark,instruction:event.target.value}:mark))}/>
     </article>})}</div></>:<p>在原图上拖动框选。可以反复添加多个区域，每处单独写要求。</p>}
     </section></>}
     {<section className="ie-edit-panel"><header><strong>画布对象</strong><small>{layers.length} 个 · 上传或拖入</small></header>{layers.length?<div className="ie-layer-list">{layers.map((item,index)=><article key={item.id} className={activeLayer===item.id?'is-active':''} onClick={()=>setActiveLayer(item.id)}><div><b><Move size={13}/>对象 {index+1}</b><small title={label(pictures.find(asset=>asset.id===item.asset_id))}>{label(pictures.find(asset=>asset.id===item.asset_id))}</small><button type="button" title="删除对象" aria-label={'删除插入对象 '+(index+1)} onClick={event=>{event.stopPropagation();emitLayers(layers.filter(layer=>layer.id!==item.id));if(activeLayer===item.id)setActiveLayer('')}}><Trash2 size={14}/></button></div><div className="ie-layer-fields"><label>左 <input type="number" min="0" max="100" value={percent(item.x)} onChange={event=>updateLayer(item.id,{x:Number(event.target.value)/100})}/>%</label><label>上 <input type="number" min="0" max="100" value={percent(item.y)} onChange={event=>updateLayer(item.id,{y:Number(event.target.value)/100})}/>%</label><label>宽 <input type="number" min="2" max="100" value={percent(item.width)} onChange={event=>updateLayer(item.id,{width:Number(event.target.value)/100})}/>%</label><label>高 <input type="number" min="2" max="100" value={percent(item.height)} onChange={event=>updateLayer(item.id,{height:Number(event.target.value)/100})}/>%</label></div></article>)}</div>:<p>点击“添加图片对象”，或将本地图片、素材图片拖到原图上的具体位置；对象可移动、可调整大小。</p>}<small className="ie-composite-note">{workflow==='ai'?'图片对象会随原图一同交给 AI 重绘；对象位置与外观可能由模型调整。':'图片对象会按当前位置原样叠加，保存时不调用 AI。'}</small></section>}
   </div>
     {workflow==='ai'&&<details className="ie-reference-details"><summary>原图与 AI 参考图 <small>{chosen.length} / {effectiveLimit}</small></summary><div className="ie-selected-heading"><strong>已选图片</strong><small>参考图只供 AI 理解风格或细节，不会原样叠加</small></div>
   <div className="ie-selected" aria-label="已选图片">{chosen.length?chosen.map((id,index)=>{const asset=assets.find(item=>item.id===id);return <div className={'ie-selected-card'+(index===0?' is-primary':'')} key={id}><button type="button" className="ie-selected-preview" onClick={()=>setPreview(id)} aria-label={'预览'+label(asset)} title="放大预览">{asset?<AssetThumbnail asset={asset}/>:<ImageIcon size={22}/>}<span><Expand size={13}/></span></button><div className="ie-selected-caption"><b>{index===0?'主原图':'参考 '+index}</b><small title={asset?.title||id}>{label(asset)}</small></div>{index>0&&<button type="button" className="ie-remove" onClick={()=>onReferences(auxiliary.filter(item=>item!==id))} aria-label={'移除参考图 '+label(asset)} title="移除参考图"><X size={15}/></button>}</div>}):<p>尚未选择图片。上传后第一张会作为主原图。</p>}</div>
   <div className="ie-reference-head"><div><strong>辅助参考图</strong><small>{limit>1?'提供风格、主体或细节参考':'当前模型只支持一张原图'}</small></div>{limit>1&&<button type="button" disabled={uploading||!canAddReference} onClick={()=>openUpload('reference')}><Upload size={14}/>上传参考图</button>}</div>
    {limit>1&&<div className={'ie-reference-drop'+(dragTarget==='reference'?' is-dragging':'')} onDragOver={event=>dragOver(event,'reference')} onDragLeave={leave} onDrop={event=>drop(event,'reference')}><span>{selected?'从电脑或下方素材栏拖入图片，添加到辅助参考':'请先选择主原图；此处拖入的第一张会成为主原图'}</span><small>{Math.max(0,effectiveLimit-chosen.length)} 个可用位置</small></div>}
     </details>}
    {worksHref&&<a className="ie-works-link" href={worksHref}>查看全部作品与素材 ↗</a>}
   {chosen.length>effectiveLimit&&<p role="alert" className="ie-error">{referenceLimitMessage}。请移除多余参考图。</p>}{progress&&<p className="ie-progress" role="status">{progress}</p>}{error&&<p role="alert" className="ie-error">{error}</p>}
    </div>
    <div className="ie-submit-bar">{workflow==='ai'?<><button type="button" className="ie-submit-ai" disabled={!current||!canGenerate||generating||chosen.length>effectiveLimit||marks.some(mark=>!mark.instruction.trim())} onClick={onGenerate}><Sparkles size={16}/>{generating?'任务处理中…':`按标注生成新图${marks.length?'（'+marks.length+' 处）':''}`}</button><small>{!marks.length&&!prompt.trim()&&!layers.length?'先框选并填写备注、添加图片对象，或写整图要求。':'图片对象和标注会一起提交 AI；结果在此页显示，原图保留。'}</small></>:<><button type="button" className="ie-submit-composite" disabled={!current||!layers.length||compositing||!url||layerAssetIds.some(id=>!layerUrls[id])} onClick={()=>void saveComposite()}><Save size={16}/>{compositing?'合成中…':'保存合成新图'}</button><small>按原图分辨率叠加可见对象，无需 AI 模型。</small></>}{generationStatus&&<p role="status">{generationStatus}</p>}{generationError&&<p role="alert">{generationError}</p>}</div>
   {showAssets&&<aside className="ie-asset-drawer" aria-label="图片素材库"><header><div><strong>图片素材</strong><small>{pictures.length} 张 · 拖到画面可放置对象</small></div><button type="button" onClick={()=>setShowAssets(false)} aria-label="关闭图片素材"><X size={16}/></button></header><div className="ie-source-list" aria-label="选择原图、插入对象或参考图">{pictures.map(asset=><article key={asset.id} className={selected===asset.id?'active':''} draggable={!uploading} onDragStart={event=>{event.dataTransfer.setData('application/x-tijian-asset',asset.id);event.dataTransfer.effectAllowed='copy'}} onDragEnd={()=>setDragTarget(null)}><button type="button" className="ie-source-preview" onClick={()=>setPreview(asset.id)} aria-label={'预览'+label(asset)}><AssetThumbnail asset={asset}/></button><small title={asset.title}>{label(asset)}</small><div><button type="button" onClick={()=>{selectPrimary(asset.id);setShowAssets(false)}} aria-pressed={selected===asset.id}>{selected===asset.id?'当前原图':'设为原图'}</button>{limit>1&&asset.id!==selected&&<button type="button" disabled={auxiliary.includes(asset.id)||!canAddReference} onClick={()=>addReference(asset.id)}>{auxiliary.includes(asset.id)?'已作参考':'加参考'}</button>}</div></article>)}{!pictures.length&&<span>素材栏暂时没有图片，请先上传或生成一张。</span>}</div></aside>}
  {preview&&previewAsset&&<div className="ie-lightbox" role="dialog" aria-modal="true" aria-label={'预览'+label(previewAsset)} onClick={()=>setPreview('')}><button type="button" className="ie-lightbox-close" onClick={()=>setPreview('')}>关闭 ×</button><div className="ie-lightbox-image" onClick={event=>event.stopPropagation()}><AssetThumbnail asset={previewAsset}/><span>{label(previewAsset)} · {preview===selected?'主原图':'图片素材'}</span></div></div>}
 </section>;
}
