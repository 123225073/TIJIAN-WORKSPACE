import {useState} from 'react';
import {ArrowRight, BookOpenText, Layers3, MessageCircleMore, Send} from 'lucide-react';
import {api} from './api';
import './studio-home.css';

const starters=['客户觉得电梯维保贵，我怎么解释服务价值？','我想把行业资料做成公众号文章，先做什么？','老旧电梯更新前要核对哪些信息？'];

export default function StudioHome({drafts,t}:{drafts:any[];t:any}){
 const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sessions=(t.list?.('task')||[]).filter((x:any)=>x.mode==='qa');
 const bound=t.state?.bindings?.qa||t.state?.bindings?.writing;
 const ready=!!bound&&!!t.state?.models?.some((m:any)=>m.id===bound&&m.capability==='text'&&m.published);
 const start=async()=>{const text=question.trim();if(!text||busy||!ready)return;setBusy(true);setError('');try{const task=await api<any>('/tasks/open',{title:text,mode:'qa',source_ids:[]});if(!task.messages?.length)await api('/tasks/'+task.id+'/send',{text,mode:'qa',source_ids:[],reference_scope:task.reference_scope});await t.refresh();location.hash='task/'+task.id}catch(e){setError(e instanceof Error?e.message:'对话未能开始')}finally{setBusy(false)}};
 return <div className="sh-page sh-home-v3">
  <header className="sh-welcome"><span>梯见 · 电梯行业内容工作台</span><h1>从一个问题或想法开始</h1><p>问行业知识、找创作方向、做成内容，再整理为适合公众号、视频号或抖音的交付稿。</p></header>
  <section className="sh-chat" aria-label="AI 对话"><div className="sh-chat-title"><MessageCircleMore size={22}/><div><strong>问问梯见</strong><small>销售沟通 · 软件使用 · 电梯行业知识</small></div><a href="#knowledge">查看个人知识库 →</a></div><textarea aria-label="向梯见提问" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void start()}}} placeholder="把遇到的问题写在这里。AI 会结合可用的系统知识和你的个人资料回答，并标出引用依据。"/><div className="sh-chat-bottom"><span>{ready?'答案会标明资料来源；证据不足会说明。':'对话模型尚未配置，请联系管理员。'}</span><button className="primary" disabled={!ready||!question.trim()||busy} onClick={()=>void start()}>{busy?'正在打开…':'开始对话'}<Send size={15}/></button></div>{error&&<p role="alert" className="sh-error">{error}</p>}</section>
  <div className="sh-prompt-list">{starters.map(x=><button key={x} onClick={()=>setQuestion(x)}>{x}<ArrowRight size={14}/></button>)}</div>
  <section className="sh-journey"><div><small>一站式创作</small><h2>有想法，就按步骤做成作品</h2><p>找方向 → 选题 → 写/拍/生成 → 整理素材 → 平台交付。每一步都能单独打开，完成后回到流程继续。</p></div><a href="#studio/flow">开始创作 <ArrowRight size={17}/></a></section>
  <div className="sh-home-columns"><section><h2>继续上次的创作</h2>{drafts.length?drafts.slice(0,4).map(d=><a className="sh-history-row" key={d.id} href={d.href}><Layers3 size={16}/><span>{d.title||'未命名草稿'}</span><ArrowRight size={15}/></a>):<p>还没有草稿。可以从一站式创作开始。</p>}</section><section><h2>最近的对话</h2>{sessions.length?sessions.slice(0,4).map((x:any)=><a className="sh-history-row" href={'#task/'+x.id} key={x.id}><BookOpenText size={16}/><span>{x.title}</span><ArrowRight size={15}/></a>):<p>提问后，历史对话会保存在这里。</p>}</section></div>
 </div>;
}
