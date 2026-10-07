import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUp,BookOpen,Download,Eye,ImagePlus,MessageCircle,Paperclip,PenLine,Save} from 'lucide-react';
import {useProfileDefault,profileScope,profileUnavailable,unavailableProfileOption,taskProfileInitial,profileChoiceKey,readProfileChoice} from './profile-defaults';
import {api,download,getToken,type Item} from './api';
import Markdown from './Markdown';
import {JobFeedback,activeJob} from './OperationFeedback';
import {ChoiceMenu} from './ChoiceMenu';
import {ProfileFromTask} from './ProfileFromTask';
import {ReferencePicker,defaultScope,type ReferenceScope} from './ReferencePicker';
import {linkedReferences} from './KnowledgeFlow';
import WechatRichEditor from './WechatRichEditor';
import WechatLayoutProof,{defaultWechatStyle} from './WechatLayoutProof';
import AssetPicker,{AssetThumbnail} from './AssetPicker';
import {sendKey} from './inputKeys';
import './wechat-article.css';
import './task-workspace.css';
import ImageParameters,{imagePlan} from './ImageParameters';

const platforms:Record<string,string>={wechat:'公众号',moments:'朋友圈',xiaohongshu:'小红书',channels:'视频号',douyin:'抖音',image:'图片',video:'视频',legacy:'已有成果'};
const contentFields=['title','body','summary','cover_brief','cover_asset_id','caption','script','shotlist','tags','wechat_style'];
export default function TaskWorkspace(t:any){
 const task=t.task as Item,composerKey='assistant-composer:'+t.state.user.id+':'+task.id;
 const cache=(()=>{try{return JSON.parse(localStorage.getItem(composerKey)||'null')}catch{return null}})();
 const [text,setText]=useState(cache?.text??(task.messages?.length?'':task.title)),[profile,setProfile]=useProfileDefault(t.list('profile'),profileScope(t.state),'task:'+task.id,taskProfileInitial(task,cache,profileScope(t.state)),t.state.complete!==false),[model,setModel]=useState(cache?.model||'');
 const [scope,setScope]=useState<ReferenceScope>(cache?.scope||task.reference_scope||defaultScope),[tab,setTab]=useState('body'),[references,setReferences]=useState(false),[selected,setSelected]=useState(task.active_outcome||Object.keys(task.platform_outcomes||{})[0]||'legacy'),[versions,setVersions]=useState<any[]>([]),[sending,setSending]=useState(false);
 const saveActive=useRef<null|(()=>Promise<void>)>(null),messages=useRef<HTMLDivElement>(null),lastOutcome=useRef(task.active_outcome);
 const mapping:Record<string,string>={...(task.content_id&&!Object.keys(task.platform_outcomes||{}).length?{legacy:task.content_id}:{}),...task.platform_outcomes,...task.media_outcomes};
 const content=t.get(mapping[selected]);
 const jobs=t.list('job').filter((j:any)=>j.task_id===task.id),liveJob=jobs[0],running=sending||jobs.some(activeJob);
 const profiles=t.opts('profile'),pictures=t.list('studio_asset').filter((a:any)=>a.asset_type==='image'&&a.status==='ready');
 useEffect(()=>{const last=task.messages?.at(-1);if(task.active_outcome&&(lastOutcome.current!==task.active_outcome||last?.role==='assistant'&&/^(?:已生成|已整理(?:图片|视频))/.test(last.text))){setSelected(task.active_outcome);setTab('body');lastOutcome.current=task.active_outcome}},[task.active_outcome,task.messages?.length]);
 useEffect(()=>{if(t.state.complete===false)return;localStorage.setItem(composerKey,JSON.stringify({text,profile,model,scope,profile_scope:profileScope(t.state)}))},[text,profile,model,scope,composerKey,t.state.complete]);
 useEffect(()=>{messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:'smooth'})},[task.messages?.length]);
 const send=async(value=text,skip=false)=>{if(!value.trim()||running)return;setSending(true);try{
  if(t.state.complete===false)throw new Error('身份档案尚未加载，请稍候');
  if(!skip&&profileUnavailable(t.list('profile'),profile,t.state.complete!==false))throw new Error('原 IP 已删除或不可用，请重新选择');
  if(saveActive.current)await saveActive.current();
  if(skip)setProfile('');
  await api('/tasks/'+task.id+'/send',{text:value,mode:'auto',profile_id:skip?'':profile,model_id:model||undefined,source_ids:scope.item_ids,reference_scope:scope,skip_profile:skip||(profile===''&&readProfileChoice(profileChoiceKey(profileScope(t.state),'task:'+task.id))==='')});
  setText('');await t.refresh();
 }catch(e){t.setError(e instanceof Error?e.message:'对话提交失败')}finally{setSending(false)}};
 const select=async(key:string)=>{try{if(saveActive.current)await saveActive.current();setSelected(key);setTab('body')}catch(e){t.setError((e as Error).message)}};
 const openTab=async(key:string)=>{try{if(saveActive.current)await saveActive.current();setTab(key);if(key==='versions'&&content?.kind==='content')setVersions(await api('/objects/'+content.id+'/versions'))}catch(e){t.setError((e as Error).message)}};
 return <div className="aw-workspace"><header className="aw-heading"><button aria-label="返回梯世界首页" onClick={()=>void (async()=>{try{if(saveActive.current)await saveActive.current();location.hash='studio/home'}catch(e){t.setError((e as Error).message)}})()}><ArrowLeft size={18}/></button><div><h1>{task.title}</h1><span>对话理解需求，成果按平台保留</span></div><span className="aw-status">{running?'处理中':'已保存到工作区'}</span></header>
  <div className="aw-grid"><section className="aw-conversation"><header><MessageCircle size={16}/><strong>工作对话</strong><span>{task.messages?.length||0} 条记录</span></header>
   <div className="aw-messages" ref={messages}>{!task.messages?.length&&<div className="aw-empty"><PenLine size={30}/><h3>说说你的问题或创作想法</h3><p>聊行业、查资料，或明确告诉我想写哪个平台的内容。</p></div>}{(task.messages||[]).map((m:any,i:number)=><article className={'aw-message '+m.role} key={i}><small>{m.role==='user'?'你':'梯世界'}<time>{m.at?new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}</time></small><Markdown text={linkedReferences(m.text,t.get)}/></article>)}<JobFeedback job={liveJob} preview={activeJob(liveJob)&&liveJob?.input?.action!=='assistant'}/></div>
   {task.identity_required&&<div className="aw-identity-guide"><strong>先让内容有明确的身份与读者</strong><p>选择下面的运营身份后继续，或在对话中建立定位。</p><div><button disabled={running||!profile} onClick={()=>void send('使用这个身份，继续刚才的创作')}>使用已选身份继续</button><button disabled={running} onClick={()=>void send('请帮我建立身份定位')}>开始定位</button><button disabled={running} onClick={()=>void send('不需要身份，继续刚才的创作',true)}>跳过定位，通用创作</button></div></div>}
   <div className="aw-composer"><div className="aw-composer-settings"><ChoiceMenu label="运营身份" value={profile} onChange={setProfile} options={[{value:'',label:task.identity_skipped?'通用创作':'选择运营身份',description:'创作前可选择或建立身份，也可以明确跳过'},...unavailableProfileOption(t.list('profile'),profile,t.state.complete!==false),...profiles]}/><button className="quiet" onClick={()=>setReferences(true)}><Paperclip size={14}/>参考资料</button></div>
    <textarea aria-label="对话要求" value={text} disabled={sending} onChange={e=>setText(e.target.value)} onKeyDown={e=>sendKey(e,()=>void send(),setText)} placeholder="继续交流，或说：把这篇文章改写成朋友圈文案…"/>
    <footer><ChoiceMenu label="本次模型" value={model} onChange={setModel} options={[{value:'',label:'系统默认模型'},...t.state.models.filter((x:any)=>x.capability==='text').map((x:any)=>({value:x.id,label:x.title}))]}/><button className="aw-send" aria-label="发送要求" disabled={running||!text.trim()} onClick={()=>void send()}><ArrowUp size={19}/></button></footer>
   </div></section>
   <section className="aw-results"><nav className="aw-main-tabs" aria-label="工作区栏目">{[['body','工作成果'],['sources','参考资料'],['versions','版本']].map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>void openTab(key)}>{label}</button>)}</nav>
    {tab==='body'&&<><nav className="aw-platform-tabs" aria-label="工作成果平台">{Object.keys(mapping).map(p=><button key={p} className={selected===p?'active':''} onClick={()=>void select(p)}>{platforms[p]||p}</button>)}{!Object.keys(mapping).length&&<span>明确提出创作需求后，成品会显示在这里</span>}</nav>
     {task.agent_proposal&&<ProfileFromTask t={t} task={task} mode="profile" modelId={model} onSaved={setProfile}/>}
     {content?.kind==='content'?<PlatformOutcome key={content.id} content={content} platform={selected} task={task} t={t} pictures={pictures} running={running} registerSave={saveActive} onCreateCover={()=>void send('请根据当前公众号文章生成封面图片')}/>:content?.kind==='studio_draft'?<MediaOutcome key={content.id} draft={content} task={task} type={selected} t={t} registerSave={saveActive}/>:<div className="aw-empty"><PenLine size={34}/><h3>把灵感变成可编辑的成品</h3><p>例如“帮我写一篇公众号文章”。生成后会自动保存标题、正文、封面建议与摘要；其他平台各自保留。</p></div>}
    </>}
    {tab==='sources'&&<div className="aw-result-scroll"><ReferencePicker t={t} scope={scope} onChange={setScope} taskId={task.id} profileId={profile} report={task.retrieval}/></div>}
    {tab==='versions'&&<div className="aw-result-scroll"><h3>{platforms[selected]} · 历史版本</h3>{versions.filter(v=>v.body).map(v=><article className="version-card" key={v.version}><strong>版本 {v.version}</strong><small>{v.updated?new Date(v.updated).toLocaleString('zh-CN'):''}</small><details><summary>查看内容</summary><Markdown text={v.body}/></details><button disabled={running} onClick={()=>t.action(async()=>{await api('/content/'+content.id+'/restore/'+v.version,{});setVersions(await api('/objects/'+content.id+'/versions'))},'已恢复为新的草稿版本')}>恢复此版本</button></article>)}{!versions.length&&<p>成果保存后，历史版本会显示在这里。</p>}</div>}
   </section></div>
  {references&&<div className="reference-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setReferences(false)}}><section className="reference-dialog" role="dialog" aria-modal="true" aria-label="选择本次参考资料"><header className="block-heading"><strong><BookOpen size={16}/> 参考资料</strong><button autoFocus onClick={()=>setReferences(false)}>完成选择</button></header><ReferencePicker t={t} scope={scope} onChange={setScope} taskId={task.id} profileId={profile} report={task.retrieval}/></section></div>}
 </div>;
}

