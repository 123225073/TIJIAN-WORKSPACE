const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
export const readRatio=(value:string)=>{if(!/^\d{1,5}(?:\.\d{1,4})?\s*:\s*\d{1,5}(?:\.\d{1,4})?$/.test(value))return NaN;const [a,b]=value.split(':').map(Number);return a>0&&b>0&&a/b>=.05&&a/b<=20?a/b:NaN};
export function imagePlan(choices:any,options:any){
 const next={...options},requested=options.requested_ratio,resolution=options.requested_resolution;
 const sizes=(choices.size||[]).map((value:string)=>{const match=value.match(/^(\d+)[x*](\d+)$/);return match?{value,w:+match[1],h:+match[2]}:null}).filter(Boolean);
 let actual=options.aspect_ratio,actualResolution=String(options.resolution||'').toUpperCase();
 if(sizes.length){
  const current=sizes.find((x:any)=>x.value===options.size)||sizes[0];
  if(requested||resolution){const target=requested?readRatio(requested):current.w/current.h,edge=({'1K':1024,'2K':2048,'4K':4096} as any)[resolution]||Math.max(current.w,current.h);const score=(x:any)=>Math.round(Math.abs(Math.log(x.w/x.h/target))*1e5)/1e5;
   next.size=[...sizes].sort((a:any,b:any)=>score(a)-score(b)||Math.abs(Math.log(Math.max(a.w,a.h)/edge))-Math.abs(Math.log(Math.max(b.w,b.h)/edge)))[0].value;}
  const selected=sizes.find((x:any)=>x.value===next.size)||current,div=gcd(selected.w,selected.h);actual=selected.w/div+':'+selected.h/div;actualResolution=Math.max(selected.w,selected.h)<=1600?'1K':Math.max(selected.w,selected.h)<=3000?'2K':'4K';
 }else if(choices.aspect_ratio?.length){
  if(requested)next.aspect_ratio=[...choices.aspect_ratio].sort((a:string,b:string)=>Math.abs(Math.log(readRatio(a)/readRatio(requested)))-Math.abs(Math.log(readRatio(b)/readRatio(requested))))[0];
  if(resolution&&choices.resolution?.length)next.resolution=[...choices.resolution].sort((a:string,b:string)=>Math.abs(Math.log(parseFloat(a)/parseFloat(resolution)))-Math.abs(Math.log(parseFloat(b)/parseFloat(resolution))))[0];
  actual=next.aspect_ratio;actualResolution=String(next.resolution||'').toUpperCase();
 }
 const changes=[];if(requested&&actual&&Math.abs(Math.log(readRatio(actual)/readRatio(requested)))>.001)changes.push(`比例 ${requested} → ${actual}`);if(resolution&&actualResolution&&resolution!==actualResolution)changes.push(`分辨率 ${resolution} → ${actualResolution}`);
 return {options:next,actual,actualResolution,notice:changes.length?'当前模型不支持所选参数，已采用最接近的可用设置：'+changes.join('；'):''};
}
