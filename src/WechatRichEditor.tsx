import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {editorToMarkdown,markdownToEditorHtml,WECHAT_COLORS,WECHAT_SIZES} from './wechat-rich';

export type RichFormat='heading'|'heading3'|'paragraph'|'bold'|'bullet'|'numbered'|'color'|'size';
export type RichEditorHandle={format:(kind:RichFormat,value?:string)=>void;insertImages:(images:{id:string;title:string}[])=>void;focus:()=>void};
type Props={value:string;onChange:(value:string)=>void;onDropAsset:(id:string)=>void;onDropFiles:(files:FileList)=>void;fontSize:string;lineHeight:string;paragraphGap:string;accent:string};

const WechatRichEditor=forwardRef<RichEditorHandle,Props>(function WechatRichEditor({value,onChange,onDropAsset,onDropFiles,fontSize,lineHeight,paragraphGap,accent},ref){
 const editor=useRef<HTMLDivElement>(null),selection=useRef<Range|null>(null),last=useRef<string|null>(null);
 const [tools,setTools]=useState<{left:number;top:number;below:boolean}|null>(null);
 useEffect(()=>{if(!editor.current||last.current===value)return;editor.current.innerHTML=markdownToEditorHtml(value);last.current=value},[value]);
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
 useImperativeHandle(ref,()=>({focus:()=>editor.current?.focus(),format,insertImages:images=>{if(!editor.current||!images.length)return;editor.current.focus();restore();const selected=window.getSelection(),range=selected?.getRangeAt(0);if(!range)return;const origin=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer as Element:range.startContainer.parentElement;let after=origin?.closest('p,li,h1,h2,h3,blockquote,table,pre,div');after=after?.closest('ul,ol')||after;if(after===editor.current)after=null;for(const image of images){const paragraph=document.createElement('p'),chip=document.createElement('span');chip.className='wa-image-chip';chip.contentEditable='false';chip.dataset.waImage=`/api/studio/assets/${image.id}/file`;chip.dataset.waAlt=image.title||'正文图片';chip.textContent='▧  '+chip.dataset.waAlt;paragraph.append(chip);if(after)after.after(paragraph);else editor.current.append(paragraph);after=paragraph}const next=document.createElement('p');next.append(document.createElement('br'));after?.after(next);range.selectNodeContents(next);range.collapse(true);selected?.removeAllRanges();selected?.addRange(range);sync();editor.current.focus()}}),[onChange]);
 return <><div ref={editor} className="wa-rich-editor" role="textbox" aria-label="公众号文章正文" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder="在这里直接编辑正文；选中文字后可设置标题、颜色和字号。" style={{fontSize:fontSize+'px',lineHeight, ['--wa-gap' as string]:paragraphGap+'px',['--wa-accent' as string]:({forest:'#087f5b',blue:'#315ed6',ink:'#303b3d'} as Record<string,string>)[accent]||'#087f5b'}} onInput={sync} onKeyUp={remember} onMouseUp={remember} onFocus={remember} onBlur={event=>{if(!event.relatedTarget||!(event.relatedTarget as Element).closest('.wa-selection-toolbar'))setTools(null)}} onPaste={event=>{const plain=event.clipboardData.getData('text/plain');if(event.clipboardData.getData('text/html')||!/(^|\n)\s{0,3}(?:#{1,6}\s|[-*]\s|\d+\.\s|>\s)|\*\*[^*]+\*\*|!\[[^\]]*\]\([^)]+\)/m.test(plain))return;event.preventDefault();document.execCommand('insertHTML',false,markdownToEditorHtml(plain));sync()}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData('application/x-tijian-asset');if(id)onDropAsset(id);else if(event.dataTransfer.files.length)onDropFiles(event.dataTransfer.files)}}/>{tools&&createPortal(<div className="wa-selection-toolbar" role="toolbar" aria-label="选中文字格式" style={{left:tools.left,top:tools.top,transform:tools.below?'translate(-50%,0)':'translate(-50%,-100%)'}} onMouseDown={event=>{if((event.target as HTMLElement).closest('button'))event.preventDefault()}}><select aria-label="段落样式" defaultValue="" onChange={event=>{format(event.target.value as RichFormat);event.target.value=''}}><option value="" disabled>段落样式</option><option value="paragraph">正文</option><option value="heading">小标题</option><option value="heading3">三级标题</option></select><button type="button" onClick={()=>format('bold')}>加粗</button><button type="button" onClick={()=>format('bullet')}>项目列表</button><button type="button" onClick={()=>format('numbered')}>数字列表</button><select aria-label="选中文字颜色" defaultValue="" onChange={event=>{format('color',event.target.value);event.target.value=''}}><option value="" disabled>颜色</option><option value="ink">深灰</option><option value="forest">墨绿</option><option value="blue">蓝色</option><option value="red">红色</option><option value="orange">橙色</option></select><select aria-label="选中文字大小" defaultValue="" onChange={event=>{format('size',event.target.value);event.target.value=''}}><option value="" disabled>字号</option>{WECHAT_SIZES.map(size=><option key={size} value={size}>{size} px</option>)}</select></div>,document.body)}</>;
});
export default WechatRichEditor;
