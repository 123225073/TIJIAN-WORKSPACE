import {useEffect,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,PauseCircle,Sparkles,X} from 'lucide-react';
import './wechat-optimize.css';

export type OptimizeScope='all'|'title'|'body'|'summary'|'cover_brief';
const labels:Record<OptimizeScope,string>={all:'整篇文章',title:'文章标题',body:'文章正文',summary:'摘要',cover_brief:'封面画面建议'};
const reviewFields:[string,string][]=[['title','文章标题'],['body','文章正文'],['summary','摘要'],['cover_brief','封面画面建议'],['keywords','关键词'],['publishing_notes','发布前核对']];
const started=(job:any)=>job&&['queued','running'].includes(job.status);

export default function WechatOptimizePage({scope,original,job,busy,error,onClose,onNew,onStart,onApply,onStop}:{scope:OptimizeScope;original:any;job:any;busy:boolean;error:string;onClose:()=>void;onNew:()=>void;onStart:(scope:OptimizeScope,instruction:string)=>void;onApply:()=>void;onStop:()=>void}){
 const [direction,setDirection]=useState('');
 const [chosen,setChosen]=useState<OptimizeScope>(scope);
 useEffect(()=>{setChosen(scope);setDirection('')},[scope]);
 const active=started(job),done=job?.status==='done',failed=['failed','cancelled','interrupted'].includes(job?.status);
 const fields=done?(job.result?.proposal||{}):{};
 const resultScope:OptimizeScope=job?.input?.scope||chosen;
 const keys=resultScope==='all'?reviewFields:reviewFields.filter(([key])=>key===resultScope);
 const elapsed=job?.created?Math.max(0,Math.floor((Date.now()-Date.parse(job.created))/1000)):0;
 return <div className="wo-page" role="dialog" aria-modal="true" aria-label="公众号文章 AI 优化">
  <div className="wo-atmosphere" aria-hidden="true"><i/><i/><i/></div>
  <header className="wo-topbar"><div className="wo-identity"><span className="wo-mark"><Sparkles size={19}/></span><span><small>梯见 · CONTENT STUDIO</small><strong>文章 AI 优化</strong></span></div><button type="button" className="wo-close" onClick={onClose} aria-label="关闭 AI 优化页面"><X size={20}/></button></header>
  <main className="wo-content"><div className="wo-intro"><span className="wo-eyebrow">WECHAT ARTICLE · EDITORIAL LAB</span><h1>把你的想法，写进这篇文章。</h1><p>选择需要调整的部分，告诉 AI 你想达到的效果。结果会先供你核对，确认后才写入发布稿。</p></div>
   {!job&&<section className="wo-setup"><div className="wo-section-head"><span>01 / 选择范围</span><h2>这次想优化哪里？</h2></div><div className="wo-scope-grid">{(Object.keys(labels) as OptimizeScope[]).map(key=><button type="button" key={key} className={chosen===key?'selected':''} onClick={()=>setChosen(key)}><span>{labels[key]}</span>{chosen===key&&<Check size={16}/>}</button>)}</div><div className="wo-section-head"><span>02 / 说清目标</span><h2>你希望怎么改？</h2></div><label className="wo-direction"><span>优化方向 <em>可选</em></span><textarea value={direction} onChange={e=>setDirection(e.target.value)} rows={5} maxLength={4000} placeholder={chosen==='body'?'例如：保留原有案例和图片位置，把正文压缩到约 900 字；语气更像面向电梯销售的一线经验分享。':'例如：突出“如何选择电梯品牌”的核心问题，语气更具体，保留已有事实。'} /><small>可写目标字数、增删重点、语气、读者对象或必须保留的内容；留空则按原稿与选题优化。</small></label>{error&&<p className="wo-error" role="alert">{error}</p>}<div className="wo-setup-foot"><span>原稿会保留；AI 不会自动同步公众号。</span><button type="button" className="wo-primary" disabled={busy} onClick={()=>onStart(chosen,direction.trim())}>{busy?<LoaderCircle className="wo-spin" size={18}/>:<Sparkles size={18}/>}开始优化</button></div></section>}
   {job&&<><section className="wo-progress"><div className="wo-section-head"><span>03 / 实时创作</span><h2>{active?'正在优化 '+labels[resultScope]:done?'优化完成，等待你审核':failed?'本次优化未完成':'正在准备结果'}</h2></div><div className="wo-status-line"><div className={'wo-pulse '+(active?'is-live':'')} aria-hidden="true"><i/><i/><i/></div><div><strong>{job.error||job.progress||(done?'已生成待审核版本':'正在读取任务状态')}</strong><small>{active?'任务在后台继续运行，可以关闭此页后再回来。':done?'原稿没有被自动覆盖。':'请查看原因后再决定是否重试。'} · 已用时 {elapsed} 秒</small></div></div><div className="wo-phases">{['读取原稿','理解优化方向','生成内容','核对结果'].map((phase,index)=><div key={phase} className={done||index<(job.status==='queued'?0:job.stream_text?2:1)?'complete':active&&index===(job.stream_text?2:job.status==='queued'?0:1)?'current':''}><span>{String(index+1).padStart(2,'0')}</span>{phase}</div>)}</div>{active&&<div className="wo-stream"><div className="wo-stream-heading"><span className="wo-live-dot"/>实时输出 <small>{job.stream_phase==='buffered'?'模型暂未提供逐字输出，正在等待完整结果':job.stream_text?'模型正在返回内容':'等待模型开始输出'}</small></div><pre>{job.stream_text||'正在整理内容…'}</pre></div>}{failed&&<div className="wo-failure"><p>{job.error||'优化没有完成，原稿已保留。'}</p><button type="button" onClick={onNew}><Sparkles size={16}/>调整要求后重试</button><button type="button" onClick={onClose}><ArrowLeft size={16}/>返回发布稿</button></div>}{active&&<button type="button" className="wo-stop" onClick={onStop}><PauseCircle size={16}/>停止任务</button>}</section>{error&&<p className="wo-error" role="alert">{error}</p>}
   {done&&<section className="wo-review"><div className="wo-section-head"><span>04 / 对照审核</span><h2>逐项核对，再决定是否应用</h2></div><p>请检查事实、措辞及正文图片位置。AI 内容尚未写入发布稿，更不会发布到公众号。</p>{keys.map(([key,label])=><article key={key} className="wo-compare"><h3>{label}</h3><div><section><small>当前原稿</small><pre>{String(original[key]||'（空）')}</pre></section><section><small>AI 建议</small><pre>{String(fields[key]||'（未返回此字段）')}</pre></section></div></article>)}<div className="wo-review-foot"><button type="button" onClick={onClose}>保留原稿，稍后再说</button><button type="button" onClick={onNew}>重新优化</button><button type="button" className="wo-primary" disabled={busy} onClick={onApply}>{busy?<LoaderCircle className="wo-spin" size={17}/>:<Check size={17}/>}应用到发布稿</button></div></section>}
   </>}
  </main>
 </div>
}