function PlatformOutcome({content,platform,task,t,pictures,running,registerSave,onCreateCover}:any){
 const key='platform-draft:'+t.state.user.id+':'+content.id;
 const cached=(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}})();
 const initial=Object.fromEntries(contentFields.map(k=>[k,content[k]??(k==='wechat_style'?defaultWechatStyle:'')]));
 const oldCache=(()=>{try{return JSON.parse(localStorage.getItem('draft:'+t.state.user.id+':'+content.id)||'null')}catch{return null}})();
 const [values,setValues]=useState<any>(cached?.fields||(oldCache?{...initial,body:oldCache.body}:initial)),[baseline,setBaseline]=useState(JSON.stringify(initial)),[version,setVersion]=useState(cached?.version||oldCache?.version||content.version),[preview,setPreview]=useState(false),[picker,setPicker]=useState<'cover'|'body'|null>(null),[saving,setSaving]=useState(false);
 const dirty=JSON.stringify(values)!==baseline;
 const saveFlight=useRef<Promise<void>|null>(null),latest=useRef(values);latest.current=values;
 useEffect(()=>{if(!dirty){const fields=Object.fromEntries(contentFields.map(k=>[k,content[k]??(k==='wechat_style'?defaultWechatStyle:'')]));setValues(fields);setBaseline(JSON.stringify(fields));setVersion(content.version)}},[content.version]);
 const change=(k:string,v:any)=>setValues((old:any)=>{const fields={...old,[k]:v};localStorage.setItem(key,JSON.stringify({fields,version}));return fields});
 const save=()=>{
  if(saveFlight.current)return saveFlight.current;
  if(!dirty)return Promise.resolve();
  const submitted=values;setSaving(true);
  saveFlight.current=(async()=>{try{
   const saved=await api('/tasks/'+task.id+'/outcomes/'+content.id,{version,...submitted},'PATCH');
   setVersion(saved.version);setBaseline(JSON.stringify(submitted));
   if(JSON.stringify(latest.current)===JSON.stringify(submitted))localStorage.removeItem(key);
   else localStorage.setItem(key,JSON.stringify({fields:latest.current,version:saved.version}));
   localStorage.removeItem('draft:'+t.state.user.id+':'+content.id);await t.refresh();
  }finally{setSaving(false);saveFlight.current=null}})();
  return saveFlight.current;
 };
 useEffect(()=>{registerSave.current=save;return()=>{registerSave.current=null}},[values,baseline,version]);
 const wechat=platform==='wechat'||(platform==='legacy'&&/公众号/.test(content.format||'')),video=['channels','douyin'].includes(platform);
 const exportFile=async()=>{await save();await download('/content/'+content.id+'/export?format='+ (wechat?'html':'md'),(values.title||'文稿')+(wechat?'.html':'.md'))};
 const cover=pictures.find((p:any)=>p.id===values.cover_asset_id);
 return <div className="aw-outcome"><div className="aw-outcome-bar"><span>{saving?'正在保存…':dirty?'修改已暂存本机':'已保存草稿 v'+version}</span><button disabled={running||saving} onClick={()=>setPreview(v=>!v)}>{preview?<PenLine size={14}/>:<Eye size={14}/>} {preview?'继续编辑':'阅读预览'}</button><button disabled={saving||!dirty||running} onClick={()=>t.action(save,'已保存当前平台稿件')}><Save size={14}/>保存修改</button></div>
  <section className="aw-section"><h3><span>01</span>{video?'视频标题':'文章标题'}</h3><input aria-label="成果标题" value={values.title} onChange={e=>change('title',e.target.value)} disabled={running}/></section>
  <section className="aw-section"><h3><span>02</span>{wechat?'文章正文':video?'口播脚本':'文案正文'}</h3>
   {wechat?<><div className="aw-editor-actions"><button disabled={running} onClick={()=>setPicker('body')}><ImagePlus size={14}/>插入图片</button><span>选中文字可设置格式</span></div>{preview?<WechatLayoutProof body={values.body} settings={values.wechat_style}/>:<div className={running?'aw-editor-disabled':''}><WechatRichEditor value={values.body} onChange={(v:string)=>{if(!running)change('body',v)}} fontSize={values.wechat_style.font_size} lineHeight={values.wechat_style.line_height} paragraphGap={values.wechat_style.paragraph_gap} accent={values.wechat_style.accent} onDropAsset={(id:string)=>{if(!running&&pictures.some((p:any)=>p.id===id))change('body',values.body+'\n\n![正文配图](/api/studio/assets/'+id+'/file)')}} onDropFiles={()=>setPicker('body')}/></div>}</>:preview?<Markdown text={video?values.script||values.body:values.body}/>:<textarea aria-label="成果正文" rows={14} value={video?values.script||values.body:values.body} onChange={e=>{change(video?'script':'body',e.target.value);if(video)change('body',e.target.value)}} disabled={running}/>}
  </section>
  {wechat&&<><section className="aw-section"><h3><span>03</span>封面图片</h3><div className="aw-cover">{cover?<AssetThumbnail asset={cover}/>:<div>封面待生成或选择</div>}<div><button disabled={running} onClick={()=>setPicker('cover')}>从素材库选择</button><button disabled={running} onClick={async()=>{try{await save();onCreateCover()}catch(e){t.setError((e as Error).message)}}}>生成封面方案</button></div></div><label>画面建议<textarea rows={3} aria-label="封面画面建议" value={values.cover_brief} disabled={running} onChange={e=>change('cover_brief',e.target.value)}/></label></section><section className="aw-section"><h3><span>04</span>摘要</h3><textarea aria-label="成果摘要" rows={3} maxLength={120} disabled={running} value={values.summary} onChange={e=>change('summary',e.target.value)}/></section></>}
  {video&&<><section className="aw-section"><h3><span>03</span>发布文案</h3><textarea aria-label="发布文案" rows={3} value={values.caption} disabled={running} onChange={e=>change('caption',e.target.value)}/></section><section className="aw-section"><h3><span>04</span>分镜与画面</h3><textarea aria-label="分镜与画面" rows={7} value={values.shotlist} disabled={running} onChange={e=>change('shotlist',e.target.value)}/></section></>}
  {values.tags&&<section className="aw-section"><label>相关标签<input value={values.tags} disabled={running} onChange={e=>change('tags',e.target.value)}/></label></section>}
  <footer className="aw-outcome-footer"><span>草稿请核对后使用</span><button disabled={saving||running} onClick={()=>t.action(exportFile,'已导出当前平台稿件')}><Download size={14}/>导出文稿</button></footer>
  {picker&&<AssetPicker items={pictures} busy={running} onClose={()=>setPicker(null)} onSelect={(a:any)=>{if(picker==='cover')change('cover_asset_id',a.id);else change('body',values.body+'\n\n!['+(a.title||'正文配图').replace(/[\[\]\n]/g,'')+'](/api/studio/assets/'+a.id+'/file)');setPicker(null)}}/>}
 </div>;
}

