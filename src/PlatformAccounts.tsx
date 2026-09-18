import {useEffect,useRef,useState} from 'react';
import {Plus,RefreshCw,ExternalLink,ShieldCheck,LogOut} from 'lucide-react';
import platforms from '../desktop/platforms.json';
import {api,type Item} from './api';
type LoginState={code:string;status:string;detail:string;lastVerified?:number;windowOpen?:boolean;persistenceWarning?:string};
export function PlatformAccounts(t:any){
 const [states,setStates]=useState<Record<string,LoginState>>({}),[busy,setBusy]=useState<Record<string,string>>({});
 const active=useRef(new Set<string>()),epochs=useRef<Record<string,number>>({});
 const accounts:Item[]=t.list('channel'),ids=accounts.map(x=>x.id).join('|');
 const fields=[{key:'title',label:'账号名称',required:true},{key:'platform',label:'平台',options:platforms}];
 const request=(id:string,action:string)=>{const bridge=(window as any).tijianDesktop;if(!bridge)throw Error('请在桌面软件中使用平台登录');return bridge.platformAccount({id,action,token:sessionStorage.getItem('tijian-session')})};
 useEffect(()=>{
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   await Promise.all(accounts.map(async x=>{
    if(active.current.has(x.id))return;
    const epoch=epochs.current[x.id]||0;
    try{const r=await request(x.id,'status');if(!cancelled&&!active.current.has(x.id)&&epoch===(epochs.current[x.id]||0))setStates(v=>({...v,[x.id]:r}))}
    catch{if(!cancelled&&!active.current.has(x.id)&&epoch===(epochs.current[x.id]||0))setStates(v=>({...v,[x.id]:{code:'error',status:'检查未完成',detail:'无法检查登录状态，请重试；已有平台登录资料保留'}}))}
   }));
   if(!cancelled)timer=setTimeout(poll,5000);
  };
  void poll();return()=>{cancelled=true;clearTimeout(timer)};
 },[ids]);
 const operate=(x:Item,action:string)=>{
  if(active.current.has(x.id))return;
  if(action==='logout'&&!window.confirm('退出“'+x.title+'”的平台登录？会关闭此账号的登录、阅读和授权窗口，并清除本机登录资料。'))return;
  active.current.add(x.id);epochs.current[x.id]=(epochs.current[x.id]||0)+1;setBusy(v=>({...v,[x.id]:action}));
  t.action(async()=>{try{const r=await request(x.id,action);setStates(v=>({...v,[x.id]:r}))}finally{active.current.delete(x.id);setBusy(v=>({...v,[x.id]:''}))}},'');
 };
 return <section className="accounts-page">
  <header className={t.embedded?'accounts-toolbar':'page-heading'}><div>{!t.embedded&&<><div className="eyebrow">CONNECTED ACCOUNTS</div><h1>平台账号</h1></>}<p>管理自己的运营账号，共 {accounts.length} 个。每个账号独立保存登录资料。</p></div><button className="primary" onClick={()=>t.newItem('channel','添加平台账号',fields)}><Plus size={16}/>添加账号</button></header>
  <div className="accounts-summary"><ShieldCheck size={18}/><span>登录资料保存在本机 · 授权在平台页面完成</span><small>状态每 5 秒更新</small></div>
  <div className="account-grid">{accounts.map(x=>{
   const s=states[x.id],working=!!busy[x.id],label=platforms.find(p=>p.value===x.platform)?.label||x.platform;
   return <article className="account-card" key={x.id}>
    <header><div className="platform-monogram" aria-hidden="true">{label?.slice(0,1)}</div><div><small>{label}</small><h2>{x.title}</h2></div><span className={'connection-state '+(working?'checking':s?.code||'checking')}>{working?'处理中':s?.status||'正在检查'}</span></header>
    <div className="account-state-detail" aria-live="polite"><p>{working?'正在处理，请稍候…':s?.detail||'正在读取本机账号状态'}</p>{s?.lastVerified&&<small>最近验证：{new Date(s.lastVerified).toLocaleString('zh-CN')}</small>}{s?.persistenceWarning&&<p className="form-error">{s.persistenceWarning}</p>}</div>
    <div className="account-primary-actions"><button className="primary" disabled={working} onClick={()=>operate(x,'open')}><ExternalLink size={15}/>{s?.windowOpen?'返回平台窗口':'打开平台'}</button><button disabled={working} onClick={()=>operate(x,'check')}><RefreshCw size={15} className={working?'spin':''}/>检查状态</button>{s?.code==='error'&&<button disabled={working} onClick={()=>operate(x,'retry')}>重新加载</button>}</div>
    <footer><button className="text-button" disabled={working} onClick={()=>t.editItem(x,[fields[0]])}>编辑名称</button><button className="text-button" disabled={working} onClick={()=>t.action(()=>api('/objects/'+x.id+'/trash',{}),'已移入回收站；本地登录资料保留，可恢复账号')}>移入回收站</button><button className="text-button" disabled={working} onClick={()=>operate(x,'logout')}><LogOut size={13}/>退出登录</button></footer>
   </article>;
  })}</div>
  {!accounts.length&&<div className="surface"><h2>连接第一个运营账号</h2><p>添加账号后打开平台，使用平台提供的扫码或验证码登录。</p></div>}
  <p className="account-help">“上次已登录”表示窗口已关闭，保留最近验证时间；“尚未确认”表示缺少可靠的页面标识，不代表登录失败。平台要求重新验证时才需要再次扫码。微博可使用微博 App 扫码或手机号验证码；微信授权加载失败时也可切换这两种方式。</p>
 </section>;
}
