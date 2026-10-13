/** Production blocks are source metadata, never reader copy. No keyword deletion. */
export type ProductionBlock={id:string;kind:'illustration'|'note';syntax:'explicit'|'card'|'quote';start:number;end:number;raw:string;prompt:string};
export type ProductionBookmark={body:string;instruction_id:string;start:number;end:number;raw:string};
const OPEN=/^:::article-production (illustration|note) ([A-Za-z0-9_-]{1,80})[ \t]*$/;
const CLOSE=/^:::end-article-production[ \t]*$/;
const CARD=/^▧[ \t]*文章配图[ \t]*·[ \t]*\S/;
const TITLE=/^(插图方案|配图提示词|制作说明)(?:[ \t]*(?:[0-9一二三四五六七八九十]+|[（(][0-9一二三四五六七八九十]+[）)]))?[ \t]*(?:[：:｜|·]|$)/;
const unquote=(text:string)=>text.replace(/^[ \t]{0,3}>[ \t]?/,'').replace(/\*\*/g,'').trim();
const label=/^(?:图片内容建议|配图提示词|提示词)[ \t]*[：:][ \t]*/;
const cardPayload=(lines:string[])=>lines.map((line,index)=>index===0&&CARD.test(unquote(line))?unquote(line).replace(/^▧.*?(?=图片内容建议[ \t]*[：:])/,''):line);
const promptFor=(lines:string[],kind:ProductionBlock['kind'])=>{
 if(kind==='note')return '';
 const content=lines.map(unquote),at=content.findIndex(line=>label.test(line));
 if(at>=0){const remaining=content.slice(at);remaining[0]=remaining[0].replace(label,'');const stop=remaining.findIndex(line=>/^(?:制作说明|插入位置|图片说明|风格说明)[ \t]*[：:]/.test(line));return remaining.slice(0,stop<0?undefined:stop).join('\n').trim()}
 return content.join('\n').replace(TITLE,'').trim();
};

export function parseArticleProduction(body:string):{body:string;readerBody:string;instructions:ProductionBlock[]}{
 const lines=Array.from(body.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)).filter(match=>match[0]);
 const value=(index:number)=>lines[index][0].replace(/[\r\n]+$/,'');
 const instructions:ProductionBlock[]=[];let fence:{char:string;length:number}|null=null;
 for(let i=0;i<lines.length;i++){
  const line=value(i),code=/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(code){if(!fence)fence={char:code[1][0],length:code[1].length};else if(code[1][0]===fence.char&&code[1].length>=fence.length&&!code[2].trim())fence=null;continue}
  if(fence||/^(?: {4}|\t)/.test(line))continue;
  let end=i,kind:ProductionBlock['kind']='illustration',syntax:ProductionBlock['syntax'],id='';let payload:string[];
  const open=OPEN.exec(line);
  if(open){
   let close=i+1;while(close<lines.length&&!CLOSE.test(value(close))&&!OPEN.test(value(close)))close++;
   if(close===lines.length||!CLOSE.test(value(close)))continue;
   end=close;kind=open[1] as ProductionBlock['kind'];syntax='explicit';id=open[2];payload=Array.from({length:end-i-1},(_,n)=>value(i+n+1));
  }else if(/^[ \t]{0,3}>/.test(line)&&TITLE.test(unquote(line))){
   while(end+1<lines.length&&/^[ \t]{0,3}>/.test(value(end+1)))end++;
   kind=unquote(line).startsWith('制作说明')?'note':'illustration';syntax='quote';payload=Array.from({length:end-i+1},(_,n)=>value(i+n));
  }else if(CARD.test(unquote(line))){
   // A legacy card requires BOTH the exact card heading and its content label.
   while(end+1<lines.length&&value(end+1).trim()&&!CARD.test(unquote(value(end+1))))end++;
   payload=cardPayload(Array.from({length:end-i+1},(_,n)=>value(i+n)));
   if(!payload.some(part=>/^图片内容建议[ \t]*[：:]/.test(unquote(part)))){
    let next=end+1;while(next<lines.length&&!value(next).trim())next++;
    if(next>=lines.length||!/^图片内容建议[ \t]*[：:]/.test(unquote(value(next))))continue;
    end=next;while(end+1<lines.length&&value(end+1).trim()&&!CARD.test(unquote(value(end+1))))end++;
    payload=cardPayload(Array.from({length:end-i+1},(_,n)=>value(i+n)));
   }
   syntax='card';
  }else continue;
  const start=lines[i].index!,finish=lines[end].index!+value(end).length;
  instructions.push({id:id||`legacy-${start}`,kind,syntax,start,end:finish,raw:body.slice(start,finish),prompt:promptFor(payload!,kind)});i=end;
 }
 let readerBody='',cursor=0;for(const block of instructions){readerBody+=body.slice(cursor,block.start);cursor=block.end}readerBody+=body.slice(cursor);
 // Preserve all non-production characters, including whitespace, for source mapping.
 return {body,readerBody,instructions};
}

export const readerProductionBody=(body:string)=>parseArticleProduction(body).readerBody;
export function productionBookmark(body:string,instruction_id:string):ProductionBookmark{
 const matches=parseArticleProduction(body).instructions.filter(block=>block.id===instruction_id&&block.kind==='illustration');
 if(matches.length!==1)throw Error('配图指令不存在或编号重复，请重新选择');
 const {start,end,raw}=matches[0];return {body,instruction_id,start,end,raw};
}
export function replaceProductionInstruction(body:string,bookmark:ProductionBookmark,imageMarkdown:string){
 return replaceProductionInstructions(body,[{bookmark,imageMarkdown}]);
}
/** Apply completed members of one batch atomically, preserving failed members. */
export function replaceProductionInstructions(body:string,replacements:{bookmark:ProductionBookmark;imageMarkdown:string}[]){
 const ids=new Set<string>();
 const patches=replacements.map(({bookmark,imageMarkdown})=>{
  if(body!==bookmark.body)throw Error('正文已变化，图片已保留；请重新选择配图指令');
  const fresh=productionBookmark(body,bookmark.instruction_id);
  if(fresh.start!==bookmark.start||fresh.end!==bookmark.end||fresh.raw!==bookmark.raw)throw Error('配图指令已变化，请重新选择');
  if(ids.has(fresh.instruction_id))throw Error('同一配图指令不能重复替换');ids.add(fresh.instruction_id);
  // A caller must pass a completed local image reference, never an explanation.
  if(!/^!\[[^\]\r\n]*\]\(\/api\/(?:studio\/assets\/[a-f0-9]{32,64}|illustrations\/[a-f0-9]{32})\/file\)$/.test(imageMarkdown.trim()))throw Error('请选择已完成的本地配图');
  return {...fresh,imageMarkdown:imageMarkdown.trim()};
 });
 for(const patch of patches.sort((a,b)=>b.start-a.start))body=body.slice(0,patch.start)+patch.imageMarkdown+body.slice(patch.end);
 return body;
}
