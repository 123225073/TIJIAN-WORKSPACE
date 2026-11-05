import {marked} from 'marked';
import {imageTag} from './article-position';

export type ImageAnchor={id:string;end:number;text:string};
export type ImagePlacement={asset_id:string;after:string};
// Lexer offsets retain the original Markdown, including hidden production data.
export function articleImageAnchors(body:string):ImageAnchor[]{
 const normalized=body.replace(/\r\n?/g,'\n'),positions=[0];
 for(let i=0;i<body.length;){i+=body[i]==='\r'&&body[i+1]==='\n'?2:1;positions.push(i)}
 let offset=0;const anchors:ImageAnchor[]=[];
 for(const token of marked.lexer(normalized)){
  if(normalized.slice(offset,offset+token.raw.length)!==token.raw)throw Error('此段排版暂不支持自动定位，请先整理段落或手动插图。');
  offset+=token.raw.length;
  if(['paragraph','list','blockquote'].includes(token.type)&&token.raw.replace(/!\[[^\]]*\]\([^)]+\)/g,'').trim()&&!token.raw.includes('<!--'))
   anchors.push({id:'p'+anchors.length,end:positions[offset],text:body.slice(positions[offset-token.raw.length],positions[offset]).slice(0,1600)});
 }
 return anchors;
}
export function defaultImagePlacements(body:string,ids:string[]):ImagePlacement[]{
 const anchors=articleImageAnchors(body);if(!anchors.length)throw Error('请先填写正文段落，再插入配图。');
 return ids.map((asset_id,i)=>({asset_id,after:anchors[Math.round((anchors.length-1)*(ids.length===1?0.5:i/(ids.length-1)))].id}));
}
export function applyImagePlacements(body:string,ids:string[],placements:ImagePlacement[]):string{
 const anchors=articleImageAnchors(body),seen=new Set<string>();
 if(placements.length!==ids.length||!placements.every(p=>ids.includes(p.asset_id)&&!seen.has(p.asset_id)&&seen.add(p.asset_id)&&anchors.some(a=>a.id===p.after)))throw Error('插图位置结果无效，正文未修改。');
 const inserts=new Map<number,string[]>();
 for(const p of placements){
  if(!/^[a-f0-9]{32,64}$/.test(p.asset_id))throw Error('图片编号无效。');
  const path='/api/studio/assets/'+p.asset_id+'/file';
  if(body.includes(path))continue;
  const end=anchors.find(a=>a.id===p.after)!.end;
  inserts.set(end,[...(inserts.get(end)||[]),imageTag('正文配图',path)]);
 }
 let next=body;for(const [end,tags]of [...inserts].sort((a,b)=>b[0]-a[0]))next=next.slice(0,end)+tags.join('')+next.slice(end);
 return next;
}