function AuthVideo({asset}:{asset:any}){
 const [url,setUrl]=useState('');useEffect(()=>{let live=true,objectUrl='';fetch(asset.file_url,{headers:{Authorization:'Bearer '+getToken()}}).then(r=>{if(!r.ok)throw Error();return r.blob()}).then(blob=>{objectUrl=URL.createObjectURL(blob);if(live)setUrl(objectUrl)}).catch(()=>{});return()=>{live=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[asset.id]);
 return url?<video controls src={url} className="aw-media-result"/>:<p>正在读取视频预览…</p>;
}
function UseAsCover({asset,task,t}:any){
 const article=t.get(task.platform_outcomes?.wechat);
 if(asset.asset_type!=='image'||!article)return null;
 return <button onClick={()=>t.action(()=>api('/tasks/'+task.id+'/outcomes/'+article.id,{version:article.version,cover_asset_id:asset.id},'PATCH'),'已设为公众号封面')}>用作公众号封面</button>;
}
function MediaOutcome({draft,task,type,t,registerSave}:any){
 const key='assistant-media-draft:'+t.state.user.id+':'+draft.id;
 const cache=(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}})();
 const [prompt,setPrompt]=useState(cache?.prompt??draft.input?.prompt??''),[model,setModel]=useState(cache?.model??draft.model_id??''),[options,setOptions]=useState<any>(cache?.options||draft.options||{}),[catalog,setCatalog]=useState<any[]>([]),[version,setVersion]=useState(cache?.version||draft.version),[saved,setSaved]=useState(JSON.stringify([draft.input?.prompt||'',draft.model_id||'',draft.options||{}])),[busy,setBusy]=useState(false);
 const dirty=JSON.stringify([prompt,model,options])!==saved,linkedRun=t.get(task.media_runs?.[type]),run=linkedRun?.draft_id===draft.id?linkedRun:undefined,running=run&&['queued','preparing','submitting','running'].includes(run.status);
 const cap=catalog.find((c:any)=>c.id===draft.tool||c.tool===draft.tool),models=cap?.models||[],selectedModel=models.find((m:any)=>m.id===(model||cap?.binding)),choices=selectedModel?.options||{};
 useEffect(()=>{void api('/studio/catalog').then(r=>setCatalog(r.items||r.capabilities||r.tools||[])).catch((e:Error)=>t.setError(e.message))},[draft.id]);
 useEffect(()=>{if(dirty)localStorage.setItem(key,JSON.stringify({prompt,model,options,version}))},[prompt,model,options,version,dirty]);
 useEffect(()=>{if(!running)return;let live=true;const timer=setInterval(()=>{void api('/studio/runs/'+run.id+'/refresh',{},'POST').then(()=>{if(live)void t.refresh()}).catch(()=>{})},3500);return()=>{live=false;clearInterval(timer)}},[run?.id,running]);
 const save=async()=>{if(!dirty)return;const next=await api('/studio/tasks/'+task.id+'/drafts/'+draft.id,{version,input:{...draft.input,prompt},model_id:model,options},'PATCH');setVersion(next.version);setSaved(JSON.stringify([prompt,model,options]));localStorage.removeItem(key);await t.refresh();return next};
 useEffect(()=>{registerSave.current=save;return()=>{registerSave.current=null}},[prompt,model,options,version,saved]);
 const generate=async()=>{setBusy(true);try{const next=await save();await api('/tasks/'+task.id+'/media/generate',{type,draft_id:draft.id,version:next?.version||version,confirmed:true,request_id:task.id+':'+draft.id+':'+(next?.version||version)});await t.refresh()}finally{setBusy(false)}};
 const notifiedRun=useRef('');
 useEffect(()=>{if(run?.status==='succeeded'&&run.parameter_adjustment&&notifiedRun.current!==run.id){notifiedRun.current=run.id;t.setNotice(run.parameter_adjustment)}},[run?.id,run?.status]);
 const assets=(run?.asset_ids||[]).map((id:string)=>t.get(id)).filter(Boolean);
 return <div className="aw-outcome"><section className="aw-section"><h3>{type==='image'?'图片生成方案':'视频生成方案'}</h3><p className="muted">检查画面要求和模型选项后生成，供应商可能计费。</p><textarea aria-label="媒体画面要求" rows={6} value={prompt} disabled={busy||running} onChange={e=>setPrompt(e.target.value)}/><label>生成模型<select aria-label="媒体生成模型" value={model||cap?.binding||''} disabled={busy||running} onChange={e=>{setModel(e.target.value);setOptions({})}}><option value="">选择已配置模型</option>{models.map((m:any)=><option key={m.id} value={m.id} disabled={!m.configured}>{m.title}{m.configured?'':' · 尚未配置'}</option>)}</select></label>{type==='image'&&<ImageParameters choices={choices} options={options} onChange={setOptions} disabled={busy||running}/>}<div className="aw-media-options">{Object.entries(choices).filter(([k,v])=>Array.isArray(v)&&(type!=='image'||!['size','aspect_ratio','resolution'].includes(k))).map(([k,v])=><label key={k}>{({size:'尺寸',ratio:'比例',duration:'时长',resolution:'清晰度',quality:'质量',n:'数量',generate_audio:'声音'} as any)[k]||k}<select aria-label={'媒体选项 '+k} value={JSON.stringify(options[k]??'')} onChange={e=>setOptions({...options,[k]:JSON.parse(e.target.value)})} disabled={busy||running}><option value={JSON.stringify('')}>默认</option>{(v as any[]).map(value=><option key={JSON.stringify(value)} value={JSON.stringify(value)}>{String(value)}</option>)}</select></label>)}</div><button className="primary" disabled={busy||running||!prompt.trim()||!selectedModel?.configured} onClick={()=>t.action(generate,type==='image'?imagePlan(choices,options).notice||'已提交媒体生成':'已提交媒体生成')}>{busy||running?'正在生成…':'生成'+(type==='image'?'图片':'视频')+' · 可能计费'}</button>{!selectedModel?.configured&&<p className="muted">请先在管理后台配置对应的生成服务。</p>}{run?.parameter_adjustment&&<p className="parameter-adjustment" role="status">{run.parameter_adjustment}</p>}{run&&<p role="status">{run.status==='succeeded'?'生成完成，素材已保存':run.error||run.status==='failed'?'生成未完成，请检查服务后重试':running?'生成中，完成后将保留在这里':'当前状态：'+run.status}</p>}</section>{assets.map((a:any)=><section className="aw-section" key={a.id}>{a.asset_type==='image'?<div className="aw-media-result"><AssetThumbnail asset={a} full/></div>:<AuthVideo asset={a}/>}<UseAsCover asset={a} task={task} t={t}/><button onClick={()=>t.action(()=>download('/studio/assets/'+a.id+'/file',a.title+(a.asset_type==='image'?'.png':'.mp4')),'已导出素材')}>下载素材</button></section>)}<a href={'#studio/'+(type==='image'?'image':'video')+'?draft='+draft.id+'&return='+encodeURIComponent('task/'+task.id)}>在完整创作工具中编辑 →</a></div>;
}
