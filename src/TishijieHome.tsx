import VideoPlayer from './VideoPlayer';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpenText,Compass,FileText,Film,ImageIcon,Layers3,MessageCircleMore,Play,Send,UserRound} from 'lucide-react';
import {api,getToken} from './api';
import {AssetThumbnail} from './AssetPicker';
import './tishijie-home.css';

const tools=[
 {name:'灵感与选题',description:'从行业资料中，找到客户关心的话题',href:'#benchmark',Icon:Compass},
 {name:'图文创作',description:'公众号、朋友圈、小红书，写出专业价值',href:'#studio/text',Icon:FileText},
 {name:'图片创作',description:'文章封面、产品配图和营销海报',href:'#studio/image',Icon:ImageIcon},
 {name:'AI 视频',description:'从画面想法到镜头，讲好行业故事',href:'#studio/video',Icon:Film},
 {name:'数字人视频',description:'用已授权的形象，表达你的专业观点',href:'#studio/avatar/text',Icon:UserRound},
];
const starters=['电梯报价为什么差这么多？写成公众号文章','把维保服务价值写成朋友圈文案','给老旧电梯更新构思一条视频号脚本'];
const categories=[['all','全部'],['image','图片'],['video','视频']] as const;

function VideoThumb({asset}:{asset:any}){
 const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),objectUrl=useRef('');
 useEffect(()=>{
  setUrl('');setLoading(false);setError('');
  return()=>{controller.current?.abort();controller.current=null;if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=''};
 },[asset.id,asset.file_url]);
 const load=async()=>{
  if(url||controller.current)return;
  if(!asset.file_url){setError('该视频暂时没有可用的预览文件');return}
  const request=new AbortController();controller.current=request;setLoading(true);setError('');
  try{
   const response=await fetch(asset.file_url,{headers:{Authorization:'Bearer '+getToken()},signal:request.signal});
   if(!response.ok)throw new Error('视频暂时无法读取，请重试');
   const blob=await response.blob();if(request.signal.aborted)return;
   objectUrl.current=URL.createObjectURL(blob);setUrl(objectUrl.current);
  }catch{if(!request.signal.aborted)setError('视频暂时无法读取，请重试')}
  finally{if(!request.signal.aborted){controller.current=null;setLoading(false)}}
 };
 return <div className="tw-video-thumb">
  {url?<VideoPlayer controls preload="metadata" src={url} aria-label={asset.title||'视频素材预览'} onError={()=>setError('该视频无法播放，请到素材库查看')}/>:<><Film size={30} aria-hidden="true"/><button type="button" disabled={loading} aria-label={'预览视频：'+(asset.title||'未命名视频')} onClick={()=>void load()}>{!loading&&<Play size={13} aria-hidden="true"/>}{loading?'正在读取视频…':error?'重试预览':'播放预览'}</button></>}
  {error&&<span className="tw-video-error" role="status">{error}</span>}
 </div>;
}

