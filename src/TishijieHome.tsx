import {useEffect,useState} from 'react';
import {ArrowRight,BookOpenText,Compass,FileText,Film,ImageIcon,Layers3,MessageCircleMore,Send,UserRound} from 'lucide-react';
import {api,getToken} from './api';
import {AssetThumbnail} from './AssetPicker';
import './tishijie-home.css';

const tools=[
 {name:'灵感与选题',description:'找到客户关心的问题，把行业资料变成选题',href:'#benchmark',Icon:Compass},
 {name:'图文创作',description:'公众号、朋友圈、小红书，写出你的专业价值',href:'#studio/text',Icon:FileText},
 {name:'图片创作',description:'文章封面、产品配图和营销海报',href:'#studio/image',Icon:ImageIcon},
 {name:'AI 视频',description:'从画面想法到视频，制作电梯行业内容',href:'#studio/video',Icon:Film},
 {name:'数字人视频',description:'把口播稿做成授权形象的出镜视频',href:'#studio/avatar/text',Icon:UserRound},
];
const starters=['帮我写一篇公众号文章：电梯报价为什么差这么多？','把维保服务价值写成朋友圈文案','给老旧电梯更新构思一条视频号脚本'];
function VideoThumb({asset}:{asset:any}){
 const [url,setUrl]=useState('');
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);
 const load=async()=>{if(url)return;try{const response=await fetch(asset.file_url,{headers:{Authorization:'Bearer '+getToken()}});if(response.ok)setUrl(URL.createObjectURL(await response.blob()))}catch{}};
 return <div className="tw-video-thumb"><Film size={32}/><button onClick={()=>void load()}>播放预览</button>{url&&<video controls preload="metadata" src={url}/>}</div>;
}
export default function TishijieHome({drafts,t}:{drafts:any[];t:any}){
 const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('all');
 const sessions=t.list?.('task')||[],assets=(t.list?.('studio_asset')||[]).filter((a:any)=>a.status==='ready'&&['image','video'].includes(a.asset_type));
 const visible=assets.filter((a:any)=>filter==='all'||a.asset_type===filter).slice(0,12);
 const bound=t.state?.bindings?.qa||t.state?.bindings?.writing;
 const ready=!!t.state?.models?.some((m:any)=>m.id===bound&&m.capability==='text'&&m.published);
 const start=async()=>{const text=question.trim();if(!text||busy||!ready)return;setBusy(true);setError('');try{
  const task=await api<any>('/tasks/open',{title:text,mode:'auto',source_ids:[],profile_id:t.profile||undefined});
  if(!task.messages?.length)await api('/tasks/'+task.id+'/send',{text,mode:'auto',source_ids:[],reference_scope:task.reference_scope});
  await t.refresh();location.hash='task/'+task.id;
 }catch(e){setError(e instanceof Error?e.message:'对话未能开始')}finally{setBusy(false)}};
 return <div className="tw-home"><section className="tw-hero">
  <header className="tw-hero-title"><span>电梯行业 AI 内容工作台</span><h1>梯世界</h1><h2>抢占线上曝光，用户一搜即见。</h2><p>找选题、写文章、做图片和视频，把你的行业经验变成客户看得见的内容。</p></header>
  <section className="tw-chat" aria-label="AI 对话"><div className="tw-chat-head"><MessageCircleMore size={19}/><strong>说说你想完成什么</strong><span>从一句灵感开始</span></div>
   <textarea aria-label="向梯世界提问" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.nativeEvent.isComposing){e.preventDefault();void start()}}} placeholder="例如：帮我写一篇面向物业经理的公众号文章，讲清电梯维保为什么不能只看价格。"/>
   <div className="tw-chat-foot"><span>{ready?'需要创作时，AI 会按平台整理成品。':'对话模型尚未配置，请联系管理员。'}</span><button className="primary" disabled={!ready||!question.trim()||busy} onClick={()=>void start()}>{busy?'正在打开…':'开始对话'}<Send size={15}/></button></div>{error&&<p role="alert">{error}</p>}
  </section>
  <div className="tw-starters">{starters.map(x=><button key={x} onClick={()=>setQuestion(x)}>{x}<ArrowRight size={13}/></button>)}</div>
  <div className="tw-tools">{tools.map(({name,description,href,Icon})=><a href={href} key={name}><Icon size={23}/><strong>{name}</strong><p>{description}</p><ArrowRight size={17}/></a>)}</div>
  <small className="tw-concept-credit">背景为 AI 建筑概念图</small>
 </section><section className="tw-materials"><div className="tw-section-head"><div><span>你的创作资产</span><h2>图片与视频素材</h2></div><a href="#studio/assets">查看全部素材 <ArrowRight size={15}/></a></div>
  <nav className="tw-filters" aria-label="首页素材分类">{[['all','全部'],['image','图片'],['video','视频']].map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</nav>
  {visible.length?<div className="tw-material-grid">{visible.map((a:any)=><article key={a.id}><div className="tw-material-preview">{a.asset_type==='image'?<AssetThumbnail asset={a}/>:<VideoThumb asset={a}/>}</div><div><strong>{a.title||'未命名素材'}</strong><small>{a.asset_type==='image'?'图片':'视频'} · 已保存</small></div></article>)}</div>:<div className="tw-material-empty"><ImageIcon size={27}/><div><strong>{filter==='video'?'还没有视频素材':filter==='image'?'还没有图片素材':'让你的内容有自己的画面'}</strong><p>上传项目素材，或用图片、视频工具开始创作，作品会显示在这里。</p></div><a href="#studio/assets">上传素材 <ArrowRight size={15}/></a></div>}
 </section><div className="tw-history"><section><h3>继续创作</h3>{drafts.slice(0,3).map(d=><a key={d.id} href={d.href}><Layers3 size={15}/><span>{d.title||'未命名草稿'}</span><ArrowRight size={14}/></a>)}{!drafts.length&&<p>草稿会保留，可以随时继续。</p>}</section><section><h3>最近对话</h3>{sessions.slice(0,3).map((x:any)=><a key={x.id} href={'#task/'+x.id}><BookOpenText size={15}/><span>{x.title}</span><ArrowRight size={14}/></a>)}{!sessions.length&&<p>从上方对话框开始你的第一次创作。</p>}</section></div></div>;
}
