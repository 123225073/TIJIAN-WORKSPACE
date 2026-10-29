import {useEffect,useRef,useState} from 'react';
import ArticleImagePicker from './ArticleImagePicker';
import ArticlePictureBatch from './ArticlePictureBatch';
import SocialPicturePanel from './SocialPicturePanel';
import {batchKey,batchBlocksSingle} from './article-picture-batch';
import {api,getToken,download,exportedHTML} from './api';
import Markdown from './Markdown';
import {readerArticleText} from './wechat-rich';
import {useArticleDraft,ArticleDraftFeedback} from './article-draft';
import {textBookmark,imageTag,insertAtBookmark,type TextBookmark} from './article-position';
import './article-editor.css';
import {usePairedScroll} from './usePairedScroll';
import {repairLegacySpeechTitle,speechFromContent} from './speech-helper';

export default function ArticleEditor({asset,t,onSaveReady}:{asset:any;t:any;onSaveReady?:(save:(()=>Promise<any>)|null)=>void}){
 const key='studio-content-edit:'+t.state.user.id+':'+asset.id;
 const wechat=['公众号文章','公众号'].includes(asset.format),social=['小红书文案','朋友圈文案'].includes(asset.format),oral=asset.format==='口播脚本';
 const draft=useArticleDraft({content:asset,key,fields:row=>({title:row.title??'',author:row.author??'',body:row.body??row.text??'',image_asset_ids:Array.isArray(row.image_asset_ids)?row.image_asset_ids:[]}),path:'/objects/'+asset.id,refresh:t.refresh});
 useEffect(()=>{onSaveReady?.(draft.save);return()=>onSaveReady?.(null)},[onSaveReady,draft.save]);
 const [titleRepaired,setTitleRepaired]=useState(false);
 useEffect(()=>{
  const serverTitle=String(asset.title??''),repaired=oral?repairLegacySpeechTitle(serverTitle):null;
  // Never replace a separate local title edit. The repair stays in the local
  // draft and follows the existing version check when the user saves/transfers.
  if(repaired!==null&&draft.values.title===serverTitle){draft.change('title',repaired);setTitleRepaired(true)}else setTitleRepaired(false);
 },[asset.id,asset.version,oral]);
 const body=String(draft.values.body),bodyRef=useRef(body);bodyRef.current=body;
 const [mode,setMode]=useState('split'),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pictures,setPictures]=useState<string|null>(null),[feedback,setFeedback]=useState('');
 const textarea=useRef<HTMLTextAreaElement>(null),selection=useRef({start:body.length,end:body.length}),bookmark=useRef<TextBookmark|null>(null),lock=useRef(false);
 const previewPane=useRef<HTMLDivElement>(null);
 usePairedScroll(textarea,previewPane,mode==='split');
 const positionKey='article-position:'+t.state.user.id+':'+asset.id;
 const change=(value:string)=>{draft.change('body',value);bodyRef.current=value};
 const assertBatchClear=()=>{if(batchBlocksSingle(batchKey(t.state.user.id,asset.id)))throw Error('三图任务尚未结束或尚未回填，请先查看三图进度。')};
 const action=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false)}};
 const capture=()=>{const field=textarea.current;const mark=textBookmark(bodyRef.current,field?.selectionStart??selection.current.start,field?.selectionEnd??selection.current.end);bookmark.current=mark;localStorage.setItem(positionKey,JSON.stringify(mark));return mark};
 const open=(tab:string)=>{try{assertBatchClear();const pending=JSON.parse(localStorage.getItem('article-picture:'+t.state.user.id+':'+asset.id)||'{}').pending;if(pending){bookmark.current=JSON.parse(localStorage.getItem(positionKey)||'null');if(!bookmark.current)throw Error('插入位置已丢失')}else capture();setPictures(tab);setError('')}catch(e:any){setError(e.message||'插入位置暂存失败，请检查本机存储空间')}};
 const insert=(before:string,after='')=>{const {start,end}=selection.current;change(body.slice(0,start)+before+body.slice(start,end)+after+body.slice(end));setMode(mode==='preview'?'split':mode);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+before.length,end+before.length)})};
 const insertFile=async(file:File,caption=file.name,place='cursor',mark=capture())=>{
  assertBatchClear();const form=new FormData();form.append('file',file);const row=await api('/content/'+asset.id+'/illustrations/upload',form);
  const next=insertAtBookmark(bodyRef.current,mark,imageTag(caption,'/api/illustrations/'+row.illustration_id+'/file'),place);
  change(next.body);setMode('split');setFeedback('图片已插入正文当前位置 · 已暂存本机，请保存修改');setPictures(null);
  requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.position,next.position);selection.current={start:next.position,end:next.position}});
 };
 const actualWords=Array.from(body.replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/\s/g,'')).length;
 if(oral){
  const extracted=speechFromContent({body,title:draft.values.title,format:asset.format});
  return <section className="article-editor oral-editor" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void draft.save().catch(()=>{})}}}>
   <div className="oral-editor-head"><div><span>口播文稿</span><h3>修改要说的话</h3><p>只填写需要朗读的内容。保存后可用于数字人视频或配音。</p></div><div><small>{actualWords} 字 · {draft.dirty?'有未保存修改':'已保存稿件 v'+draft.version}</small><button className="st-primary" disabled={draft.saving||!draft.dirty} onClick={()=>void draft.save().catch(()=>{})}>保存修改</button></div></div>
   <ArticleDraftFeedback draft={draft} id={asset.id}/>
   <div className="article-metadata"><label>文稿名称 <small>仅用于管理，不会朗读</small><input aria-label="文稿标题" value={draft.values.title} onChange={e=>draft.change('title',e.target.value)}/></label></div>
   {titleRepaired&&draft.dirty&&<p className="oral-title-repaired" role="status">已从旧稿名称移除误带入的系统说明；请保存修改。</p>}
   {extracted.text!==body.trim()&&<div className="oral-conversion"><span>检测到格式标记或结构化内容，可先核对并提取口播正文。</span><button type="button" onClick={()=>change(extracted.text)}>提取可朗读正文</button></div>}
   <label className="oral-body-label">口播正文<textarea ref={textarea} data-enter="newline" aria-label="编辑生成文稿" value={body} onChange={e=>change(e.target.value)} placeholder="在这里输入数字人要说的话"/></label>
   <footer className="md-footer"><span>{draft.dirty?'保存后再用于制作':'可直接用于数字人或配音 · Ctrl+S 保存'}</span><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{const saved=await draft.save();await navigator.clipboard.writeText(saved.body||'');setFeedback('口播正文已复制')})}>复制口播正文</button></footer>
   {error&&<p role="alert" className="st-alert">{error}</p>}{feedback&&<p role="status" className="article-insertion-feedback">{feedback}</p>}
  </section>;
 }
 const embeddedTitle=/^\s*(?:#{1,2}\s+([^\n]+)|(?:\*\*)?标题[：:](?:\*\*)?\s*(.+?)(?:\*\*)?)\s*(?:\r?\n|$)/.exec(body);
 const bodyTitle=embeddedTitle?(embeddedTitle[1]||embeddedTitle[2]||'').trim().replace(/\*\*$/,'').trim():'';
 return <section className={'article-editor'+(expanded?' md-expanded':'')} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void draft.save().catch(()=>{})}}}>
  <div className="md-toolbar st-text-toolbar"><div role="tablist" aria-label="文稿视图">{[['source','编辑'],['split','双栏'],['preview','预览']].map(([value,label])=><button role="tab" aria-selected={mode===value} key={value} onClick={()=>setMode(value)}>{label}</button>)}</div><small>正文约 {actualWords} 字{asset.target_words?' · 目标约 '+asset.target_words+' 字':''} · {draft.dirty?'有未保存修改':'已保存稿件 v'+draft.version}</small><button onClick={()=>setExpanded(!expanded)}>{expanded?'收起编辑器':'展开编辑器'}</button><button className="st-primary" disabled={draft.saving||!draft.dirty} onClick={()=>void draft.save().catch(()=>{})}>保存修改</button></div>
  <ArticleDraftFeedback draft={draft} id={asset.id}/>
  <div className="article-metadata"><label>{asset.format==='朋友圈文案'?'首句或标题（可选）':'标题'}<input aria-label="文稿标题" value={draft.values.title} onChange={e=>draft.change('title',e.target.value)}/></label>{wechat&&<label>作者（可选）<input aria-label="文稿作者" maxLength={64} value={draft.values.author} placeholder="填写署名，可留空" onChange={e=>draft.change('author',e.target.value)}/></label>}{social&&<button disabled={busy} onClick={()=>void action(async()=>{await navigator.clipboard.writeText(draft.values.title);setFeedback('标题已复制')})}>复制标题</button>}</div>
  {bodyTitle&&bodyTitle!==String(draft.values.title).trim()&&<div className="article-title-conflict" role="status"><span>正文开头的标题与上方标题不同：{bodyTitle}</span><button type="button" onClick={()=>{draft.change('title',bodyTitle);change(body.slice(embeddedTitle![0].length))}}>采用正文标题并移除重复标题</button><button type="button" onClick={()=>change(body.slice(embeddedTitle![0].length))}>保留上方标题并移除正文标题</button></div>}
  {social&&<SocialPicturePanel content={{...asset,...draft.values}} owner={t.state.user.id} ids={draft.values.image_asset_ids} onChange={ids=>draft.change('image_asset_ids',ids)} disabled={busy||draft.saving}/>}
  {['公众号文章','公众号'].includes(asset.format)&&<ArticlePictureBatch key={t.state.user.id+':'+asset.id} content={asset} owner={t.state.user.id} save={draft.save} getBody={()=>bodyRef.current} disabled={busy||!!pictures} onApply={(expected,next)=>{if(bodyRef.current!==expected)throw Error('正文已变化，图片保留在素材库，未覆盖修改');change(next);if(JSON.parse(localStorage.getItem(key)||'null')?.values?.body!==next)throw Error('配图正文暂存失败，请检查本机存储');setFeedback('三图进度已回填正文 · 已暂存本机，请保存修改')}}/>}
  {mode!=='preview'&&<div className="md-format"><button onClick={()=>insert('## ')}>标题</button><button onClick={()=>insert('**','**')}>粗体</button><button onClick={()=>insert('*','*')}>斜体</button><button onClick={()=>insert('\n- ')}>列表</button><button onClick={()=>insert('\n> ')}>引用</button><button onClick={()=>insert('[','](https://)')}>链接</button>{!social&&<><label className="md-upload" onPointerDown={()=>capture()}>上传图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f){const mark=bookmark.current||capture();void action(()=>insertFile(f,f.name,'cursor',mark))}e.target.value=''}}/></label><button disabled={busy} onClick={()=>open('library')}>素材库插图</button><button disabled={busy} onClick={()=>open('generate')}>AI 生成配图</button></>}<small>{social?"配图在上方单独管理 · Ctrl+S 保存":"可粘贴或拖入图片 · Ctrl+S 保存"}</small></div>}
  {pictures&&<ArticleImagePicker content={asset} owner={t.state.user.id} initialTab={pictures} context={bookmark.current?.context} onClose={()=>setPictures(null)} onInsert={async(pic,caption,place)=>{const mark=bookmark.current||JSON.parse(localStorage.getItem(positionKey)||'null');if(!mark)throw Error('请回到正文重新选择插入位置，图片保留在素材库');const response=await fetch(pic.file_url||'/api/studio/assets/'+pic.id+'/file',{headers:{Authorization:'Bearer '+getToken()}});if(!response.ok)throw Error('素材读取失败，图片仍保留在素材库');await insertFile(new File([await response.blob()],pic.title||'素材.png',{type:pic.mime_type||'image/png'}),caption||pic.title,place,mark)}}/>}
  {error&&<p role="alert" className="st-alert">{error}</p>}{feedback&&<p role="status" className="article-insertion-feedback">{feedback}</p>}
  <div className={'md-body md-'+mode}>{mode!=='preview'&&<textarea ref={textarea} data-enter="newline" aria-label="编辑生成文稿" readOnly={busy||!!pictures} value={body} onChange={e=>change(e.target.value)} onSelect={e=>{selection.current={start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd}}} onPaste={e=>{const file=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();if(social){setFeedback("请在上方配图素材中添加图片，正文与图片分别保存");return}const mark=capture();void action(()=>insertFile(file,file.name,'cursor',mark))}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{const f=e.dataTransfer.files[0];if(f?.type.startsWith('image/')){e.preventDefault();if(social){setFeedback("请在上方配图素材中添加图片，正文与图片分别保存");return}const mark=capture();void action(()=>insertFile(f,f.name,'cursor',mark))}}}/>} {mode!=='source'&&<div ref={previewPane} className="md-rendered"><Markdown text={readerArticleText(body)}/></div>}</div>
  <footer className="md-footer"><span>{draft.dirty?'保存后再导出或传递给下一步':'使用已保存版本导出；不会发布到外部平台'}</span><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{const saved=await draft.save();if(wechat){const html=await exportedHTML(asset.id);await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([readerArticleText(saved.body||'')],{type:'text/plain'})})]);setFeedback('已复制图文，可粘贴到公众号编辑器后核对图片与排版')}else{await navigator.clipboard.writeText(readerArticleText(saved.body||''));setFeedback('已复制文案')}})}>{wechat?'复制公众号图文':'复制文案'}</button><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{const saved=await draft.save();await download('/content/'+asset.id+'/export?format=html&include_metadata=true',(saved.title||'文稿')+'.html')})}>导出图文 HTML</button></footer>
 </section>;
}
