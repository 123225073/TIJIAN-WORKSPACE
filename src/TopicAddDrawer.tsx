import {LoaderCircle, X} from 'lucide-react';
import {JobFeedback, activeJob} from './OperationFeedback';

export type TopicCandidate={index:number;title:string;angle:string;rationale:string;audience:string;selected:boolean;discarded:boolean;confirmed:boolean};
type Props={
 mode:'ai'|'manual';setMode:(mode:'ai'|'manual')=>void;close:()=>void;
 brief:string;setBrief:(value:string)=>void;count:number;setCount:(value:number)=>void;
 sources:any[];sourceIds:string[];setSourceIds:(value:string[])=>void;
 title:string;setTitle:(value:string)=>void;angle:string;setAngle:(value:string)=>void;rationale:string;setRationale:(value:string)=>void;
 busy:boolean;job:any;ready:boolean;reviewLoaded:boolean;candidates:TopicCandidate[];removedCount:number;
 generate:()=>void;add:()=>void;confirm:()=>void;selectAll:()=>void;edit:(index:number,changes:Partial<TopicCandidate>)=>void;
};

export default function TopicAddDrawer(p:Props){
 const running=activeJob(p.job)&&p.job?.input?.action==='studio_topics';
 const selected=p.candidates.filter(item=>item.selected).length;
 const status=p.job?.status==='failed'?'生成失败':running?'AI 正在生成候选选题':p.reviewLoaded?'候选选题待你确认':'写下方向，生成候选选题';
 return <div className="td-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)p.close()}}>
  <section className="td-add-drawer" role="dialog" aria-modal="true" aria-label="找题与添加选题">
   <header><div><h2>找题与添加选题</h2><p>先看候选，确认后才进入选题库。</p></div><button aria-label="关闭" onClick={p.close}><X size={19}/></button></header>
   <div className="td-mode-tabs" role="tablist" aria-label="添加方式"><button role="tab" aria-selected={p.mode==='ai'} className={p.mode==='ai'?'active':''} onClick={()=>p.setMode('ai')}>AI 帮我找题</button><button role="tab" aria-selected={p.mode==='manual'} className={p.mode==='manual'?'active':''} onClick={()=>p.setMode('manual')}>自己添加</button></div>
   {p.mode==='manual'?<div className="td-add-section" role="tabpanel"><h3>自己记录一个选题</h3><label>选题<input autoFocus value={p.title} maxLength={200} onChange={e=>p.setTitle(e.target.value)} placeholder="例如：老旧电梯更新前要做哪些准备"/></label><label>切入角度<textarea value={p.angle} rows={2} onChange={e=>p.setAngle(e.target.value)}/></label><label>为什么值得做<textarea value={p.rationale} rows={2} onChange={e=>p.setRationale(e.target.value)} placeholder="受众痛点、线索依据或需要核实的问题"/></label><label>引用已保存资料<select value={p.sourceIds[0]||''} onChange={e=>p.setSourceIds(e.target.value?[e.target.value]:[])}><option value="">暂不指定</option>{p.sources.map((item:any)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button className="td-primary td-wide-button" disabled={p.busy||!p.title.trim()} onClick={p.add}>{p.busy&&<LoaderCircle className="spin" size={15}/>} {p.busy?'正在保存…':'保存到选题库'}</button></div>
   :<div className="td-add-section" role="tabpanel"><h3>第一步 · 说说你要找什么</h3><p className="td-step-help">AI 会给出方向供你筛选。没有真实近期资料时，不会把建议称作热点。</p><label>客户问题或业务方向<textarea autoFocus value={p.brief} rows={3} onChange={e=>p.setBrief(e.target.value)} placeholder="写下客户、业务或方向"/></label><div className="td-generate-row"><label>建议数量<select value={p.count} onChange={e=>p.setCount(Number(e.target.value))}>{[3,5,10,20].map(n=><option key={n} value={n}>{n} 条</option>)}</select></label><button className="td-primary" disabled={p.busy||!p.brief.trim()||!p.ready||activeJob(p.job)} onClick={p.generate}>{(p.busy||running)&&<LoaderCircle className="spin" size={16}/>} {running?'正在生成候选…':p.busy?'正在提交…':'生成候选选题'}</button></div>
   {!p.ready?<p className="td-action-hint">AI 找题暂不可用：管理员需先上架并绑定选题模型。你仍可自己添加。</p>:!p.brief.trim()?<p className="td-action-hint">先写一句客户问题或业务方向。</p>:null}
   {(running||p.reviewLoaded||p.job?.status==='failed')&&<div className={'td-review-status '+(running?'running':'')} role="status" aria-live="polite"><div className="td-review-status-head">{running&&<LoaderCircle className="spin" size={19}/>}<strong>{status}</strong></div>{running&&<div className="td-indeterminate" aria-label="AI 正在处理"><span/></div>}{running&&<p>正在读取资料并整理候选。可关闭面板，任务会继续运行。</p>}{p.job?.status==='failed'&&<p>{p.job.error||'请检查模型配置后重试。'}</p>}{running&&<JobFeedback job={p.job} preview={false}/>}</div>}
   {p.reviewLoaded&&<section className="td-review" aria-label="候选选题审核"><div className="td-review-heading"><div><h3>第二步 · 审核候选</h3><p>{p.candidates.length} 条待处理 · 已选 {selected} 条{p.removedCount>0?' · 已移除 '+p.removedCount+' 条':''}</p></div><button disabled={!p.candidates.length} onClick={p.selectAll}>全选</button></div>
   {p.candidates.length?p.candidates.map(item=><article className={'td-candidate '+(item.selected?'selected':'')} key={item.index}><div className="td-candidate-top"><label className="td-candidate-check"><input type="checkbox" checked={item.selected} onChange={e=>p.edit(item.index,{selected:e.target.checked})}/>选入库</label><button aria-label={'移除候选 '+item.title} onClick={()=>p.edit(item.index,{discarded:true,selected:false})}>移除</button></div><label>选题标题<input value={item.title} maxLength={200} onChange={e=>p.edit(item.index,{title:e.target.value})}/></label><label>切入角度<textarea rows={2} value={item.angle} onChange={e=>p.edit(item.index,{angle:e.target.value})}/></label><label>推荐理由<textarea rows={2} value={item.rationale} onChange={e=>p.edit(item.index,{rationale:e.target.value})}/></label><label>适合谁看<input value={item.audience} onChange={e=>p.edit(item.index,{audience:e.target.value})}/></label></article>):<p className="td-step-help">候选已处理完。需要更多选题时，可重新生成。</p>}
   <div className="td-review-actions"><button className="td-primary" disabled={p.busy||!selected||p.candidates.some(item=>item.selected&&!item.title.trim())} onClick={p.confirm}>{p.busy&&<LoaderCircle className="spin" size={15}/>} {p.busy?'正在入库…':`确认 ${selected} 条，加入选题库`}</button><small>未勾选的候选不会入库；编辑和移除会先保存在本机。</small></div></section>}
   </div>}
  </section>
 </div>;
}
