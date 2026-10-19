import {useState} from 'react';
import {download,exportedHTML} from './api';
import {readerArticleText,markdownToEditorHtml} from './wechat-rich';
import {Media} from './ResourcePreview';

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

export default function FlowDeliverables({contents,assets,imageAssets=assets}:{contents:any[];assets:any[];imageAssets?:any[]}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const referenced=new Set(contents.flatMap(c=>socialImagesForContent(c,imageAssets).map(a=>a.id)));
 const run=async(fn:()=>Promise<void>,message:string)=>{if(busy)return;setBusy(true);try{await fn();setNotice(message)}catch(e:any){setNotice(e.message)}finally{setBusy(false)}};
 return <section className="cf-deliverables"><h3>复制或下载已完成内容</h3><p>选好要使用的版本。下载时可选择保存位置，图片与视频可单独使用。</p>
 {!contents.length&&!assets.length&&<p>还没有完成的内容，先到“多平台创作”制作。</p>}
 {contents.map(c=><section key={c.id} aria-label={c.title+'交付内容'}><article><div><strong>{c.title}</strong><small>{c.format||'文稿'} · v{c.version}</small></div><button disabled={busy} onClick={()=>void run(async()=>{const text=readerArticleText(c.body||'');if(c.format==='公众号文章'){const html=await exportedHTML(c.id);await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})])}else await navigator.clipboard.writeText(text)},c.format==='公众号文章'?'图文已复制，请到公众号编辑器粘贴并核对图片。':'文案已复制。')}>{c.format==='公众号文章'?'复制图文':'复制文案'}</button><button disabled={busy} onClick={()=>void run(()=>download('/content/'+c.id+'/export?format=html&include_metadata=true',(c.title||'文稿')+'.html'),'已打开下载，请选择保存位置。')}>下载文稿</button></article>{socialImagesForContent(c,imageAssets).map((a,index)=><article key={a.id} data-content-id={c.id} data-image-asset-id={a.id}><div className="st-asset-media" style={{width:88,height:64,flex:'0 0 88px'}}><Media asset={a} noZoom/></div><div><strong>{a.title||'图片'}</strong><small>配图 {index+1}{index===0?' · 首图':''} · 按文稿保存的顺序</small></div><button disabled={busy} aria-label={'下载'+c.title+'配图'+(index+1)} onClick={()=>void run(()=>download('/studio/assets/'+a.id+'/file',a.filename||a.name||(a.title||'配图')+'.png'),'已打开下载，请选择保存位置。')}>下载配图</button></article>)}</section>)}
 {assets.filter(a=>!referenced.has(a.id)&&!a.archived&&!a.deleted&&a.status==='ready'&&['image','video','audio'].includes(a.asset_type)).map(a=><article key={a.id}><div><strong>{a.title||'素材'}</strong><small>{{image:'图片',video:'视频',audio:'声音'}[a.asset_type as string]}</small></div><button disabled={busy} onClick={()=>void run(()=>download('/studio/assets/'+a.id+'/file',a.filename||a.name||(a.title||'素材')+({image:'.png',video:'.mp4',audio:'.mp3'}[a.asset_type as string]||'')),'已打开下载，请选择保存位置。')}>下载</button></article>)}
 {notice&&<p role="status">{notice}</p>}</section>;
}
