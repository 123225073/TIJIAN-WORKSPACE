import VideoPlayer from './VideoPlayer';
import {useEffect, useRef, useState, type ClipboardEvent, type DragEvent} from 'react';
import {AudioLines, ClipboardPaste, Film, Image as ImageIcon, LoaderCircle, UploadCloud, X} from 'lucide-react';
import {api,getToken} from './api';
import {AssetThumbnail} from './AssetPicker';
import {pastedImages,readClipboardImages} from './image-clipboard';
import './media-references.css';

type Kind = 'image' | 'video' | 'audio';
type Asset = {id:string; asset_type:string; status:string; title?:string; name?:string; file_url?:string};

function ReferencePlayer({asset,kind}:{asset:Asset;kind:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();let blob='',active=true;setUrl('');setError('');if(!asset.file_url)return;
  fetch(asset.file_url,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('无法读取参考文件');blob=URL.createObjectURL(await r.blob());if(active)setUrl(blob)}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message)});
  return()=>{active=false;controller.abort();if(blob)URL.revokeObjectURL(blob)};
 },[asset.id,asset.file_url]);
 return error?<small>{error}</small>:!url?<small>正在读取预览…</small>:kind==='video'?<VideoPlayer controls preload="metadata" src={url}/>:<audio controls preload="metadata" src={url}/>;
}

const kinds = [
 {kind:'image', label:'参考图片', icon:ImageIcon, accept:'image/*'},
 {kind:'video', label:'参考视频', icon:Film, accept:'video/*'},
 {kind:'audio', label:'参考音频', icon:AudioLines, accept:'audio/*'},
] as const;

