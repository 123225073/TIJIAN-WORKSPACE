import {useState} from 'react';

export const BUNDLE_ORDER = ['title','copy','cover','video'];
export const bundleOrder = (item:any):string[] => Array.isArray(item.bundle_order) && item.bundle_order.length===4 ? item.bundle_order : BUNDLE_ORDER;
export const bundleHidden = (item:any):string[] => Array.isArray(item.bundle_hidden) ? item.bundle_hidden : [];
const labels:Record<string,string>={title:'标题',copy:'文案',cover:'封面',video:'成片'};

export default function DeliveryBundle({delivery,assets,onChange}:{delivery:any;assets:{id:string;title:string}[];onChange:(key:string,value:string[])=>void}){
 const [dragged,setDragged]=useState('');
 const order=bundleOrder(delivery).filter(key=>delivery.platform!=='wechat'||key!=='video');
 const hidden=bundleHidden(delivery);
 const visible=order.filter(key=>!hidden.includes(key));
 const move=(from:string,to:string)=>{if(from===to)return;const next=[...bundleOrder(delivery)];next.splice(next.indexOf(from),1);next.splice(next.indexOf(to),0,from);onChange('bundle_order',next)};
 const toggle=(key:string,show:boolean)=>onChange('bundle_hidden',show?hidden.filter(x=>x!==key):[...hidden,key]);
 const summary=(key:string)=>key==='title'?delivery.title||'待填写':key==='copy'?(delivery.body||delivery.script||delivery.caption||'待填写').slice(0,80):assets.find(x=>x.id===delivery[key==='cover'?'cover_asset_id':'video_asset_id'])?.title||'待选择';
 return <div className="td-bundle"><div className="td-bundle-head"><div><strong>交付内容总览</strong><small>拖动调整交付顺序。移出的内容可以重新添加，原草稿不会丢失。</small></div>{order.some(key=>hidden.includes(key))&&<div className="td-bundle-restore">{order.filter(key=>hidden.includes(key)).map(key=><button key={key} type="button" onClick={()=>toggle(key,true)}>+ 添加{labels[key]}</button>)}</div>}</div><div className="td-bundle-grid">{visible.map((key,index)=><article key={key} draggable onDragStart={()=>setDragged(key)} onDragEnd={()=>setDragged('')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragged)move(dragged,key);setDragged('')}}><small>拖动排序 · {index+1}</small><strong>{labels[key]}</strong><p>{summary(key)}</p><div className="td-bundle-card-actions"><button type="button" disabled={index===0} onClick={()=>move(key,visible[index-1])} aria-label={'上移'+labels[key]}>←</button><button type="button" disabled={index===visible.length-1} onClick={()=>move(key,visible[index+1])} aria-label={'下移'+labels[key]}>→</button><button type="button" onClick={()=>toggle(key,false)}>移出交付</button></div></article>)}</div>{!visible.length&&<p className="td-bundle-empty">内容已全部移出，点击上方按钮重新添加。</p>}</div>;
}
