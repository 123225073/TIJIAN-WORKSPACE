import {useEffect,useRef,useState} from 'react';
import {Download,Image as ImageIcon,Layers3} from 'lucide-react';
import {api,getToken} from './api';
import {assetUrl,type Asset} from './ResourcePreview';
import './cover-designer.css';

// These are original layout recipes, not copies of the reference project's
// unlicensed renderer or bundled fonts. Fonts are supplied by Windows.
const themes=[
 {id:'headline',name:'醒目大字',description:'白字 · 强对比',fg:'#ffffff',accent:'#ffce50',box:'none'},
 {id:'gold',name:'金色观点',description:'金白 · 精致',fg:'#fff9e9',accent:'#f3c75b',box:'dark'},
 {id:'ice',name:'冰蓝聚焦',description:'冰蓝 · 科技',fg:'#e8fbff',accent:'#64d7ec',box:'dark'},
 {id:'red',name:'红黑杂志',description:'红白 · 有力',fg:'#ffffff',accent:'#ff5a4e',box:'dark'},
 {id:'paper',name:'简洁留白',description:'浅底 · 克制',fg:'#152337',accent:'#2565bf',box:'light'},
 {id:'lemon',name:'荧光重点',description:'亮黄 · 强调',fg:'#ffffff',accent:'#d4ef54',box:'label'},
 {id:'mint',name:'清新标记',description:'薄荷 · 明快',fg:'#effffb',accent:'#70e0c7',box:'dark'},
 {id:'coral',name:'暖橙专题',description:'暖橙 · 活力',fg:'#fff9f1',accent:'#ff995e',box:'dark'},
 {id:'signal',name:'重点警示',description:'橙白 · 醒目',fg:'#ffffff',accent:'#ff7d31',box:'dark'},
 {id:'news',name:'新闻快讯',description:'红白 · 快讯',fg:'#ffffff',accent:'#ff4b4b',box:'dark'},
 {id:'blueprint',name:'专业蓝图',description:'蓝白 · 行业',fg:'#f5fbff',accent:'#65baff',box:'dark'},
 {id:'cream',name:'奶油杂志',description:'暖白 · 轻盈',fg:'#27303b',accent:'#df985e',box:'light'},
 {id:'fresh',name:'绿色清单',description:'翠绿 · 提示',fg:'#ffffff',accent:'#8ed68b',box:'label'},
 {id:'violet',name:'紫色对话',description:'浅紫 · 观点',fg:'#ffffff',accent:'#cbb3ff',box:'dark'},
 {id:'mono',name:'黑白纪实',description:'纯白 · 字幕感',fg:'#ffffff',accent:'#ffffff',box:'none'},
 {id:'sunrise',name:'金橙焦点',description:'金橙 · 聚焦',fg:'#fff7e4',accent:'#ffc351',box:'dark'},
] as const;
type Part='group'|'title'|'subtitle'|'tag';
type Placement={x?:number;y?:number;scale?:number};
export type CoverSettings={style:string;title:string;subtitle:string;tag:string;font:string;fontSize:number;position:'top'|'bottom';frameTime:number;overlayDuration:number;overlayAssetId:string;overlaySourceId:string;overlayCanvasKey?:string;placement?:Partial<Record<Part,Placement>>};
export const defaultCoverSettings:CoverSettings={style:'headline',title:'',subtitle:'',tag:'',font:'Microsoft YaHei',fontSize:11,position:'top',frameTime:0,overlayDuration:3,overlayAssetId:'',overlaySourceId:''};
const fonts=[['Microsoft YaHei','微软雅黑'],['SimHei','黑体'],['SimSun','宋体']] as const;
const allowedFonts=fonts.map(x=>x[0]);
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(x)?x:min));

function wrap(ctx:CanvasRenderingContext2D,text:string,maxWidth:number){
 const out:string[]=[];
 for(const paragraph of text.split('\n')){
  let line='';
  for(const character of Array.from(paragraph)){
   if(line&&ctx.measureText(line+character).width>maxWidth){out.push(line);line=character}else line+=character;
  }
  out.push(line);
 }
 return out;
}

