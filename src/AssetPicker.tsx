import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {getToken} from './api';
export function StudioModal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close()},[]);
 return createPortal(<dialog ref={ref} className="studio-modal" onCancel={e=>{e.preventDefault();onClose()}}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="关闭弹窗">关闭</button></header>{children}</dialog>,document.body)
}
export function AssetThumbnail({asset}:{asset:any}){
 const [url,setUrl]=useState('');useEffect(()=>{let active=true,blob='';const ctrl=new AbortController();const src=asset.file_url||asset.preview_url||asset.url;if(!src)return;if(!src.startsWith('/api/')){setUrl(src);return}fetch(src,{headers:{Authorization:'Bearer '+getToken()},signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error();return r.blob()}).then(data=>{blob=URL.createObjectURL(data);if(active)setUrl(blob)}).catch(()=>{});return()=>{active=false;ctrl.abort();if(blob)URL.revokeObjectURL(blob)}},[asset.id,asset.file_url]);
 return url?<img src={url} alt={asset.title||'图片素材'} draggable={false}/>:<span className="asset-thumb-placeholder">图片预览</span>
}
export default function AssetPicker({items,onSelect,onClose,busy=false}:{items:any[];onSelect:(a:any)=>void;onClose:()=>void;busy?:boolean}){
 const [search,setSearch]=useState('');return <StudioModal title="选择图片素材" onClose={onClose}><div className="asset-picker-tools"><input autoFocus aria-label="搜索图片素材" placeholder="搜索素材名称…" value={search} onChange={e=>setSearch(e.target.value)}/><span>{items.length} 张图片 · 点击图片放大查看</span></div><div className="asset-picker-grid">{items.filter(a=>(a.title||'').toLowerCase().includes(search.toLowerCase())).map(a=><article key={a.id}><div className="asset-picker-preview"><AssetThumbnail asset={a}/></div><strong title={a.title}>{a.title||'未命名图片'}</strong><small>{a.width&&a.height?`${a.width} × ${a.height}`:'图片'} · {(a.updated||'').slice(0,10)}</small><button type="button" disabled={busy} onClick={()=>onSelect(a)}>使用这张图片</button></article>)}</div>{!items.length&&<p className="asset-picker-empty">还没有图片素材，请先上传或生成图片。</p>}</StudioModal>
}
