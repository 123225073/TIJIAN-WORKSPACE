import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GlobalSearch from '../src/GlobalSearch';
import {HotlistBoards} from '../src/RadarSources';
const failed={id:'board-rednote',kind:'hotlist',title:'小红书',platform:'rednote',items:[{title:'09/18旧榜线索',url:'https://example.com/old',rank:1,heat:'12',body:''}],fetched_at:'2026-09-18T00:00:00Z',last_attempt_at:'2026-09-18T00:05:00Z',error:'此平台本次更新失败；保留上次榜单',attempts:[{url:'https://60s.crystelf.top/v2/rednote',status:'failed',error:'HTTP 500'}]};
const fresh={id:'board-douyin',kind:'hotlist',title:'抖音',platform:'douyin',items:[{title:'当天榜单线索',url:'https://example.com/current',rank:1,heat:'20',body:''}],fetched_at:new Date().toISOString(),upstream_at:new Date().toISOString(),provider:'60s公开热榜',provider_url:'https://60s.crystelf.top/v2/douyin'};
function Fixture(){
 const [open,setOpen]=useState(true),[route,setRoute]=useState(''),[message,setMessage]=useState('');
 const t={list:(kind:string)=>kind==='hotlist'?[failed,fresh]:[],action:async(fn:()=>Promise<unknown>)=>{await fn();setMessage('已提交更新')}};
 return <><button onClick={()=>setOpen(true)}>打开搜索</button><output aria-label="导航结果">{route}</output><output aria-label="热榜操作">{message}</output>
 <HotlistBoards t={t} onRead={row=>setMessage(row.title)}/>
 {open&&<GlobalSearch onClose={()=>setOpen(false)} onNavigate={value=>setRoute(value)}/>}</>
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
