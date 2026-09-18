import {useViewState} from './useViewState';
import {AcquisitionMeta} from './AcquisitionMeta';
import {FreeSubscription} from './FreeSubscription';
import {localDay,monthStart} from './dates';
import {useEffect,useRef,useState} from 'react';
import {ExternalLink,RefreshCw,Check,Bell,Download} from 'lucide-react';
import {api,getToken} from './api';
import './wechat-library.css';
import {DeleteRecord} from './DeleteRecord';
import {usePaidAction} from './PaidAction';
import {CollectionResult,SavedArticle} from './CollectionResult';

export const CIMI_SERVICE='https://www.cimidata.com/api-service';
const DOCS='https://www.showdoc.com.cn/2265380957870963';
const message=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试';
const stamp=(s:string)=>s?new Date(s).toLocaleString('zh-CN'):'尚未检查';
export function CimiLinks(){return <div className="cimi-links"><a href={CIMI_SERVICE} target="_blank" rel="noreferrer">开通次幂 · 获取 AppID / Secret <ExternalLink size={14}/></a><a href={DOCS} target="_blank" rel="noreferrer">接口文档</a><a href={DOCS+'/11559023150418150'} target="_blank" rel="noreferrer">官方报价</a></div>}

export function WechatSettings(){
 const [state,setState]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const form=useRef<HTMLFormElement>(null);
 useEffect(()=>{api('/wechat/settings').then(setState).catch(e=>setError(message(e)))},[]);
 async function run(test=false){setBusy(true);setError('');setNotice('');try{
  if(test){setState(await api('/wechat/settings/test',{}));setNotice('认证通过。目录权限、覆盖范围和费用需在实际查询时核对。')}
  else{const d=new FormData(form.current!);setState(await api('/wechat/settings',{app_id:d.get('app_id'),app_secret:d.get('app_secret')},'PUT'));form.current?.reset();setNotice('凭据已加密保存，输入框已清空。')}
 }catch(e){setError(message(e))}finally{setBusy(false)}}
 return <section className="surface wechat-settings"><div className="block-heading"><div><span className="section-number">公众号数据服务</span><h2>次幂 API 连接</h2></div><span className="cimi-status">{state?.configured?'已加密保存':'未配置'}</span></div>
  <p>用于识别发布账号、获取历史目录和检查订阅更新。填写官网开通后获得的 AppID 与 Secret；正文优先免费读取，也可单独确认费用后通过次幂补采。</p><CimiLinks/>
  <form ref={form} onSubmit={e=>{e.preventDefault();void run()}} autoComplete="off"><div className="cimi-fields"><label className="field"><span>AppID</span><input name="app_id" aria-label="次幂 AppID" required maxLength={500} disabled={busy} placeholder="从次幂 API 服务页面获取"/></label><label className="field"><span>Secret</span><input name="app_secret" aria-label="次幂 Secret" type="password" autoComplete="new-password" required maxLength={500} disabled={busy} placeholder={state?.configured?'更换连接时填写新凭据':'仅在本机服务端加密保存'}/></label></div><div className="button-row"><button className="primary" disabled={busy}>保存次幂连接</button><button type="button" disabled={busy||!state?.configured} onClick={()=>void run(true)}>验证认证（不查询文章）</button></div></form>
  <p className="muted">凭据不回显，不写入浏览器存储或工作区备份。最近认证：{stamp(state?.tested_at)}。{state?.usage?.day&&`${state.usage.day} 已记录 ${state.usage.calls} 次业务请求（含失败或结果不明）；实际账单以次幂为准。`}</p>
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="local-warning" role="status">{notice}</p>}
 </section>
}

