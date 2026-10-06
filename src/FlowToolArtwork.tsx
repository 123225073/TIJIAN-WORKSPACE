import {useId} from 'react';

// Local SVG output studies: graphite surfaces, cool blue light and brushed gold.
// Decorative only; each tool keeps its existing key and independent scene.
export default function FlowToolArtwork({tool}:{tool:string}){
 const id=useId().replace(/:/g,''),blue=id+'-blue',panel=id+'-panel',gold=id+'-gold';
 return <svg className="cf-tool-art" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
  <defs>
   <linearGradient id={blue} x1="0" y1="0" x2="1" y2="1">
    <stop stopColor="#b8d2ff"/><stop offset="1" stopColor="#477aca"/>
   </linearGradient>
   <linearGradient id={panel} x1="0" y1="0" x2=".8" y2="1">
    <stop stopColor="#344258"/><stop offset="1" stopColor="#192231"/>
   </linearGradient>
   <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
    <stop stopColor="#e4c891"/><stop offset="1" stopColor="#9a7f52"/>
   </linearGradient>
  </defs>
  <circle cx="60" cy="47" r="37" fill="#9abbff" opacity=".035"/>
  <ellipse cx="61" cy="84" rx="39" ry="4" fill="#070b12" opacity=".5"/>
  {tool==='text'&&<g strokeLinejoin="round">
   <path d="M25 21 70 13 83 72 38 80Z" fill="#182331" stroke="#435774"/>
   <rect x="36" y="14" width="52" height="65" rx="6" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <path d="M43 16H79" stroke="#b8d2ff" strokeOpacity=".45" strokeLinecap="round"/>
   <rect x="45" y="25" width="25" height="5" rx="2" fill={'url(#'+blue+')'}/>
   <path d="M45 41H76M45 49H76M45 57H67" stroke="#a0b4d2" strokeWidth="2" strokeLinecap="round"/>
   <path d="m74 70 21-28 7 5-21 28-10 5Z" fill={'url(#'+gold+')'} stroke="#c3a46e"/>
   <path d="m95 42 4-5q2-2 5 0l3 2q2 2 0 4l-5 4" fill={'url(#'+blue+')'}/>
   <path d="m74 70-3 10 10-5" fill="#e0cfab"/>
   <path d="m71 80 3-2" stroke="#26354c" strokeWidth="1.5"/>
  </g>}
  {tool==='image'&&<g strokeLinejoin="round">
   <rect x="22" y="22" width="73" height="54" rx="7" fill="#182331" transform="rotate(-8 59 49)" stroke="#435774"/>
   <rect x="28" y="15" width="75" height="57" rx="7" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <rect x="35" y="22" width="61" height="42" rx="4" fill="#132035" stroke="#435774"/>
   <circle cx="79" cy="32" r="6" fill={'url(#'+gold+')'}/>
   <path d="m35 64 22-27 15 17 10-11 14 21Z" fill={'url(#'+blue+')'}/>
   <path d="m47 49 10-12 7 8-7-2-6 7" fill="#d9e6fb"/>
   <rect x="20" y="61" width="25" height="20" rx="5" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <path d="M27 67h11M27 73h7" stroke="#b8d2ff" strokeWidth="2" strokeLinecap="round"/>
   <path d="M36 17H94" stroke="#b8d2ff" strokeOpacity=".4" strokeLinecap="round"/>
  </g>}
  {tool==='video'&&<g strokeLinejoin="round">
   <rect x="23" y="25" width="75" height="53" rx="7" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <rect x="30" y="37" width="61" height="33" rx="4" fill="#132035" stroke="#435774"/>
   <path d="m53 43 19 11-19 11Z" fill={'url(#'+blue+')'}/>
   <path d="m22 16 74-6 2 17-74 6Z" fill="#1e2e46" stroke="#6b83a7"/>
   <path d="m32 15 12 15m8-17 12 15m8-17 12 15" stroke="#a9c2e9" strokeWidth="6"/>
   <circle cx="96" cy="74" r="10" fill={'url(#'+gold+')'} stroke="#c3a46e"/>
   <path d="m92 74 3 3 5-6" fill="none" stroke="#3b3020" strokeWidth="2" strokeLinecap="round"/>
  </g>}
  {tool==='avatar/text'&&<g strokeLinejoin="round">
   <rect x="25" y="12" width="65" height="68" rx="9" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <rect x="31" y="18" width="53" height="52" rx="5" fill="#132035"/>
   <path d="M38 70v-7q1-14 19-14t19 14v7" fill={'url(#'+blue+')'}/>
   <ellipse cx="57" cy="36" rx="12" ry="14" fill="#d7b791"/>
   <path d="M45 33q-2-16 12-16 15 0 13 18l-8-8-15 7" fill="#283950" stroke="#6b83a7"/>
   <path d="M48 58q9 5 18 0" fill="none" stroke="#d9e6fb" strokeOpacity=".5"/>
   <rect x="79" y="40" width="13" height="25" rx="6.5" fill={'url(#'+gold+')'} stroke="#c3a46e"/>
   <path d="M82 45h7m-7 4h7m-7 4h7" stroke="#705f40" strokeWidth="1.5"/>
   <path d="M75 57v3q0 11 10 11t11-11v-3M85 71v9m-7 0h15" fill="none" stroke="#a0b4d2" strokeWidth="2" strokeLinecap="round"/>
  </g>}
  {tool==='audio/tts'&&<g>
   <rect x="20" y="30" width="80" height="41" rx="10" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <path d="M28 50h6m5-7v14m8-22v31m8-25v18m8-34v43m8-24v12m8-18v23m8-12h5" stroke={'url(#'+blue+')'} strokeWidth="3" strokeLinecap="round"/>
   <rect x="44" y="10" width="22" height="25" rx="11" fill={'url(#'+gold+')'} stroke="#c3a46e"/>
   <path d="M50 16h10m-10 5h10m-10 5h10" stroke="#705f40" strokeWidth="1.5" strokeLinecap="round"/>
   <path d="M38 26q0 16 17 16t17-16m-17 16v7" fill="none" stroke="#a0b4d2" strokeWidth="2" strokeLinecap="round"/>
   <circle cx="91" cy="72" r="11" fill="#2d558a" stroke="#9abbff"/>
   <path d="m88 67 8 5-8 5Z" fill="#d9e6fb"/>
  </g>}
  {tool==='compose'&&<g strokeLinejoin="round">
   <rect x="20" y="14" width="82" height="64" rx="7" fill={'url(#'+panel+')'} stroke="#6b83a7"/>
   <rect x="27" y="21" width="41" height="29" rx="3" fill="#132035" stroke="#435774"/>
   <path d="m27 49 14-18 11 11 5-7 11 14" fill={'url(#'+blue+')'}/>
   <circle cx="59" cy="28" r="4" fill={'url(#'+gold+')'}/>
   <path d="M77 26h16M77 34h12M77 42h16" stroke="#a0b4d2" strokeWidth="2" strokeLinecap="round"/>
   <rect x="27" y="55" width="30" height="6" rx="2" fill="#6899e4"/>
   <rect x="60" y="55" width="34" height="6" rx="2" fill="#4b658b"/>
   <rect x="27" y="65" width="47" height="6" rx="2" fill={'url(#'+gold+')'}/>
   <path d="M54 52v25" stroke="#d9e6fb" strokeWidth="1.5"/>
   <path d="m51 52 3 4 3-4Z" fill="#d9e6fb"/>
   <path d="M28 16H94" stroke="#b8d2ff" strokeOpacity=".4" strokeLinecap="round"/>
  </g>}
 </svg>;
}