export default function MediaReferences({draft, model, assets, update, reload, busy}:{
 draft:any;
 model:any;
 assets:Asset[];
 update:(values:any)=>void;
 reload:(added?:Asset[])=>Promise<void>;
 busy:boolean;
}) {
 const [error,setError]=useState('');
 const [uploading,setUploading]=useState(false);
 const [progress,setProgress]=useState('');
 const [dragging,setDragging]=useState<Kind|null>(null);
 const [remoteKind,setRemoteKind]=useState<Kind>('image'),[remoteUrl,setRemoteUrl]=useState('');
 const input=useRef<HTMLInputElement>(null);
 const pasteButton=useRef<HTMLButtonElement>(null);
 const uploadLock=useRef(false);
 const uploadKind=useRef<Kind>('image');
 const latest=useRef({draft,model,update});
 latest.current={draft,model,update};
 const limits:Partial<Record<Kind,number>>=model?.reference_limits||{};
 const ark=model?.provider==='ark',remote=draft.inputs.remote_references||[];
 const remoteCount=(kind:Kind)=>(remote as any[]).filter(r=>r.kind===kind).length;
 const addRemote=()=>{const value=remoteUrl.trim();if(!/^https:\/\/[^\s]+$/.test(value)&&!/^asset:\/\/[A-Za-z0-9_-]+$/.test(value)){setError('请输入公开HTTPS地址或官方asset://素材ID');return}if(selected(remoteKind).length+remoteCount(remoteKind)>=(limits[remoteKind]||0)){setError('已达到当前模型参考素材上限');return}update({remote_references:[...remote,{kind:remoteKind,url:value,title:value.startsWith('asset:')?'方舟素材 '+value.slice(8):'外部'+kinds.find(k=>k.kind===remoteKind)?.label}]});setRemoteUrl('');setError('')};

 const selected=(kind:Kind,current=draft):string[]=>{
  const ids=current.inputs[kind+'_ids'];
  if(Array.isArray(ids)&&ids.length)return ids;
  return kind==='image'&&current.inputs.image_id?[current.inputs.image_id]:[];
 };
 const change=(kind:Kind,ids:string[])=>latest.current.update({
  [kind+'_ids']:ids,
  ...(kind==='image'&&['image_video','image_edit','text_image'].includes(latest.current.draft.tool)?{image_id:ids[0]||''}:{}),
 });
 const add=(kind:Kind,id:string)=>{
  const ids=selected(kind);
  if(!id||ids.includes(id))return;
  const asset=assets.find(a=>a.id===id);
  if(asset?.asset_type!==kind||asset.status!=='ready'){
   setError('请把'+kinds.find(x=>x.kind===kind)?.label+'拖入对应的输入框');
   return;
  }
  if(ids.length+remoteCount(kind)>=(limits[kind]||0)){
   setError('已达到当前模型的参考素材上限');
   return;
  }
  change(kind,[...ids,id]);
  setError('');
 };
 const upload=async(files:File[],kind:Kind)=>{
  if(!files.length||uploadLock.current)return;
  uploadLock.current=true;
  const startedWithModel=draft.model_id;
  setUploading(true);
  setError('');
  const uploaded:string[]=[],uploadedAssets:Asset[]=[];
  const attach=async()=>{
   if(!uploaded.length)return;
   // Render the returned files immediately; a slow library refresh must not
   // hold the selected references or keep the upload controls locked.
   void reload(uploadedAssets).catch(()=>{});
   const {draft:current,model:currentModel}=latest.current;
   if(current.model_id!==startedWithModel){
    setProgress('上传完成，文件已保存在素材库');
    setError('上传期间切换了模型，文件未自动加入参考素材。请在当前模型下重新选择。');
    return;
   }
   const ids=selected(kind,current);
   const remaining=(currentModel?.reference_limits?.[kind]??0)-ids.length-(current.inputs.remote_references||[]).filter((r:any)=>r.kind===kind).length;
   if(uploaded.length>remaining){
    setProgress('上传完成，文件已保存在素材库');
    setError(`当前模型最多允许 ${currentModel?.reference_limits?.[kind]??0} 个参考素材，已上传文件未加入参考素材。请先移除多余素材或切换模型。`);
    return;
   }
   change(kind,[...ids,...uploaded]);
   setProgress(uploadedAssets.map((a:any)=>a.image_adjustment?.message).filter(Boolean).join(' ')||'上传完成，可继续添加或移除');
  };
  try{
   if(selected(kind).length+remoteCount(kind)+files.length>(limits[kind]||0))throw Error(`本次选择 ${files.length} 个文件，超过当前模型允许的 ${limits[kind]} 个参考素材上限`);
   if(files.some(file=>!file.type.startsWith(kind+'/')&&!(kind==='image'&&/\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(file.name))))throw Error('请把'+kinds.find(x=>x.kind===kind)?.label+'文件放入对应输入框');
   for(let i=0;i<files.length;i++){
    setProgress(`正在上传第 ${i+1} / ${files.length} 个：${files[i].name}`);
    const data=new FormData();
    data.append('file',files[i]);
    const result=await api('/studio/upload',data);
    const asset=result.asset||result;
    if(!asset.id)throw Error('素材上传未返回编号');
    uploaded.push(asset.id);
    uploadedAssets.push(asset);
   }
   await attach();
  }catch(e){
   setError((e as Error).message);
   if(uploaded.length)await attach().catch(()=>{});
  }finally{
   uploadLock.current=false;
   setUploading(false);
   if(input.current)input.current.value='';
  }
 };
 const openUpload=(kind:Kind)=>{
  uploadKind.current=kind;
  if(!input.current)return;
  input.current.accept=kinds.find(x=>x.kind===kind)?.accept||'';
  input.current.click();
 };
 const drop=(event:DragEvent<HTMLButtonElement>,kind:Kind)=>{
  event.preventDefault();
  setDragging(null);
  if(busy||uploading)return;
  const id=event.dataTransfer.getData('application/x-tijian-asset');
  if(id){add(kind,id);return}
  const files=Array.from(event.dataTransfer.files);
  if(files.length)void upload(files,kind);
  else setError('请拖入本地文件或右侧素材库中的素材卡片');
 };
 const paste=(event:ClipboardEvent<HTMLElement>,kind:Kind)=>{
  if(kind!=='image'||busy||uploading)return;
  const files=pastedImages(event.clipboardData);
  if(!files.length)return;
  event.preventDefault();
  void upload(files,kind);
 };
 const pasteFromButton=async()=>{
  pasteButton.current?.focus();
  if(busy||uploading)return;
  try{await upload(await readClipboardImages(),'image')}
  catch(cause){setError((cause as Error).message?.startsWith('剪贴板')?(cause as Error).message:'无法直接读取剪贴板图片；请先复制截图，再聚焦“粘贴截图”按钮并按 Ctrl+V')}
 };

 return <section className="media-refs">
  <div className="media-refs-title"><strong>参考素材</strong><small>{model?.family?.replace('seedance-','Seedance ')||'请先选择模型'}</small></div>
  {!model?.reference_limits&&draft.tool!=='text_image'?<p>请先选择支持参考素材的模型。</p>:<>
   {kinds.filter(({kind})=>(limits[kind]||0)>0).map(({kind,label,icon:Icon})=><div className="media-refs-row" key={kind} onPaste={event=>paste(event,kind)}>
    <div className="media-refs-label"><Icon size={16}/><b>{label}</b><span>{selected(kind).length+remoteCount(kind)} / {limits[kind]}</span></div>
    <div className="media-refs-actions"><button type="button" className={'media-refs-drop'+(dragging===kind?' dragging':'')}
     aria-label={'上传或拖入'+label} disabled={busy||uploading||selected(kind).length>=(limits[kind]||0)}
     onClick={()=>openUpload(kind)} onDragOver={e=>{e.preventDefault();setDragging(kind)}}
     onDragLeave={()=>setDragging(null)} onDrop={e=>drop(e,kind)}>
     <UploadCloud size={17}/><span>{uploading&&uploadKind.current===kind?'上传中…':'上传'+(kind==='image'?'图片':kind==='video'?'视频':'音频')}</span>
    </button>{kind==='image'&&<button ref={pasteButton} type="button" className="media-refs-paste" aria-label="粘贴截图或图片" disabled={busy||uploading||selected(kind).length>=(limits[kind]||0)} onClick={()=>void pasteFromButton()} title="复制图片后点击；也可聚焦此按钮后按 Ctrl+V"><ClipboardPaste size={16}/><span>粘贴图片</span><kbd>Ctrl+V</kbd></button>}</div>
    <p className="media-refs-hint">{kind==='image'?'支持拖入图片，也可按 Ctrl+V 粘贴':'支持拖入本地文件或素材库素材'}</p>
    <div className="media-refs-selected">{selected(kind).map((id,i)=>{
     const asset=assets.find(a=>a.id===id);
     return <div className={'media-ref-card '+kind} key={id} title={asset?.title||id}>
      {kind==='image'&&asset&&<button className="media-refs-preview" type="button" aria-label={'放大查看'+(asset.title||'参考图片')}><AssetThumbnail asset={asset}/></button>}
      {kind!=='image'&&asset?.file_url&&<ReferencePlayer asset={asset} kind={kind}/>}
      <span>{kind==='image'&&draft.inputs.reference_mode==='first_frame'?'首帧':kind==='image'&&draft.inputs.reference_mode==='first_last_frame'?(i===0?'首帧':'尾帧'):label+' '+(i+1)} · {asset?.title||'素材'}</span>
      {ark&&kind==='image'&&i>0&&<button type="button" className="ark-ref-move" disabled={busy} aria-label={'前移参考图片'+(i+1)} onClick={()=>{const ids=[...selected(kind)];[ids[i-1],ids[i]]=[ids[i],ids[i-1]];change(kind,ids)}}>前移</button>}
     <button type="button" aria-label={'移除'+(asset?.title||label)} disabled={busy}
       onClick={()=>change(kind,selected(kind).filter(x=>x!==id))}><X size={13}/></button>
     </div>;
    })}</div>
   </div>)}
   <input ref={input} hidden type="file" multiple onChange={e=>void upload(Array.from(e.target.files||[]),uploadKind.current)}/>
   {ark?<><div className="ark-link-input"><select aria-label="方舟外部素材类型" value={remoteKind} onChange={e=>setRemoteKind(e.target.value as Kind)}>{kinds.map(k=><option key={k.kind} value={k.kind}>{k.label}</option>)}</select><input aria-label="方舟素材地址" value={remoteUrl} onChange={e=>setRemoteUrl(e.target.value)} placeholder="HTTPS地址或asset://素材ID"/><button type="button" disabled={busy||!remoteUrl.trim()} onClick={addRemote}>添加</button></div><div className="media-refs-selected">{remote.map((r:any,i:number)=><div key={i}><span>{r.title}</span><button type="button" aria-label={'移除外部素材'+(i+1)} onClick={()=>update({remote_references:remote.filter((_:any,n:number)=>n!==i)})}><X size={13}/></button></div>)}</div><p>提示词中可用 @image1 / @video1 / @audio1 指定对应素材。视频与音频各自总时长不超过{model?.reference_limits?.duration||30}秒。{!model.storage_ready?'本地视频参考需管理员配置火山TOS；图片和音频可直接使用。':''}</p><a href="https://docs.volcengine.com/docs/ark/seedance-portrait-asset-guide?lang=zh" target="_blank" rel="noreferrer">真人肖像素材请使用官方授权素材库 ↗</a></>:<p>数量由当前模型决定；中转平台可能设置更低上限。生成前会再次检查。</p>}
  </>}
  {progress&&<p className="media-refs-progress" role="status">{uploading&&<LoaderCircle className="spin" size={14}/>} {progress}</p>}
  {error&&<p className="mw-error" role="alert">{error}</p>}
 </section>;
}
