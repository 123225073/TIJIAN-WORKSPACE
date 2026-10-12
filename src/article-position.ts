export type TextBookmark={body:string;start:number;end:number;context:{body:string;start:number;end:number;text:string}};
export function textBookmark(body:string,start:number,end=start):TextBookmark{
 start=Math.max(0,Math.min(body.length,start));end=Math.max(start,Math.min(body.length,end));
 let first=0,last=body.length;
 for(const gap of body.matchAll(/\n{2,}/g)){
  if(start<=gap.index!+gap[0].length-1){last=gap.index!;break}
  first=gap.index!+gap[0].length;
 }
 const from=end>start?start:first,to=end>start?end:last;
 return {body,start,end,context:{body,start:from,end:to,text:body.slice(from,to)}};
}
export function imageTag(title:string,path:string){
 if(!/^\/api\/(?:studio\/assets\/[a-f0-9]{32,64}\/file|illustrations\/[a-f0-9]{32}\/file)$/.test(path))throw Error('图片引用无效，请重新选择素材');
 return '\n\n!['+(title||'正文配图').replace(/[\[\]\r\n<>]/g,'')+']('+path+')\n\n';
}
export function insertAtBookmark(body:string,bookmark:TextBookmark,tag:string,place='cursor'){
 if(place==='cursor'&&body!==bookmark.body)throw Error('正文已变化，图片已保留；请回到正文重新选择插入位置');
 const index=place==='start'?0:place==='end'?body.length:bookmark.start;
 return {body:body.slice(0,index)+tag+body.slice(index),position:index+tag.length};
}