export function WechatLibrary({account,t,mode='catalog'}:any){
 const cache='catalog-view:'+t.state.user.id+':'+account.id+':'+mode;
 const [library,setLibrary]=useState<any>(null),[settings,setSettings]=useState<any>(null);
 const [input,setInput]=useState(account.url||''),[since,setSince]=useViewState(cache+':since',monthStart()),[until,setUntil]=useViewState(cache+':until',localDay()),[keyword,setKeyword]=useViewState(cache+':keyword',''),[limit,setLimit]=useViewState(cache+':limit','30');
 const [large,setLarge]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [queryPages,setQueryPages]=useViewState(cache+':queryPages','3');const pause=useRef(false);
 const [pageIndex,setPageIndex]=useState(0);
 const [selected,setSelected]=useState<string[]>([]),[runId,setRunId]=useState(''),[view,setView]=useState('library');
 const [minutes,setMinutes]=useState('120'),[daily,setDaily]=useState('12'),[pages,setPages]=useState('2'),[autoBody,setAutoBody]=useState(false),[subConsent,setSubConsent]=useState(false);
 const mounted=useRef(true);
 const paid=usePaidAction();
 const [submitted,setSubmitted]=useState<any>(null),[submitting,setSubmitting]=useState(false);
 const resultAnchor=useRef<HTMLDivElement>(null);
 const [collectError,setCollectError]=useState('');
 const bodyJobs=(t.list?.('job')||[]).filter((j:any)=>j.input?.action==='wechat_body'&&j.input?.benchmark_id===account.id);
 const deleted=t.state?.objects?.find((j:any)=>j.id===submitted?.id)?.archived;
 const bodyJob=submitted&&!deleted?(bodyJobs.find((j:any)=>j.id===submitted.id)||submitted):bodyJobs.find((j:any)=>['queued','running'].includes(j.status));
 const collecting=submitting||bodyJob&&['queued','running'].includes(bodyJob.status);
 const refresh=async()=>{const [l,s]=await Promise.all([api('/wechat/library/'+account.id),api('/wechat/settings')]);if(mounted.current){setLibrary(l);setSettings(s)}return l};
 useEffect(()=>{mounted.current=true;void refresh().then(l=>{const sub=l.subscription;if(sub){setMinutes(String(sub.interval_minutes));setDaily(String(sub.daily_limit));setPages(String(sub.pages_per_check));setAutoBody(sub.auto_body)}if(l.runs[0])setRunId(l.runs[0].id)}).catch(e=>setError(message(e)));const timer=setInterval(()=>void refresh().catch(()=>{}),10000);return()=>{mounted.current=false;pause.current=true;clearInterval(timer)}},[account.id]);
 const action=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');setNotice('');try{await fn();await refresh();await t.refresh?.()}catch(e){setError(message(e));await refresh().catch(()=>{})}finally{setBusy(false)}};
 useEffect(()=>{if(bodyJob?.id&&!collecting)void refresh().catch(()=>{})},[bodyJob?.id,bodyJob?.status]);
 useEffect(()=>{if(!collecting)return;const timer=setInterval(()=>{void t.refresh?.();void refresh().catch(()=>{})},1000);return()=>clearInterval(timer)},[collecting,account.id]);
 const run=library?.runs.find((x:any)=>x.id===runId);
 const f=mode==='automatic'?{since:'',until:'',keyword:'',limit:library?.items?.length||0}:view==='run'&&run?run.filters:{since,until,keyword,limit:Number(limit)||30};
 const items=(library?.items||[]).filter((x:any)=>(mode!=='automatic'||['automatic_subscription','manual_subscription_check'].includes(x.discovery_origin)||x.provider==='weread')&&(view!=='run'||!run||run.keys.includes(x.article_key))&&(!f.since&&!f.until||x.published&&(!f.since||x.published>=f.since)&&(!f.until||x.published<=f.until))&&(!f.keyword||x.title.toLowerCase().includes(f.keyword.toLowerCase()))).slice(0,f.limit);
 const pageCount=Math.max(1,Math.ceil(items.length/20)),visiblePage=Math.min(pageIndex,pageCount-1),visibleItems=items.slice(visiblePage*20,visiblePage*20+20);
 useEffect(()=>setPageIndex(0),[since,until,keyword,view,runId]);
 const allIds=new Set((library?.items||[]).map((x:any)=>x.id));
 const chosen=selected.filter(id=>allIds.has(id));
 const unknown=(mode==='automatic'?items:library?.items||[]).filter((x:any)=>!x.published).length;
 async function next(newRun=false){pause.current=false;await action(async()=>{const budget=Number(queryPages);if(!Number.isInteger(budget)||budget<1||budget>100)throw Error('本次页数上限须为1至100');let r=run;if(newRun){r=await api('/wechat/runs',{benchmark_id:account.id,since,until,keyword,limit:Number(limit),confirm_large:large});setRunId(r.id);setSelected([])}setView('run');for(let n=0;n<budget&&!pause.current&&mounted.current;n++){r=await api('/wechat/runs/'+r.id+'/next',{version:r.version,confirmed:true});await refresh();if(r.done)break;}setNotice(pause.current?'已暂停，当前页已保存，可从断点继续。':'本次目录查询已结束；已到来源末页、篇数上限或本次页数上限。')})}
 async function collectBody(mode='public'){setSubmitting(true);setCollectError('');setNotice('');resultAnchor.current?.scrollIntoView({block:'nearest',behavior:'smooth'});try{const bridge=(window as any).tijianDesktop;const job=mode==='public'&&bridge?.wechatBody?await bridge.wechatBody({action:'start',ids:chosen,benchmark_id:account.id,token:getToken()}):await api('/wechat/collect',{ids:chosen,benchmark_id:account.id,mode,confirmed:mode==='cimidata',confirmed_conversion:mode==='cimidata'});setSubmitted(job);setSelected([]);await t.refresh?.();setNotice('')}catch(e){setCollectError(message(e))}finally{setSubmitting(false)}}
 async function exportZip(){await action(async()=>{const r=await fetch('/api/wechat/export',{method:'POST',headers:{Authorization:'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({ids:chosen})});if(!r.ok)throw Error((await r.json()).detail||'导出失败');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='公众号文章与目录.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);setNotice('已导出所选目录与已有正文；未采集正文的文章会在目录中标明。')})}
 const confirmQuery=(newRun=false)=>{const n=Number(queryPages);if(!Number.isInteger(n)||n<1||n>100){setError('本次页数上限须为1至100');return}paid.confirm(newRun?'确认付费获取目录？':'确认付费继续查询？',`本次最多请求 ${n} 页目录，参考单价 ¥0.05/页，费用最多约 ¥${(n*0.05).toFixed(2)}。确认仅适用于本次点击，继续查询会再次询问。`,()=>void next(newRun))};
 return <section className="wechat-library">{paid.modal}
  {mode==='settings'&&<><FreeSubscription key={account.id} account={account} bound={library?.account} t={t} onChange={refresh}/><div className="connection-summary"><span>次幂连接：{settings?.configured?'已配置':'尚未配置'} · 仅在手动确认后使用付费服务</span><a className="settings-link" href={'#settings/cimi/'+account.id+'/'+(t.route?.split('/')[3]||'saved')}>配置次幂服务 →</a></div><details><summary>高级：通过次幂重新识别账号（计费）</summary>
  <div className="cimi-account"><label className="field"><span>该博主发布的一篇公众号原文链接</span><input aria-label="次幂公众号原文链接" value={input} disabled={busy} onChange={e=>setInput(e.target.value)} placeholder="https://mp.weixin.qq.com/s/…"/></label>
   <p className="muted">参考价：识别账号约 ¥0.02/次，目录约 ¥0.05/页；实际费用以<a href={DOCS+'/11559023150418150'} target="_blank" rel="noreferrer">官方报价</a>为准。失败可能计费，不自动重试。</p>
   <button disabled={busy||!input.trim()} onClick={()=>paid.confirm('确认付费识别账号？','本次调用账号识别接口 1 次，参考费用 ¥0.02。重复识别也会再次调用并可能扣费。',()=>void action(async()=>{await api('/wechat/resolve',{url:input,benchmark_id:account.id,confirmed:true});setRunId('');setView('library');setSelected([])}))}>{library?.account?'重新识别并绑定账号':'识别发布账号（计费）'}</button>
   {library?.account&&<div className="discovery-result"><strong><Check size={16}/> {library.account.title}</strong><p>账号标识 {library.account.biz} · {library.account.wxid}</p><small>来源：{library.account.provider==='weread'?'微信读书原文识别':'次幂文章账号接口'} · {stamp(library.account.verified_at)}</small></div>}
  </div></details></>}
  {library&&!library.account&&mode!=='settings'&&<p className="local-warning">请先确认这个公众号的身份。<a href={'#settings/benchmark/'+account.id+'/manual'}>前往连接与账号设置 →</a></p>}
  {library?.account&&<>
  {mode==='catalog'&&<><div className="connection-summary"><span>次幂：{settings?.configured?'连接已保存':'尚未配置'}</span><a className="settings-link" href={'#settings/cimi/'+account.id+'/manual'}>服务设置 →</a></div><div className="section-intro catalog-heading"><h3>从目录选择文章</h3><p>01 筛选范围与获取目录 → 02 勾选文章 → 03 保存正文</p></div>
   <div className="cimi-filters"><label className="field"><span>开始日期</span><input type="date" aria-label="文章库开始日期" value={since} onChange={e=>{setSince(e.target.value);setView('library');setSelected([])}}/></label><label className="field"><span>结束日期</span><input type="date" aria-label="文章库结束日期" value={until} onChange={e=>{setUntil(e.target.value);setView('library');setSelected([])}}/></label><label className="field"><span>标题关键词</span><input aria-label="文章库标题关键词" value={keyword} onChange={e=>{setKeyword(e.target.value);setView('library');setSelected([])}}/></label><label className="field"><span>最多篇数</span><input aria-label="文章库最多篇数" type="number" min="1" max="2000" value={limit} onChange={e=>{setLimit(e.target.value);setView('library');setSelected([])}}/></label></div>
   {Number(limit)>30&&<label className="check-line"><input type="checkbox" checked={large} onChange={e=>setLarge(e.target.checked)}/>确认获取超过30篇，按上述范围筛选</label>}
   <label className="field"><span>本次最多读取目录页数（1—100）</span><input aria-label="本次目录页数上限" type="number" min="1" max="100" value={queryPages} disabled={busy} onChange={e=>setQueryPages(e.target.value)}/><small>目录请求最多 {queryPages||0} 次，参考费用约 ¥{((Number(queryPages)||0)*0.05).toFixed(2)}；实际以次幂账单为准。筛选在本地进行，未命中的目录页也会产生费用。</small></label>
   <div className="button-row"><button className="primary" disabled={busy||!settings?.configured||(Number(limit)>30&&!large)} onClick={()=>confirmQuery(true)}>按此范围获取目录（计费）</button><button onClick={()=>{setView('library');setSelected([])}}>查看本地文章库（免费）</button></div>
   {!!library.runs.length&&<label className="field"><span>历史查询与断点</span><select aria-label="历史查询与断点" value={runId} onChange={e=>{setRunId(e.target.value);setView('run');setSelected([])}}><option value="">选择查询</option>{library.runs.map((x:any)=><option key={x.id} value={x.id}>{stamp(x.created)} · {x.pages} 页 · {x.filters.since||'不限起始'} ～ {x.filters.until||'不限结束'} · 最多{x.filters.limit}篇</option>)}</select></label>}
   {run&&<div className="cimi-coverage"><DeleteRecord item={run} t={t} onDeleted={()=>{setRunId('');setView('library');void refresh()}}/><strong>{run.coverage}</strong><p>本轮已读取 {run.pages} 页。按本次页数上限逐页查询；重启后保留断点。新文章会加入本地库，关键词与日期只筛选结果。</p>{run.error&&<p className="form-error">{run.error}</p>}{!run.done&&<button disabled={busy||!settings?.configured} onClick={()=>confirmQuery()}>从断点继续查询（计费）</button>}</div>}
   </>}
   {mode!=='settings'&&<>
   <div className="block-heading"><h3>{mode==='automatic'?'订阅发现':view==='run'?'本轮目录结果':'已获取目录'} · {items.length} 篇</h3><span>当前账号目录共 {library.items.length} 篇 / 正文已保存 {library.items.filter((x:any)=>x.status==='body_saved').length} 篇</span></div>
   {unknown>0&&<p className="muted">{unknown} 篇发布日期未知{mode==='catalog'?'；设置日期条件时排除':''}。</p>}
   <div className="button-row"><button disabled={busy||!visibleItems.length} onClick={()=>setSelected(visibleItems.map((x:any)=>x.id))}>选择本页（最多20篇）</button><button onClick={()=>setSelected([])}>清空选择</button><span>已选 {chosen.length} 篇</span></div>
   <div className="cimi-articles">{visibleItems.map((x:any)=><div className="discovery-entry" key={x.id}><input type="checkbox" disabled={busy||chosen.length>=100&&!chosen.includes(x.id)} checked={chosen.includes(x.id)} onChange={e=>setSelected(e.target.checked?[...chosen,x.id]:chosen.filter(id=>id!==x.id))}/><span><strong>{x.title}</strong>{mode==='automatic'&&library.notices.some((n:any)=>n.article_id===x.id)&&<button className="notice-pill" onClick={()=>void action(async()=>{for(const n of library.notices.filter((n:any)=>n.article_id===x.id))await api('/wechat/notices/'+n.id+'/read',{})})}>新发现 · 标为已读</button>}<small>{x.published||'日期未知'} · {x.status==='body_saved'?'正文已保存':x.status==='failed'?'正文采集失败':'已发现，正文未采集'}</small><AcquisitionMeta item={x}/>{x.error&&<small className="form-error">{x.error}</small>}{x.status==='body_saved'&&<SavedArticle source={t.get?.(x.source_id)}/>}</span><a href={x.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} aria-label={'打开原文 '+x.title}><ExternalLink size={16}/></a><DeleteRecord item={x} t={t} onDeleted={()=>{setSelected(v=>v.filter(id=>id!==x.id));void refresh()}}/></div>)}{!items.length&&<p className="inline-empty">{mode==='automatic'?'还没有订阅发现记录。开启订阅后，检查结果会显示在这里。':'当前条件下没有目录文章。可调整日期或查询目录，再勾选需要的正文。'}</p>}</div>
   {pageCount>1&&<div className="button-row"><button disabled={visiblePage===0} onClick={()=>setPageIndex(visiblePage-1)}>上一页</button><span>第 {visiblePage+1} / {pageCount} 页 · 共 {items.length} 篇</span><button disabled={visiblePage+1>=pageCount} onClick={()=>setPageIndex(visiblePage+1)}>下一页</button></div>}
   <div className="button-row"><button className="primary" disabled={busy||collecting||!chosen.length} onClick={()=>void collectBody()}>{collecting?'正在采集正文…':'采集所选正文（不收次幂费用）'}</button><button disabled={busy||collecting||!chosen.length||!settings?.configured} onClick={()=>paid.confirm('确认次幂付费正文补采？',`已选择 ${chosen.length} 篇，长链接需先转换（¥0.01/次），再获取正文（¥0.01/次）；每篇最多两次调用，本批参考费用最多约 ¥${(chosen.length*0.02).toFixed(2)}。已缓存的短链接不重复转换。已有且未删除的正文直接复用，不重复付费。不会自动重试失败文章，也不会重新查询目录。`,()=>void collectBody('cimidata'))}>次幂正文补采（计费）</button><button disabled={busy||!chosen.length} onClick={()=>void exportZip()}><Download size={16}/>导出目录与已有正文</button></div>
   {(submitting||bodyJob||collectError)&&<div ref={resultAnchor} className={'collection-feedback '+(collecting?'is-running':'')} role="status" aria-live="polite">{submitting?<><RefreshCw size={17} className="spin"/> 正在提交采集，请稍候…</>:bodyJob?<><strong>{collecting?'正在采集中':['failed','interrupted'].includes(bodyJob.status)?'采集失败':bodyJob.status==='cancelled'?'采集已取消':bodyJob.result?.failed?bodyJob.result?.success?'采集部分成功':'采集失败':'采集成功'}</strong><span>{collecting?bodyJob.progress:`成功 ${bodyJob.result?.success||0} 篇 · 失败 ${bodyJob.result?.failed||0} 篇`}</span>{collecting&&bodyJob.progress?.includes('验证')&&<button onClick={()=>{void (window as any).tijianDesktop?.wechatBody({action:'show',token:getToken()}).catch((e:Error)=>setCollectError(e.message))}}>打开微信验证窗口</button>}{collecting&&<button onClick={()=>void action(()=>api('/jobs/'+bodyJob.id+'/cancel',{}))}>取消采集</button>}</>:<span>请选择文章后采集。免费公开读取与次幂付费补采分别操作。</span>}{collectError&&<p className="form-error">{collectError}</p>}</div>}
   <p className="muted">免费读取遇到验证会请你操作；受限时可手动选择付费补采。每批付费只确认一次。查看和导出已保存内容不收费。</p>
   {bodyJob&&<details><summary>查看本次逐篇结果</summary><DeleteRecord item={bodyJob} t={t} onDeleted={()=>setSubmitted(null)}/><CollectionResult job={bodyJob} getSource={t.get}/></details>}
   </>}
   {mode==='settings'&&<details open={library.subscription?.enabled||undefined}><summary>手动选择备用：付费定时查询 · {library.subscription?.enabled?'已开启':'未开启'}</summary><section className="cimi-subscription"><div className="block-heading"><h3><Bell size={17}/> 定时查询更新（付费）</h3><strong>{library.subscription?.enabled?'已开启':'未开启'}</strong></div><p>这是定时付费查询，不是新文推送；即使没有新文章也可能扣费。工作台运行时定时检查；退出或休眠期间暂停，恢复后继续补漏。首次检查建立基线，旧文章不提醒；新增保存在应用内，即使当时页面未打开也能查看。</p><div className="cimi-filters"><label className="field"><span>检查间隔（分钟）</span><input aria-label="订阅检查间隔" type="number" min="30" max="10080" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label className="field"><span>每日自动调用上限</span><input aria-label="订阅每日调用上限" type="number" min="1" max="200" value={daily} onChange={e=>setDaily(e.target.value)}/></label><label className="field"><span>每轮最多目录页</span><input aria-label="订阅每轮目录页" type="number" min="1" max="10" value={pages} onChange={e=>setPages(e.target.value)}/></label></div><p className="muted">每日自动调用次数按当前用户的所有公众号合计；每个订阅会按此上限检查。耗尽后停止自动查询，次日继续。此处不承诺分钟级发现或公众号全量历史。</p>
    <label className="check-line"><input type="checkbox" checked={autoBody} onChange={e=>setAutoBody(e.target.checked)}/>发现新增时自动尝试公开正文归档（不调用付费正文接口）</label><label className="check-line"><input type="checkbox" checked={subConsent} onChange={e=>setSubConsent(e.target.checked)}/>同意按上述频率和次数上限进行付费自动查询</label><div className="button-row"><button disabled={busy||!subConsent} onClick={()=>paid.confirm('确认开启或更新自动扣费查询？',`每 ${minutes} 分钟检查一次，每轮最多 ${pages} 页，约 ¥${(Number(pages)*0.05).toFixed(2)}/轮。每日调用阈值 ${daily} 次，按此阈值估算约 ¥${(Number(daily)*0.05).toFixed(2)}/天、¥${(Number(daily)*0.05*30).toFixed(2)}/30天。次数按所有公众号合计，各订阅使用各自阈值。开启后按上述规则自动调用，不会逐轮弹窗，暂停后停止。`,()=>void action(()=>api('/wechat/subscription/'+account.id,{enabled:true,confirmed:subConsent,interval_minutes:Number(minutes),daily_limit:Number(daily),pages_per_check:Number(pages),auto_body:autoBody},'PUT')))}>{library.subscription?.enabled?'保存订阅设置':'开启订阅'}</button>{library.subscription?.enabled&&<button disabled={busy} onClick={()=>void action(()=>api('/wechat/subscription/'+account.id,{enabled:false},'PUT'))}>暂停订阅</button>}</div>
    {library.subscription&&<div className="cimi-coverage"><p>上次成功：{stamp(library.subscription.last_success)} · {library.subscription.coverage||'等待首次检查'}</p>{library.subscription.error&&<p className="form-error">{library.subscription.error}</p>}</div>}
    {!!library.notices.length&&<div className="cimi-notices"><h4>未读更新 · {library.notices.length}</h4>{library.notices.map((n:any)=><div key={n.id}><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a><button onClick={()=>void action(()=>api('/wechat/notices/'+n.id+'/read',{}))}>标为已读</button></div>)}</div>}
   </section></details>}
  </>}
  {busy&&<div role="status"><RefreshCw size={16} className="spin"/> 正在处理，请稍候… <button onClick={()=>{pause.current=true}}>当前页完成后暂停目录查询</button></div>}{error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="local-warning" role="status">{notice}</p>}
 </section>
}
