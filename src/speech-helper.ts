// Formatting cleanup only. An article still requires the existing AI writer to
// become a spoken adaptation. Keep this contract aligned with speech_helper.py.
const speechLabels=new Set(['口播','口播稿','口播脚本','朗读正文','旁白','spoken','script']);
const productionLabels=new Set(['标题','发布标题','视频标题','文章标题','摘要','发布文案','分镜','分镜脚本','画面','画面建议','封面建议','封面提示词','制作说明','拍摄建议','话题标签']);
const speechFormat=(source:any)=>['口播脚本','视频脚本'].includes(source?.format);

function structured(body:string):Record<string,any>{
 const value=body.trim().replace(/^```(?:json)?\s*\n/i,'').replace(/\n```\s*$/,'');
 if(!value.startsWith('{'))return {};
 try{const result=JSON.parse(value);return result&&typeof result==='object'&&!Array.isArray(result)?result:{}}catch{return {}}
}
function decodeEntities(text:string){
 // A detached textarea decodes HTML entities without mounting markup, scripts,
 // or image requests. Escape literal tags so only entities are interpreted.
 const decoder=document.createElement('textarea');decoder.innerHTML=text.replace(/</g,'&lt;');return decoder.value;
}
export function cleanSpeech(value:string,title='',explicit=false){
 let text=decodeEntities(value.replace(/\r\n?/g,'\n'));
 text=text.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'')
  .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,(_m,level,body)=>'\n'+'#'.repeat(Number(level))+' '+body+'\n')
  .replace(/!\[[^\]\n]*\]\((?:\\.|[^)\n])*\)|<img\b[^>]*>/gi,'')
  .replace(/\[([^\]\n]+)\]\([^\n)]+\)/g,'$1')
  .replace(/<br\s*\/?>|<\/(?:p|div)>/gi,'\n').replace(/<[A-Za-z/][^>]*>/g,'');
 const result:string[]=[];let skipLevel:number|null=null;
 for(let line of text.split('\n')){
  const stripped=line.trim(),quoted=stripped.startsWith('>');
  const heading=/^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(stripped),level=heading?.[1].length||0,label=(heading?.[2]||stripped).trim().replace(/^\*+|\*+$/g,'').replace(/[：:]+$/,'').trim();
  if(heading&&level===1&&label==='标题')continue;
  if(!quoted&&productionLabels.has(label)&&(heading||!explicit)){skipLevel=level;continue}
  if(!quoted&&(speechLabels.has(label)||label==='正文')&&(heading||!explicit)){skipLevel=null;continue}
  if(skipLevel!==null){if(!quoted&&heading&&level<=skipLevel)skipLevel=null;else continue}
  const inline=/^(?:#{1,6}\s*)?(?:\*\*)?([^：:]+?)(?:\*\*)?\s*[：:]\s*(.*)$/.exec(stripped);
  if(!explicit&&!quoted&&inline&&productionLabels.has(inline[1])){result.push('');continue}
  if(heading&&!quoted)continue;
  if(!quoted){
   const ranges=[...line.matchAll(/“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』|"[^"\n]*"|'[^'\n]*'/g)].map(m=>[m.index,m.index+m[0].length]);
   line=line.replace(/(?:【|\[|（|\()(?:分镜|制作说明|画面|镜头|字幕|音效|配乐|动作|语气|停顿)(?:[：:][^】\]）)\n]*|\s*)(?:】|\]|）|\))/g,(match,offset)=>ranges.some(([start,end])=>start<=offset&&offset<end)?match:'');
  }
  if(!explicit&&!result.some(x=>x.trim())&&stripped&&stripped.replace(/^\*+|\*+$/g,'')===title.trim())continue;
  if(/^\s*(?:```|~~~|[-*_]{3,}\s*$)/.test(line))continue;
  line=line.replace(/^\s*(?:>\s*)+/,'').replace(/^\s*(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/,'')
   .replace(/\*\*([^\n]+?)\*\*|__([^\n]+?)__/g,(_m,a,b)=>a||b)
   .replace(/(?<!\w)[*_]([^\n]+?)[*_](?!\w)/g,'$1').replace(/`([^`]+)`/g,'$1');
  result.push(line.trimEnd());
 }
 return result.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function speechFromContent(source:any){
 const body=typeof source?.body==='string'?source.body:'',raw=structured(body);
 let chosen='',field='body',explicit=false;
 for(const data of [source||{},raw]){
  for(const key of ['spoken','script'])if(typeof data[key]==='string'&&data[key].trim()){chosen=data[key];field=key;explicit=true;break}
  if(explicit)break;
 }
 if(!explicit){
  chosen=typeof raw.body==='string'?raw.body:body;
  const match=/^\s*(?:#{1,6}\s*)?(?:\*\*)?(口播脚本|口播稿|朗读正文|旁白)(?:\*\*)?\s*[：:]?\s*$/m.exec(chosen);
  if(match){chosen=chosen.slice(match.index+match[0].length);field='speech_section';explicit=true}
 }
 const title=typeof raw.title==='string'?raw.title:source?.title||'',text=cleanSpeech(chosen,title,explicit||speechFormat(source));
 return {text,source_field:field,needs_conversion:!!text&&!(explicit||speechFormat(source)),cleaned:text!==chosen.trim()};
}
