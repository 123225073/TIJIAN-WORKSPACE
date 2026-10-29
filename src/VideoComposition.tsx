import {useEffect,useState} from 'react';
import {ChevronDown,Download,Layers3} from 'lucide-react';
import {api,getToken} from './api';
import {assetUrl,Media,type Asset} from './ResourcePreview';
import './video-composition.css';

type Settings={style:string;title:string;srt:string;position:string;title_duration:string};
const defaults:Settings={style:'clean',title:'',srt:'',position:'bottom',title_duration:'3'};
const templates=[['clean','简洁白','纯净标题'],['blue','行业蓝','蓝色标题牌'],['gold','暖金','金色重点字']];
const clock=(s:string)=>{const m=s.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN};
function captionAt(srt:string,time:number){
 for(const block of srt.replace(/\r/g,'').split(/\n\s*\n/)){
  const lines=block.trim().split('\n');if(/^\d+$/.test(lines[0]||''))lines.shift();
  const times=(lines.shift()||'').split('-->');if(times.length===2&&time>=clock(times[0])&&time<clock(times[1]))return lines.join(' ').trim();
 }return '';
}
export default function VideoComposition({asset,onSaved,onDownload,onUse,onOpenStudio}:{asset:Asset;onSaved:(a:Asset)=>void;onDownload:(a:Asset)=>void;onUse?:(a:Asset)=>void;onOpenStudio?:()=>void}){
 const key='tijian-video-composition:'+asset.id;
 const [settings,setSettings]=useState<Settings>(()=>{try{const saved={...defaults,...JSON.parse(localStorage.getItem(key)||'{}')};return {...saved,title_duration:['3','5','8','full'].includes(saved.title_duration)?saved.title_duration:'3'}}catch{return defaults}});
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Asset|null>(null),[url,setUrl]=useState(''),[time,setTime]=useState(0);
 useEffect(()=>{localStorage.setItem(key,JSON.stringify(settings))},[key,settings]);
 useEffect(()=>{if(!open)return;let object='',live=true;const controller=new AbortController(),source=assetUrl(asset);
  if(!source)return;if(!source.startsWith('/api/')){setUrl(source);return}
  fetch(source,{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('视频预览不可用');object=URL.createObjectURL(await r.blob());if(live)setUrl(object);else URL.revokeObjectURL(object)}).catch(e=>{if(live&&e.name!=='AbortError')setError('视频预览不可用，请重试')});
  return()=>{live=false;controller.abort();if(object)URL.revokeObjectURL(object)};
 },[open,asset.id]);
 const set=(value:Partial<Settings>)=>setSettings(old=>({...old,...value}));
 const previewCaption=captionAt(settings.srt,time),wrappedCaption=previewCaption.length>18?previewCaption.slice(0,18)+'\n'+previewCaption.slice(18):previewCaption;
 const showTitle=!!settings.title.trim()&&(settings.title_duration==='full'||time<Number(settings.title_duration));
 const submit=async()=>{setError('');setBusy(true);try{const saved=await api<Asset>('/studio/assets/'+encodeURIComponent(asset.id)+'/compose-video',settings);setResult(saved);onSaved(saved)}catch(e){setError(e instanceof Error?e.message:'合成失败，原视频已保留')}finally{setBusy(false)}};
 return <section className="vc-panel" aria-label="数字人视频模板合成">
  <button type="button" className="vc-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><span><Layers3 size={17}/><strong>模板与字幕合成</strong><small>为这段视频添加标题和字幕</small></span><ChevronDown size={17} className={open?'vc-open':''}/></button>
  {open&&<div className="vc-body">
   {onOpenStudio&&<div className="st-alert"><strong>制作完整视频</strong><p>在视频剪辑中自动生成字幕，添加可拖动片头、补充画面与背景音乐，并实时预览。</p><button type="button" className="st-primary" onClick={onOpenStudio}>打开视频剪辑 →</button></div>}
   <p>片头标题叠加在视频画面上，默认显示前 3 秒；字幕按时间轴显示。合成后另存新视频，原视频仍可放大和下载。</p>
   <div className="vc-templates" role="group" aria-label="选择片头模板">{templates.map(([id,name,desc])=><button type="button" className={'vc-template '+id+(settings.style===id?' selected':'')} aria-pressed={settings.style===id} key={id} onClick={()=>set({style:id})}><span className="vc-template-preview"><span className="vc-template-mark"/><b>行业观点</b><i>这里是字幕</i></span><strong>{name}</strong><small>{desc}</small></button>)}</div>
   <label className="vc-field"><span>片头标题 <small>可留空 · 最多 28 字</small></span><input aria-label="片头标题" maxLength={28} value={settings.title} onChange={e=>set({title:e.target.value})} placeholder="输入视频开头显示的短标题"/></label>
   <label className="vc-field vc-duration"><span>标题显示时长 <small>从视频开始计算，不影响字幕</small></span><select aria-label="标题显示时长" value={settings.title_duration} onChange={e=>set({title_duration:e.target.value})}><option value="3">前 3 秒（推荐）</option><option value="5">前 5 秒</option><option value="8">前 8 秒</option><option value="full">整段显示</option></select><small>视频短于所选时长时，显示到视频结束。</small></label>
   <label className="vc-field"><span>字幕位置</span><select value={settings.position} onChange={e=>set({position:e.target.value})}><option value="bottom">画面下方（默认）</option><option value="upper">画面上方</option></select></label>
   <details className="vc-field"><summary>已有 SRT 字幕（可选）</summary><p>已有字幕可在此导入；自动识别和 AI 校对请使用“视频剪辑”。若原视频已有字幕，可留空避免重叠。</p><label className="vc-upload">导入 SRT 文件<input type="file" accept=".srt,text/plain" onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>100000){setError('字幕文件不能超过 100 KB')}else void file.text().then(srt=>{set({srt});setError('')}).catch(()=>setError('字幕文件读取失败'))}e.target.value=''}}/></label><textarea rows={6} value={settings.srt} onChange={e=>set({srt:e.target.value})}/><small>每条最多 36 字；按时间顺序排列，字幕时间不能交叠。</small></details>
   <div className="vc-preview"><div className="vc-preview-head"><strong>合成预览</strong><small>播放检查片头与字幕；成片以实际导出为准</small></div>{url?<><div className="vc-stage" style={{aspectRatio:`${asset.width||9} / ${asset.height||16}`,maxWidth:Math.min(300,390*(asset.width||9)/(asset.height||16))}}><video src={url} controls preload="metadata" onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onSeeked={e=>setTime(e.currentTarget.currentTime)}/>{showTitle&&<div className={'vc-title '+settings.style}>{settings.title}</div>}{previewCaption&&<div className={'vc-caption '+settings.position}>{wrappedCaption}</div>}</div>{settings.title.trim()&&!showTitle&&<p className="vc-preview-note">当前已过片头，拖动进度回到开头可查看标题。</p>}</>:<p>正在读取视频…</p>}</div>
   {error&&<p className="st-alert" role="alert">{error}</p>}<button type="button" className="st-primary vc-submit" disabled={busy} onClick={()=>void submit()}>{busy?'正在本机合成，请稍候…':'合成并保存新视频'}</button><small>本机处理，不调用付费合成服务；视频较长时需要等待。</small>
   {result&&<div className="vc-result"><strong>合成完成</strong><Media asset={result}/><div className="st-inline"><button onClick={()=>onDownload(result)}><Download size={14}/>下载成片</button>{onUse&&<button className="st-primary" onClick={()=>onUse(result)}>使用此成片并返回</button>}</div></div>}
  </div>}
 </section>;
}
