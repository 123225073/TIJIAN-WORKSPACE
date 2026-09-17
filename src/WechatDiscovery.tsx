import {localDay,monthStart} from './dates';
import {WechatLibrary} from './WechatLibrary';
import {useEffect,useRef,useState} from 'react';
import {X,RefreshCw} from 'lucide-react';
import {api} from './api';
export function WechatDiscovery(props:any){
 const [source,setSource]=useState('cimidata');
 return <div className="reader-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)props.onClose()}}><section className="detail-drawer discovery-panel" role="dialog" aria-modal="true" aria-label="获取公众号发布文章"><div className="block-heading"><h2>获取公众号发布文章</h2><button className="icon-button" aria-label="关闭公众号文章获取" onClick={props.onClose}><X/></button></div><div className="wechat-source-tabs"><button className={source==='cimidata'?'active':''} onClick={()=>setSource('cimidata')}>次幂 · 文章库与订阅</button><button className={source==='desktop'?'active':''} onClick={()=>setSource('desktop')}>微信网页登录态</button></div>{source==='cimidata'?<WechatLibrary {...props}/>:<DesktopWechatDiscovery {...props}/>}</section></div>
}
function DesktopWechatDiscovery({account,t}:any){
 const [input,setInput]=useState(account.url||''),[limit,setLimit]=useState(''),[since,setSince]=useState(()=>monthStart()),[until,setUntil]=useState(()=>localDay());
 const [result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]),[notice,setNotice]=useState('');
 const stopped=useRef(false),alive=useRef(true),runId=useRef('');
 const call=(data:any)=>{const bridge=(window as any).tijianDesktop;if(!bridge?.wechatDiscovery)throw Error('请使用新版桌面软件读取公众号发布列表');return bridge.wechatDiscovery({...data,token:sessionStorage.getItem('tijian-session')})};
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;stopped.current=true;if(runId.current)void call({action:'cancel',id:runId.current}).catch(()=>{})}},[]);
 const invalidate=()=>{setResult(null);setSelected([]);setError('');if(runId.current)void call({action:'cancel',id:runId.current}).catch(()=>{});runId.current=''};
 const load=async(restart=false,confirm=false)=>{
  stopped.current=false;setBusy(true);setError('');setNotice('');
  try{
   if(restart){if(runId.current)await call({action:'cancel',id:runId.current});runId.current='';setResult(null);setSelected([])}
   let request:any=restart?{action:'start',input,limit,since,until}:{action:'next',id:runId.current,confirm_all:confirm};
   while(!stopped.current){
    const next=await call(request);runId.current=next.id;
    if(!alive.current){void call({action:'cancel',id:next.id}).catch(()=>{});break}setResult(next);
    if(next.error){setError(next.error);break}
    if(next.done||next.needs_confirmation)break;
    request={action:'next',id:next.id};
    await new Promise(resolve=>setTimeout(resolve,200));
   }
  }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
 };
 const save=async()=>{
  setBusy(true);setError('');let submitted=0;
  try{
   for(let i=0;i<selected.length;i+=100){await api('/import/batch',{urls:selected.slice(i,i+100).join('\n'),benchmark_id:account.id,expected_publisher_biz:result.account.biz});submitted+=Math.min(100,selected.length-i)}
   await t.refresh();setNotice(`已提交 ${submitted} 篇正文采集；请在此账号的采集记录查看成功与失败。`);setSelected([]);
  }catch(e){setError(`已提交 ${submitted} 篇；`+(e as Error).message);setSelected(selected.slice(submitted))}finally{setBusy(false)}
 };
 return <section>
  <p className="local-warning">使用当前选择的本机微信网页登录态读取；能否获取目录取决于平台权限。这里保留原有采集流程。</p>
  <p>粘贴该博主发布的一篇文章。系统按文章中的发布账号标识读取作品，不搜索提及博主的内容。</p>
  <label className="field"><span>公众号原文链接</span><input disabled={busy} value={input} placeholder="https://mp.weixin.qq.com/s/…" onChange={e=>{invalidate();setInput(e.target.value)}}/></label>
  <div className="button-row"><label>最多获取篇数<input aria-label="最多获取篇数" disabled={busy} type="number" min="1" step="1" value={limit} placeholder="不限定" onChange={e=>{invalidate();setLimit(e.target.value)}}/></label><label>开始日期<input disabled={busy} aria-label="公众号开始日期" type="date" value={since} onChange={e=>{invalidate();setSince(e.target.value)}}/></label><label>结束日期<input disabled={busy} aria-label="公众号结束日期" type="date" value={until} onChange={e=>{invalidate();setUntil(e.target.value)}}/></label></div>
  <p className="muted">不填范围时，发现第 31 篇会暂停，请你确认是否继续全部获取。日期范围按发布时间筛选；数量按符合条件的文章计算。</p>
  <div className="button-row"><button className="primary" disabled={busy||!input.trim()} onClick={()=>void load(true)}>识别账号并获取列表</button>{busy&&<button onClick={()=>{stopped.current=true}}>暂停读取</button>}{result&&!result.done&&!result.needs_confirmation&&!busy&&<button onClick={()=>void load()}>继续读取原范围</button>}</div>
  {busy&&<p aria-live="polite"><RefreshCw size={16} className="spin"/> 正在读取；已获得 {result?.items?.length||0} 篇，发布记录 {result?.offset||0} / {result?.total_records??'待确认'}</p>}
  {error&&<p className="form-error">{error}</p>}
  {result&&<><div className="discovery-result"><strong>发布账号：{result.account.name}</strong><p>账号标识：{result.account.biz}</p><strong>已获取 {result.items.length} 篇 · {result.coverage}</strong><p>{result.note}</p>{result.unknown_dates>0&&<p>有 {result.unknown_dates} 篇日期未知，未纳入日期筛选。</p>}</div>
  {result.needs_confirmation&&<div className="local-warning" role="alert"><strong>该账号文章超过 30 篇，请确认查找范围</strong><p>当前只显示前 30 篇。你可以修改上方数量或日期后重新获取，也可以继续读取该账号的全部可访问发布记录。</p><button className="primary" disabled={busy} onClick={()=>void load(false,true)}>确认获取全部，继续读取</button></div>}
  <div className="button-row"><button disabled={busy} onClick={()=>setSelected(result.items.map((x:any)=>x.url))}>全选已获取 {result.items.length} 篇</button><button disabled={busy} onClick={()=>setSelected([])}>清空选择</button></div>
  <div className="discovery-list">{result.items.map((item:any)=><label className="discovery-entry" key={item.key}><input disabled={busy} type="checkbox" checked={selected.includes(item.url)} onChange={e=>setSelected(e.target.checked?[...selected,item.url]:selected.filter(x=>x!==item.url))}/><span><strong>{item.title}</strong><small>{item.author} · {item.published||'日期未知'}</small></span></label>)}</div>
  <button className="primary" disabled={busy||!selected.length} onClick={()=>void save()}>采集所选 {selected.length} 篇正文</button></>}
  {notice&&<p className="local-warning">{notice}</p>}
 </section>
}
