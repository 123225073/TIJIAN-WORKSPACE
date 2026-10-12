import {useEffect,useState} from 'react';
import {ArrowUpRight,Clock3} from 'lucide-react';
import type {Item} from './api';
import './current-activity.css';

const editor=/^studio\/(?:text|image|video|avatar\/(?:text|audio|photo|image|create)|audio\/(?:create|tts)|compose|flow)(?:\?|$)/;
export default function CurrentActivity({route,userId,objects}:{route:string;userId:string;objects:Item[]}){
 const key='current-activity:'+userId;
 const [target,setTarget]=useState(()=>localStorage.getItem(key)||'');
 useEffect(()=>{
  if(route.startsWith('task/')||editor.test(route)){
   setTarget(route);localStorage.setItem(key,route);
  }
 },[route,key]);
 const id=target.split('?')[0].split('/')[1];
 const task=target.startsWith('task/')?objects.find(x=>x.id===id&&x.kind==='task'&&!x.archived):undefined;
 const valid=target.startsWith('task/')?!!task:editor.test(target);
 if(!valid)return null;
 const same=target===route,label=same?'当前任务':'继续当前任务';
 return <button className="current-activity" aria-label={label} disabled={same} title={task?.title||'回到刚才的创作页面'} onClick={()=>{location.hash=target}}><Clock3 size={15}/><span>{label}</span>{!same&&<ArrowUpRight size={14}/>}</button>;
}
