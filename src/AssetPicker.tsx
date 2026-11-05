import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {FolderOpen} from 'lucide-react';
import {getToken} from './api';
import './asset-picker.css';
export function StudioModal({title,children,onClose,open=true}:{title:string;children:ReactNode;onClose:()=>void;open?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const dialog=ref.current;if(open)dialog?.showModal();return()=>dialog?.close()},[open]);
 useEffect(()=>{if(!open)return;const route=()=>onClose();window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route)},[onClose,open]);
 return createPortal(<dialog ref={ref} className="studio-modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose()}}><header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label="关闭弹窗">关闭</button></header>{children}</dialog>,document.body)
}
export function AssetThumbnail({asset,full=false}:{asset:any;full?:boolean}){
 const [url,setUrl]=useState(''),[visible,setVisible]=useState(full),[error,setError]=useState(''),[retry,setRetry]=useState(0);const ref=useRef<HTMLElement|null>(null);
 const source=full?(asset.file_url||asset.preview_url||asset.url||asset.thumbnail_url):(asset.thumbnail_url||asset.file_url||asset.preview_url||asset.url);
 useEffect(()=>{if(full){setVisible(true);return}const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'120px'});observer.observe(node);return()=>observer.disconnect()},[full]);
 useEffect(()=>{if(!visible)return;let active=true,blob='';const ctrl=new AbortController();setUrl('');setError('');if(!source){setError('图片没有可读取的文件');return}if(!source.startsWith('/api/')){setUrl(source);return}fetch(source,{headers:{Authorization:'Bearer '+getToken()},signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error();return r.blob()}).then(data=>{if(!active)return;blob=URL.createObjectURL(data);setUrl(blob)}).catch(()=>{if(active&&!ctrl.signal.aborted)setError('图片预览读取失败，原素材引用已保留')});return()=>{active=false;ctrl.abort();if(blob)URL.revokeObjectURL(blob)}},[asset.id,source,visible,retry]);
 // Keep the img a direct child: cover and canvas layouts size that element.
 // Observe the placeholder only until the lightweight preview becomes visible.
 return url&&!error?<img ref={node=>{ref.current=node}} src={url} onError={()=>setError('图片预览读取失败，原素材引用已保留')} data-original-src={asset.file_url||asset.preview_url||asset.url||undefined} alt={asset.title||'图片素材'} decoding="async" draggable={false}/>:<span ref={node=>{ref.current=node}} className="asset-thumb-placeholder" style={{display:'block',width:'100%',height:'100%'}}>{error?<><span role="alert">{error}</span><button type="button" onClick={()=>setRetry(x=>x+1)}>重试预览</button></>:'图片预览'}</span>
}
export default function AssetPicker({items,onSelect,onClose,busy=false,title='选择图片素材'}:{items:any[];onSelect:(a:any)=>void;onClose:()=>void;busy?:boolean;title?:string}){
 const [search,setSearch]=useState(''),[previewId,setPreviewId]=useState('');
 const shown=items.filter(a=>String(a.title||a.name||'').toLowerCase().includes(search.trim().toLowerCase()));
 const preview=items.find(a=>a.id===previewId);
 const name=(asset:any)=>asset.title||asset.name||'未命名图片';
 return <StudioModal title={title} onClose={onClose}>
  {preview?<div className="asset-picker-full">
   <div><button type="button" onClick={()=>setPreviewId('')}>返回图片列表</button><strong>{name(preview)}</strong><button type="button" disabled={busy} onClick={()=>onSelect(preview)}>使用这张图片</button></div>
   <AssetThumbnail key={preview.id} asset={preview} full/>
  </div>:<>
   <div className="asset-picker-tools"><input autoFocus aria-label="搜索图片素材" placeholder="搜索素材名称…" value={search} onChange={e=>setSearch(e.target.value)}/><span>{shown.length} / {items.length} 张图片</span></div>
   <div className="asset-picker-grid">{shown.map(a=><article key={a.id}>
    <div className="asset-picker-preview"><AssetThumbnail asset={a}/><button type="button" className="asset-picker-zoom" aria-label={'预览 '+name(a)} onClick={()=>setPreviewId(a.id)}>放大</button></div>
    <strong title={name(a)}>{name(a)}</strong><small>{a.width&&a.height?`${a.width} × ${a.height}`:'图片'}{a.updated?' · '+a.updated.slice(0,10):''}</small>
    <button type="button" disabled={busy} onClick={()=>onSelect(a)}>使用这张图片</button>
   </article>)}</div>
   {!shown.length&&<p className="asset-picker-empty">{items.length?'没有与搜索匹配的图片。':'还没有图片素材，请先上传或生成图片。'}</p>}
  </>}
 </StudioModal>;
}

export function ImageLibraryField({items,value='',onSelect,disabled=false,label,id,clear=false}:{items:any[];value?:string;onSelect:(id:string)=>void;disabled?:boolean;label:string;id?:string;clear?:boolean}){
 const [open,setOpen]=useState(false);
 const selected=items.find(a=>a.id===value);
 return <div className="image-library-field">
  <button type="button" className="image-library-trigger" id={id} aria-label={label} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(true)}>
   <FolderOpen size={15}/><span>{selected?.title||selected?.name||(value?'原选择 · 当前不可用':label)}</span>
  </button>
  {clear&&value&&<button type="button" className="image-library-clear" aria-label={'清除'+label} disabled={disabled} onClick={()=>onSelect('')}>清除</button>}
  {open&&<AssetPicker items={items} title={label} busy={disabled} onSelect={asset=>{onSelect(asset.id);setOpen(false)}} onClose={()=>setOpen(false)}/>}
 </div>;
}
