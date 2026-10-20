import './ark-video.css';
import {videoModes} from './video-inputs';

export default function ArkVideoControls({draft,model,update,changeOptions,busy,section='main'}:{draft:any;model:any;update:(v:any)=>void;changeOptions:(k:string,v:any)=>void;busy:boolean;section?:'main'|'settings'}){
 const mode=draft.inputs.reference_mode||'reference',opts=draft.options||{},latest=model?.family==='seedance-2.5';
 const locked=latest&&['first_frame','first_last_frame','edit','extend'].includes(mode);
 const available=model?.options||{},supported=model?.modes||['text','reference','first_frame','first_last_frame'];
 const setMode=(next:string)=>{update({reference_mode:next,...(next!==mode&&!(['first_frame','first_last_frame'].includes(mode)&&['first_frame','first_last_frame'].includes(next))?{frame_slots:undefined}:{})});if(latest&&['first_frame','first_last_frame','edit','extend'].includes(next))changeOptions('ratio','adaptive');if(next==='edit')changeOptions('duration',-1)};
 const toggle=(key:string,label:string,defaultValue=false)=><label className="ark-toggle"><input type="checkbox" disabled={busy} checked={opts[key]??defaultValue} onChange={e=>changeOptions(key,e.target.checked)}/>{label}</label>;
 const modeButton=(m:string)=><button key={m} type="button" disabled={busy} aria-pressed={m===mode} onClick={()=>setMode(m)}>{videoModes[m]?.label||m}</button>;
 if(section==='main')return <section className="ark-controls video-simple-controls" aria-label="视频创作方式与输出">
  {draft.inputs.draft_run?<div className="ark-sample-note">沿用样片的镜头与声音，生成正式视频。<button type="button" disabled={busy} onClick={()=>update({draft_run:''})}>退出样片模式</button></div>:<>
   <div className="ark-section-label"><strong>想做什么</strong></div>
   <div className="ark-modes">{['text','first_frame','first_last_frame','reference'].filter(m=>supported.includes(m)).map(modeButton)}</div>
   {supported.some((m:string)=>['edit','extend'].includes(m))&&<details className="video-existing-modes" open={['edit','extend'].includes(mode)||undefined}><summary>修改已有视频{['edit','extend'].includes(mode)?' · '+videoModes[mode].label:''}</summary><div className="ark-modes">{supported.filter((m:string)=>['edit','extend'].includes(m)).map(modeButton)}</div></details>}
   <p className="video-mode-hint">{videoModes[mode]?.hint}</p>
   <div className="ark-basic-grid">
    <label>画面比例<select aria-label="视频画面比例" disabled={busy||locked} value={locked?'adaptive':opts.ratio||'adaptive'} onChange={e=>changeOptions('ratio',e.target.value)}>{(available.ratio||['adaptive']).map((v:string)=><option key={v} value={v}>{({adaptive:'自动适配', '9:16':'竖屏 · 9:16','16:9':'横屏 · 16:9','1:1':'方形 · 1:1'} as Record<string,string>)[v]||v}</option>)}</select></label>
    <label>时长<select aria-label="视频时长" disabled={busy||mode==='edit'} value={mode==='edit'?-1:opts.duration??-1} onChange={e=>changeOptions('duration',Number(e.target.value))}>{(available.duration||[-1]).map((v:number)=><option key={v} value={v}>{v===-1?'智能选择':v+' 秒'}</option>)}</select></label>
   </div>{locked&&<p>保持首帧或原视频比例。{mode==='edit'?'时长沿用原片。':''}</p>}
  </>}
  {opts.draft&&<p>当前为样片模式；样片与正式视频分别计费。</p>}
 </section>;
 return <section className="ark-controls video-detail-controls" aria-label="视频模型参数">
  <div className="ark-basic-grid">
   <label>分辨率<select aria-label="视频分辨率" disabled={busy||opts.draft} value={opts.draft?'480p':opts.resolution||'720p'} onChange={e=>changeOptions('resolution',e.target.value)}>{(available.resolution||[]).map((v:string)=><option key={v}>{v}</option>)}</select></label>
   {!draft.inputs.draft_run&&<label>声音<select aria-label="视频生成声音" disabled={busy} value={String(opts.generate_audio??true)} onChange={e=>changeOptions('generate_audio',e.target.value==='true')}><option value="true">同步生成声音</option><option value="false">无声视频</option></select></label>}
   {latest&&<label>文件格式<select aria-label="视频文件格式" disabled={busy} value={opts.output_format||'mp4'} onChange={e=>changeOptions('output_format',e.target.value)}>{(available.output_format||['mp4']).map((v:string)=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>}
  </div>
  {!draft.inputs.draft_run&&latest&&<label className="ark-toggle"><input type="checkbox" disabled={busy} checked={!!opts.draft} onChange={e=>{changeOptions('draft',e.target.checked);if(e.target.checked)changeOptions('resolution','480p')}}/>先生成480p样片，确认后再生成正式视频</label>}
  {opts.draft&&<p>样片和正式视频为两次独立任务，按官方用量分别计费。</p>}
  <details className="ark-advanced"><summary>高级参数</summary><div className="ark-basic-grid">
   <label>排队优先级<input aria-label="视频排队优先级" disabled={busy} type="number" min={0} max={9} value={opts.priority??0} onChange={e=>changeOptions('priority',Number(e.target.value))}/></label>
   <label>任务有效期（小时）<input aria-label="视频任务有效期" disabled={busy} type="number" min={1} max={72} value={(opts.execution_expires_after??172800)/3600} onChange={e=>changeOptions('execution_expires_after',Number(e.target.value)*3600)}/></label>
  </div><div className="ark-toggles">{toggle('watermark','添加水印')}{toggle('return_last_frame','保存尾帧，供连续镜头使用')}{!draft.inputs.draft_run&&toggle('web_search','联网搜索辅助生成')}</div>
  <label className="ark-callback">状态回调（可选）<input aria-label="视频任务回调地址" disabled={busy} type="url" placeholder="https://你的服务地址；本工具会自动查询任务状态" value={opts.callback_url||''} onChange={e=>changeOptions('callback_url',e.target.value||undefined)}/></label>
  </details>
 </section>;
}