function rounded(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
 ctx.beginPath();ctx.roundRect(x,y,w,h,Math.max(0,Math.min(r,w/2,h/2)));ctx.fill();
}

// The same drawing routine supplies screen hit boxes and the exported pixels.
type Box={x:number;y:number;w:number;h:number};
function placement(options:CoverSettings,part:Part){const p=options.placement?.[part]||{};return {x:clamp(p.x||0,-.9,.9),y:clamp(p.y||0,-.9,.9),scale:clamp(p.scale??1,.45,2)}}
function transformBox(box:Box,centerX:number,centerY:number,dx:number,dy:number,scale:number):Box{return {x:centerX+(box.x-centerX)*scale+dx,y:centerY+(box.y-centerY)*scale+dy,w:box.w*scale,h:box.h*scale}}
export function drawCover(canvas:HTMLCanvasElement,frame:CanvasImageSource|null,options:CoverSettings,width:number,height:number,fit='cover'){
 canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('封面画布不可用');
 ctx.clearRect(0,0,width,height);if(frame){
  const source=frame as HTMLVideoElement & HTMLCanvasElement;const sw=source.videoWidth||source.width,sh=source.videoHeight||source.height;
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
  if(sw&&sh){const scale=(fit==='contain'||fit==='none'?Math.min:Math.max)(width/sw,height/sh);const dw=sw*scale,dh=sh*scale;ctx.drawImage(frame,(width-dw)/2,(height-dh)/2,dw,dh)}else ctx.drawImage(frame,0,0,width,height);
 }
 const theme=themes.find(x=>x.id===options.style)||themes[0],font=allowedFonts.includes(options.font as typeof allowedFonts[number])?options.font:'Microsoft YaHei';
 const title=String(options.title||'').replace(/\n{3,}/g,'\n\n').trim().slice(0,60),subtitle=String(options.subtitle||'').trim().slice(0,80),tag=String(options.tag||'').trim().slice(0,20);
 if(!title&&!subtitle&&!tag)return {} as Partial<Record<Part,Box>>;
 const pad=width*.07,usable=width-pad*2,zone=Math.min(height*.38,Math.max(height*.19,width*.58));
 let size=clamp(options.fontSize,5,20)/100*width,lines:string[]=[];
 do{ctx.font=`900 ${size}px "${font}"`;lines=wrap(ctx,title,usable*.88);if(lines.length*size*1.22<=zone*.58&&lines.every(x=>ctx.measureText(x).width<=usable*.9))break;size*=.92}while(size>Math.max(9,width*.012));
 if(lines.length*size*1.22>zone*.62)throw Error('标题换行过多，请缩短文字');
 const top=options.position==='bottom'?height-zone-height*.055:height*.055;
 const titleHeight=title?lines.length*size*1.22:0,tagSize=Math.max(width*.012,size*.30);let subSize=Math.max(width*.014,size*.42),subLines:string[]=[];
 if(subtitle){do{ctx.font=`600 ${subSize}px "${font}"`;subLines=wrap(ctx,subtitle,usable*.88);if(subLines.length*subSize*1.3<=zone*.25)break;subSize*=.9}while(subSize>Math.max(8,width*.009));if(subLines.length*subSize*1.3>zone*.28)throw Error('副标题换行过多，请缩短文字')}
 const total=titleHeight+(subtitle?subLines.length*subSize*1.3:0)+(tag?tagSize*1.7:0)+size*.5;
 const panelY=top+(zone-Math.min(total,zone))*.5,boxHeight=Math.min(zone,total+size*.22);
 const groupBox={x:pad,y:panelY-size*.18,w:usable,h:boxHeight},centerX=width/2,centerY=groupBox.y+groupBox.h/2,group=placement(options,'group');
 const result:Partial<Record<Part,Box>>={group:transformBox(groupBox,centerX,centerY,group.x*width,group.y*height,group.scale)};
 ctx.save();ctx.translate(centerX+group.x*width,centerY+group.y*height);ctx.scale(group.scale,group.scale);ctx.translate(-centerX,-centerY);
 ctx.textAlign='center';ctx.textBaseline='top';
 if(theme.box==='dark'){ctx.fillStyle='rgba(8,18,29,.74)';rounded(ctx,pad,panelY-size*.18,usable,boxHeight,size*.20)}
 if(theme.box==='light'){ctx.fillStyle='rgba(250,252,252,.95)';rounded(ctx,pad,panelY-size*.18,usable,boxHeight,size*.20)}
 if(['gold','blueprint','violet'].includes(theme.id)){ctx.strokeStyle=theme.accent;ctx.lineWidth=Math.max(1,width*.003);ctx.strokeRect(pad+size*.1,panelY-size*.08,usable-size*.2,boxHeight-size*.2)}
 if(['red','paper','news','signal'].includes(theme.id)){ctx.fillStyle=theme.accent;ctx.fillRect(pad,panelY-size*.18,Math.max(3,width*.012),boxHeight)}
 if(['ice','mint','fresh','sunrise'].includes(theme.id)){ctx.fillStyle=theme.accent;ctx.fillRect(pad+size*.2,panelY-size*.1,Math.max(width*.08,size),Math.max(2,width*.004))}
 if(theme.id==='coral'||theme.id==='cream'){ctx.fillStyle=theme.accent;ctx.fillRect(width/2-usable*.14,panelY+boxHeight-size*.26,usable*.28,Math.max(2,width*.005))}
 const drawPart=(part:Exclude<Part,'group'>,box:Box,render:()=>void)=>{const p=placement(options,part),cx=box.x+box.w/2,cy=box.y+box.h/2;const item=transformBox(box,cx,cy,p.x*width,p.y*height,p.scale);result[part]=transformBox(item,centerX,centerY,group.x*width,group.y*height,group.scale);ctx.save();ctx.translate(cx+p.x*width,cy+p.y*height);ctx.scale(p.scale,p.scale);ctx.translate(-cx,-cy);render();ctx.restore()};
 let y=panelY;
 if(tag){ctx.font=`700 ${tagSize}px "${font}"`;const tw=Math.min(usable*.8,ctx.measureText(tag).width+tagSize*1.5),tagY=y;drawPart('tag',{x:(width-tw)/2,y:tagY,w:tw,h:tagSize*1.4},()=>{ctx.font=`700 ${tagSize}px "${font}"`;ctx.fillStyle=theme.accent;rounded(ctx,(width-tw)/2,tagY,tw,tagSize*1.4,tagSize*.7);ctx.fillStyle='#102031';ctx.fillText(tag,width/2,tagY+tagSize*.18,tw-tagSize*.5)});y+=tagSize*1.7}
 if(title){ctx.font=`900 ${size}px "${font}"`;const titleY=y,tw=Math.min(usable,Math.max(...lines.map(line=>ctx.measureText(line).width),size));drawPart('title',{x:(width-tw)/2,y:titleY,w:tw,h:titleHeight},()=>{ctx.font=`900 ${size}px "${font}"`;ctx.lineJoin='round';ctx.lineWidth=Math.max(2,size*.085);ctx.strokeStyle='rgba(5,12,22,.88)';ctx.shadowColor='rgba(0,0,0,.32)';ctx.shadowBlur=size*.12;ctx.fillStyle=theme.fg;let ty=titleY;
  for(let i=0;i<lines.length;i++){const line=lines[i];if(theme.box==='label'&&i===lines.length-1){const w=Math.min(usable,ctx.measureText(line).width+size*.5);ctx.fillStyle=theme.accent;rounded(ctx,(width-w)/2,ty+size*.02,w,size*1.12,size*.1);ctx.fillStyle='#172331';ctx.shadowBlur=0}else if(theme.box!=='light')ctx.strokeText(line,width/2,ty,usable);ctx.fillText(line,width/2,ty,usable);ty+=size*1.22}
 });y+=titleHeight}
 if(subtitle){ctx.font=`600 ${subSize}px "${font}"`;const subY=y,sw=Math.min(usable,Math.max(...subLines.map(line=>ctx.measureText(line).width),subSize));drawPart('subtitle',{x:(width-sw)/2,y:subY,w:sw,h:subLines.length*subSize*1.3},()=>{ctx.shadowBlur=0;ctx.font=`600 ${subSize}px "${font}"`;ctx.fillStyle=theme.box==='light'?'#34465d':'#ffffff';ctx.strokeStyle='rgba(5,12,22,.9)';ctx.lineWidth=Math.max(1,subSize*.08);let sy=subY;for(const line of subLines){if(theme.box!=='light')ctx.strokeText(line,width/2,sy,usable);ctx.fillText(line,width/2,sy,usable);sy+=subSize*1.3}})}
 ctx.restore();return result;
}

