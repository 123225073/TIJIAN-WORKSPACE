import {useRef,useState,type DragEvent} from 'react';
import {Image as ImageIcon,UploadCloud,X,ArrowLeftRight} from 'lucide-react';
import {api} from './api';
import {AssetThumbnail} from './AssetPicker';
import {videoFrameKey,videoFrameRefs,videoFrameSlots} from './video-inputs';
import './video-frame-references.css';

// Roles are persisted separately from the compact image array. Removing a first
// frame must never silently turn the retained last frame into the first frame.
export default function VideoFrameReferences(props:any){
 const {draft,model,assets,update,reload,busy}=props;
 const [uploading,setUploading]=useState(''),[error,setError]=useState(''),[added,setAdded]=useState<any[]>([]);
 const file=useRef<HTMLInputElement>(null),target=useRef('first_frame'),lock=useRef(false),latest=useRef(props);latest.current=props;
 const slots=videoFrameSlots(draft.inputs),refs=videoFrameRefs(draft.inputs);
 const roles=draft.inputs.reference_mode==='first_frame'?['first_frame']:['first_frame','last_frame'];
 const allAssets=[...assets,...added.filter(a=>!assets.some((x:any)=>x.id===a.id))];
 const pictures=allAssets.filter((a:any)=>a.asset_type==='image'&&a.status==='ready');
 const label=(role:string)=>role==='first_frame'?'首帧':'尾帧';
 const changeSlot=(role:string,ref:any)=>{
  const current=latest.current.draft,inputs=current.inputs,old=videoFrameSlots(inputs),next={...old,[role]:ref?videoFrameKey(ref):''};
  if(ref&&Object.entries(next).some(([k,v])=>k!==role&&v===next[role])){setError('首帧与尾帧请分别选择图片；如需静止开场，可使用“首帧生视频”。');return}
  const previous=old[role],remaining=videoFrameRefs(inputs).filter(r=>videoFrameKey(r)!==previous);
  if(ref&&!remaining.some(r=>videoFrameKey(r)===videoFrameKey(ref)))remaining.push(ref);
  const ordered=[next.first_frame,next.last_frame].map(key=>remaining.find(r=>videoFrameKey(r)===key)).filter(Boolean);
  const extras=remaining.filter(r=>!Object.values(next).includes(videoFrameKey(r)));
  const imageRefs=[...ordered,...extras],image_ids=imageRefs.filter(r=>r.id).map(r=>r.id);
  latest.current.update({frame_slots:next,image_ids,image_id:image_ids[0]||'',remote_references:[...(inputs.remote_references||[]).filter((r:any)=>r.kind!=='image'),...imageRefs.filter(r=>!r.id).map(r=>({...r,kind:'image'}))]});
  setError('');
 };
 const choose=(role:string,id:string)=>{const asset=allAssets.find(a=>a.id===id);if(asset?.asset_type!=='image'||asset.status!=='ready'){setError('请选择已就绪的图片素材');return}changeSlot(role,{id})};
 const upload=async(role:string,files:File[])=>{
  if(!files.length||lock.current||busy)return;
  if(files.length!==1){setError('每个画面只需 1 张图片，请分别上传首帧和尾帧。');return}
  const image=files[0];if(!image.type.startsWith('image/')&&!/\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(image.name)){setError('首帧和尾帧只接受图片文件。');return}
  const started={model:draft.model_id,mode:draft.inputs.reference_mode,id:draft.id};lock.current=true;setUploading(role);setError('');
  try{const data=new FormData();data.append('file',image);const result=await api('/studio/upload',data),asset=result.asset||result;if(!asset.id)throw Error('图片上传未返回素材编号');setAdded(items=>[asset,...items]);void reload([asset]).catch(()=>{});
   const current=latest.current.draft;if(current.id!==started.id||current.model_id!==started.model||current.inputs.reference_mode!==started.mode){setError('图片已保存到素材库；创作方式已切换，请在当前页面重新选择。');return}changeSlot(role,{id:asset.id});
  }catch(cause){setError((cause as Error).message)}finally{lock.current=false;setUploading('');if(file.current)file.current.value=''}
 };
 const drop=(event:DragEvent<HTMLElement>,role:string)=>{event.preventDefault();if(busy||uploading)return;const id=event.dataTransfer.getData('application/x-tijian-asset');if(id)choose(role,id);else void upload(role,Array.from(event.dataTransfer.files))};
 const extras=[...refs.filter(r=>!roles.map(role=>slots[role]).includes(videoFrameKey(r))).map(r=>({kind:'image',...r})),...(draft.inputs.video_ids||[]).map((id:string)=>({kind:'video',id})),...(draft.inputs.audio_ids||[]).map((id:string)=>({kind:'audio',id})),...(draft.inputs.remote_references||[]).filter((r:any)=>r.kind!=='image')];
 const removeExtra=(ref:any)=>{const frame_slots=Object.fromEntries(Object.entries(slots).map(([role,key])=>[role,ref.kind==='image'&&key===videoFrameKey(ref)?'':key]));if(ref.id){const key=ref.kind+'_ids',ids=(draft.inputs[key]||[]).filter((id:string)=>id!==ref.id);update({[key]:ids,...(ref.kind==='image'?{image_id:ids[0]||'',frame_slots}:{})})}else update({remote_references:(draft.inputs.remote_references||[]).filter((r:any)=>r.kind!==ref.kind||r.url!==ref.url),frame_slots})};
 return <section className="video-frame-references" aria-label="首尾帧图片选择">
  <header><strong>{roles.length===2?'首尾画面':'开场画面'}</strong><small>上传图片，或直接从右侧素材库拖入</small></header>
  <div className="video-frame-grid">{roles.map((role,index)=>{const ref=refs.find(r=>videoFrameKey(r)===slots[role]),asset=ref?.id?allAssets.find(a=>a.id===ref.id):null;return <article className="video-frame-slot" key={role} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,role)} aria-label={label(role)+'图片'}>
   <div className="video-frame-title"><b>{index+1<10?'0'+(index+1):index+1}</b><div><strong>{label(role)}</strong><small>{role==='first_frame'?'视频开始时的画面':'视频结束时的画面'}</small></div>{ref&&<button type="button" aria-label={'移除'+label(role)+'图片'} disabled={busy||!!uploading} onClick={()=>changeSlot(role,null)}><X size={15}/></button>}</div>
   <div className={'video-frame-preview'+(ref?' selected':'')}>{asset?<AssetThumbnail asset={asset}/>:ref?<span>已选择外部图片<br/>{ref.title||ref.url}</span>:<><ImageIcon size={27}/><span>{'添加'+label(role)+'图片'}</span></>}</div>
   {ref&&<p className="video-frame-name">{label(role)} · {asset?.title||ref.title||'外部图片'}</p>}
   <button type="button" className="video-frame-upload" disabled={busy||!!uploading} onClick={()=>{target.current=role;file.current?.click()}}><UploadCloud size={15}/>{uploading===role?'上传中…':(ref?'替换':'上传')+label(role)}</button>
   <select aria-label={'选择'+label(role)+'素材'} disabled={busy||!!uploading} value={ref?.id||''} onChange={e=>{if(e.target.value)choose(role,e.target.value)}}><option value="">从素材库选择{label(role)}</option>{pictures.map((a:any)=><option key={a.id} value={a.id} disabled={Object.entries(slots).some(([k,v])=>k!==role&&v==='id:'+a.id)}>{a.title||'未命名图片'}</option>)}</select>
  </article>})}</div>
  {roles.length===2&&slots.first_frame&&slots.last_frame&&<button className="video-frame-swap" type="button" disabled={busy||!!uploading} onClick={()=>update({frame_slots:{first_frame:slots.last_frame,last_frame:slots.first_frame}})}><ArrowLeftRight size={14}/>交换首帧与尾帧</button>}
  {!!extras.length&&<div className="video-frame-extras"><strong>以下素材不适用于当前方式，请移除后生成</strong>{extras.map((ref:any,i:number)=><div key={i}><span>{allAssets.find(a=>a.id===ref.id)?.title||ref.title||'额外素材'}</span><button type="button" disabled={busy||!!uploading} aria-label={'移除'+(allAssets.find(a=>a.id===ref.id)?.title||ref.title||'额外素材')} onClick={()=>removeExtra(ref)}>移除</button></div>)}</div>}
  <input ref={file} type="file" accept="image/*" hidden onChange={e=>void upload(target.current,Array.from(e.target.files||[]))}/>
  {error&&<p className="mw-error" role="alert">{error}</p>}
 </section>;
}
