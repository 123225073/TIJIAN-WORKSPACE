import {useEffect,type RefObject} from 'react';

/** Relative progress works across Markdown, rich text and a differently sized preview. */
export function linkScroll(first:HTMLElement,second:HTMLElement){
 const expected=new WeakMap<HTMLElement,number>();
 const copy=(source:HTMLElement,target:HTMLElement)=>{
  const last=expected.get(source);
  if(last!==undefined&&Math.abs(source.scrollTop-last)<2){expected.delete(source);return}
  expected.delete(source);
  const extent=source.scrollHeight-source.clientHeight;
  const top=extent>0?source.scrollTop/extent*Math.max(0,target.scrollHeight-target.clientHeight):0;
  if(Math.abs(target.scrollTop-top)<1)return;
  expected.set(target,top);target.scrollTop=top;
 };
 const left=()=>copy(first,second),right=()=>copy(second,first);
 const eventNode=(node:HTMLElement):EventTarget=>node.ownerDocument.scrollingElement===node?node.ownerDocument:node;
 const a=eventNode(first),b=eventNode(second);
 a.addEventListener('scroll',left,{passive:true});b.addEventListener('scroll',right,{passive:true});left();
 return()=>{a.removeEventListener('scroll',left);b.removeEventListener('scroll',right)};
}

export function usePairedScroll(first:RefObject<HTMLElement|null>,second:RefObject<HTMLElement|null>,enabled=true){
 useEffect(()=>{if(enabled&&first.current&&second.current)return linkScroll(first.current,second.current)},[first,second,enabled]);
}
