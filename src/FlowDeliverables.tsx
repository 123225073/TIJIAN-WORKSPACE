import {useEffect,useState} from 'react';
import {Download,Copy,Archive,ArrowUpRight,RefreshCw} from 'lucide-react';
import {api,download,exportedHTML,getToken} from './api';
import {readerArticleText,markdownToEditorHtml} from './wechat-rich';
import {Media} from './ResourcePreview';
import {AssetThumbnail,StudioModal} from './AssetPicker';
import PlatformIcon from './PlatformIcon';
import './flow-deliverables.css';

// assets must come from the authenticated /studio/assets listing. Never turn
// arbitrary IDs or URLs in a content object into downloadable image references.
export function socialImagesForContent(content:any,assets:any[]){
 if(!content?.id||!content.flow_id||content.archived)return [];
 let ids:unknown[]=[];
 if(['小红书文案','朋友圈文案'].includes(content.format)&&Array.isArray(content.image_asset_ids))ids=content.image_asset_ids;
 else if(content.format==='公众号文章'){
  // Parse actual image nodes; URLs in prose, code or production notes are not pictures.
  const holder=document.createElement('div');holder.innerHTML=markdownToEditorHtml(readerArticleText(content.body||''));
  ids=Array.from(holder.querySelectorAll('[data-wa-image]')).flatMap(node=>{const match=/^\/api\/studio\/assets\/([0-9a-f]{32}(?:[0-9a-f]{32})?)\/file$/.exec((node as HTMLElement).dataset.waImage||'');return match?[match[1]]:[]});
 }
 const available=new Map(assets.filter(a=>a.asset_type==='image'&&a.status==='ready'&&(!a.flow_id||a.flow_id===content.flow_id)&&!a.archived&&!a.deleted&&/^[0-9a-f]{32}(?:[0-9a-f]{32})?$/.test(a.id)&&a.file_url==='/api/studio/assets/'+a.id+'/file').map(a=>[a.id,a]));
 return [...new Set(ids)].flatMap(id=>typeof id==='string'&&available.has(id)?[available.get(id)!]:[]);
}

type Picture={kind:'studio_asset'|'illustration'|'invalid';id:string;url:string;filename:string;index:number;available:boolean;reason?:string;thumbnail_url?:string};
type Version={content_id:string;version:number;title:string;format:string;body:string;updated?:string;selected?:boolean;images:Picture[];images_zip_url?:string;unavailable_count?:number;notice?:string;topic_id?:string;scope_reason?:string;topic_title?:string;platform?:string};
type Group={platform:string;label:string;versions:Version[]};
type DeliverySet={flow_id:string;topic_id:string;topic_title?:string;groups:Group[];history:Version[];assets:any[];unassigned?:any[]};
const platforms=[['wechat','公众号'],['xiaohongshu','小红书'],['moments','朋友圈'],['video','短视频'],['avatar','数字人口播']];
const platformKey=(value:string)=>['channels','douyin'].includes(value)?'video':value;
const friendly=(value:string,fallback:string)=>String(value||'').replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,'').replace(/\b[a-f0-9]{32,64}\b/gi,'').replace(/\s+/g,' ').trim()||fallback;
const localPath=(url:string)=>{if(!url.startsWith('/api/'))throw Error('这项下载暂不可用，请刷新素材。');return url.slice(4)};
const saveBlob=(blob:Blob,filename:string)=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};

