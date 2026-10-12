// Formatting behavior adapted from the local WechatRichEditor. Scoped article insertion and image rendering.
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,getToken} from './api';
import './article-recovery.css';
import {textBookmark} from './article-position';
import {editorToMarkdown,markdownToEditorHtml,WECHAT_COLORS,WECHAT_SIZES} from './wechat-rich';

export type RichFormat='heading'|'heading3'|'paragraph'|'bold'|'bullet'|'numbered'|'color'|'size';
export type ArticleBookmark={body:string;startPath:number[];startOffset:number;endPath:number[];endOffset:number;context:{body:string;start:number;end:number;text:string}};
export type RichEditorHandle={format:(kind:RichFormat,value?:string)=>void;bookmark:()=>ArticleBookmark;insertImages:(images:{id:string;title:string;file_url?:string}[],bookmark?:ArticleBookmark)=>void;focus:()=>void};
type Props={value:string;onChange:(value:string)=>void;onDropAsset:(id:string)=>void;onDropFiles:(files:FileList)=>void;fontSize:string;lineHeight:string;paragraphGap:string;accent:string};

const ArticleRichEditor=forwardRef<RichEditorHandle,Props>(function ArticleRichEditor({value,onChange,onDropAsset,onDropFiles,fontSize,lineHeight,paragraphGap,accent},ref){
 const editor=useRef<HTMLDivElement>(null),selection=useRef<Range|null>(null),last=useRef<string|null>(null);
 const imageUrls=useRef(new Map<string,string>());
 const [tools,setTools]=useState<{left:number;top:number;below:boolean}|null>(null);
 useEffect(()=>{if(!editor.current||last.current===value)return;editor.current.innerHTML=markdownToEditorHtml(value);last.current=value;void hydrate()},[value]);
 useEffect(()=>()=>{imageUrls.current.forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url)})},[]);
 const hydrate=async()=>{for(const chip of Array.from(editor.current?.querySelectorAll<HTMLElement>('[data-wa-image]')||[])){const path=chip.dataset.waImage!;if(!/^\/api\/(?:studio\/assets\/[a-f0-9]{32,64}\/file|illustrations\/[a-f0-9]{32}\/file)$/.test(path))continue;try{let url=imageUrls.current.get(path);if(!url){if(path.includes('/illustrations/'))url=(await api(path.slice(4))).data_uri;else{const r=await fetch(path,{headers:{Authorization:'Bearer '+getToken()}});if(!r.ok)throw Error();url=URL.createObjectURL(await r.blob())}imageUrls.current.set(path,url!)}if(!chip.isConnected||chip.querySelector('img'))continue;const image=document.createElement('img');image.src=url!;image.alt=chip.dataset.waAlt||'正文图片';image.draggable=false;chip.prepend(image)}catch{chip.title='图片暂不可读取；引用仍保留，可重新打开检查'}}};
 const remember=()=>{const current=window.getSelection();if(!current?.rangeCount||!editor.current?.contains(current.anchorNode))return;selection.current=current.getRangeAt(0).cloneRange();if(current.isCollapsed){setTools(null);return}const rect=current.getRangeAt(0).getBoundingClientRect();if(!rect.width&&!rect.height)return;const below=rect.top<100;setTools({left:Math.max(175,Math.min(window.innerWidth-175,rect.left+rect.width/2)),top:below?rect.bottom+10:rect.top-10,below})};
 const restore=()=>{const current=window.getSelection();const saved=selection.current;if(saved&&editor.current?.contains(saved.commonAncestorContainer)){current?.removeAllRanges();current?.addRange(saved)}else{editor.current?.focus();const range=document.createRange();range.selectNodeContents(editor.current!);range.collapse(false);current?.removeAllRanges();current?.addRange(range)}};
 const sync=()=>{if(!editor.current)return;const next=editorToMarkdown(editor.current);last.current=next;onChange(next)};
 const format=(kind:RichFormat,choice?:string)=>{
  if(!editor.current)return;editor.current.focus();restore();
  if(kind==='color'||kind==='size'){
   const valid=kind==='color'?Boolean(choice&&WECHAT_COLORS[choice]):Boolean(choice&&WECHAT_SIZES.includes(choice as typeof WECHAT_SIZES[number]));if(!valid)return;
   const selected=window.getSelection();if(!selected?.rangeCount)return;const range=selected.getRangeAt(0);
   if(range.collapsed){const origin=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer as Element:range.startContainer.parentElement;const block=origin?.closest('p,div,h1,h2,h3,li');if(block&&block!==editor.current)range.selectNodeContents(block);else range.selectNodeContents(range.startContainer)}
   const startNode=range.startContainer,endNode=range.endContainer,startOffset=range.startOffset,endOffset=range.endOffset;
   const walker=document.createTreeWalker(editor.current,NodeFilter.SHOW_TEXT),targets:Text[]=[];let node:Node|null;
   while(node=walker.nextNode()){if(node.textContent?.length&&range.intersectsNode(node)&&!(node.parentElement?.closest('[contenteditable="false"]')))targets.push(node as Text)}
   for(const target of targets.reverse()){
    const from=target===startNode?startOffset:0,to=target===endNode?endOffset:target.length;if(to<=from)continue;
    const fragment=document.createRange(),span=document.createElement('span');fragment.setStart(target,from);fragment.setEnd(target,to);
    if(kind==='color'){span.dataset.waColor=choice;span.style.color=WECHAT_COLORS[choice!]}else{span.dataset.waSize=choice;span.style.fontSize=choice+'px'}
    fragment.surroundContents(span);
   }
  }else{
   const command=kind==='bold'?'bold':kind==='bullet'?'insertUnorderedList':kind==='numbered'?'insertOrderedList':'formatBlock';
   document.execCommand(command,false,command==='formatBlock'?kind==='heading'?'h2':kind==='heading3'?'h3':'p':undefined);
  }
  sync();editor.current.focus();setTools(null);
 };
 const pathFor=(node:Node)=>{const path:number[]=[];while(node!==editor.current&&node.parentNode){path.unshift(Array.from(node.parentNode.childNodes).indexOf(node as ChildNode));node=node.parentNode}return path};
 const nodeFor=(path:number[])=>{let node:Node=editor.current!;for(const index of path){if(!node.childNodes[index])throw Error('插入位置已变化，请回到正文重新选择位置');node=node.childNodes[index]}return node};
 const bookmark=():ArticleBookmark=>{
  if(!editor.current)throw Error('请先打开正文编辑区');remember();const range=selection.current?.cloneRange()||document.createRange();if(!selection.current){range.selectNodeContents(editor.current);range.collapse(false)}
  // Serialize invisible boundary markers in a detached clone. Formatting adds
  // Markdown characters, so DOM text lengths are not Markdown coordinates.
  const clone=editor.current.cloneNode(true) as HTMLElement;
  const clonedNode=(path:number[])=>path.reduce((node,index)=>node.childNodes[index],clone as Node);
  const markedRange=document.createRange();markedRange.setStart(clonedNode(pathFor(range.startContainer)),range.startOffset);markedRange.setEnd(clonedNode(pathFor(range.endContainer)),range.endOffset);
  const uid=crypto.randomUUID().replaceAll('-',''),begin='TJSTART'+uid,finish='TJEND'+uid;
  const tail=markedRange.cloneRange();tail.collapse(false);tail.insertNode(document.createTextNode(finish));
  const head=markedRange.cloneRange();head.collapse(true);head.insertNode(document.createTextNode(begin));
  let serialized=editorToMarkdown(clone),start=serialized.indexOf(begin);serialized=serialized.replace(begin,'');let end=serialized.indexOf(finish);serialized=serialized.replace(finish,'');
  if(start<0||end<start)throw Error('未能读取插入位置，请重新点击正文');
  const leading=serialized.length-serialized.trimStart().length;serialized=serialized.trim();
  start=Math.max(0,Math.min(serialized.length,start-leading));end=range.collapsed?start:Math.max(start,Math.min(serialized.length,end-leading));
  const context=textBookmark(serialized,start,end).context;
  return {body:value,startPath:pathFor(range.startContainer),startOffset:range.startOffset,endPath:pathFor(range.endContainer),endOffset:range.endOffset,context};
 };
 const insertImages=(images:{id:string;title:string;file_url?:string}[],saved?:ArticleBookmark)=>{
  if(!editor.current||!images.length)return;const mark=saved||bookmark();if(mark.body!==value)throw Error('正文已变化，图片已保留在素材库；请重新选择插入位置');
  const range=document.createRange();range.setStart(nodeFor(mark.startPath),mark.startOffset);range.collapse(true);const fragment=document.createDocumentFragment();let lastNode:Node|null=null;
  for(const image of images){const chip=document.createElement('span');chip.className='wa-image-chip';chip.contentEditable='false';chip.dataset.waImage=image.file_url||`/api/studio/assets/${image.id}/file`;chip.dataset.waAlt=image.title||'正文图片';chip.textContent='▧  '+chip.dataset.waAlt;fragment.append(document.createTextNode('\n\n'),chip,document.createTextNode('\n\n'));lastNode=chip}
  range.insertNode(fragment);if(lastNode){range.setStartAfter(lastNode);range.collapse(true);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);selection.current=range.cloneRange()}
  sync();void hydrate();editor.current.focus();setTools(null);
 };
 useImperativeHandle(ref,()=>({focus:()=>editor.current?.focus(),format,bookmark,insertImages}),[onChange,value]);
 return <><div ref={editor} className="wa-rich-editor article-rich-editor" role="textbox" aria-label="公众号文章正文" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder="在这里直接编辑正文；选中文字后可设置标题、颜色和字号。" style={{fontSize:fontSize+'px',lineHeight, ['--wa-gap' as string]:paragraphGap+'px',['--wa-accent' as string]:({forest:'#087f5b',blue:'#315ed6',ink:'#303b3d'} as Record<string,string>)[accent]||'#087f5b'}} onInput={sync} onKeyUp={remember} onMouseUp={remember} onFocus={remember} onBlur={event=>{if(!event.relatedTarget||!(event.relatedTarget as Element).closest('.wa-selection-toolbar'))setTools(null)}} onPaste={event=>{if(event.clipboardData.files.length){event.preventDefault();remember();onDropFiles(event.clipboardData.files);return}const plain=event.clipboardData.getData('text/plain');if(event.clipboardData.getData('text/html')||!/(^|\n)\s{0,3}(?:#{1,6}\s|[-*]\s|\d+\.\s|>\s)|\*\*[^*]+\*\*|!\[[^\]]*\]\([^)]+\)/m.test(plain))return;event.preventDefault();document.execCommand('insertHTML',false,markdownToEditorHtml(plain));sync()}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const drop=document.caretRangeFromPoint(event.clientX,event.clientY);if(drop&&editor.current?.contains(drop.startContainer)){window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(drop);remember()}const id=event.dataTransfer.getData('application/x-tijian-asset');if(id)onDropAsset(id);else if(event.dataTransfer.files.length)onDropFiles(event.dataTransfer.files)}}/>{tools&&createPortal(<div className="wa-selection-toolbar" role="toolbar" aria-label="选中文字格式" style={{left:tools.left,top:tools.top,transform:tools.below?'translate(-50%,0)':'translate(-50%,-100%)'}} onMouseDown={event=>{if((event.target as HTMLElement).closest('button'))event.preventDefault()}}><select aria-label="段落样式" defaultValue="" onChange={event=>{format(event.target.value as RichFormat);event.target.value=''}}><option value="" disabled>段落样式</option><option value="paragraph">正文</option><option value="heading">小标题</option><option value="heading3">三级标题</option></select><button type="button" onClick={()=>format('bold')}>加粗</button><button type="button" onClick={()=>format('bullet')}>项目列表</button><button type="button" onClick={()=>format('numbered')}>数字列表</button><select aria-label="选中文字颜色" defaultValue="" onChange={event=>{format('color',event.target.value);event.target.value=''}}><option value="" disabled>颜色</option><option value="ink">深灰</option><option value="forest">墨绿</option><option value="blue">蓝色</option><option value="red">红色</option><option value="orange">橙色</option></select><select aria-label="选中文字大小" defaultValue="" onChange={event=>{format('size',event.target.value);event.target.value=''}}><option value="" disabled>字号</option>{WECHAT_SIZES.map(size=><option key={size} value={size}>{size} px</option>)}</select></div>,document.body)}</>;
});
export default ArticleRichEditor;
