import {useState} from 'react';
import {ArrowRight, BookOpenText, BriefcaseBusiness, CircleHelp, MessageCircleMore, SearchCheck} from 'lucide-react';
import {api} from './api';
import './knowledge-assistant.css';

const starters = [
  {title:'销售沟通', icon:BriefcaseBusiness, example:'客户觉得电梯维保费用高，我该如何解释服务价值？请给我可修改的话术，并标明依据。'},
  {title:'使用工作台', icon:CircleHelp, example:'我想把行业资料变成公众号文章，在工作台里应该怎么操作？'},
  {title:'电梯行业知识', icon:BookOpenText, example:'老旧电梯更新通常要先核对哪些信息？请区分已有资料和需要进一步确认的内容。'},
];

export default function KnowledgeAssistant({t}:{t:any}){
  const [question,setQuestion]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const sessions=t.list?.('task')||[];
  const bound=t.state?.bindings?.qa||t.state?.bindings?.writing;
  const ready=!!bound&&!!t.state?.models?.some((m:any)=>m.id===bound&&m.capability==='text'&&m.published);
  const start=async()=>{
    if(!question.trim()||busy||!ready)return;
    setBusy(true);setError('');
    try{
      const text=question.trim();
      const task=await api<any>('/tasks/open',{title:text,mode:'auto',source_ids:[]});
      if(!task.messages?.length)await api('/tasks/'+task.id+'/send',{text,mode:'auto',source_ids:[],reference_scope:task.reference_scope});
      await t.refresh();
      location.hash='task/'+task.id;
    }
    catch(e){setError(e instanceof Error?e.message:'无法创建对话，请稍后重试')}
    finally{setBusy(false)}
  };
  return <div className="ka-page">
    <header className="ka-header"><span>KNOWLEDGE / ASSISTANT</span><h1>问问梯世界</h1><p>向工作台提问。回答会检索你保存的原始资料、知识页和有效记忆，并展示引用依据。</p><a href="#knowledge">查看与管理知识库 <ArrowRight size={15}/></a></header>
    <section className="ka-start"><div className="ka-start-title"><MessageCircleMore size={25}/><div><h2>今天想解决什么问题？</h2><p>先写问题，进入对话后可继续追问或调整参考资料。</p></div></div><textarea aria-label="输入要向知识库提问的问题" placeholder="例如：物业客户问电梯更新的流程，我该怎么回答？" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void start()}}}/><div className="ka-start-foot"><span><SearchCheck size={16}/>资料不足时会指出缺口，建议话术会标为示例。</span><button className="ka-submit" disabled={!question.trim()||busy||!ready} onClick={()=>void start()}>{busy?'正在打开…':'开始对话'}<ArrowRight size={17}/></button></div>{!ready&&<p className="ka-error" role="status">知识问答尚未绑定已验证的文本模型，请联系管理员；已有对话仍可查看。</p>}{error&&<p className="ka-error" role="alert">{error}</p>}</section>
    <div className="ka-section-title"><h2>可以从这些问题开始</h2><span>点击后可先修改提问</span></div>
    <div className="ka-starters">{starters.map(({title,icon:Icon,example})=><button key={title} onClick={()=>setQuestion(example)}><Icon size={23}/><strong>{title}</strong><span>{example}</span><ArrowRight size={16}/></button>)}</div>
    {!!sessions.length&&<><div className="ka-section-title"><h2>继续之前的对话</h2><span>{sessions.length} 个会话</span></div><div className="ka-history">{sessions.slice(0,6).map((x:any)=><a href={'#task/'+x.id} key={x.id}><MessageCircleMore size={17}/><span>{x.title}</span><ArrowRight size={16}/></a>)}</div></>}
  </div>;
}
