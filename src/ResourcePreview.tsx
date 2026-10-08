import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ShieldCheck,UserRound} from 'lucide-react';
import {getToken} from './api';
import VideoPlayer from './VideoPlayer';
import {StudioModal} from './AssetPicker';
import './digital-human-layout.css';
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export const mediaKind=(a:Asset)=>a.asset_type||a.media_type?.split('/')[0]||a.type||a.kind||'';
export const safeUrl=(url?:string)=>url&&(/^(https?:|blob:)/.test(url)||url.startsWith('/api/'))?url:'';
export type Asset = {id:string; title?:string; name?:string; kind?:string; type?:string; media_type?:string; status?:string; owner_id?:string; workspace_id?:string; visibility?:string; public?:boolean; provider?:string; url?:string; download_url?:string; file_url?:string; preview_url?:string; preview_asset_type?:'video'|'image'|'audio'; preview_origin?:string; clone_status?:string; text?:string; [key:string]:any};
export const isCloneAsset=(a:Asset)=>['avatar','voice'].includes(mediaKind(a));
export const cloneConfirmed=(a:Asset)=>isCloneAsset(a)&&a.provider==='hifly'&&a.clone_status==='succeeded';
export const previewKind=(a:Asset)=>a.preview_asset_type&&['video','image','audio'].includes(a.preview_asset_type)?a.preview_asset_type:isCloneAsset(a)?'':mediaKind(a);
// A provider resource ID is not a video/audio file. Only explicit media types
// from the asset contract can select a player for avatar / voice resources.
export const assetUrl=(a:Asset)=>isCloneAsset(a)?previewKind(a)?safeUrl(a.preview_url||a.file_url||a.url):'':safeUrl(a.file_url||a.preview_url||a.url||a.download_url);
export const creationPreview=(a:Asset)=>a.preview_origin==='creation_source'&&!!assetUrl(a)&&['image','video','audio'].includes(previewKind(a));
export const creationPreviewLabel=(a:Asset)=>({video:'创建原视频预览',image:'创建原照片预览',audio:'创建原录音试听'} as Record<string,string>)[previewKind(a)]||'创建原素材预览';
type PlaybackState={time:number;volume:number;muted:boolean;rate:number;playing:boolean};
export function Media({asset,noZoom=false,playback}:{asset:Asset;noZoom?:boolean;playback?:PlaybackState}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[poster,setPoster]=useState('');
 const source=assetUrl(asset),kind=previewKind(asset);
 const cover=safeUrl(asset.preview_cover_url);
 useEffect(()=>{let live=true,object='';setPoster('');if(!cover||kind!=='video')return;
  if(!cover.startsWith('/api/')){setPoster(cover);return}
  const controller=new AbortController();fetch(cover,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)return;object=URL.createObjectURL(await r.blob());if(live)setPoster(object);else URL.revokeObjectURL(object)}).catch(()=>{});return()=>{live=false;controller.abort();if(object)URL.revokeObjectURL(object)};
 },[cover,kind]);
 useEffect(()=>{let live=true,object='';setUrl('');setError('');if(!source)return;
  if(!source.startsWith('/api/')){setUrl(source);return}
  const controller=new AbortController();fetch(source,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('文件暂时无法读取');object=URL.createObjectURL(await r.blob());if(live)setUrl(object);else URL.revokeObjectURL(object)}).catch(e=>{if(live&&e.name!=='AbortError')setError(message(e))});return()=>{live=false;controller.abort();if(object)URL.revokeObjectURL(object)};
 },[asset.id,source,kind]);
 if(asset.text||asset.body)return <pre className="st-text-result">{asset.text||asset.body}</pre>;
 if(error&&!url)return <p className="st-muted" role="status">{error}</p>;
 if(!url)return <div className="st-media-placeholder">{assetUrl(asset)?'预览加载中…':'该资源暂无可验证预览'}</div>;
 const media=kind==='image'?<img src={url} alt={asset.title||'图片素材'} data-no-zoom={noZoom?'true':undefined} onError={()=>setError('图片预览暂不可用，请稍后重试')}/>:kind==='audio'?<audio controls src={url} preload="metadata" onError={()=>setError('录音暂时无法播放，请稍后重试')}/>:kind==='video'?<VideoPlayer controls src={url} poster={poster||undefined} preload="metadata" expandable={!noZoom} aria-label={asset.title||"视频素材"} onError={()=>setError('视频暂时无法播放，请稍后重试')} onLoadedMetadata={e=>{if(!playback)return;const video=e.currentTarget;video.currentTime=playback.time;video.volume=playback.volume;video.muted=playback.muted;video.playbackRate=playback.rate;if(playback.playing)void video.play().catch(()=>{})}}/>:<p className="st-muted">此文件不支持内嵌预览。</p>;
 return <>{media}{error&&<p className="st-muted" role="status">{error}</p>}</>;
}
export function CloneAssetPreview({asset,compact=false}:{asset:Asset;compact?:boolean}){
 const confirmed=cloneConfirmed(asset),sourcePreview=creationPreview(asset);
 const officialView=asset.provider_view_url&&/^https:\/\/hifly\.cc\/market\/(digital|voice)$/.test(asset.provider_view_url)?asset.provider_view_url:'';
 return <section className={'st-clone-preview'+(compact?' compact':'')} aria-label={mediaKind(asset)==='avatar'?'形象资产预览':'声音资产预览'}>
  {confirmed&&<div className="st-clone-confirmation"><ShieldCheck size={16}/><strong>飞影已确认克隆完成</strong></div>}
  {sourcePreview&&<div className="st-clone-source-label">{creationPreviewLabel(asset)}</div>}
  {assetUrl(asset)?['image','video'].includes(previewKind(asset))?<HumanMediaPreview asset={asset}/>:<Media asset={asset}/>:<div className="st-clone-no-preview"><UserRound size={28}/><span>{confirmed?(mediaKind(asset)==='avatar'?'形象':'声音')+'资产已保存，创建原素材暂不可预览':'该资源未提供可验证预览'}</span></div>}
  {sourcePreview&&<p className="st-clone-preview-note">原素材供核对{mediaKind(asset)==='avatar'?'形象':'声音'}，后续创作将引用已保存的克隆资产。</p>}
  {asset.preview_origin==='provider_preview'&&<small className="st-clone-source-label">飞影提供的{previewKind(asset)==='video'?'视频样片':previewKind(asset)==='audio'?'声音试听':'形象封面'}</small>}
  {officialView&&asset.preview_unavailable_reason&&<div className="st-official-preview"><small>{asset.preview_unavailable_reason}</small><a href={officialView} target="_blank" rel="noopener noreferrer">在飞影官方资源库查看 <ArrowUpRight size={13}/></a></div>}
 </section>;
}
export function HumanMediaPreview({asset}:{asset:Asset}){
 const [expanded,setExpanded]=useState(false),preview=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),stage=useRef<HTMLDivElement>(null);
 const playback=useRef<PlaybackState>({time:0,volume:1,muted:false,rate:1,playing:false});
 useEffect(()=>{if(!expanded)return;const dialog=stage.current?.closest('dialog');return()=>{dialog?.close()}},[expanded]);
 const closePreview=()=>{const large=stage.current?.querySelector('video'),original=preview.current?.querySelector('.st-human-preview-inline video') as HTMLVideoElement|null;if(large&&original){const playing=!large.paused;large.pause();original.currentTime=large.currentTime;original.volume=large.volume;original.muted=large.muted;original.playbackRate=large.playbackRate;if(playing)void original.play().catch(()=>{})}stage.current?.closest('dialog')?.close();setExpanded(false);if(trigger.current?.isConnected)trigger.current.focus()};
 const label=asset.title||asset.name||'人物素材';
 return <div className="st-human-media-preview" ref={preview}>
  <div className="st-human-preview-head"><span title={label}>{label}</span><button ref={trigger} type="button" onClick={e=>{e.preventDefault();e.stopPropagation();const video=preview.current?.querySelector('video');if(video){playback.current={time:video.currentTime,volume:video.volume,muted:video.muted,rate:video.playbackRate,playing:!video.paused};video.pause()}setExpanded(true)}} aria-label={'放大预览：'+label}>放大预览 <ArrowUpRight size={14}/></button></div>
  <div className="st-human-preview-inline"><Media asset={asset} noZoom/></div>
  {expanded&&<StudioModal title={label} onClose={closePreview}><div ref={stage} className="st-human-preview-stage"><Media asset={asset} noZoom playback={playback.current}/></div><p className="st-human-preview-help">完整显示素材 · 视频可使用播放控件 · Esc 关闭</p></StudioModal>}
 </div>;
}
