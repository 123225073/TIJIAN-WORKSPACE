import {useEffect} from 'react';
import './liquid-tabs.css';

// Enhance existing tab controls without changing their navigation or saved state.
const groups='[role="tablist"],.aw-main-tabs,.aw-platform-tabs,.artifact-tabs,.work-tabs,.knowledge-tabs,.st-tabs,.st-library-tabs,.mw-mode-switch,.ie-workflow-tabs,.ie-mark-tabs,.ap-tabs,.vs-tabs,.sl-tabs,.capability-tabs,.model-category,.wechat-source-tabs,.td-mode-tabs,.ark-modes,.wo-tabs,.wa-view-switch,.st-view-tabs';
export default function LiquidTabs(){
 useEffect(()=>{
  let frame=0,live=true;const timers=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
  const observed=new Set<HTMLElement>();
  const measure=()=>{frame=0;if(!live)return;document.querySelectorAll<HTMLElement>(groups).forEach(group=>{
   const controls=Array.from(group.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.matches('button,a'));
   if(controls.length<2)return;
   if(!group.classList.contains('liquid-tabs'))group.classList.add('liquid-tabs');
   if(!observed.has(group)){resize.observe(group);observed.add(group)}
   const active=controls.find(node=>node.matches('.active,.selected,[aria-current="page"],[aria-pressed="true"],[aria-selected="true"]'));
   if(!active||!active.getBoundingClientRect().width){group.style.setProperty('--liquid-visible','0');return}
   const box=group.getBoundingClientRect(),target=active.getBoundingClientRect();
   const previous=group.dataset.liquidActive,current=String(controls.indexOf(active));
   if(previous!==undefined&&previous!==current){group.dataset.liquidMoving='true';clearTimeout(timers.get(group));timers.set(group,setTimeout(()=>{delete group.dataset.liquidMoving;timers.delete(group)},400))}
   group.dataset.liquidActive=current;
   for(const [key,value] of Object.entries({'x':target.left-box.left+group.scrollLeft,'y':target.top-box.top+group.scrollTop,'w':target.width,'h':target.height})){
    const next=value+'px';if(group.style.getPropertyValue('--liquid-'+key)!==next)group.style.setProperty('--liquid-'+key,next);
   }
   group.style.setProperty('--liquid-visible','1');
  });for(const group of observed)if(!group.isConnected){resize.unobserve(group);observed.delete(group)}};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)};
  const resize=new ResizeObserver(schedule),mutation=new MutationObserver(schedule);
  mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-current','aria-pressed','aria-selected']});
  document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);document.fonts.ready.then(schedule);schedule();
  return()=>{live=false;cancelAnimationFrame(frame);for(const timer of timers.values())clearTimeout(timer);resize.disconnect();mutation.disconnect();document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule)};
 },[]);
 return null;
}
