// Adapted from ZJU-REAL/Easel web/frontend/src/lib/sanitize.ts (Apache-2.0).
import {marked} from 'marked';
import DOMPurify from 'dompurify';
marked.setOptions({breaks:true,gfm:true});
export default function Markdown({text}:{text:string}){return <div className="markdown" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(marked.parse(text||'') as string,{FORBID_TAGS:['iframe','object','form'],FORBID_ATTR:['style']})}}/>;}
