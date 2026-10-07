import {useEffect,useRef,useState,type VideoHTMLAttributes} from 'react';
import {Maximize2} from 'lucide-react';
import {StudioModal} from './AssetPicker';
import './video-player.css';

export default function VideoPlayer({expandable=true,...props}:VideoHTMLAttributes<HTMLVideoElement>&{expandable?:boolean}){
 const inline=useRef<HTMLVideoElement>(null),large=useRef<HTMLVideoElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [expanded,setExpanded]=useState(false),position=useRef(0),wasPlaying=useRef(false);
 const close=()=>{const player=large.current,original=inline.current;if(player&&original){position.current=player.currentTime;const playing=!player.paused;player.pause();original.currentTime=position.current;original.volume=player.volume;original.muted=player.muted;original.playbackRate=player.playbackRate;if(playing)void original.play().catch(()=>{})}player?.closest("dialog")?.close();setExpanded(false);trigger.current?.focus()};
 useEffect(()=>{setExpanded(false)},[props.src]);
 useEffect(()=>{const route=()=>{inline.current?.pause();large.current?.pause();setExpanded(false)};window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route)},[]);
 if(!expandable)return <video {...props} ref={inline}/>;
 return <div className="video-player"><video {...props} ref={inline}/>{expandable&&<button className="video-enlarge" ref={trigger} type="button" aria-label={'放大查看视频：'+(props['aria-label']||props.title||'当前视频')} onClick={e=>{e.preventDefault();e.stopPropagation();position.current=inline.current?.currentTime||0;wasPlaying.current=!!inline.current&&!inline.current.paused;inline.current?.pause();setExpanded(true)}}><Maximize2 size={14}/>放大查看</button>}{expanded&&<StudioModal title={props['aria-label']||props.title||'视频预览'} onClose={close}><div className="video-large-stage"><video ref={large} src={props.src} controls preload="metadata" onLoadedMetadata={()=>{const player=large.current;if(!player)return;player.currentTime=position.current;player.volume=inline.current?.volume??1;player.muted=inline.current?.muted??false;player.playbackRate=inline.current?.playbackRate??1;if(wasPlaying.current)void player.play().catch(()=>{})}}/></div><p className="video-large-help">完整显示视频 · 可使用全屏按钮 · Esc 关闭</p></StudioModal>}</div>;
}
