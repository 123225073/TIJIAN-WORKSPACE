import {useEffect,useRef,useState} from 'react';
import ArticleImagePicker from './ArticleImagePicker';
import ArticlePictureBatch from './ArticlePictureBatch';
import ArticleImageRail from './ArticleImageRail';
import SocialPicturePanel from './SocialPicturePanel';
import {batchKey,batchBlocksSingle} from './article-picture-batch';
import {api,getToken,download,exportedHTML} from './api';
import Markdown from './Markdown';
import {readerArticleText} from './wechat-rich';
import {useArticleDraft,ArticleDraftFeedback} from './article-draft';
import {textBookmark,imageTag,insertAtBookmark,type TextBookmark} from './article-position';
import './article-editor.css';
import './article-canvas.css';
import ArticleRichEditor,{type ArticleBookmark,type RichEditorHandle} from './ArticleRichEditor';
import WechatLayoutProof,{defaultWechatStyle} from './WechatLayoutProof';
import MatrixPublish from './MatrixPublish';
import MatrixPublication from './MatrixPublication';
import {usePairedScroll} from './usePairedScroll';
import {repairLegacySpeechTitle,speechFromContent} from './speech-helper';

export default function ArticleEditor({asset,t,onSaveReady,matrixPublication=false,onSaved}:{asset:any;t:any;onSaveReady?:(save:(()=>Promise<any>)|null)=>void;matrixPublication?:boolean;onSaved?:()=>void}){
 const key='studio-content-edit:'+t.state.user.id+':'+asset.id;
 const wechat=['公众号文章','公众号'].includes(asset.format),social=['小红书文案','朋友圈文案'].includes(asset.format),oral=asset.format==='口播脚本';
 const richMode=wechat||matrixPublication;
 const draft=useArticleDraft({content:asset,key,fields:row=>({title:row.title??'',author:row.author??'',body:row.body??row.text??'',image_asset_ids:Array.isArray(row.image_asset_ids)?row.image_asset_ids:[],...(wechat?{wechat_style:{...defaultWechatStyle,template:'editorial',...row.wechat_style}}:{})}),path:'/objects/'+asset.id,refresh:async()=>{await t.refresh();onSaved?.()}});
 useEffect(()=>{onSaveReady?.(draft.save);return()=>onSaveReady?.(null)},[onSaveReady,draft.save]);
 const [titleRepaired,setTitleRepaired]=useState(false);
 useEffect(()=>{
  const serverTitle=String(asset.title??''),repaired=oral?repairLegacySpeechTitle(serverTitle):null;
  // Never replace a separate local title edit. The repair stays in the local
  // draft and follows the existing version check when the user saves/transfers.
  if(repaired!==null&&draft.values.title===serverTitle){draft.change('title',repaired);setTitleRepaired(true)}else setTitleRepaired(false);
 },[asset.id,asset.version,oral]);
 const body=String(draft.values.body),bodyRef=useRef(body);bodyRef.current=body;
 const [mode,setMode]=useState(richMode?'visual':'split'),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pictures,setPictures]=useState<string|null>(null),[feedback,setFeedback]=useState('');
 const textarea=useRef<HTMLTextAreaElement>(null),selection=useRef({start:body.length,end:body.length}),bookmark=useRef<TextBookmark|null>(null),lock=useRef(false);
 const rich=useRef<RichEditorHandle>(null),richMark=useRef<ArticleBookmark|null>(null);
 const previewPane=useRef<HTMLDivElement>(null);
 usePairedScroll(textarea,previewPane,mode==='split');
 const positionKey='article-position:'+t.state.user.id+':'+asset.id;
 const change=(value:string)=>{draft.change('body',value);bodyRef.current=value};
 const assertBatchClear=()=>{if(batchBlocksSingle(batchKey(t.state.user.id,asset.id)))throw Error('三图任务尚未结束或尚未回填，请先查看三图进度。')};
 const action=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false)}};
 const capture=()=>{richMark.current=richMode?rich.current?.bookmark()||null:null;if(richMark.current)localStorage.setItem(positionKey+':rich',JSON.stringify(richMark.current));const field=textarea.current;const mark=textBookmark(bodyRef.current,field?.selectionStart??selection.current.start,field?.selectionEnd??selection.current.end);bookmark.current=mark;localStorage.setItem(positionKey,JSON.stringify(mark));return mark};
 const open=(tab:string)=>{try{assertBatchClear();const pending=JSON.parse(localStorage.getItem('article-picture:'+t.state.user.id+':'+asset.id)||'{}').pending;if(pending){bookmark.current=JSON.parse(localStorage.getItem(positionKey)||'null');if(!bookmark.current)throw Error('插入位置已丢失')}else capture();setPictures(tab);setError('')}catch(e:any){setError(e.message||'插入位置暂存失败，请检查本机存储空间')}};
 const insert=(before:string,after='')=>{const {start,end}=selection.current;change(body.slice(0,start)+before+body.slice(start,end)+after+body.slice(end));setMode(mode==='preview'?'split':mode);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+before.length,end+before.length)})};
 const insertFile=async(file:File,caption=file.name,place='cursor',mark=capture())=>{
  assertBatchClear();const form=new FormData();form.append('file',file);const row=await api('/content/'+asset.id+'/illustrations/upload',form);
  const imagePath='/api/illustrations/'+row.illustration_id+'/file';
  if(richMode&&place==='cursor'){
   const position=richMark.current||JSON.parse(localStorage.getItem(positionKey+':rich')||'null');
   if(!rich.current||!position)throw Error('请在正文重新选择插入位置，图片已保留');
   rich.current.insertImages([{id:row.illustration_id,title:caption,file_url:imagePath}],position);
   setFeedback('图片已插入正文 · 请保存修改');setPictures(null);return;
  }
  const next=insertAtBookmark(bodyRef.current,mark,imageTag(caption,imagePath),place);
  change(next.body);setMode(richMode?'visual':'split');setFeedback('图片已插入正文当前位置 · 已暂存本机，请保存修改');setPictures(null);
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
 const embeddedTitle=/^\s*(?:#\s+([^\n]+)|(?:\*\*)?标题[：:](?:\*\*)?\s*(.+?)(?:\*\*)?)\s*(?:\r?\n|$)/.exec(body);
 const bodyTitle=embeddedTitle?(embeddedTitle[1]||embeddedTitle[2]||'').trim().replace(/\*\*$/,'').trim():'';
 const hasLegacyBatch=Boolean(localStorage.getItem(batchKey(t.state.user.id,asset.id)));
 const insertAsset=async(pic:any,caption:string,place:string,mark=bookmark.current||capture())=>{
  const response=await fetch(pic.file_url||'/api/studio/assets/'+pic.id+'/file',{headers:{Authorization:'Bearer '+getToken()}});
  if(!response.ok)throw Error('素材读取失败，图片仍保留在素材库');
  await insertFile(new File([await response.blob()],pic.title||'素材.png',{type:pic.mime_type||'image/png'}),caption||pic.title,place,mark);
 };
 const articleSettings=draft.values.wechat_style||defaultWechatStyle;
 const bodyEditor=<ArticleRichEditor ref={rich} value={body} onChange={change} readOnly={mode==='preview'||busy||!!pictures} label={wechat?'公众号文章正文':'文章正文'} fontSize={articleSettings.font_size} lineHeight={articleSettings.line_height} paragraphGap={articleSettings.paragraph_gap} accent={articleSettings.accent} onDropAsset={id=>{const mark=capture();void action(async()=>{const r=await fetch('/api/studio/assets/'+encodeURIComponent(id)+'/file',{headers:{Authorization:'Bearer '+getToken()}});if(!r.ok)throw Error('素材读取失败');await insertFile(new File([await r.blob()],'素材图片.png',{type:r.headers.get('content-type')||'image/png'}),'正文配图','cursor',mark)})}} onDropFiles={files=>{const file=Array.from(files).find(f=>f.type.startsWith('image/'));if(file){const mark=capture();void action(()=>insertFile(file,file.name,'cursor',mark))}}}/>;
 return <section className={'article-editor'+(richMode?' article-canvas':'')+(expanded?' md-expanded':'')} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void draft.save().catch(()=>{})}}}>
  <div className="md-toolbar st-text-toolbar">
   <div role="tablist" aria-label="文稿视图">{(richMode?[['visual','编辑文章'],['preview','阅读预览']]:[['source','编辑'],['split','双栏'],['preview','预览']]).map(([value,label])=><button role="tab" aria-selected={mode===value} key={value} onClick={()=>{if(mode==='visual')capture();setMode(value)}}>{label}</button>)}</div>
   <small>{actualWords} 字 · {draft.saving?'保存中…':draft.dirty?'有未保存修改':'已保存 v'+draft.version}</small>
   <div className="article-canvas-actions">{wechat&&<details className="article-canvas-settings"><summary>文章设置</summary><div><label>作者<input aria-label="文稿作者" maxLength={64} value={draft.values.author} placeholder="可留空" onChange={e=>draft.change('author',e.target.value)}/></label><label>排版模板<select value={articleSettings.template||'editorial'} onChange={e=>draft.change('wechat_style',{...articleSettings,template:e.target.value})}><option value="editorial">杂志图文</option><option value="classic">清爽阅读</option></select></label></div></details>}<button onClick={()=>setExpanded(!expanded)}>{expanded?'退出专注':'专注写作'}</button><button className="st-primary" disabled={draft.saving||!draft.dirty} onClick={()=>void draft.save().catch(()=>{})}>保存修改</button></div>
  </div>
  <ArticleDraftFeedback draft={draft} id={asset.id}/>
  {!richMode&&<div className="article-metadata"><label>{asset.format==='朋友圈文案'?'首句或标题（可选）':'标题'}<input aria-label="文稿标题" value={draft.values.title} onChange={e=>draft.change('title',e.target.value)}/></label>{social&&<button disabled={busy} onClick={()=>void action(async()=>{await navigator.clipboard.writeText(draft.values.title);setFeedback('标题已复制')})}>复制标题</button>}</div>}
  {bodyTitle&&bodyTitle!==String(draft.values.title).trim()&&<details className="article-title-conflict article-canvas-title-note"><summary>正文含有另一标题，可选择保留哪一个</summary><p>{bodyTitle}</p><button type="button" onClick={()=>{draft.change('title',bodyTitle);change(body.slice(embeddedTitle![0].length))}}>采用正文标题</button><button type="button" onClick={()=>change(body.slice(embeddedTitle![0].length))}>保留当前标题</button></details>}
  {error&&<p role="alert" className="st-alert">{error}</p>}{feedback&&<p role="status" className="article-insertion-feedback">{feedback}</p>}
  <div className={richMode?'article-canvas-workspace':''}>
   <div className={richMode?'article-canvas-main':''}>
    {mode!=='preview'&&<div className="md-format" role="toolbar" aria-label="文章编辑工具">
     {richMode?<><button disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>rich.current?.format('heading')}>小标题</button><button disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>rich.current?.format('bold')}>加粗</button><button disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={()=>rich.current?.format('bullet')}>列表</button></>:<><button onClick={()=>insert('## ')}>标题</button><button onClick={()=>insert('**','**')}>粗体</button><button onClick={()=>insert('*','*')}>斜体</button><button onClick={()=>insert('\n- ')}>列表</button><button onClick={()=>insert('\n> ')}>引用</button><button onClick={()=>insert('[','](https://)')}>链接</button></>}
     {!social&&<><label className="md-upload" onPointerDown={()=>capture()}>上传图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f){const mark=bookmark.current||capture();void action(()=>insertFile(f,f.name,'cursor',mark))}e.target.value=''}}/></label><button disabled={busy} onClick={()=>open('library')}>素材库</button>{!richMode&&<button disabled={busy} onClick={()=>open('generate')}>AI 生成配图</button>}</>}
     <small>{richMode?'点击正文即可编辑':'可粘贴或拖入图片 · Ctrl+S 保存'}</small>
    </div>}
    {richMode?(mode==='preview'&&wechat?<WechatLayoutProof body={body} settings={articleSettings} title={draft.values.title} author={draft.values.author}/>:<div className={'article-visual-paper '+(articleSettings.template||'editorial')+(mode==='preview'?' article-canvas-reading':'')}>
     <header className="article-paper-heading"><span>{mode==='preview'?'文章预览':'文章正文'}</span>{mode==='preview'?<h1>{draft.values.title||'未命名文章'}</h1>:<textarea rows={1} aria-label="文稿标题" data-enter="newline" placeholder="在这里输入文章标题" value={draft.values.title} onChange={e=>draft.change('title',e.target.value)} ref={node=>{if(node){node.style.height='auto';node.style.height=node.scrollHeight+'px'}}}/>}{draft.values.author&&<p>{draft.values.author}</p>}</header>
     {bodyEditor}
    </div>):<div className={'md-body md-'+mode}>
     {mode!=='preview'&&<textarea ref={textarea} data-enter="newline" aria-label="编辑生成文稿" readOnly={busy||!!pictures} value={body} onChange={e=>change(e.target.value)} onSelect={e=>{selection.current={start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd}}} onPaste={e=>{const file=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();if(social){setFeedback('请在配图素材中添加图片，正文与图片分别保存');return}const mark=capture();void action(()=>insertFile(file,file.name,'cursor',mark))}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{const f=e.dataTransfer.files[0];if(f?.type.startsWith('image/')){e.preventDefault();if(social){setFeedback('请在配图素材中添加图片，正文与图片分别保存');return}const mark=capture();void action(()=>insertFile(f,f.name,'cursor',mark))}}}/>}
     {mode!=='source'&&<div ref={previewPane} className="md-rendered"><Markdown text={readerArticleText(body)}/></div>}
    </div>}
    <footer className="md-footer"><span>{draft.dirty?'修改暂存本机 · 保存后可导出':'当前保存版本可导出 · Ctrl+S 保存'}</span><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{const saved=await draft.save();if(wechat){const html=await exportedHTML(asset.id);await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([readerArticleText(saved.body||'')],{type:'text/plain'})})]);setFeedback('已复制图文，可粘贴到公众号编辑器后核对图片与排版')}else{await navigator.clipboard.writeText(readerArticleText(saved.body||''));setFeedback('已复制文案')}})}>{wechat?'复制公众号图文':'复制文案'}</button><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{const saved=await draft.save();await download('/content/'+asset.id+'/export?format=html&include_metadata=true',(saved.title||'文稿')+'.html')})}>导出 HTML</button></footer>
   </div>
   {richMode&&<aside className="article-canvas-images" aria-label="文章配图">{!social&&<ArticleImageRail key={t.state.user.id+':'+asset.id} content={asset} owner={t.state.user.id} save={draft.save} getBody={()=>bodyRef.current} onApply={(expected,next)=>{if(bodyRef.current!==expected)throw Error('正文已变化，未覆盖修改');change(next);setMode('visual')}} disabled={busy||draft.saving||!!pictures} onCapture={()=>{if(mode==='visual')capture()}} onInsert={(pic,caption,place)=>insertAsset(pic,caption,place,capture())}/>}{social&&<SocialPicturePanel content={{...asset,...draft.values}} owner={t.state.user.id} ids={draft.values.image_asset_ids} onChange={ids=>draft.change('image_asset_ids',ids)} disabled={busy||draft.saving}/>}
    {hasLegacyBatch&&<details className="article-canvas-legacy"><summary>原三图任务与恢复</summary><ArticlePictureBatch key={'legacy:'+t.state.user.id+':'+asset.id} content={asset} owner={t.state.user.id} save={draft.save} getBody={()=>bodyRef.current} disabled={busy||!!pictures} onApply={(expected,next)=>{if(bodyRef.current!==expected)throw Error('正文已变化，图片保留在素材库，未覆盖修改');change(next);if(JSON.parse(localStorage.getItem(key)||'null')?.values?.body!==next)throw Error('配图正文暂存失败，请检查本机存储');setFeedback('三图进度已回填正文 · 已暂存本机，请保存修改')}}/></details>}
   </aside>}
  </div>
  {!richMode&&social&&<SocialPicturePanel content={{...asset,...draft.values}} owner={t.state.user.id} ids={draft.values.image_asset_ids} onChange={ids=>draft.change('image_asset_ids',ids)} disabled={busy||draft.saving}/>}
  {pictures&&<ArticleImagePicker content={asset} owner={t.state.user.id} initialTab={pictures} context={bookmark.current?.context} onClose={()=>setPictures(null)} onInsert={async(pic,caption,place)=>{const mark=bookmark.current||JSON.parse(localStorage.getItem(positionKey)||'null');if(!mark)throw Error('请回到正文重新选择插入位置，图片保留在素材库');await insertAsset(pic,caption,place,mark)}}/>}
  {asset.flow_id&&asset.creation_channel&&(matrixPublication?<MatrixPublication flowId={asset.flow_id} items={[{platform:asset.creation_channel,content_id:asset.id,content_version:draft.version}]} dirty={draft.dirty||draft.saving} compact/>:<MatrixPublish flowId={asset.flow_id} platform={asset.creation_channel} contentId={asset.id} contentVersion={draft.version} dirty={draft.dirty||draft.saving}/>)}
 </section>;
}
