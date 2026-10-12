import {useRef,useState} from 'react';
import ArticleImagePicker from './ArticleImagePicker';
import {api,getToken} from './api';
import {textBookmark,type TextBookmark} from './article-position';
import './article-recovery.css';

// Legacy outcome entry. Current platform outcomes use PlatformArticleOutcome.
export default function ArticleImages({t,content,body,save,dirty,disabled}:any){
 const [tab,setTab]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const bookmark=useRef<TextBookmark|null>(null),copies=useRef(new Map<string,string>());
 const open=(value:string)=>{const editor=document.querySelector<HTMLTextAreaElement>('.document-editor');bookmark.current=textBookmark(body,editor?.selectionStart??body.length,editor?.selectionEnd??body.length);setTab(value);setError('')};
 const insert=async(pic:any,caption:string,place:string)=>{
  try{
   const mark=bookmark.current;if(!mark)throw Error('请重新选择插入位置');
   if(place==='cursor'&&mark.body!==body)throw Error('正文已变化，请重新选择插入位置；图片保留在素材库');
   let id=copies.current.get(pic.id);
   if(!id){const response=await fetch(pic.file_url||'/api/studio/assets/'+pic.id+'/file',{headers:{Authorization:'Bearer '+getToken()}});if(!response.ok)throw Error('图片读取失败');const form=new FormData();form.append('file',new File([await response.blob()],pic.title||'配图.png',{type:pic.mime_type||'image/png'}));const r=await api('/content/'+content.id+'/illustrations/upload',form);id=r.illustration_id;copies.current.set(pic.id,id!)}
   if(dirty)await save();
   const state=await api('/state/updates?ids='+content.id),row=state.items.find((x:any)=>x.id===content.id);
   if(!row||row.body!==body)throw Error('服务器正文已变化，请先比较版本；选中图片与插入位置仍保留');
   const index=place==='start'?0:place==='end'?body.length:mark.start;
   await api('/content/'+content.id+'/illustrations/insert',{illustration_id:id,version:row.version,position:Array.from(body.slice(0,index)).length,caption:caption||pic.title});
   setNotice('图片已插入正文当前位置并保存');setTab(null);await t.refresh();
  }catch(e:any){setError(e.message);throw e}
 };
 return <div className="article-images" data-error-target={content.id}><button type="button" disabled={disabled} onClick={()=>open('library')}>素材库插图</button><button type="button" disabled={disabled} onClick={()=>open('generate')}>AI 生成新配图</button>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>{setTab(null);document.querySelector<HTMLTextAreaElement>('.document-editor')?.focus()}}>返回正文解决</button></p>}{tab&&<ArticleImagePicker content={content} owner={t.state.user.id} initialTab={tab} context={bookmark.current?.context} onClose={()=>setTab(null)} onInsert={insert}/>}</div>;
}
