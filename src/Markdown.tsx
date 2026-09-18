// Adapted from ZJU-REAL/Easel web/frontend/src/lib/sanitize.ts (Apache-2.0).
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {useEffect,useRef} from 'react';
import {api} from './api';
marked.setOptions({breaks:true,gfm:true});
export default function Markdown({text}:{text:string}){
 const root=useRef<HTMLDivElement>(null);
 const html=DOMPurify.sanitize(marked.parse(text||'') as string,{FORBID_TAGS:['iframe','object','form'],FORBID_ATTR:['style']}).replace(/src="(\/api\/illustrations\/[a-f0-9]{32}\/file)"/g,'data-local-image="$1"');
 useEffect(()=>{let active=true;root.current?.querySelectorAll<HTMLImageElement>('img[data-local-image]').forEach(img=>{const path=img.dataset.localImage!;api(path.replace('/api','')).then(d=>{if(active)img.src=d.data_uri}).catch(()=>{if(active)img.alt='配图暂不可用'})});return()=>{active=false}},[html]);
 return <div ref={root} className="markdown" dangerouslySetInnerHTML={{__html:html}}/>;
}