export default function TishijieHome({drafts,t}:{drafts:any[];t:any}){
 const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('all');
 const input=useRef<HTMLTextAreaElement>(null);
 const sessions=t.list?.('task')||[],assets=(t.list?.('studio_asset')||[]).filter((a:any)=>a.status==='ready'&&['image','video'].includes(a.asset_type));
 const filtered=assets.filter((a:any)=>filter==='all'||a.asset_type===filter),visible=filtered.slice(0,12),loading=!t.state||t.state.complete===false;
 const bound=t.state?.bindings?.qa||t.state?.bindings?.writing;
 const ready=!!t.state?.models?.some((m:any)=>m.id===bound&&m.capability==='text'&&m.published);
 const start=async()=>{const text=question.trim();if(!text||busy||!ready||loading)return;setBusy(true);setError('');try{
  const task=await t.openTask(text,'auto',[],t.profile);
  if(!task.messages?.length)await api('/tasks/'+task.id+'/send',{text,mode:'auto',source_ids:[],reference_scope:task.reference_scope,skip_profile:t.profileSkipped===true});
  await t.refresh();location.hash='task/'+task.id;
 }catch(e){setError(e instanceof Error?e.message:'对话未能开始')}finally{setBusy(false)}};
 return <div className="tw-home"><section className="tw-hero" aria-labelledby="tw-title">
  <header className="tw-hero-title"><span>电梯行业 AI 内容工作台</span><h1 id="tw-title">梯世界</h1><h2>抢占线上曝光，用户一搜即见。</h2><p>找选题、写文章、做图片和视频，把行业经验变成客户看得见的内容。</p></header>
  <section className="tw-chat" aria-labelledby="tw-chat-title" aria-busy={busy}>
   <div className="tw-chat-head"><span className="tw-chat-icon"><MessageCircleMore size={20} aria-hidden="true"/></span><div><strong id="tw-chat-title">AI 对话</strong><span>说说你想完成什么</span></div><span className="tw-chat-label">从一句灵感开始</span></div>
   <textarea ref={input} aria-label="向梯世界提问" aria-describedby="tw-chat-hint" value={question} disabled={busy} onChange={e=>{setQuestion(e.target.value);setError('')}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(!e.repeat)void start()}}} placeholder="例如：帮我写一篇面向物业经理的公众号文章，讲清电梯维保为什么不能只看价格。"/>
   <div className="tw-chat-foot"><span id="tw-chat-hint">{!t.state?'正在读取工作区…':ready?<>成果保留在对话中 <span className="tw-key-hint">· Enter 发送 / Shift + Enter 换行</span></>:'对话模型尚未配置，请联系管理员。'}</span><button type="button" className="tw-send" disabled={!ready||!question.trim()||busy} onClick={()=>void start()}>{busy?'正在打开…':'开始对话'}<Send size={15} aria-hidden="true"/></button></div>
   {error&&<p className="tw-chat-error" role="alert">{error}</p>}
  </section>
  <div className="tw-starters" aria-label="试试这些创作话题">{starters.map(x=><button type="button" key={x} disabled={busy} onClick={()=>{setQuestion(x);setError('');input.current?.focus()}}>{x}<ArrowRight size={13} aria-hidden="true"/></button>)}</div>
  <a className="tw-flow-entry" href="#studio/flow"><span className="tw-flow-icon"><Layers3 size={22} aria-hidden="true"/></span><div><strong>一站式创作</strong><span>按步骤完成一件作品：选题 → 内容 → 素材 → 交付</span></div><span className="tw-flow-action">进入工作流 <ArrowRight size={17} aria-hidden="true"/></span></a>
  <nav className="tw-tools" aria-label="直接打开创作工具">{tools.map(({name,description,href,Icon},i)=><a href={href} key={name} className={'tw-tool tw-tool-'+i}><span className="tw-tool-icon"><Icon size={23} strokeWidth={1.6} aria-hidden="true"/></span><strong>{name}</strong><p>{description}</p><ArrowRight className="tw-tool-arrow" size={16} aria-hidden="true"/></a>)}</nav>
  <small className="tw-concept-credit">背景为 AI 建筑概念图</small>
 </section><section className="tw-materials" aria-labelledby="tw-materials-title">
  <div className="tw-section-head"><div><span>你的创作资产</span><h2 id="tw-materials-title">图片与视频素材</h2></div><a href="#studio/assets">查看全部素材 <ArrowRight size={15} aria-hidden="true"/></a></div>
  <div className="tw-material-toolbar"><nav className="tw-filters" aria-label="首页素材分类">{categories.map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</nav><span className="tw-material-count" role="status" aria-live="polite">{loading?'正在读取素材…':`${categories.find(([key])=>key===filter)?.[1]} · ${filtered.length} 件${filtered.length>12?'，展示最近 12 件':''}`}</span></div>
  {loading?<div className="tw-material-empty" role="status"><ImageIcon size={27} aria-hidden="true"/><div><strong>正在读取素材</strong><p>加载完成后，你保存的图片与视频会显示在这里。</p></div></div>:visible.length?<div className="tw-material-grid">{visible.map((a:any)=><article key={a.id}><div className="tw-material-preview">{a.asset_type==='image'?<AssetThumbnail asset={a}/>:<VideoThumb asset={a}/>}</div><div><strong title={a.title}>{a.title||'未命名素材'}</strong><small>{a.asset_type==='image'?'图片':'视频'} · 已保存</small></div></article>)}</div>:<div className="tw-material-empty"><ImageIcon size={27} aria-hidden="true"/><div><strong>{filter==='video'?'还没有视频素材':filter==='image'?'还没有图片素材':'让你的内容有自己的画面'}</strong><p>{filter==='video'?'上传视频，或打开 AI 视频工具开始创作。':filter==='image'?'上传图片，或打开图片创作工具制作封面与配图。':'上传项目素材，或用图片、视频工具开始创作，作品会显示在这里。'}</p></div><a href="#studio/assets">上传素材 <ArrowRight size={15} aria-hidden="true"/></a></div>}
 </section><div className="tw-history"><section><h3><Layers3 size={16} aria-hidden="true"/>继续创作</h3>{drafts.slice(0,3).map(d=><a key={d.id} href={d.href}><FileText size={15} aria-hidden="true"/><span>{d.title||'未命名草稿'}</span><ArrowRight size={14} aria-hidden="true"/></a>)}{!drafts.length&&<p>草稿会保留，可以随时继续。</p>}</section><section><h3><MessageCircleMore size={16} aria-hidden="true"/>最近对话</h3>{sessions.slice(0,3).map((x:any)=><a key={x.id} href={'#task/'+x.id}><BookOpenText size={15} aria-hidden="true"/><span>{x.title}</span><ArrowRight size={14} aria-hidden="true"/></a>)}{!sessions.length&&<p>从上方对话框开始你的第一次创作。</p>}</section></div></div>;
}