const blob=(canvas:HTMLCanvasElement,type:string,quality?:number)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('生成图片失败，请重试')),type,quality));
function downloadBlob(data:Blob,name:string){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}

export default function CoverDesigner({asset,value,onChange,aspectRatio,fit,srt='',playbackRate=1,sourceStart=0,previewDuration}:{asset:Asset|null;value:CoverSettings;onChange:(value:CoverSettings)=>void;aspectRatio:string;fit:string;srt?:string;playbackRate?:number;sourceStart?:number;previewDuration?:number}){
 const ratios:Record<string,[number,number]>={'9:16':[720,1280],'16:9':[1280,720],'1:1':[720,720],'4:5':[720,900]};const [outputWidth,outputHeight]=ratios[aspectRatio]||ratios['9:16'];const canvasKey=aspectRatio+':'+(fit==='contain'||fit==='none'?'contain':'cover');
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),canvasWrap=useRef<HTMLDivElement>(null),revision=useRef(0),latest=useRef(value),liveRef=useRef(true);latest.current=value;
 const boxesRef=useRef<Partial<Record<Part,Box>>>({}),drag=useRef<{mode:'move'|'scale';part:Part;x:number;y:number;placement:Placement;distance:number}|null>(null),playRef=useRef(false);
 const [url,setUrl]=useState(''),[duration,setDuration]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[playing,setPlaying]=useState(false),[current,setCurrent]=useState(0),[selected,setSelected]=useState<Part>('group'),[boxes,setBoxes]=useState<Partial<Record<Part,Box>>>({});
 const sourceId=asset?.id||'',latestSource=useRef(sourceId);latestSource.current=sourceId;
 useEffect(()=>{liveRef.current=true;return()=>{liveRef.current=false;revision.current++}},[]);
 useEffect(()=>{revision.current++;if(value.overlayAssetId&&(value.overlaySourceId!==sourceId||value.overlayCanvasKey!==canvasKey))onChange({...value,overlayAssetId:'',overlaySourceId:'',overlayCanvasKey:''})},[sourceId,canvasKey]);
 useEffect(()=>{let object='',live=true;const controller=new AbortController();setUrl('');setReady(false);setDuration(0);setError('');const source=asset?assetUrl(asset):'';if(!source)return;
  if(!source.startsWith('/api/')){setError('封面暂只支持本地已保存的视频');return}
  fetch(source,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('读取视频失败');object=URL.createObjectURL(await r.blob());if(live)setUrl(object);else URL.revokeObjectURL(object)}).catch(e=>{if(live&&e.name!=='AbortError')setError('视频读取失败，请检查素材')});
  return()=>{live=false;controller.abort();if(object)URL.revokeObjectURL(object)};
 },[sourceId]);
 const change=(part:Partial<CoverSettings>,invalidate=true)=>{revision.current++;onChange({...latest.current,...part,...(invalidate?{overlayAssetId:'',overlaySourceId:''}:{})})};
 const paint=()=>{const v=video.current,c=canvas.current;if(!v||!c||v.readyState<2||!v.videoWidth)return;try{const visible=!playRef.current||v.currentTime-sourceStart<latest.current.overlayDuration;const display=visible?latest.current:{...latest.current,title:'',subtitle:'',tag:''};const next=drawCover(c,v,display,outputWidth,outputHeight,fit);if(JSON.stringify(next)!==JSON.stringify(boxesRef.current)){boxesRef.current=next;setBoxes(next)}setReady(true);setError('')}catch(e){setReady(false);setError(e instanceof Error?e.message:'封面预览失败，请重试')}};
 useEffect(()=>{paint()},[value.style,value.title,value.subtitle,value.tag,value.font,value.fontSize,value.position,value.placement,ready,canvasKey]);
 useEffect(()=>{if(!playing)return;let frame=0,lastPaint=0,lastCaption=0;const run=(now:number)=>{const v=video.current;if(!v||v.paused)return;if(previewDuration&&v.currentTime>=sourceStart+previewDuration){v.pause();playRef.current=false;setPlaying(false);paint();return}if(now-lastPaint>=33){paint();lastPaint=now}if(now-lastCaption>=120){setCurrent(Math.max(0,v.currentTime-sourceStart));lastCaption=now}frame=requestAnimationFrame(run)};frame=requestAnimationFrame(run);return()=>cancelAnimationFrame(frame)},[playing,sourceStart,previewDuration,playbackRate]);
 useEffect(()=>{const v=video.current;if(v)v.playbackRate=clamp(playbackRate,.5,2)},[playbackRate,url]);
 const seek=(value:number)=>{const v=video.current;if(!v||!Number.isFinite(v.duration))return;const t=clamp(value,0,Math.max(0,v.duration-.04));change({frameTime:t},false);setReady(false);v.currentTime=t;if(Math.abs(v.currentTime-t)<.001&&v.readyState>=2&&!v.seeking)paint()};
 const preview=async()=>{const v=video.current;if(!v)return;if(playing){v.pause();playRef.current=false;setPlaying(false);v.currentTime=clamp(latest.current.frameTime,0,Math.max(0,v.duration-.04));paint();return}try{v.currentTime=clamp(sourceStart,0,Math.max(0,v.duration-.04));v.playbackRate=clamp(playbackRate,.5,2);v.muted=false;playRef.current=true;setPlaying(true);await v.play()}catch{playRef.current=false;setPlaying(false);setError('视频暂时无法播放，请重试')}};
 const setPart=(part:Part,patch:Placement)=>change({placement:{...latest.current.placement,[part]:{...placement(latest.current,part),...patch}}});
 const pointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{if(playing||!ready||!boxes[selected]||!canvas.current)return;const rect=canvas.current.getBoundingClientRect(),box=boxes[selected]!,x=(e.clientX-rect.left)/rect.width*outputWidth,y=(e.clientY-rect.top)/rect.height*outputHeight,scaleX=outputWidth/rect.width,scaleY=outputHeight/rect.height;const nearHandle=Math.abs(x-clamp(box.x+box.w,3,outputWidth-3))<22*scaleX&&Math.abs(y-clamp(box.y+box.h,3,outputHeight-3))<22*scaleY;if(!nearHandle&&(x<box.x-12*scaleX||x>box.x+box.w+12*scaleX||y<box.y-12*scaleY||y>box.y+box.h+12*scaleY))return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={part:selected,mode:nearHandle?'scale':'move',x:e.clientX,y:e.clientY,placement:placement(latest.current,selected),distance:Math.max(18,Math.hypot(box.w/scaleX,box.h/scaleY))}};
 const pointerMove=(e:React.PointerEvent<HTMLDivElement>)=>{const d=drag.current,c=canvas.current;if(!d||!c)return;const rect=c.getBoundingClientRect(),dx=e.clientX-d.x,dy=e.clientY-d.y;if(d.mode==='scale'){setPart(d.part,{scale:clamp((d.placement.scale??1)*(1+(dx+dy)/d.distance),.45,2)})}else{const groupScale=d.part==='group'?1:placement(latest.current,'group').scale;setPart(d.part,{x:clamp((d.placement.x||0)+dx/rect.width/groupScale,-.9,.9),y:clamp((d.placement.y||0)+dy/rect.height/groupScale,-.9,.9)})}};
 const selectedBox=boxes[selected];
 const caption=(()=>{if(!playing||!srt)return '';const time=current;for(const block of srt.replace(/\r/g,'').split(/\n\s*\n/)){const lines=block.split('\n'),i=lines.findIndex(l=>l.includes('-->'));if(i<0)continue;const parse=(t:string)=>{const m=t.trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(('0.'+m[4])):NaN};const [a,b]=lines[i].split('-->').map(parse);if(time>=a&&time<b)return lines.slice(i+1).join('\n')}return ''})();
 const saveCover=async()=>{if(!canvas.current||!ready)return;setError('');try{downloadBlob(await blob(canvas.current,'image/jpeg',.94),'视频封面.jpg')}catch(e){setError(e instanceof Error?e.message:'导出封面失败')}};
 const applyOverlay=async()=>{if(!asset?.id||!video.current?.videoWidth||!value.title.trim()){setError('请选择视频并填写片头标题');return}setBusy(true);setError('');const started=revision.current,id=asset.id;try{
  const layer=document.createElement('canvas');drawCover(layer,null,value,outputWidth,outputHeight,fit);const file=await blob(layer,'image/png');const data=new FormData();data.append('file',new File([file],'片头标题.png',{type:'image/png'}));const response=await api('/studio/upload',data),saved=response.asset||response;if(!saved.id)throw Error('片头图层未能保存');
  if(!liveRef.current)return;if(started!==revision.current||id!==latestSource.current){setError('编辑内容已变化，图层已保存到素材库；请重新应用片头');return}
  onChange({...latest.current,overlayAssetId:saved.id,overlaySourceId:id,overlayCanvasKey:canvasKey});
 }catch(e){setError(e instanceof Error?e.message:'片头图层保存失败')}finally{setBusy(false)}};
 return <section className="cd-designer" aria-label="封面与片头设计">
  <header><div><span>封面与片头</span><h3>选一帧，做好第一眼</h3><p>封面可单独下载；标题图层可选叠加到视频开头。</p></div><ImageIcon size={22}/></header>
  {!asset?<p className="cd-empty">先选择一段本地视频，再设计封面和片头。</p>:<>
   <div className="cd-grid"><div className="cd-preview"><div className="cd-frame">{url&&<video ref={video} src={url} muted playsInline preload="auto" onLoadedMetadata={e=>{const v=e.currentTarget;setDuration(v.duration||0);v.currentTime=clamp(value.frameTime,0,Math.max(0,(v.duration||0)-.04))}} onLoadedData={paint} onSeeked={paint} onEnded={()=>{playRef.current=false;setPlaying(false);paint()}} onError={()=>setError('无法读取视频帧')}/>}<div ref={canvasWrap} className="cd-canvas-wrap" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}><canvas ref={canvas} aria-label="封面与片头画面预览"/>{!playing&&selectedBox&&<div className="cd-transform" aria-hidden="true" style={{left:`${selectedBox.x/outputWidth*100}%`,top:`${selectedBox.y/outputHeight*100}%`,width:`${selectedBox.w/outputWidth*100}%`,height:`${selectedBox.h/outputHeight*100}%`}}/>}{!playing&&selectedBox&&<span className="cd-handle" aria-hidden="true" style={{left:`${clamp(selectedBox.x+selectedBox.w,3,outputWidth-3)/outputWidth*100}%`,top:`${clamp(selectedBox.y+selectedBox.h,3,outputHeight-3)/outputHeight*100}%`}}/>}{caption&&<div className="cd-preview-caption">{caption}</div>}</div>{!ready&&<div className="cd-loading">正在读取所选帧…</div>}</div><div className="cd-preview-actions"><button type="button" disabled={!ready} onClick={()=>void preview()}>{playing?'停止播放':'播放预览片头'}</button><button type="button" disabled={!ready||playing} onClick={()=>void saveCover()}><Download size={15}/>下载封面 JPG</button></div><label>选择封面画面 <span>{value.frameTime.toFixed(1)} / {duration.toFixed(1)} 秒</span><input type="range" aria-label="选择封面画面时间" min="0" max={Math.max(0,duration-.04)} step="0.1" value={Math.min(value.frameTime,Math.max(0,duration-.04))} disabled={!duration||playing} onChange={e=>seek(Number(e.target.value))}/></label><p className="cd-preview-help">拖动画面中的选中框移动，拖动右下角调整大小；播放时按片头时长显示。</p></div>
    <div className="cd-controls"><div className="cd-theme-head"><strong>选择样式</strong><small>{themes.length} 款原创模板</small></div><div className="cd-themes" role="group" aria-label="封面样式">{themes.map(t=><button type="button" key={t.id} data-style={t.id} aria-pressed={value.style===t.id} className={'cd-theme '+(value.style===t.id?'selected':'')} onClick={()=>change({style:t.id})}><span className="cd-theme-thumb" style={{'--cd-accent':t.accent,'--cd-ink':t.fg} as React.CSSProperties}><b>让内容<br/>被看见</b><i>视频标题</i></span><strong>{t.name}</strong><small>{t.description}</small></button>)}</div>
    <label>封面标题 <small>建议简短，支持换行</small><textarea rows={2} maxLength={60} aria-label="封面标题" value={value.title} onChange={e=>change({title:e.target.value})}/></label><label>副标题 <small>可选</small><input maxLength={80} aria-label="封面副标题" value={value.subtitle} onChange={e=>change({subtitle:e.target.value})}/></label><label>标签 <small>可选</small><input maxLength={20} aria-label="封面标签" value={value.tag} onChange={e=>change({tag:e.target.value})}/></label>
    <div className="cd-edit-target"><span>画面中调整</span><div role="group" aria-label="选择拖动对象">{([['group','整体'],['title','主标题'],['subtitle','副标题'],['tag','标签']] as [Part,string][]).map(([part,label])=><button type="button" key={part} aria-pressed={selected===part} disabled={!boxes[part]} onClick={()=>setSelected(part)}>{label}</button>)}</div><small>选择对象后可在左侧画面拖动；也可用下面的数值微调。</small></div><div className="cd-transform-fields"><label>左右 <input type="range" aria-label="左右位置" min="-60" max="60" step="1" value={Math.round(placement(value,selected).x*100)} onChange={e=>setPart(selected,{x:Number(e.target.value)/100})}/></label><label>上下 <input type="range" aria-label="上下位置" min="-60" max="60" step="1" value={Math.round(placement(value,selected).y*100)} onChange={e=>setPart(selected,{y:Number(e.target.value)/100})}/></label><label>缩放 <input type="range" aria-label="选中对象缩放" min="45" max="200" step="1" value={Math.round(placement(value,selected).scale*100)} onChange={e=>setPart(selected,{scale:Number(e.target.value)/100})}/></label><button type="button" onClick={()=>setPart(selected,{x:0,y:0,scale:1})}>还原选中对象</button></div>
    <div className="cd-settings"><label>字体<select aria-label="封面字体" value={value.font} onChange={e=>change({font:e.target.value})}>{fonts.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>字号 <small>{value.fontSize}%</small><input aria-label="封面字号" type="range" min="5" max="20" step="0.5" value={value.fontSize} onChange={e=>change({fontSize:Number(e.target.value)})}/></label><label>标题区域<select aria-label="标题区域" value={value.position} onChange={e=>change({position:e.target.value as 'top'|'bottom',placement:{...value.placement,group:{...placement(value,'group'),x:0,y:0}}})}><option value="top">画面上方</option><option value="bottom">画面下方</option></select></label><label>片头显示<select aria-label="片头显示时长" value={value.overlayDuration} onChange={e=>change({overlayDuration:Number(e.target.value)},false)}><option value={3}>前 3 秒</option><option value={5}>前 5 秒</option><option value={8}>前 8 秒</option>{![3,5,8].includes(value.overlayDuration)&&<option value={value.overlayDuration}>前 {value.overlayDuration} 秒</option>}</select></label><label>自定义时长（秒）<input aria-label="自定义片头时长" type="number" min="0.1" max="3600" step="0.1" value={value.overlayDuration} onChange={e=>change({overlayDuration:clamp(Number(e.target.value),.1,3600)},false)}/></label></div>
    <p className="cd-hint">预览按成片画面比例和首段画面适配方式显示；文字位置需手动避开人物。</p><button type="button" className="cd-apply" disabled={!ready||busy||!value.title.trim()} onClick={()=>void applyOverlay()}><Layers3 size={15}/>{busy?'正在保存图层…':value.overlayAssetId?'重新应用片头标题':'应用标题到片头'}</button>{value.overlayAssetId&&<div className="cd-applied"><p role="status">片头标题已应用；修改模板或文字后需重新应用。</p><button type="button" onClick={()=>change({overlayAssetId:'',overlaySourceId:''},false)}>取消片头叠加</button></div>}</div>
   </div>{error&&<p className="cd-error" role="alert">{error}</p>}
  </>}
 </section>;
}
