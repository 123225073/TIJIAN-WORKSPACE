import {useEffect,useRef,useState} from 'react';
import {api} from './api';
const nodes=[['text','文案创作','text'],['image','AI 生图','text_image'],['video','AI 视频','text_video'],['avatar/text','数字人口播','text_avatar'],['audio/tts','文本配音','tts'],['compose','素材成片','compose']];
export default function CreationFlow({t}:{t:any}){
 const owner=t.state.user.id,storage='studio-flow:'+owner;
 const [flow,setFlow]=useState<any>(()=>{try{return JSON.parse(localStorage.getItem(storage)||'{}')}catch{return {}}}),[assets,setAssets]=useState<any[]>([]),[catalog,setCatalog]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const version=useRef(0),dirty=useRef(false),queue=useRef(Promise.resolve()),saveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{void api('/studio/flow').then(r=>{version.current=r.version;if(!dirty.current&&r.version)setFlow(r);setLoaded(true)}).catch(e=>setError(e.message))},[]);
 useEffect(()=>{if(!loaded||!dirty.current)return;const timer=setTimeout(()=>{queue.current=queue.current.catch(()=>{}).then(async()=>{try{const r=await api('/studio/flow',{...flow,version:version.current});version.current=r.version}catch(e:any){setError('主题暂存本机，服务端保存失败：'+e.message)}})},600);saveTimer.current=timer;return()=>clearTimeout(timer)},[flow,loaded]);
 useEffect(()=>{void Promise.all([api('/studio/assets'),api('/studio/catalog')]).then(([a,c])=>{setAssets(a.items);setCatalog(c.tools)}).catch(e=>setError(e.message))},[]);
 const change=(v:any)=>{dirty.current=true;const next={...flow,...v};setFlow(next);try{localStorage.setItem(storage,JSON.stringify(next))}catch{setError('本机保存失败，请检查存储空间')}};
 const launch=async(path:string,tool:string)=>{setBusy(true);setError('');try{
  if(!loaded)throw new Error('正在恢复主题，请稍候');
  clearTimeout(saveTimer.current);await queue.current;
  const source=flow.content_id?t.get(flow.content_id):null,brief=flow.brief||'';
  const input=tool==='text'?{brief,format:'通用文案'}:['text_avatar','tts'].includes(tool)?{text:source?.body||brief}:tool==='compose'?{scenes:flow.visual_id?[{asset_id:flow.visual_id,length:5,...(flow.audio_id?{audio_id:flow.audio_id}:{})}]:[]}:{prompt:brief};
  if(!brief.trim()&&!source&&tool!=='compose')throw new Error('请先写下创作主题或选择一份文稿');
  let topicId=flow.topic_id||'';
  if(!topicId&&(brief.trim()||source)){
   const topic=await api('/studio/topics',{title:(brief.trim()||source.title).slice(0,200),angle:'从此主题继续创作；可在选题库完善切入角度',source_ids:source?[source.id]:[],profile_id:flow.profile_id||'',origin:'一站式创作',origin_ref:'flow:'+brief.trim().slice(0,150)+':'+(source?.id||''),status:'selected'});
   topicId=topic.id;
  }
  const saved=await api('/studio/flow',{...flow,topic_id:topicId,version:version.current});version.current=saved.version;
  const body={title:brief.slice(0,60)||'一站式创作',tool,input,brand_id:flow.brand_id||'',profile_id:flow.profile_id||'',source_ids:flow.content_id?[flow.content_id]:[],...(tool==='text'?{}:{options:{}})};
  const draft=await api(tool==='text'?'/studio/text/drafts':'/studio/drafts',body);
  change({last_draft:draft.id,topic_id:topicId});location.hash='studio/'+path+'?draft='+draft.id+'&mode='+tool;
 }catch(e:any){setError(e.message)}finally{setBusy(false)}};
 return <section className="st-flow"><div className="st-brand-intro"><h2>一个主题，多种作品</h2><p>选定资料，再点击所需工具。完成作品后回到这里，选择成果继续制作。</p><a href="#studio/topics">查看选题库与平台交付 →</a></div><div className="st-flow-context"><label>代理品牌（可选）<select value={flow.brand_id||''} onChange={e=>change({brand_id:e.target.value,profile_id:''})}><option value="">暂不指定</option>{t.list('studio_brand').map((b:any)=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label><label>我的 IP<select value={flow.profile_id||''} onChange={e=>change({profile_id:e.target.value})}><option value="">通用表达</option>{t.list('profile').filter((p:any)=>!flow.brand_id||!p.brand_id||p.brand_id===flow.brand_id).map((p:any)=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label className="st-wide">本次主题 / 画面要求<textarea rows={3} value={flow.brief||''} onChange={e=>change({brief:e.target.value,topic_id:''})} placeholder="例如：向本地物业介绍老旧电梯更新服务"/></label></div>
 <div className="st-flow-map"><div className="st-flow-start"><small>01 · 准备</small><a href="#studio/brand">我的 IP 与业务资料 →</a><a href="#benchmark">灵感与对标 →</a><p>没有档案也可以开始创作。</p></div><div className="st-flow-nodes">{nodes.map(([path,label,tool])=>{const ready=tool==='text'?!!t.state.bindings.writing:catalog.find(c=>c.id===tool)?.configured;return <button key={tool} disabled={busy} onClick={()=>void launch(path,tool)}><small>02 · 创作</small><strong>{label} →</strong><span>{ready?'进入并设置参数':'可编辑草稿 · 生成服务未就绪'}</span></button>})}</div><div className="st-flow-start"><small>03 · 选成果，继续制作</small><a href="#studio/works">作品与素材 →</a><p>文稿可用于口播和配音；画面与音频可用于合成。</p></div></div>
 <div className="st-flow-context"><label>用于后续创作的文稿<select value={flow.content_id||''} onChange={e=>change({content_id:e.target.value})}><option value="">不指定，使用主题</option>{t.list('content').map((x:any)=><option key={x.id} value={x.id}>{x.title} · v{x.version}</option>)}</select></label><label>合成画面<select value={flow.visual_id||''} onChange={e=>change({visual_id:e.target.value})}><option value="">进入合成页后选择</option>{assets.filter(x=>['image','video'].includes(x.asset_type)&&x.status==='ready').map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label><label>合成配音<select value={flow.audio_id||''} onChange={e=>change({audio_id:e.target.value})}><option value="">不指定</option>{assets.filter(x=>x.asset_type==='audio'&&x.status==='ready').map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label></div>{error&&<p className="st-alert" role="alert">{error}</p>}</section>
}
