import {useEffect,useState} from 'react';
import {api} from './api';
import {fullTime} from './AcquisitionMeta';
export function SubscriptionStatus({account,t,tab='saved'}:any){
 const [state,setState]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;const read=()=>api('/weread/status/'+account.id).then(d=>{if(live){setState(d);setError('')}}).catch(e=>live&&setError(e.message));void read();const timer=setInterval(read,5000);return()=>{live=false;clearInterval(timer)}},[account.id]);
 const sub=state?.subscription,job=t.list('job').find((j:any)=>j.input?.benchmark_id===account.id&&j.input?.action==='weread_sync'&&['queued','running'].includes(j.status));
 const label=error?'状态读取失败':!state?'读取状态…':state.error?'需要重新登录':!state.configured?'尚未连接':!sub?'未开启订阅':!sub.enabled?'订阅已暂停':job?'正在检查':sub.error?'检查异常':sub.mode==='latest'?'仅能发现最新一篇':sub.last_success?'订阅运行中':'等待首次检查';
 const paid=t.list('wechat_subscription').find((x:any)=>x.benchmark_id===account.id);
 return <section className="connection-summary" aria-label="对标连接状态"><div><strong>微信读书 <span className={'status-pill '+(state?.error||sub?.error||error?'warning':'')}>{label}</span></strong><small>最近成功：{fullTime(sub?.last_success)}{sub?.enabled&&!state?.error&&sub.next_check?' · 下次检查：'+fullTime(new Date(sub.next_check*1000).toISOString()):''}</small>{(state?.error||sub?.error||error)&&<small className="form-error">{state?.error||sub?.error||error}</small>}{sub?.mode==='latest'&&<small>当前来源覆盖有限，多篇更新可能遗漏。</small>}{paid?.enabled&&<small>付费定时查询已开启 · {paid.error||'按设置的频率和预算执行'}</small>}</div><div className="button-row">{sub&&<button disabled={!!job||!!state?.error||!state?.configured} onClick={()=>t.action(()=>api('/weread/check/'+account.id,{}),'已提交免费检查')}>{job?'正在免费检查…':'立即免费检查'}</button>}<a className="settings-link" href={'#settings/benchmark/'+account.id+'/'+tab}>{state?.error?'重新登录 / 配置':'连接与订阅设置'} →</a></div></section>
}
