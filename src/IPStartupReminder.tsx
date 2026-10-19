import {useState} from 'react';
import {UserRound} from 'lucide-react';

/** Dismissal lasts only for this app opening and this signed-in workspace. */
export default function IPStartupReminder({t}:{t:any}){
 const [dismissed,setDismissed]=useState(false);
 const ready=t.state?.complete!==false;
 const completed=(t.list?.('profile')||[]).some((p:any)=>!p.archived&&p.status==='accepted');
 if(!ready||completed||dismissed)return null;
 return <div className="st-modal-backdrop"><section className="st-interview ip-startup-reminder" role="dialog" aria-modal="true" aria-labelledby="ip-startup-title">
  <UserRound size={30}/><h2 id="ip-startup-title">先让梯世界认识你</h2>
  <p>完成个人 IP 定位，后续选题、文章和视频才能围绕你的客户与业务来创作。</p>
  <p>回答 12 个简单问题，不清楚的可以先跳过。进度会保存，随时回来继续。</p>
  <div className="st-inline"><button className="st-primary" onClick={()=>{setDismissed(true);location.hash='studio/brand?interview=1'}}>开始 IP 定位</button><button onClick={()=>setDismissed(true)}>稍后再做</button></div>
 </section></div>;
}
