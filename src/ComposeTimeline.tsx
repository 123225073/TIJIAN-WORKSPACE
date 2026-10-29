import {useEffect,useRef,useState} from 'react';
import {getToken} from './api';
import {assetUrl,mediaKind,type Asset} from './ResourcePreview';
import './compose-timeline.css';

type Scene={asset_id:string;trim:number;length:number;fit:string;volume:number;audio_id?:string;audio_volume?:number};
type Roll={asset_id:string;start:number;trim:number;length:number;fit:string};
type TimelineProject={scenes:Scene[];b_roll:Roll[];music:{asset_id:string;volume:number}|null;srt:string;aspect_ratio:string;playback_speed?:number;intro:{overlay_asset_id:string;overlay_duration:number};subtitle_style:{font:string;size:string;color:string;stroke_color:string;stroke:number;position:string}};
function useAssetUrl(asset?:Asset,retry=0){
 const [result,setResult]=useState({source:'',url:'',error:false,retry:0});const source=asset?assetUrl(asset):'';
 useEffect(()=>{let live=true,blob='';if(!source){setResult({source:'',url:'',error:false,retry});return}const controller=new AbortController();
  if(!source.startsWith('/api/')){setResult({source,url:source,error:false,retry});return}
  fetch(source,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('读取素材失败');blob=URL.createObjectURL(await r.blob());if(live)setResult({source,url:blob,error:false,retry});else URL.revokeObjectURL(blob)}).catch(e=>{if(live&&e.name!=='AbortError')setResult({source,url:'',error:true,retry})});
  return()=>{live=false;controller.abort();if(blob)URL.revokeObjectURL(blob)};
 },[source,retry]);return result.source===source&&result.retry===retry?result:{source,url:'',error:false,retry};
}
const clamp=(x:number,low:number,high:number)=>Math.max(low,Math.min(high,x));
const seconds=(value:string)=>{const m=value.trim().match(/^(\d+):(\d\d):(\d\d)[,.](\d{3})$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN};
const captionAt=(srt:string,t:number)=>{for(const block of srt.replace(/\r/g,'').split(/\n\s*\n/)){const lines=block.trim().split('\n');if(/^\d+$/.test(lines[0]||''))lines.shift();const pair=(lines.shift()||'').split('-->');if(pair.length===2&&t>=seconds(pair[0])&&t<seconds(pair[1]))return lines.join(' ').trim()}return ''};
const clock=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}.${Math.floor((t%1)*10)}`;

export default function ComposeTimeline({project,assets,onMoveRoll,onTimeChange}:{project:TimelineProject;assets:Asset[];onMoveRoll:(index:number,start:number,length:number)=>void;onTimeChange?:(time:number)=>void}){
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[notice,setNotice]=useState(''),[mainReady,setMainReady]=useState(''),[rollReady,setRollReady]=useState(''),[musicReady,setMusicReady]=useState(''),[voiceReady,setVoiceReady]=useState(''),[titleReady,setTitleReady]=useState(''),[decodeError,setDecodeError]=useState(''),[retry,setRetry]=useState(0);
 const editor=useRef<HTMLElement>(null),mainVideo=useRef<HTMLVideoElement>(null),rollVideo=useRef<HTMLVideoElement>(null),musicRef=useRef<HTMLAudioElement>(null),voiceRef=useRef<HTMLAudioElement>(null),drag=useRef<{i:number;x:number;start:number;length:number;mode:'move'|'end';width:number}|null>(null),track=useRef<HTMLDivElement>(null);
 const audioGraph=useRef<{context:AudioContext;nodes:Map<HTMLMediaElement,{source:MediaElementAudioSourceNode;gain:GainNode}>}|null>(null);
 useEffect(()=>()=>{const graph=audioGraph.current;if(graph){for(const node of graph.nodes.values()){node.source.disconnect();node.gain.disconnect()}void graph.context.close().catch(()=>{});audioGraph.current=null}},[]);
 useEffect(()=>{const host=editor.current?.closest<HTMLElement>('.st-retained-editor');const stop=()=>{if(document.hidden||host?.hidden)setPlaying(false)};const observer=host?new MutationObserver(stop):null;if(host)observer?.observe(host,{attributes:true,attributeFilter:['hidden']});document.addEventListener('visibilitychange',stop);stop();return()=>{observer?.disconnect();document.removeEventListener('visibilitychange',stop)}},[]);
 const enableAudio=()=>{try{if(!audioGraph.current)audioGraph.current={context:new AudioContext(),nodes:new Map()};void audioGraph.current.context.resume().catch(()=>{})}catch{setNotice('当前环境无法放大预览音量；导出仍按设置的音量处理')}};
 const total=project.scenes.reduce((sum,s)=>sum+Math.max(0,Number(s.length)||0),0),speed=project.playback_speed||1;
 let offset=0,sceneIndex=-1;for(let i=0;i<project.scenes.length;i++){const end=offset+Number(project.scenes[i].length||0);if(time<end||i===project.scenes.length-1){sceneIndex=i;break}offset=end}
 const scene=project.scenes[sceneIndex],base=assets.find(x=>x.id===scene?.asset_id);
 let rollIndex=-1;project.b_roll.forEach((r,i)=>{if(r.asset_id&&time>=r.start&&time<r.start+r.length)rollIndex=i});
 const roll=project.b_roll[rollIndex],overlay=assets.find(a=>a.id===roll?.asset_id),music=assets.find(a=>a.id===project.music?.asset_id),voice=assets.find(a=>a.id===scene?.audio_id);
 // Start loading the nearest upcoming insert before its first frame is due.
 // Keep the same object URL as playback crosses that boundary; loading a
 // large video only after the boundary made short B-rolls disappear entirely.
 const nextRoll=project.b_roll.filter(r=>r.asset_id&&r.start>time).sort((a,b)=>a.start-b.start)[0];
 const preparedRoll=overlay||assets.find(a=>a.id===nextRoll?.asset_id);
 const title=project.intro.overlay_asset_id?{id:project.intro.overlay_asset_id,asset_type:'image',file_url:'/api/studio/assets/'+encodeURIComponent(project.intro.overlay_asset_id)+'/file'} as Asset:undefined;
 const mainAsset=useAssetUrl(base,retry),preparedRollAsset=useAssetUrl(preparedRoll,retry),musicAsset=useAssetUrl(music,retry),voiceAsset=useAssetUrl(voice,retry),titleAsset=useAssetUrl(title,retry);
 const mainUrl=mainAsset.url,rollUrl=overlay?.id===preparedRoll?.id?preparedRollAsset.url:'',musicUrl=musicAsset.url,voiceUrl=voiceAsset.url,titleUrl=titleAsset.url;
 const mainKey=(base?.id||'')+':'+mainUrl,rollKey=(overlay?.id||'')+':'+rollUrl,musicKey=(music?.id||'')+':'+musicUrl,voiceKey=(voice?.id||'')+':'+voiceUrl,titleKey=(title?.id||'')+':'+titleUrl,showTitle=!!title&&time<project.intro.overlay_duration;
 const issue=(base&&(mainAsset.error||decodeError===mainKey)?'主画面':overlay&&(preparedRollAsset.error||decodeError===rollKey)?'补充画面':music&&(musicAsset.error||decodeError===musicKey)?'背景音乐':voice&&(voiceAsset.error||decodeError===voiceKey)?'配音':showTitle&&(titleAsset.error||decodeError===titleKey)?'片头':'');
 const buffering=!!(base&&(!mainUrl||mainReady!==mainKey)||overlay&&(!rollUrl||rollReady!==rollKey)||music&&(!musicUrl||musicReady!==musicKey)||voice&&(!voiceUrl||voiceReady!==voiceKey)||showTitle&&(!titleUrl||titleReady!==titleKey));
 const activePlayback=playing&&!buffering&&!issue;
 const currentCaption=captionAt(project.srt,time),style=project.subtitle_style;
 useEffect(()=>{if(time>total)setTime(total)},[total]);
 useEffect(()=>{onTimeChange?.(time)},[time]);
 useEffect(()=>{if(!activePlayback||!total)return;let id=0,last=performance.now();const run=(now:number)=>{const elapsed=Math.min(.2,(now-last)/1000)*speed;last=now;setTime(t=>{const next=t+elapsed;if(next>=total){setPlaying(false);return total}return next});id=requestAnimationFrame(run)};id=requestAnimationFrame(run);return()=>cancelAnimationFrame(id)},[activePlayback,total,speed]);
 useEffect(()=>{if(issue&&playing){setPlaying(false);setNotice(issue+'读取失败，请检查素材后重试')}},[issue,playing]);
 useEffect(()=>{const graph=audioGraph.current;if(graph){const active=new Set([mainVideo.current,musicRef.current,voiceRef.current]);for(const [element,node] of graph.nodes)if(!active.has(element)){node.source.disconnect();node.gain.disconnect();graph.nodes.delete(element)}}
  const sync=(el:HTMLMediaElement|null,target:number,volume:number,muted=false)=>{if(!el||!el.src)return;el.playbackRate=speed;el.preservesPitch=true;el.muted=muted;
   if(graph&&!muted){try{let node=graph.nodes.get(el);if(!node){const source=graph.context.createMediaElementSource(el),gain=graph.context.createGain();source.connect(gain);gain.connect(graph.context.destination);node={source,gain};graph.nodes.set(el,node)}el.volume=1;node.gain.gain.value=clamp(volume,0,2)}catch{el.volume=clamp(volume,0,1)}}else el.volume=clamp(volume,0,1);
   if(!el.loop&&Number.isFinite(el.duration)&&target>=el.duration){if(!el.paused)el.pause();return}
   const actualTarget=el.loop&&Number.isFinite(el.duration)&&el.duration>0?target%el.duration:target;
   if(Number.isFinite(actualTarget)&&Math.abs(el.currentTime-actualTarget)>.3){try{el.currentTime=Math.max(0,actualTarget)}catch{}}if(activePlayback){if(el.paused)void el.play().catch(()=>setNotice('预览需要点击播放后才能听到声音'))}else if(!el.paused)el.pause()};
  sync(mainVideo.current,(scene?.trim||0)+Math.max(0,time-offset),scene?.volume??1);sync(rollVideo.current,(roll?.trim||0)+Math.max(0,time-(roll?.start||0)),0,true);sync(musicRef.current,time,project.music?.volume??0);sync(voiceRef.current,Math.max(0,time-offset),scene?.audio_volume??1);
 },[time,playing,activePlayback,speed,mainUrl,rollUrl,musicUrl,voiceUrl,sceneIndex,rollIndex,scene?.volume,scene?.audio_volume,project.music?.volume]);
 const seek=(value:number)=>{setTime(clamp(value,0,total));setNotice('')};
 const move=(e:React.PointerEvent<HTMLButtonElement>,i:number,mode:'move'|'end')=>{const rect=track.current?.getBoundingClientRect(),r=project.b_roll[i];if(!rect||!r)return;e.preventDefault();e.stopPropagation();drag.current={i,x:e.clientX,start:r.start,length:r.length,mode,width:rect.width};e.currentTarget.setPointerCapture(e.pointerId)};
 const moving=(e:React.PointerEvent<HTMLButtonElement>)=>{const d=drag.current;if(!d||!d.width||!total)return;const delta=(e.clientX-d.x)/d.width*total;const clip=project.b_roll[d.i],a=assets.find(x=>x.id===clip?.asset_id),maxLength=mediaKind(a||{} as Asset)==='video'?Math.max(.1,Number(a?.duration||total)-(clip?.trim||0)):total;const start=d.mode==='move'?clamp(d.start+delta,0,Math.max(0,total-d.length)):d.start;const length=d.mode==='end'?clamp(d.length+delta,.1,Math.min(total-start,maxLength)):d.length;onMoveRoll(d.i,Math.round(start*10)/10,Math.round(length*10)/10)};
 const ratio=project.aspect_ratio.replace(':',' / '),[ratioW,ratioH]=project.aspect_ratio.split(':').map(Number),stageMax=Math.min(720,390*(ratioW||9)/(ratioH||16));
 return <section ref={editor} className="ct-editor" aria-label="成片预览与时间轴"><div className="ct-heading"><div><b>成片预览</b><small>播放或拖动时间轴，查看画面、片头和字幕</small></div><span>预览以最终导出为准</span></div>
  <div className="ct-stage-wrap"><div className="ct-stage" style={{aspectRatio:ratio,maxWidth:stageMax}}>
   {base&&mainUrl?(mediaKind(base)==='image'?<img src={mainUrl} onLoad={()=>setMainReady(mainKey)} onError={()=>setDecodeError(mainKey)} style={{objectFit:scene.fit==='contain'?'contain':'cover'}} alt="主画面"/>:<video ref={mainVideo} src={mainUrl} onLoadedData={()=>setMainReady(mainKey)} onError={()=>setDecodeError(mainKey)} playsInline preload="auto" style={{objectFit:scene.fit==='contain'?'contain':'cover'}}/>):<div className="ct-placeholder">{base?'正在读取主画面…':'选择主画面后开始预览'}</div>}
   {overlay&&rollUrl&&(mediaKind(overlay)==='image'?<img className="ct-roll" src={rollUrl} onLoad={()=>setRollReady(rollKey)} onError={()=>setDecodeError(rollKey)} style={{objectFit:roll.fit==='contain'?'contain':'cover'}} alt="补充画面"/>:<video className="ct-roll" ref={rollVideo} src={rollUrl} onLoadedData={()=>setRollReady(rollKey)} onError={()=>setDecodeError(rollKey)} playsInline muted preload="auto" style={{objectFit:roll.fit==='contain'?'contain':'cover'}}/>)}
   {overlay&&buffering&&<div className="ct-buffer">正在读取素材，预览将在素材就绪后继续…</div>}
   {titleUrl&&showTitle&&<img className="ct-title" src={titleUrl} onLoad={()=>setTitleReady(titleKey)} onError={()=>setDecodeError(titleKey)} alt="片头标题"/>}
   {currentCaption&&<div className={'ct-caption '+(style.position==='upper'?'upper':'')} style={{fontFamily:style.font,color:style.color,WebkitTextStroke:`${Math.max(0,style.stroke)*.35}px ${style.stroke_color}`,fontSize:style.size==='large'?'min(5.5cqw, 5.5cqh)':style.size==='small'?'min(3.5cqw, 3.5cqh)':'min(4.5cqw, 4.5cqh)'}}>{currentCaption.length>18?<>{currentCaption.slice(0,18)}<br/>{currentCaption.slice(18)}</>:currentCaption}</div>}
  </div>{musicUrl&&<audio ref={musicRef} src={musicUrl} onLoadedData={()=>setMusicReady(musicKey)} onError={()=>setDecodeError(musicKey)} loop preload="auto"/>}{voiceUrl&&<audio ref={voiceRef} src={voiceUrl} onLoadedData={()=>setVoiceReady(voiceKey)} onError={()=>setDecodeError(voiceKey)} preload="auto"/>}</div>
  <div className="ct-controls"><button type="button" className="lc-button primary" disabled={!base||!total||(!playing&&(buffering||!!issue))} onClick={()=>{if(time>=total)setTime(0);setNotice('');if(!playing)enableAudio();setPlaying(p=>!p)}}>{playing?'暂停':'▶ 播放成片'}</button><span>{clock(time/speed)} / {clock(total/speed)}</span><input type="range" aria-label="成片播放位置" min="0" max={total||0} step="0.05" value={Math.min(time,total)} onChange={e=>seek(Number(e.target.value))}/><small>{speed.toFixed(1)}×</small></div>{issue?<div className="lc-warning">{issue}读取失败，请检查素材。 <button className="lc-button" onClick={()=>{setDecodeError('');setNotice('');setRetry(x=>x+1)}}>重新读取素材</button></div>:buffering&&base?<p className="lc-muted ct-buffer-note">正在读取当前素材；素材较大时需要等待，预览时间不会跳过画面。</p>:null}{notice&&<p className="lc-warning">{notice}</p>}
  <div className="ct-tracks"><div className="ct-label">主画面</div><div className="ct-lane">{project.scenes.map((s,i)=>{const start=project.scenes.slice(0,i).reduce((n,x)=>n+Number(x.length||0),0),a=assets.find(x=>x.id===s.asset_id);return <button className="ct-clip main" type="button" key={i} style={{left:(start/(total||1)*100)+'%',width:(s.length/(total||1)*100)+'%'}} onClick={()=>seek(start)} title={a?.title||'主画面'}>{a?.title||a?.name||'选择主画面'}</button>})}<span className="ct-playhead" style={{left:(time/(total||1)*100)+'%'}}/></div>
   <div className="ct-label">补充画面</div><div className="ct-lane" ref={track} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();seek((e.clientX-rect.left)/rect.width*total)}}>{project.b_roll.map((r,i)=>{const a=assets.find(x=>x.id===r.asset_id);return <button className="ct-clip broll" type="button" key={i} style={{left:(r.start/(total||1)*100)+'%',width:(r.length/(total||1)*100)+'%'}} onPointerDown={e=>move(e,i,'move')} onPointerMove={moving} onPointerUp={()=>{drag.current=null}} onClick={e=>e.stopPropagation()} title="拖动调整出现时间，拖动右侧调整时长">{a?.title||a?.name||'请选择补充素材'}<span className="ct-resize" role="slider" aria-label="调整补充画面时长" onPointerDown={e=>move(e as unknown as React.PointerEvent<HTMLButtonElement>,i,'end')}/></button>})}<span className="ct-playhead" style={{left:(time/(total||1)*100)+'%'}}/></div>
   <div className="ct-label">字幕 / 音乐</div><div className="ct-lane info" onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();seek((e.clientX-rect.left)/rect.width*total)}}><span>{project.srt?'字幕已添加':'暂无字幕'} · {music?'背景音乐已添加':'暂无背景音乐'}</span><span className="ct-playhead" style={{left:(time/(total||1)*100)+'%'}}/></div></div>
  <p className="ct-help">拖动金色片段可调整补充画面出现时间，拖动片段右边缘可改变时长；口播声音继续播放。</p>
 </section>;
}
