import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {getToken} from './api';
import {editImageSource,openImageEditor,type EditImageSource} from './image-edit-handoff';
import './image-context-menu.css';
export default function ImageLightbox(){
 const [src,setSrc]=useState(''),[original,setOriginal]=useState(''),[title,setTitle]=useState(''),[scale,setScale]=useState(1),[offset,setOffset]=useState({x:0,y:0});
 const dialog=useRef<HTMLDialogElement>(null),drag=useRef<any>(null);
 const [menu,setMenu]=useState<{source:EditImageSource;x:number;y:number}|null>(null),[menuBusy,setMenuBusy]=useState(false),[menuError,setMenuError]=useState('');
 const contextDialog=useRef<HTMLDialogElement>(null),handoffLock=useRef(false);
 const reset=()=>{setScale(1);setOffset({x:0,y:0})};
 const close=()=>{setSrc('');setOriginal('')};
 useEffect(()=>{const click=(e:MouseEvent)=>{const target=e.target as HTMLElement;const img=target?.closest('img')||target?.closest('.media-refs-preview')?.querySelector('img');if(!img||img.closest('.image-lightbox,.ie-workspace')||!img.src||img.hasAttribute('data-no-zoom'))return;e.preventDefault();setSrc(img.currentSrc||img.src);setOriginal(img.dataset.originalSrc||'');setTitle(img.alt||'图片预览');reset()};document.addEventListener('click',click);return()=>document.removeEventListener('click',click)},[]);
 useEffect(()=>{if(!original.startsWith('/api/studio/assets/'))return;let active=true,object='';const controller=new AbortController();void fetch(original,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();const data=await response.blob();if(active){object=URL.createObjectURL(data);setSrc(object)}}).catch(()=>{});return()=>{active=false;controller.abort();if(object)URL.revokeObjectURL(object)}},[original]);
 useEffect(()=>{if(src)dialog.current?.showModal();else dialog.current?.close()},[src]);
 useEffect(()=>{
  const documents=new Map<Document,()=>void>(),frameDocuments=new Map<Element,Document>();
  const detach=(doc:Document)=>{for(const [frame,child] of frameDocuments)if(frame.ownerDocument===doc){frameDocuments.delete(frame);detach(child)}documents.get(doc)?.();documents.delete(doc)};
  const attach=(doc:Document)=>{
   if(documents.has(doc))return;
   const context=(event:MouseEvent)=>{
    const target=event.target as Element|null;
    const image=target?.closest?.('img')||target?.closest?.('.ie-layer')?.querySelector('img')||target?.closest?.('.ie-canvas-image')?.querySelector('img')||target?.closest?.('.media-refs-preview')?.querySelector('img');
    if(!image?.src||handoffLock.current)return;
    event.preventDefault();event.stopPropagation();
    let x=event.clientX,y=event.clientY,win=doc.defaultView;
    try{while(win&&win!==window){const frame=win.frameElement;if(!frame)break;const rect=frame.getBoundingClientRect();x+=rect.left;y+=rect.top;win=frame.ownerDocument.defaultView}}catch{/* A cross-origin surface keeps its native menu. */}
    try{setMenuError('');setMenu({source:editImageSource(image as HTMLImageElement),x:Math.max(8,Math.min(x,window.innerWidth-290)),y:Math.max(8,Math.min(y,window.innerHeight-190))})}catch(e){setMenuError((e as Error).message)}
   };
   const frame=(element:Element)=>{if(element.tagName!=='IFRAME')return;try{const child=(element as HTMLIFrameElement).contentDocument,previous=frameDocuments.get(element);if(previous&&previous!==child)detach(previous);if(child){frameDocuments.set(element,child);attach(child)}}catch{/* Do not reach into third-party frames. */}};
   const loaded=(event:Event)=>{if((event.target as Element)?.tagName==='IFRAME')frame(event.target as Element)};
   doc.addEventListener('contextmenu',context,true);doc.addEventListener('load',loaded,true);
   const observer=new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node.nodeType===1){const element=node as Element;frame(element);element.querySelectorAll('iframe').forEach(frame)}for(const node of record.removedNodes)if(node.nodeType===1&&!node.isConnected){const removed=node as Element;for(const element of [removed,...removed.querySelectorAll('iframe')]){const child=frameDocuments.get(element);if(child){frameDocuments.delete(element);detach(child)}}}}});
   observer.observe(doc,{childList:true,subtree:true});documents.set(doc,()=>{doc.removeEventListener('contextmenu',context,true);doc.removeEventListener('load',loaded,true);observer.disconnect()});
   doc.querySelectorAll('iframe').forEach(frame);
  };
  attach(document);return()=>{documents.forEach(stop=>stop());documents.clear();frameDocuments.clear()};
 },[]);
 useEffect(()=>{if(menu){if(!contextDialog.current?.open)contextDialog.current?.showModal()}else contextDialog.current?.close()},[menu]);
 const addToEditor=async()=>{if(!menu||handoffLock.current)return;handoffLock.current=true;setMenuBusy(true);setMenuError('');try{await openImageEditor(menu.source);setMenu(null);close()}catch(e){setMenuError((e as Error).message||'原图暂不可读取，请重新打开图片后再试。')}finally{handoffLock.current=false;setMenuBusy(false)}};
 return createPortal(<><dialog ref={dialog} className="image-lightbox" onCancel={close}><header><strong>{title}</strong><span>滚轮缩放 · 拖动查看 · Esc 关闭</span><button onClick={()=>setScale(v=>Math.max(.1,v/1.25))}>−</button><output>{Math.round(scale*100)}%</output><button onClick={()=>setScale(v=>Math.min(10,v*1.25))}>＋</button><button onClick={reset}>适应窗口</button><button onClick={close}>关闭</button></header><div className="image-lightbox-stage" onWheel={e=>{setScale(v=>Math.max(.1,Math.min(10,v*(e.deltaY<0?1.1:.9))))}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,origin:offset}}} onPointerMove={e=>{if(drag.current)setOffset({x:drag.current.origin.x+e.clientX-drag.current.x,y:drag.current.origin.y+e.clientY-drag.current.y})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onDoubleClick={reset}>{src&&<img src={src} data-original-src={original||undefined} alt={title} draggable={false} style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${scale})`}}/>}</div></dialog><dialog ref={contextDialog} className="image-context-menu" style={{left:menu?.x,top:menu?.y}} aria-label="图片操作" onCancel={event=>{event.preventDefault();if(!menuBusy)setMenu(null)}} onClick={event=>{if(event.target===event.currentTarget&&!menuBusy)setMenu(null)}}><div role="menu" aria-label="图片右键操作"><button type="button" role="menuitem" disabled={menuBusy} onClick={()=>void addToEditor()}>{menuBusy?'正在准备原图…':'添加到图片编辑区域'}</button><p>在新的图片编辑稿中打开，当前草稿保留。</p>{menuError&&<p role="alert" className="image-context-error">{menuError}</p>}<button type="button" role="menuitem" className="image-context-close" disabled={menuBusy} onClick={()=>setMenu(null)}>关闭菜单</button></div></dialog></>,document.body);
}
