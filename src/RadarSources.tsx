import {useEffect,useState} from 'react';
import {RefreshCw,Plus,Globe,ExternalLink,X,Search} from 'lucide-react';
import {api,type Item} from './api';
import {DeleteRecord} from './DeleteRecord';
import {SourceWizard,openReader} from './DiscoveryPanels';
import './radar.css';

const hotlistPlatforms=[['weibo','微博热搜'],['zhihu','知乎热榜'],['toutiao','头条热榜'],['douyin','抖音热榜'],['rednote','小红书热榜'],['baidu/hot','百度热榜']];
const hotlistTime=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'未记录';
export function HotlistBoards({t,query='',industry=false,onRead}:{t:any;query?:string;industry?:boolean;onRead:(row:any)=>void}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer)},[]);
 const active=t.list('job').some((j:Item)=>j.input?.action==='hotlists'&&['queued','running'].includes(j.status));
 return <><p className="radar-explanation">公开平台榜单，每个平台分别更新；主源不可用时最多尝试两个公开备用来源。5分钟内复用缓存。获取时间与上游榜单时间分别展示，热榜线索需查看原文核实。</p>
  <div className="hotlist-grid">{hotlistPlatforms.map(([platform,label])=>{
   const board=t.list('hotlist').find((x:Item)=>x.platform===platform),age=board?.fetched_at?clock-Date.parse(board.fetched_at):Infinity;
   const rows=(board?.items||[]).filter((row:any)=>row.title.toLowerCase().includes(query.toLowerCase())&&(!industry||/电梯|扶梯|物业|适老|旧改|老旧小区|楼宇|特种设备|城市更新/.test(row.title)));
   const failed=!!board?.error,status=failed?(board?.items?.length?'更新失败 · 历史榜单':'更新失败 · 暂无榜单'):!board?.items?.length?'尚未加载':board.cache_hit||age>300000?'缓存榜单':'本次获取';
   const cooling=board?.last_attempt_at&&clock-Date.parse(board.last_attempt_at)<300000;
   return <section className="hotlist-board" key={platform} aria-label={label}><header><span className="platform-mark">{label[0]}</span><div><h2>{label}</h2><small>{status}</small></div><span>{rows.length} 条</span></header>
    <div className="hotlist-provenance"><span>获取：{hotlistTime(board?.fetched_at)}</span><span>上游榜单：{board?.upstream_at?hotlistTime(board.upstream_at):'未提供时间'}</span>{board?.last_attempt_at&&<span>最近尝试：{hotlistTime(board.last_attempt_at)}</span>}
     {board?.provider_url&&<a href={board.provider_url} target="_blank" rel="noopener noreferrer">{board.provider||'历史聚合来源'}</a>}</div>
    {failed&&<p className="local-warning">{board.error}</p>}
    <div className="hotlist-board-actions"><button disabled={active||!!cooling} onClick={()=>t.action(()=>api('/hotlists/refresh',{platforms:[platform]}),'已提交'+label+'更新')}><RefreshCw size={13}/>{active?'更新中…':cooling?'5分钟后可再次更新':failed?'重试此平台':'更新此平台'}</button>
     {!!board?.attempts?.length&&<details><summary>来源检查</summary>{board.attempts.map((attempt:any)=><p key={attempt.url}>{new URL(attempt.url).hostname} · {attempt.status==='ok'?'取得 '+attempt.count+' 条':attempt.error}</p>)}</details>}</div>
    <div className="hotlist-rows">{rows.map((row:any)=><button key={row.url} onClick={()=>onRead({...row,board,source_type:label})}><b className={row.rank<=3?'top-rank':''}>{row.rank}</b><span><strong>{row.title}</strong><small>热度 {row.heat}{row.published_at?' · 条目发布 '+hotlistTime(row.published_at):''}</small></span></button>)}
     {!rows.length&&<p className="inline-empty">{board?.items?.length?'没有匹配的热点。可关闭筛选查看综合榜。':failed?'尚无可用榜单，已报告本次更新失败。':'点击更新，加载真实榜单。'}</p>}</div>
   </section>
  })}</div></>
}

