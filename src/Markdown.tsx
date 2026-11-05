// Adapted from ZJU-REAL/Easel web/frontend/src/lib/sanitize.ts (Apache-2.0).
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {useEffect,useRef} from 'react';
import {api,getToken} from './api';
marked.setOptions({breaks:true,gfm:true});
export default function Markdown({text,textOnly=false}:{text:string;textOnly?:boolean}){
 const root=useRef<HTMLDivElement>(null);
 const html=DOMPurify.sanitize(marked.parse(text||'') as string,textOnly?{
  ALLOWED_TAGS:['h1','h2','h3','h4','h5','h6','p','br','hr','strong','em','del','blockquote','ul','ol','li','pre','code','table','thead','tbody','tr','th','td'],
  ALLOWED_ATTR:[],ALLOW_DATA_ATTR:false,
 }:{FORBID_TAGS:['iframe','object','form'],FORBID_ATTR:['style']}).replace(/src="(\/api\/(?:illustrations\/[a-f0-9]{32}|studio\/assets\/[a-f0-9]{32}(?:[a-f0-9]{32})?)\/file)"/g,'data-local-image="$1"');
 useEffect(()=>{
  let active=true;const token=getToken(),controller=new AbortController(),urls:string[]=[];
  root.current?.querySelectorAll<HTMLImageElement>('img[data-local-image]').forEach(img=>{
   const path=img.dataset.localImage!;
   // Only exact same-origin private image paths receive credentials. Remove src
   // before DOM insertion so the browser cannot make an unauthenticated request.
   if(!/^\/api\/(?:illustrations\/[a-f0-9]{32}|studio\/assets\/[a-f0-9]{32}(?:[a-f0-9]{32})?)\/file$/.test(path))return;
   void (async()=>{try{
    if(path.startsWith('/api/illustrations/')){const d=await api(path.slice(4));if(active&&getToken()===token)img.src=d.data_uri}
    else{const response=await fetch(path,{headers:{Authorization:'Bearer '+token},signal:controller.signal});if(!response.ok)throw Error('配图读取失败');const blob=await response.blob();if(active&&getToken()===token){const url=URL.createObjectURL(blob);urls.push(url);img.src=url}}
   }catch{if(active)img.alt='配图暂不可用'}})();
  });return()=>{active=false;controller.abort();urls.forEach(url=>URL.revokeObjectURL(url))};
 },[html]);
 return <div ref={root} className="markdown" dangerouslySetInnerHTML={{__html:html}}/>;
}
