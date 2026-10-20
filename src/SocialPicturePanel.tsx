import {useEffect,useRef,useState} from 'react';
import ArticleImagePicker from './ArticleImagePicker';
import {AssetThumbnail} from './AssetPicker';
import {api,download} from './api';
import './social-picture-panel.css';
import SocialPictureBatch from './SocialPictureBatch';

type Props={content:any;owner:string;ids:string[];onChange:(ids:string[])=>void|Promise<void>;disabled?:boolean};

// Controlled image IDs only. The parent saves this list alongside, not inside, its body.
export default function SocialPicturePanel(props:Props){
 return <PicturePanel key={JSON.stringify([props.owner,props.content.id])} {...props}/>;
}
function PicturePanel({content,owner,ids,onChange,disabled=false}:Props){
 const [items,setItems]=useState<any[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [error,setError]=useState(''),[tab,setTab]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const lock=useRef(false),live=useRef(true),current=useRef({ids,onChange,disabled});current.current={ids,onChange,disabled};
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
 useEffect(()=>{if(disabled)setTab('')},[disabled]);
 // Sorting does not reload the library. New IDs supplied by the parent do.
 const membership=JSON.stringify([...new Set(ids)].sort());
 useEffect(()=>{let active=true;setLoading(true);setLoadError('');
  api('/studio/assets').then(r=>{if(active)setItems(r.items.filter((a:any)=>a.asset_type==='image'&&a.status==='ready'))})
   .catch(e=>{if(active)setLoadError(e.message||'图片素材读取失败')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[membership,reload]);
 const change=async(next:string[])=>{
  if(!live.current||current.current.disabled)throw Error('当前内容暂不可修改，图片已保留在素材库。');
  if(lock.current)throw Error('正在保存图片顺序，请稍后重试。');
  lock.current=true;setBusy(true);setError('');
  try{await current.current.onChange(next)}finally{lock.current=false;if(live.current)setBusy(false)}
 };
 const act=async(run:()=>Promise<void>)=>{try{await run()}catch(e:any){if(live.current)setError(e.message||'操作未完成，请重试')}};
 const move=(index:number,offset:number)=>void act(async()=>{const next=[...current.current.ids];const target=index+offset;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];await change(next)});
 const insert=async(asset:any)=>{
  if(!asset?.id||asset.asset_type!=='image'||asset.status!=='ready')throw Error('这张图片尚不可用，请重新选择。');
  if(!live.current||current.current.disabled)throw Error('当前内容暂不可修改，图片已保留在素材库。');
  if(!current.current.ids.includes(asset.id))await change([...current.current.ids,asset.id]);
  if(live.current)setItems(old=>[...old.filter(a=>a.id!==asset.id),asset]);
 };
 const saveImage=async(asset:any)=>{
  const ext:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'};
  const suffix=ext[asset.mime_type]||'png';
  const title=(asset.title||'图片').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  await download('/studio/assets/'+encodeURIComponent(asset.id)+'/file',/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(title)?title:title+'.'+suffix);
 };
 const blocked=disabled||busy;
 return <section className="social-picture-panel" aria-label="社交配图">
  <header><div><h3>配图素材 <small>{ids.length} 张</small></h3><p>图片与正文分别保存，可调整顺序、单独下载。</p></div>
   <div className="spp-actions"><button type="button" disabled={blocked||!content.id} onClick={()=>setTab('library')}>选择图片</button><button type="button" disabled={blocked||!content.id} onClick={()=>setTab('generate')}>生成配图</button><SocialPictureBatch content={content} owner={owner} disabled={blocked} onImages={async newIds=>{await change([...new Set([...current.current.ids,...newIds])]);setReload(n=>n+1)}}/></div>
  </header>
  {!content.id&&<p>保存文稿后即可添加配图。</p>}
  {loadError&&<p role="alert">{loadError}；已保留图片引用。<button type="button" disabled={loading} onClick={()=>setReload(n=>n+1)}>重新读取图片</button></p>}
  {error&&<p role="alert">{error}</p>}
  {!ids.length&&<p className="spp-empty">还没有配图，选择已有图片或生成一张。</p>}
  <ol className="spp-grid">{ids.map((id,index)=>{const asset=items.find(a=>a.id===id);return <li key={id+':'+index} data-asset-id={id}>
   <div className="spp-preview">{asset?<AssetThumbnail asset={asset}/>:<span>{loading?'正在读取图片…':loadError?'暂时无法读取图片，引用已保留':'图片已缺失或暂不可用，引用已保留'}</span>}<span className="spp-number">{String(index+1).padStart(2,'0')}</span></div>
   <strong title={asset?.title||id}>{asset?.title||'待找回的图片'}</strong>
   <div className="spp-card-actions"><button type="button" aria-label={`图片 ${index+1} 移前`} disabled={blocked||index===0} onClick={()=>move(index,-1)}>移前</button><button type="button" aria-label={`图片 ${index+1} 移后`} disabled={blocked||index===ids.length-1} onClick={()=>move(index,1)}>移后</button><button type="button" aria-label={`移除图片 ${index+1}`} disabled={blocked} onClick={()=>void act(()=>change(current.current.ids.filter((_,i)=>i!==index)))}>移除</button><button type="button" aria-label={`下载图片 ${index+1}`} disabled={blocked||!asset} onClick={()=>void act(()=>saveImage(asset))}>下载</button></div>
  </li>})}</ol>
  {tab&&!disabled&&<ArticleImagePicker content={content} owner={owner} standalone context={{body:String(content.body||content.text||''),start:0,end:Array.from(String(content.body||content.text||'')).slice(0,1000).join('').length,text:Array.from(String(content.body||content.text||'')).slice(0,1000).join('')}} initialTab={tab} onClose={()=>setTab('')} onInsert={insert}/>}
 </section>;
}