const labels:Record<string,string>={ready:'可读取',no_match:'未发现匹配',needs_browser:'需网页读取',failed:'获取失败'};
export const sourceState=(f:Item)=>f.enabled===false?'已暂停':labels[f.last_result?.status]|| (f.error?'获取异常':'尚未获取');
export async function scanRadar(channel_id=''){
 const bridge=(window as any).tijianDesktop;if(!bridge)throw Error('读取动态网页请使用桌面版');
 return bridge.discoveryBrowser({action:'radar-scan',channel_id,token:sessionStorage.getItem('tijian-session')});
}
export function RadarSources(t:any){
 const [edit,setEdit]=useState<any>(null),[browser,setBrowser]=useState<any>(null),[query,setQuery]=useState('');
 const all=t.list('feed'),feeds=all.filter((f:Item)=>(f.title+' '+f.url).toLowerCase().includes(query.toLowerCase()));
 const running=t.list('job').filter((j:Item)=>j.input?.action==='radar'&&['queued','running'].includes(j.status));
 const busy=(f:Item)=>running.some((j:Item)=>!j.input.feed_ids||j.input.feed_ids.includes(f.id));
 return <div className="radar-source-manager"><div className="source-manager-tools"><span>{all.length} 个信源 · {all.filter((f:Item)=>f.enabled!==false).length} 个已启用</span><button className="primary" onClick={()=>setEdit({})}><Plus size={16}/>添加信源</button></div><div className="filter-search"><Search size={16}/><input aria-label="搜索信源" placeholder="查找名称或网址" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="source-cards">{feeds.map((f:Item)=><article className="source-card" key={f.id}><div className="source-card-icon"><Globe size={20}/></div><div className="source-card-main"><header><h3>{f.title}</h3><span className={'source-status '+(f.error?'warning':'')}>{busy(f)?'获取中…':sourceState(f)}</span></header><a href={f.url} target="_blank" rel="noreferrer" className="source-url">{f.url}</a><div className="source-facts"><span>关键词：{f.keywords||'不限'}</span><span>{f.last_attempt?'最近检查 '+new Date(f.last_attempt).toLocaleString('zh-CN'):'尚未执行获取'}</span>{f.last_result&&<span>发现 {f.last_result.found||0} · 新增 {f.last_result.added||0}</span>}</div>{(f.error||f.last_result?.note)&&<p className={'source-note '+(f.error?'warning':'')}>{f.error||f.last_result.note}</p>}<div className="source-actions"><button disabled={busy(f)||f.enabled===false} onClick={()=>t.action(()=>api('/radar/'+f.id+'/refresh',{}),'正在获取该信源资讯')}><RefreshCw size={14}/>获取资讯</button><button onClick={()=>setBrowser(f)}><ExternalLink size={14}/>网页读取</button><button onClick={()=>setEdit(f)}>编辑</button><button onClick={()=>t.action(()=>t.update(f,{enabled:f.enabled===false}))}>{f.enabled===false?'启用':'暂停'}</button><DeleteRecord item={f} t={t}/></div></div></article>)}</div>{!feeds.length&&<p className="inline-empty">{all.length?'没有匹配的信源。':'粘贴网站栏目、RSS 或博主主页，添加第一个信源。'}</p>}{edit&&<SourceWizard t={t} item={edit.id?edit:null} onClose={()=>setEdit(null)}/>} {browser&&<RadarBrowser feed={browser} t={t} onClose={()=>setBrowser(null)}/>}</div>
}
export function RadarBrowser({feed,t,onClose}:any){
 const [channel,setChannel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<any>(null),[selected,setSelected]=useState<string[]>([]);
 const run=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const read=async()=>{const r=await scanRadar(channel);const words=String(feed.keywords||'').split(/[,，\s]+/).filter(Boolean);r.items=r.items.filter((x:any)=>!words.length||words.some(w=>x.title.toLowerCase().includes(w.toLowerCase())));setResult(r);setSelected(r.items.map((x:any)=>x.url))};
 return <div className="reader-overlay"><section className="detail-drawer discovery-panel" role="dialog" aria-label="读取信源网页"><div className="block-heading"><h2>从网页获取线索</h2><button className="icon-button" aria-label="关闭网页读取" onClick={onClose}><X/></button></div><p>{feed.title}</p><p className="muted">打开网站完成必要的登录、搜索或验证，再回到这里读取已加载的链接。抖音请打开目标博主主页；核对作品后勾选保存。</p><div className="button-row"><button disabled={busy} onClick={()=>void run(async()=>{const r=await openReader(feed.url);setChannel(r.channel_id||'')})}>1. 打开网站</button><button className="primary" disabled={busy} onClick={()=>void run(read)}>2. 读取当前页面</button></div>{error&&<p className="form-error">{error}</p>}{result&&<><p>{result.note}</p><p className="path">当前页面：{result.url}</p><div className="button-row"><button onClick={()=>setSelected(result.items.map((x:any)=>x.url))}>全选</button><button onClick={()=>setSelected([])}>清空</button><span>已选 {selected.length} / {result.items.length}</span></div><div className="browser-leads">{result.items.map((x:any)=><label key={x.url}><input type="checkbox" checked={selected.includes(x.url)} onChange={e=>setSelected(e.target.checked?[...selected,x.url]:selected.filter(u=>u!==x.url))}/><span>{x.title}</span></label>)}</div>{!result.items.length&&<p className="local-warning">没有匹配的可见链接。可在网页加载更多内容，或修改信源关键词。</p>}<button className="primary" disabled={busy||!selected.length} onClick={()=>void run(async()=>{const r=await api('/radar/'+feed.id+'/browser-import',{url:result.url,items:result.items.filter((x:any)=>selected.includes(x.url))});await t.refresh();t.setToast('已新增 '+r.added+' 条线索');onClose()})}>保存所选线索</button></>}</section></div>
}
