import {useEffect,useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {api} from './api';
import './outcome-handoff.css';

const labels:Record<string,string>={wechat:'公众号',channels:'视频号',douyin:'抖音'};
export default function OutcomeHandoff({content,task,platform,save,disabled,t,onBusy}:any){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[links,setLinks]=useState<any[]>([]);
 const lock=useRef(false),path='/tasks/'+task.id+'/outcomes/'+content.id;
 useEffect(()=>{let live=true;void api(path+'/handoffs').then(r=>{if(live)setLinks(r.items||[])}).catch(()=>{});return()=>{live=false}},[path,content.version]);
 if(!labels[platform])return null;
 const transfer=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const saved=await save();
   if(!saved||!Number.isInteger(saved.version))throw Error('未能确认保存版本，请核对文稿后再继续');
   const result=await api(path+'/handoff',{version:saved.version});
   try{await t.refresh()}catch{/* The committed handoff and route are authoritative. */}
   location.hash=result.route;
  }catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false);onBusy(false)}
 };
 return <section className="aw-handoff" aria-label="使用工作成果">
  <div><strong>下一步：{labels[platform]}平台准备</strong><p>保存当前稿件，将标题、正文、摘要和已选封面带入一站式创作，继续核对发布稿。</p><small>每个已保存版本生成独立作品；再次点击同一版本会打开原作品。后续编辑各自保存。</small></div>
  <button className="primary" disabled={disabled||busy} onClick={()=>void transfer()}>{busy?'正在带入…':'保存并进入平台准备'}<ArrowRight size={15}/></button>
  {!!links.length&&<details><summary>已带入的作品 · {links.length}</summary>{links.map(link=><a key={link.id} href={'#studio/flow?work='+encodeURIComponent(link.id)+'&step=4'}>文稿 v{link.source_version} · {link.brief} →</a>)}</details>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
