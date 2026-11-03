import {useEffect,useRef,useState} from 'react';
import './subtitle-preview.css';

export type SubtitleStyle={font:string;size:string;color:string;stroke_color:string;stroke:number;position:string;start_time?:number;hide_during_intro?:boolean;font_scale?:number;x?:number;y?:number};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const subtitleUnits=(s:string)=>Array.from(s).length;
export function outputCanvas(aspectRatio:string,resolution:string){const [rw,rh]=aspectRatio.split(':').map(Number),base=resolution==='720p'?720:1080;let w=rw<=rh?base:Math.round(base*rw/rh),h=rw<=rh?Math.round(base*rh/rw):base;w+=w%2;h+=h%2;return {width:w,height:h}}
export function subtitleLayout(text:string,style:SubtitleStyle,w:number,h:number,outputWidth=1080){
 const chars=Array.from(text.replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝').replace(/\n/g,' '));if(!chars.length||!w||!h)return null;
 const size=style.size==='large'?.055:style.size==='small'?.035:.045;
 const base=Math.min(w,h)*size*clamp(style.font_scale??1,.5,2),available=w*.8,total=subtitleUnits(chars.join(''));
 let lines=[chars.join('')];
 if(total*base*1.10>available&&chars.length>1){let best=Infinity,split=1;for(let i=1;i<chars.length;i++){const delta=Math.abs(subtitleUnits(chars.slice(0,i).join(''))-subtitleUnits(chars.slice(i).join('')));if(delta<best){best=delta;split=i}}lines=[chars.slice(0,split).join(''),chars.slice(split).join('')].filter(Boolean)}
 const width=Math.max(...lines.map(subtitleUnits)),fontPx=Math.min(base,available/(width*1.10));
 const half=width*fontPx*1.10/2/w,x=clamp(style.x??.5,half,1-half),pad=Math.max(h*.05,fontPx*lines.length*1.3/2+(style.stroke+2)*w/outputWidth),y=clamp(style.y??(style.position==='upper'?.34:.87),pad/h,1-pad/h);
 return {lines,fontPx,x,y,tooLong:fontPx<Math.min(w,h)*.018};
}
export function subtitleCues(srt:string){const sec=(v:string)=>{const m=v.trim().match(/^(\d+):(\d\d):(\d\d)[,.](\d{3})$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN};return srt.replace(/\r/g,'').split(/\n\s*\n/).map(block=>{const lines=block.trim().split('\n');if(/^\d+$/.test(lines[0]||''))lines.shift();const pair=(lines.shift()||'').split('-->');return {start:sec(pair[0]||''),end:sec(pair[1]||''),text:lines.map(x=>x.trim()).join(' ').trim()}}).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&c.text)}
export function subtitleAt(srt:string,t:number){return subtitleCues(srt).find(c=>t>=c.start&&t<c.end)?.text||''}
export function visibleSubtitle(srt:string,t:number,style:SubtitleStyle,introEnd:number){const start=Math.max(style.start_time||0,style.hide_during_intro?introEnd:0);return t>=start?subtitleAt(srt,t):''}

export default function SubtitlePreview({text,style,onChange,onDragStart,sample=false,aspectRatio='9:16',resolution='1080p'}:{text:string;style:SubtitleStyle;onChange?:(update:Partial<SubtitleStyle>)=>void;onDragStart?:()=>void;sample?:boolean;aspectRatio?:string;resolution?:string}){
 const root=useRef<HTMLDivElement>(null),drag=useRef<{mode:'move'|'scale';x:number;y:number;cx:number;cy:number;scale:number;width:number;height:number}|null>(null);
 const [dimensions,setDimensions]=useState({w:0,h:0}),[selected,setSelected]=useState(false);
 useEffect(()=>{const el=root.current?.parentElement;if(!el)return;const update=()=>setDimensions({w:el.clientWidth,h:el.clientHeight});update();const observer=new ResizeObserver(update);observer.observe(el);return()=>observer.disconnect()},[]);
 const output=outputCanvas(aspectRatio,resolution),layout=subtitleLayout(text,style,dimensions.w,dimensions.h,output.width);if(!layout)return <div className="svp-layer" ref={root}/>;
 const start=(e:React.PointerEvent<HTMLElement>,mode:'move'|'scale')=>{if(!onChange)return;e.stopPropagation();e.preventDefault();setSelected(true);onDragStart?.();drag.current={mode,x:e.clientX,y:e.clientY,cx:layout.x,cy:layout.y,scale:style.font_scale??1,width:dimensions.w,height:dimensions.h};e.currentTarget.setPointerCapture(e.pointerId)};
 const move=(e:React.PointerEvent<HTMLElement>)=>{const d=drag.current;if(!d||!onChange)return;e.stopPropagation();if(d.mode==='move')onChange({x:Math.round(clamp(d.cx+(e.clientX-d.x)/d.width,0,1)*1000)/1000,y:Math.round(clamp(d.cy+(e.clientY-d.y)/d.height,.05,.95)*1000)/1000});else onChange({font_scale:Math.round(clamp(d.scale+(e.clientX-d.x)/d.width*2,.5,2)*100)/100})};
 return <div className="svp-layer" ref={root}>{sample&&<div className="svp-sample">字幕样式示例 · 拖动可调整</div>}<div role="button" tabIndex={0} aria-label="拖动字幕调整位置" title="拖动调整字幕位置；选中后拖动右下角缩放" className={'svp-caption '+(selected?'is-selected':'')} onPointerDown={e=>start(e,'move')} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onClick={e=>e.stopPropagation()} style={{left:`${layout.x*100}%`,top:`${layout.y*100}%`,fontFamily:style.font,color:style.color,WebkitTextStroke:`${Math.max(0,style.stroke)*dimensions.w/output.width}px ${style.stroke_color}`,fontSize:layout.fontPx}}>{layout.lines.map((line,i)=><span key={i}>{line}</span>)}{selected&&onChange&&<span role="slider" aria-label="拖动调整字幕大小" className="svp-scale" onPointerDown={e=>start(e,'scale')} onPointerMove={move} onPointerUp={()=>{drag.current=null}}/>}</div></div>;
}
