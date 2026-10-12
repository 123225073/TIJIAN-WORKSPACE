import {useRef,useState} from 'react';
import ArticleImagePicker from './ArticleImagePicker';
import {api,getToken,download} from './api';
import Markdown from './Markdown';
import {readerArticleText} from './wechat-rich';
import {useArticleDraft,ArticleDraftFeedback} from './article-draft';
import {textBookmark,imageTag,insertAtBookmark,type TextBookmark} from './article-position';
import './article-editor.css';

export default function ArticleEditor({asset,t}:{asset:any;t:any}){
 const key='studio-content-edit:'+t.state.user.id+':'+asset.id;
 const draft=useArticleDraft({content:asset,key,fields:row=>({body:row.body??row.text??''}),path:'/objects/'+asset.id,refresh:t.refresh});
 const body=String(draft.values.body),bodyRef=useRef(body);bodyRef.current=body;
 const [mode,setMode]=useState('preview'),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pictures,setPictures]=useState<string|null>(null),[feedback,setFeedback]=useState('');
 const textarea=useRef<HTMLTextAreaElement>(null),selection=useRef({start:body.length,end:body.length}),bookmark=useRef<TextBookmark|null>(null),lock=useRef(false);
 const positionKey='article-position:'+t.state.user.id+':'+asset.id;
 const change=(value:string)=>draft.change('body',value);
 const action=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false)}};
 const capture=()=>{const field=textarea.current;const mark=textBookmark(bodyRef.current,field?.selectionStart??selection.current.start,field?.selectionEnd??selection.current.end);bookmark.current=mark;localStorage.setItem(positionKey,JSON.stringify(mark));return mark};
 const open=(tab:string)=>{try{const pending=JSON.parse(localStorage.getItem('article-picture:'+t.state.user.id+':'+asset.id)||'{}').pending;if(pending){bookmark.current=JSON.parse(localStorage.getItem(positionKey)||'null');if(!bookmark.current)throw Error('插入位置已丢失')}else capture();setPictures(tab);setError('')}catch{setError('插入位置暂存失败，请检查本机存储空间')}};
 const insert=(before:string,after='')=>{const {start,end}=selection.current;change(body.slice(0,start)+before+body.slice(start,end)+after+body.slice(end));setMode(mode==='preview'?'split':mode);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+before.length,end+before.length)})};
 const insertFile=async(file:File,caption=file.name,place='cursor',mark=capture())=>{
  const form=new FormData();form.append('file',file);const row=await api('/content/'+asset.id+'/illustrations/upload',form);
  const next=insertAtBookmark(bodyRef.current,mark,imageTag(caption,'/api/illustrations/'+row.illustration_id+'/file'),place);
  change(next.body);setMode('split');setFeedback('图片已插入正文当前位置 · 已暂存本机，请保存修改');setPictures(null);
  requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.position,next.position);selection.current={start:next.position,end:next.position}});
 };
 const actualWords=Array.from(body.replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/\s/g,'')).length;
 return <section className={'article-editor'+(expanded?' md-expanded':'')} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void draft.save().catch(()=>{})}}}>
  <div className="md-toolbar st-text-toolbar"><div role="tablist" aria-label="文稿视图">{[['source','编辑'],['split','双栏'],['preview','预览']].map(([value,label])=><button role="tab" aria-selected={mode===value} key={value} onClick={()=>setMode(value)}>{label}</button>)}</div><small>正文约 {actualWords} 字{asset.target_words?' · 目标约 '+asset.target_words+' 字':''} · {draft.dirty?'有未保存修改':'已保存稿件 v'+draft.version}</small><button onClick={()=>setExpanded(!expanded)}>{expanded?'收起编辑器':'展开编辑器'}</button><button className="st-primary" disabled={draft.saving||!draft.dirty} onClick={()=>void draft.save().catch(()=>{})}>保存修改</button></div>
  <ArticleDraftFeedback draft={draft} id={asset.id}/>
  {mode!=='preview'&&<div className="md-format"><button onClick={()=>insert('## ')}>标题</button><button onClick={()=>insert('**','**')}>粗体</button><button onClick={()=>insert('*','*')}>斜体</button><button onClick={()=>insert('\n- ')}>列表</button><button onClick={()=>insert('\n> ')}>引用</button><button onClick={()=>insert('[','](https://)')}>链接</button><label className="md-upload" onPointerDown={()=>capture()}>上传图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f){const mark=bookmark.current||capture();void action(()=>insertFile(f,f.name,'cursor',mark))}e.target.value=''}}/></label><button disabled={busy} onClick={()=>open('library')}>素材库插图</button><button disabled={busy} onClick={()=>open('generate')}>AI 生成配图</button><small>可粘贴或拖入图片 · Ctrl+S 保存</small></div>}
  {pictures&&<ArticleImagePicker content={asset} owner={t.state.user.id} initialTab={pictures} context={bookmark.current?.context} onClose={()=>setPictures(null)} onInsert={async(pic,caption,place)=>{const mark=bookmark.current||JSON.parse(localStorage.getItem(positionKey)||'null');if(!mark)throw Error('请回到正文重新选择插入位置，图片保留在素材库');const response=await fetch(pic.file_url||'/api/studio/assets/'+pic.id+'/file',{headers:{Authorization:'Bearer '+getToken()}});if(!response.ok)throw Error('素材读取失败，图片仍保留在素材库');await insertFile(new File([await response.blob()],pic.title||'素材.png',{type:pic.mime_type||'image/png'}),caption||pic.title,place,mark)}}/>}
  {error&&<p role="alert" className="st-alert">{error}</p>}{feedback&&<p role="status" className="article-insertion-feedback">{feedback}</p>}
  <div className={'md-body md-'+mode}>{mode!=='preview'&&<textarea ref={textarea} data-enter="newline" aria-label="编辑生成文稿" readOnly={busy||!!pictures} value={body} onChange={e=>change(e.target.value)} onSelect={e=>{selection.current={start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd}}} onPaste={e=>{const file=Array.from(e.clipboardData.files).find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();const mark=capture();void action(()=>insertFile(file,file.name,'cursor',mark))}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{const f=e.dataTransfer.files[0];if(f?.type.startsWith('image/')){e.preventDefault();const mark=capture();void action(()=>insertFile(f,f.name,'cursor',mark))}}}/>} {mode!=='source'&&<div className="md-rendered"><Markdown text={readerArticleText(body)}/></div>}</div>
  <footer className="md-footer"><span>{draft.dirty?'保存后再导出或传递给下一步':'使用已保存版本导出；不会发布到外部平台'}</span><button disabled={busy||draft.saving} onClick={()=>void action(async()=>{await draft.save();await download('/content/'+asset.id+'/export?format=html',(asset.title||'文稿')+'.html')})}>导出图文 HTML</button></footer>
 </section>;
}