function PicturePreview({image,label}:{image:Picture;label:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(image.kind!=='illustration'||!image.available)return;let live=true;setUrl('');setError('');void api(localPath(image.url)).then(r=>{if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(r.data_uri||''))throw Error('图片暂不可读取');if(live)setUrl(r.data_uri)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[image.id,image.url,image.kind,image.available]);
 if(!image.available)return <span className="fd-picture-unavailable">{image.reason||'图片暂不可用'}</span>;
 if(image.kind==='illustration')return url?<img src={url} alt={label} draggable={false}/>:<span className="fd-picture-unavailable">{error||'正在读取图片…'}</span>;
 return <AssetThumbnail asset={{id:image.id,title:label,file_url:image.url,thumbnail_url:image.thumbnail_url}}/>;
}

export default function FlowDeliverables({contents=[],assets=[],flowId='',topicId,currentPlatform='wechat',selectedContentId='',topicTitle=''}:{contents?:any[];assets?:any[];imageAssets?:any[];flowId?:string;topicId?:string;currentPlatform?:string;selectedContentId?:string;topicTitle?:string}){
 const scope=flowId||contents.find(c=>c.flow_id)?.flow_id||'';
 const [data,setData]=useState<DeliverySet|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reload,setReload]=useState(0);
 const [platform,setPlatform]=useState(platformKey(currentPlatform)),[versions,setVersions]=useState<Record<string,string>>({}),[historyOpen,setHistoryOpen]=useState(false),[historyId,setHistoryId]=useState('');
 const inputs=JSON.stringify([contents.map(c=>[c.id,c.version]),assets.map(a=>[a.id,a.status])]);
 useEffect(()=>{setPlatform(platformKey(currentPlatform));setVersions({});setHistoryOpen(false);setNotice('')},[scope,topicId,currentPlatform]);
 useEffect(()=>{let live=true;const session=getToken();setLoading(true);setError('');setData(null);if(!scope){setLoading(false);return}void api('/studio/flows/'+encodeURIComponent(scope)+'/deliverables').then(result=>{if(!live||session!==getToken())return;if(topicId!==undefined&&(result.topic_id||'')!==topicId)throw Error('本次选题正在保存，请稍后刷新素材。');setData(result)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[scope,topicId,inputs,reload]);
 const run=async(fn:()=>Promise<void>,message:string)=>{if(busy)return;setBusy(true);setNotice('');setError('');try{await fn();setNotice(message)}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const groups=data?.groups||[],group=groups.find(g=>g.platform===platform),items=group?.versions||[];
 const selected=items.find(v=>v.content_id===versions[platform])||items.find(v=>v.content_id===selectedContentId)||items.find(v=>v.selected)||items[0];
 const history=data?.history||[],historical=history.find(v=>v.content_id===historyId)||history[0];
 const imageDownload=async(image:Picture)=>{if(!image.available)throw Error(image.reason||'这张图片暂不可用');if(image.kind==='illustration'){const result=await api(localPath(image.url));if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(result.data_uri||''))throw Error('图片暂不可读取');const response=await fetch(result.data_uri);saveBlob(await response.blob(),friendly(image.filename,'配图.png'))}else await download(localPath(image.url),friendly(image.filename,'配图.png'))};
 const renderVersion=(version:Version,historical=false)=>{
  const title=friendly(version.title,'未命名文稿'),images=version.images||[],missing=version.unavailable_count||images.filter(i=>!i.available).length;
  return <section className="fd-version" aria-label={historical?'历史稿件内容':'当前平台稿件'} data-content-id={version.content_id}>
   <div className="fd-version-head"><div><span className="fd-eyebrow">{historical?'历史稿件':(group?.label||'平台')+' · 当前查看'}</span><h4>{title}</h4><p>{version.format} · 已保存 v{version.version}{version.updated?' · '+version.updated.slice(0,16).replace('T',' '):''}</p></div><div className="fd-text-actions"><button disabled={busy} onClick={()=>void run(async()=>{const text=readerArticleText(version.body||'');if(version.format==='公众号文章'){const html=await exportedHTML(version.content_id);await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})])}else await navigator.clipboard.writeText(text)},version.format==='公众号文章'?'图文已复制，请粘贴后核对图片与排版。':'文案已复制。')}><Copy size={15}/>{version.format==='公众号文章'?'复制图文':'复制文案'}</button><button disabled={busy} onClick={()=>void run(()=>download('/content/'+version.content_id+'/export?format=html&include_metadata=true',title+'.html'),'已发起文稿下载，请选择保存位置。')}><Download size={15}/>下载文稿</button></div></div>
   <div className="fd-images-head"><div><h5>配图素材 <span>{images.length} 张</span></h5><p>按本稿保存的顺序排列 · 点击图片放大，滚轮缩放</p></div>{!!images.length&&version.images_zip_url&&<button className="fd-primary" disabled={busy||missing>0} onClick={()=>void run(()=>download(localPath(version.images_zip_url!),title+'-配图.zip'),'已发起当前稿件的图片 ZIP 下载。')}><Archive size={15}/>一键下载本稿配图</button>}</div>
   {(version.notice||missing>0)&&<p className="fd-warning" role="status">{version.notice||`有 ${missing} 张图片暂不可用，请先核对；当前无法完整打包。`}</p>}
   {images.length?<ol className="fd-picture-grid">{images.map((image,index)=>{const number=String(index+1).padStart(2,'0'),name=friendly(image.filename,number+'-配图.png');return <li key={image.kind+':'+image.id+':'+index} data-image-asset-id={image.id}><div className="fd-picture-preview"><PicturePreview image={image} label={title+' · 配图 '+number}/><span className="fd-picture-number">{number}</span></div><div className="fd-picture-info"><strong>{name}</strong><small>{index===0?'首图':'配图 '+number}</small></div><button disabled={busy||!image.available} aria-label={'下载'+title+'配图'+(index+1)} onClick={()=>void run(()=>imageDownload(image),'已发起单张图片下载。')}><Download size={14}/>下载这张</button></li>})}</ol>:<div className="fd-empty">本稿还没有配图。可返回多平台创作添加图片。</div>}
   {historical&&!version.images_zip_url&&!!images.length&&<p className="fd-muted">历史图片可按张下载；切回原选题后可打包下载。</p>}
   <details className="fd-body-preview"><summary>查看文案内容</summary><pre>{readerArticleText(version.body||'')||'该稿件暂无正文。'}</pre></details>
   <a className="fd-original" href={'#studio/works?record='+encodeURIComponent(version.content_id)}>在作品与素材中查看原稿 <ArrowUpRight size={14}/></a>
  </section>;
 };
 const independent=data?.assets||[],unassigned=data?.unassigned||[];
 return <section className="cf-deliverables fd-workspace" aria-label="平台发布素材">
  <header className="fd-heading"><div><span className="fd-eyebrow">发布素材</span><h3>按平台整理，选定一稿再使用</h3><p>当前选题：<strong>{friendly(data?.topic_title||topicTitle,'尚未确定选题')}</strong></p></div><button type="button" disabled={loading||busy} onClick={()=>{setNotice('');setReload(n=>n+1)}}><RefreshCw size={15}/>{loading?'正在读取…':'刷新素材'}</button></header>
  <nav className="fd-platform-tabs" role="tablist" aria-label="稿件平台">{platforms.map(([key,label])=>{const count=groups.find(g=>g.platform===key)?.versions.length||0;return <button role="tab" aria-selected={platform===key} disabled={busy} key={key} onClick={()=>{setPlatform(key);setNotice('')}}><PlatformIcon platform={key==='video'?'channels':key} size={25}/><span>{label}<small>{count?' '+count+' 份稿件':' 暂无稿件'}</small></span></button>})}</nav>
  {loading?<p className="fd-empty" role="status">正在读取当前选题的各平台素材…</p>:error&&!data?<div className="fd-warning" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重新读取</button></div>:!selected?<div className="fd-empty">当前选题还没有{platforms.find(([key])=>key===platform)?.[1]}稿件。可切换平台，或返回多平台创作。</div>:<><div className="fd-version-picker"><label>选择这次要使用的稿件<select aria-label="选择平台稿件版本" disabled={busy} value={selected.content_id} onChange={e=>{setVersions(old=>({...old,[platform]:e.target.value}));setNotice('')}}>{items.map((v,index)=><option key={v.content_id} value={v.content_id}>{'稿件 '+String(index+1).padStart(2,'0')+' · '+friendly(v.title,'未命名文稿')+' · v'+v.version+(v.content_id===selectedContentId||v.selected?' · 已选入作品':'')}</option>)}</select></label><span>一次只展示这份稿件的图片</span></div>{renderVersion(selected)}</>}
  {!!independent.length&&<details className="fd-recovery"><summary>本选题的独立素材 · {independent.length} 项</summary><p>这些素材尚未关联到上方文稿。</p><div className="fd-independent-grid">{independent.map((asset,index)=><div key={asset.id} className="fd-independent-card"><div className="fd-independent-preview"><Media asset={{...asset,title:({image:'独立图片',video:'视频成片',audio:'配音'} as Record<string,string>)[asset.asset_type]+' '+String(index+1).padStart(2,'0')}}/></div><strong>{friendly(asset.title,'独立素材 '+String(index+1).padStart(2,'0'))}</strong><button disabled={busy} onClick={()=>void run(()=>download('/studio/assets/'+asset.id+'/file',friendly(asset.filename||asset.name,`素材${index+1}${({image:'.png',video:'.mp4',audio:'.mp3'} as Record<string,string>)[asset.asset_type]||''}`)),'已发起素材下载。')}><Download size={14}/>下载素材</button></div>)}</div></details>}
  {!!(history.length||unassigned.length)&&<details className="fd-recovery"><summary>找回历史与未归类素材 · {history.length+unassigned.length} 项</summary><p>其他选题和归属待确认的内容保留在这里，不计入当前平台稿件。</p>{!!history.length&&<button onClick={()=>{setHistoryOpen(true);setHistoryId(history[0].content_id)}}><Archive size={15}/>查看历史稿件 · {history.length} 份</button>}{!!unassigned.length&&<a href="#studio/assets">到作品与素材找回未归类素材 · {unassigned.length} 项 <ArrowUpRight size={14}/></a>}</details>}
  {notice&&<p role="status" className="fd-notice">{notice}</p>}{error&&data&&<p role="alert" className="fd-warning">{error}</p>}
  {historyOpen&&historical&&<StudioModal title="找回历史稿件" onClose={()=>setHistoryOpen(false)}><div className="fd-history"><p>查看历史不会改变当前选题或已选稿件。</p><label>选择历史稿件<select aria-label="选择历史稿件" value={historical.content_id} onChange={e=>setHistoryId(e.target.value)}>{history.map(v=><option key={v.content_id} value={v.content_id}>{friendly(v.topic_title||v.title,'历史稿件')+' · '+v.format+' · v'+v.version}</option>)}</select></label>{renderVersion(historical,true)}{notice&&<p role="status" className="fd-notice">{notice}</p>}{error&&<p role="alert" className="fd-warning">{error}</p>}</div></StudioModal>}
 </section>;
}
