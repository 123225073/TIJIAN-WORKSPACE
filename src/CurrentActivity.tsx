import {useEffect,useState} from 'react';
import {Clock3} from 'lucide-react';
import type {Item} from './api';
import {taskActive} from './taskActivity';
import './current-activity.css';

export default function CurrentActivity({objects}:{route:string;userId:string;objects:Item[]}){
 const [active,setActive]=useState(()=>objects.filter(x=>['job','studio_run'].includes(x.kind)&&taskActive(x)).length);
 useEffect(()=>{const update=(event:Event)=>setActive((event as CustomEvent).detail.active);window.addEventListener('task-center-summary',update);return()=>window.removeEventListener('task-center-summary',update)},[]);
 return <button className="current-activity" aria-label="当前任务" title="查看任务进度与耗时" onClick={()=>window.dispatchEvent(new Event('task-center-open'))}><Clock3 size={15}/><span>当前任务</span>{active>0&&<b>{active}</b>}</button>;
}
