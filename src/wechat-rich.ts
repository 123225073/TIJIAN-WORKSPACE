import DOMPurify from 'dompurify';
import {marked} from 'marked';
import {parseArticleProduction,readerProductionBody} from './article-production';

export const WECHAT_COLORS:Record<string,string>={ink:'#243b34',forest:'#087f5b',blue:'#315ed6',red:'#c34539',orange:'#ac631d'};
export const WECHAT_SIZES=['14','16','18','20','24'] as const;
export const readerArticleText=(text:string)=>readerProductionBody(text).replace(/\[(?:资料|来源|系统资料)?\s*[0-9a-f]{32}(?:[0-9a-f]{32})?\](?!\()/gi,'');
const STYLE_TOKEN=/\{#(color|size):([a-z0-9]+)\}|\{#\/(color|size)\}/g;

export function markdownToEditorHtml(value:string){
 const source=value||'',metadata=parseArticleProduction(source).instructions;
 const nonce=crypto.randomUUID().replaceAll('-','');
 const placeholders=metadata.map((block,index)=>({block,token:`TJPRODUCTION${nonce}X${index}`}));
 let editorSource=source;
 for(const {block,token} of [...placeholders].reverse())editorSource=editorSource.slice(0,block.start)+'\n\n'+token+'\n\n'+editorSource.slice(block.end);
 const html=DOMPurify.sanitize(String(marked.parse(editorSource,{async:false})));
 const content=html.replace(STYLE_TOKEN,(token,kind:string,choice:string,closing:string)=>{
  if(closing)return '</span>';
  if(kind==='color'&&WECHAT_COLORS[choice])return `<span data-wa-color="${choice}" style="color:${WECHAT_COLORS[choice]}">`;
  if(kind==='size'&&WECHAT_SIZES.includes(choice as typeof WECHAT_SIZES[number]))return `<span data-wa-size="${choice}" style="font-size:${choice}px">`;
  return token;
 });
 const holder=document.createElement('div');
 holder.innerHTML=DOMPurify.sanitize(content,{ADD_ATTR:['data-wa-color','data-wa-size']});
 for(const image of Array.from(holder.querySelectorAll('img'))){
  const chip=document.createElement('span');
  chip.contentEditable='false';chip.className='wa-image-chip';
  chip.dataset.waImage=image.getAttribute('src')||'';
  chip.dataset.waAlt=image.getAttribute('alt')||'正文图片';
  chip.textContent='▧  '+chip.dataset.waAlt;
  image.replaceWith(chip);
 }
 // Raw instructions never enter rendered HTML. DOM setters escape their data
 // attributes; the reader/editor sees a compact, non-editable metadata chip.
 for(const {block,token} of placeholders){
  const paragraph=Array.from(holder.querySelectorAll('p')).find(item=>item.textContent===token);
  if(!paragraph)throw Error('制作信息未能完整保留，请重新打开文稿');
  const chip=document.createElement('span');chip.contentEditable='false';chip.className='wa-production-chip';chip.style.display='block';
  chip.dataset.waProduction=block.raw;chip.dataset.waProductionId=block.id;chip.dataset.waProductionKind=block.kind;
  chip.textContent=block.kind==='illustration'?'▧ 配图计划':'制作说明（已收起）';
  chip.title='制作信息已保留；阅读预览与导出自动隐藏';paragraph.replaceWith(chip);
 }
 return holder.innerHTML;
}

export function editorToMarkdown(root:HTMLElement){
 const rawBlocks:{token:string;raw:string}[]=[],nonce=crypto.randomUUID().replaceAll('-','');
 const inline=(node:Node):string=>{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
  if(node.nodeType!==Node.ELEMENT_NODE)return '';
  const element=node as HTMLElement,tag=element.tagName.toLowerCase();
  if(element.dataset.waProduction!==undefined){const token=`TJPRODUCTIONRAW${nonce}X${rawBlocks.length}`;rawBlocks.push({token,raw:element.dataset.waProduction});return token}
  if(element.dataset.waImage)return `![${(element.dataset.waAlt||'正文图片').replace(/[\[\]]/g,'')}](${element.dataset.waImage})`;
  const content=Array.from(element.childNodes).map(inline).join('');
  if(element.dataset.waColor&&WECHAT_COLORS[element.dataset.waColor])return `{#color:${element.dataset.waColor}}${content}{#/color}`;
  if(element.dataset.waSize&&WECHAT_SIZES.includes(element.dataset.waSize as typeof WECHAT_SIZES[number]))return `{#size:${element.dataset.waSize}}${content}{#/size}`;
  if(tag==='strong'||tag==='b')return `**${content}**`;
  if(tag==='em'||tag==='i')return `*${content}*`;
  if(tag==='code')return '`'+content+'`';
  if(tag==='a'){const href=element.getAttribute('href')||'';return href?`[${content}](${href})`:content}
  if(tag==='img'){const src=element.getAttribute('src')||'';return `![${element.getAttribute('alt')||''}](${src})`}
  if(tag==='br')return '\n';
  return content;
 };
 const blocks=(parent:HTMLElement):string=>Array.from(parent.childNodes).map(node=>{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent?.trim()?node.textContent+'\n\n':'';
  if(node.nodeType!==Node.ELEMENT_NODE)return '';
  const item=node as HTMLElement,tag=item.tagName.toLowerCase();
  if(/^h[1-6]$/.test(tag))return '#'.repeat(Math.min(3,Number(tag[1])))+' '+Array.from(item.childNodes).map(inline).join('').trim()+'\n\n';
  if(tag==='p'||tag==='div')return Array.from(item.childNodes).map(inline).join('').trim()+'\n\n';
  if(tag==='ul'||tag==='ol')return Array.from(item.children).filter(child=>child.tagName.toLowerCase()==='li').map((li,index)=>`${tag==='ol'?index+1+'.':'-'} ${Array.from(li.childNodes).map(inline).join('').trim()}`).join('\n')+'\n\n';
  if(tag==='blockquote')return Array.from(item.childNodes).map(inline).join('').split('\n').map(line=>'> '+line).join('\n')+'\n\n';
  if(tag==='pre')return '```\n'+(item.textContent||'')+'\n```\n\n';
  if(tag==='hr')return '---\n\n';
  if(tag==='table'){
   const rows=Array.from(item.querySelectorAll('tr')).map(row=>Array.from(row.children).map(cell=>cell.textContent?.trim()||''));
   if(!rows.length)return '';
   return '| '+rows[0].join(' | ')+' |\n| '+rows[0].map(()=>'---').join(' | ')+' |\n'+rows.slice(1).map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n\n';
  }
  return inline(item).trim()+'\n\n';
 }).join('').replace(/\n{3,}/g,'\n\n').trim();
 let markdown=blocks(root);
 // Restore after whitespace normalization, so CRLF/blank lines within raw
 // production blocks survive unrelated manual paragraph or formatting edits.
 for(const {token,raw} of rawBlocks)markdown=markdown.replace(token,raw);
 return markdown;
}
