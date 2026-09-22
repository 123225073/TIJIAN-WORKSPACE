import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
export default function ImageLightbox(){
 const [src,setSrc]=useState(''),[title,setTitle]=useState(''),[scale,setScale]=useState(1),[offset,setOffset]=useState({x:0,y:0});
 const dialog=useRef<HTMLDialogElement>(null),drag=useRef<any>(null);
 const reset=()=>{setScale(1);setOffset({x:0,y:0})};
 useEffect(()=>{const click=(e:MouseEvent)=>{const img=(e.target as HTMLElement)?.closest('img');if(!img||img.closest('.image-lightbox')||!img.src||img.hasAttribute('data-no-zoom'))return;e.preventDefault();setSrc(img.currentSrc||img.src);setTitle(img.alt||'图片预览');reset()};document.addEventListener('click',click);return()=>document.removeEventListener('click',click)},[]);
 useEffect(()=>{if(src)dialog.current?.showModal();else dialog.current?.close()},[src]);
 return createPortal(<dialog ref={dialog} className="image-lightbox" onCancel={()=>setSrc('')}><header><strong>{title}</strong><span>滚轮缩放 · 拖动查看 · Esc 关闭</span><button onClick={()=>setScale(v=>Math.max(.1,v/1.25))}>−</button><output>{Math.round(scale*100)}%</output><button onClick={()=>setScale(v=>Math.min(10,v*1.25))}>＋</button><button onClick={reset}>适应窗口</button><button onClick={()=>setSrc('')}>关闭</button></header><div className="image-lightbox-stage" onWheel={e=>{setScale(v=>Math.max(.1,Math.min(10,v*(e.deltaY<0?1.1:.9))))}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,origin:offset}}} onPointerMove={e=>{if(drag.current)setOffset({x:drag.current.origin.x+e.clientX-drag.current.x,y:drag.current.origin.y+e.clientY-drag.current.y})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onDoubleClick={reset}>{src&&<img src={src} alt={title} draggable={false} style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${scale})`}}/>}</div></dialog>,document.body);
}
