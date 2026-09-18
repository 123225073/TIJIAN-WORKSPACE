import {useEffect,useState} from 'react';
import {api} from './api';
import {fullTime} from './AcquisitionMeta';
import './library.css';

export function MemorySettings(t:any){
 const [data,setData]=useState<any>(null),[settings,setSettings]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{const d=await api('/synthesis');setData(d);setSettings((v:any)=>v||d.settings)}catch(e){setError((e as Error).message)}};
 useEffect(()=>{void load();const timer=setInterval(load,5000);return()=>clearInterval(timer)},[]);
 const run=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn();await load();await t.refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 if(!settings)return <p>{error||'正在读取整理设置…'}</p>;
 const active=data?.jobs?.find((j:any)=>['queued','running'].includes(j.status));
 return <section className="surface memory-settings"><h2>让积累每天往前一步</h2><p>原始资料导入即可提问。夜间把新增资料整理成 Wiki，把对话中你明确表达的偏好整理成个人记忆。普通结果自动保存，冲突或不确定事项进入“需核对”。</p>
  <label className="memory-switch"><span><strong>自动整理 Wiki</strong><small>只处理新增或变化的原始资料，保留来源与版本</small></span><input type="checkbox" checked={settings.auto_wiki} onChange={e=>setSettings({...settings,auto_wiki:e.target.checked})}/></label>
  <label className="memory-switch"><span><strong>自动整理对话记忆</strong><small>提取用户发言，不把助手建议和假设角色变成你的事实</small></span><input type="checkbox" checked={settings.auto_memory} onChange={e=>setSettings({...settings,auto_memory:e.target.checked})}/></label>
  <div className="memory-fields"><label className="field"><span>每天运行时间（北京时间）</span><input type="time" value={settings.time} onChange={e=>setSettings({...settings,time:e.target.value})}/></label><label className="field"><span>整理专用模型</span><select value={settings.model_id} onChange={e=>setSettings({...settings,model_id:e.target.value})}><option value="">使用知识整理默认模型</option>{t.state.models.filter((m:any)=>m.capability==='text').map((m:any)=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label className="field"><span>每次最多调用模型</span><input type="number" min={1} max={100} value={settings.max_calls} onChange={e=>setSettings({...settings,max_calls:Number(e.target.value)})}/><small>剩余资料下次继续；失败段可重试</small></label></div>
  <label className="memory-switch"><span><strong>AI 辅助搜索</strong><small>提问时增加一次同义词扩展；失败时自动使用本地关键词搜索</small></span><input type="checkbox" checked={settings.ai_search} onChange={e=>setSettings({...settings,ai_search:e.target.checked})}/></label>
  <p className="candidate-notice">工作台运行且电脑唤醒时执行；错过时间会在下次启动后补跑最近一次。模型会读取待整理内容，使用你配置服务的额度；可随时关闭。初次启用从下一个设定时间开始。</p>
  {error&&<p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="primary" disabled={busy} onClick={()=>void run(async()=>{const saved=await api('/synthesis/settings',Object.fromEntries(Object.entries(settings).filter(([k])=>k!=='enabled_at')));setSettings(saved);t.setToast('已保存夜间整理设置')})}>保存整理设置</button><button disabled={busy||!!active} onClick={()=>void run(async()=>{const j=await api('/synthesis/run',{});location.hash='knowledge/job/'+j.id})}>立即整理新增内容</button><a href="#knowledge/memory">管理个人记忆 →</a></div>
  <h3>最近整理记录</h3>{data?.schedule?.error&&<p role="alert">定时运行未开始：{data.schedule.error}</p>}{data?.jobs?.map((j:any)=><div className="memory-run" key={j.id}><span><strong>{j.error||j.result?.summary||j.progress}</strong><small>{fullTime(j.created)} · {j.input?.trigger==='nightly'?'定时整理':'手动整理'}</small></span><a href={'#knowledge/job/'+j.id}>查看结果 →</a></div>)}{!data?.jobs?.length&&<p className="muted">尚未运行。首次整理可点击“立即整理新增内容”。</p>}
 </section>
}
