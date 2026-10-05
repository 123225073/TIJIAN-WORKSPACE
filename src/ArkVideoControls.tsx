import './ark-video.css';

const modes:Record<string,string>={text:'文字生视频',reference:'多素材参考',first_frame:'首帧生视频',first_last_frame:'首尾帧',edit:'编辑视频',extend:'延长视频'};
export default function ArkVideoControls({draft,model,update,changeOptions,busy}:{draft:any;model:any;update:(v:any)=>void;changeOptions:(k:string,v:any)=>void;busy:boolean}){
 const mode=draft.inputs.reference_mode||'reference',opts=draft.options||{},latest=model?.family==='seedance-2.5';
 const locked=latest&&['first_frame','first_last_frame','edit','extend'].includes(mode);
 const max=model?.reference_limits?.duration||30,available=model?.options||{};
 const setMode=(next:string)=>{update({reference_mode:next});if(latest&&['first_frame','first_last_frame','edit','extend'].includes(next))changeOptions('ratio','adaptive');if(next==='edit')changeOptions('duration',-1)};
 const toggle=(key:string,label:string,defaultValue=false)=><label className="ark-toggle"><input type="checkbox" disabled={busy} checked={opts[key]??defaultValue} onChange={e=>changeOptions(key,e.target.checked)}/>{label}</label>;
 return <section className="ark-controls" aria-label="方舟视频创作设置">
  <div className="ark-section-label"><strong>创作方式</strong><span>官方 Seedance</span></div>
  {draft.inputs.draft_run?<div className="ark-sample-note">基于已确认样片生成正式视频，镜头与声音沿用样片。<button type="button" onClick={()=>update({draft_run:''})}>退出样片模式</button></div>:<div className="ark-modes">{(model?.modes||Object.keys(modes)).map((m:string)=><button key={m} type="button" disabled={busy} aria-pressed={m===mode} onClick={()=>setMode(m)}>{modes[m]}</button>)}</div>}
  <div className="ark-basic-grid">
   <label>分辨率<select aria-label="视频分辨率" disabled={busy||opts.draft} value={opts.draft?'480p':opts.resolution||'720p'} onChange={e=>changeOptions('resolution',e.target.value)}>{(available.resolution||['480p','720p','1080p']).map((v:string)=><option key={v}>{v}</option>)}</select></label>
   {!draft.inputs.draft_run&&<><label>画面比例<select aria-label="视频画面比例" disabled={busy||locked} value={locked?'adaptive':opts.ratio||'adaptive'} onChange={e=>changeOptions('ratio',e.target.value)}>{(available.ratio||['adaptive']).map((v:string)=><option key={v} value={v}>{v==='adaptive'?'自动适配素材':v}</option>)}</select></label>
   <label>时长<select aria-label="视频时长" disabled={busy||mode==='edit'} value={mode==='edit'?-1:opts.duration??-1} onChange={e=>changeOptions('duration',Number(e.target.value))}><option value={-1}>智能选择</option>{Array.from({length:max-3},(_,i)=>i+4).map(v=><option key={v} value={v}>{v} 秒</option>)}</select></label>
   <label>声音<select aria-label="视频生成声音" disabled={busy} value={String(opts.generate_audio??true)} onChange={e=>changeOptions('generate_audio',e.target.value==='true')}><option value="true">同步生成声音</option><option value="false">无声视频</option></select></label></>}
  </div>
  {locked&&<p>保持首帧或原视频的画面比例。{mode==='edit'?'编辑视频同时保持原片时长。':''}</p>}
  {!draft.inputs.draft_run&&latest&&<label className="ark-toggle"><input type="checkbox" disabled={busy} checked={!!opts.draft} onChange={e=>{changeOptions('draft',e.target.checked);if(e.target.checked)changeOptions('resolution','480p')}}/>先生成480p样片，确认后再生成正式视频</label>}
  {opts.draft&&<p>样片和正式视频为两次独立任务，按官方用量分别计费。</p>}
  <details className="ark-advanced"><summary>更多设置</summary><div className="ark-basic-grid">
   {latest&&<label>文件格式<select aria-label="视频文件格式" disabled={busy} value={opts.output_format||'mp4'} onChange={e=>changeOptions('output_format',e.target.value)}><option value="mp4">MP4 · 通用格式</option><option value="mov">MOV · 后期制作</option></select></label>}
   <label>排队优先级<input aria-label="视频排队优先级" disabled={busy} type="number" min={0} max={9} value={opts.priority??0} onChange={e=>changeOptions('priority',Number(e.target.value))}/></label>
   <label>任务有效期（小时）<input aria-label="视频任务有效期" disabled={busy} type="number" min={1} max={72} value={(opts.execution_expires_after??172800)/3600} onChange={e=>changeOptions('execution_expires_after',Number(e.target.value)*3600)}/></label>
  </div><div className="ark-toggles">{toggle('watermark','添加水印')}{toggle('return_last_frame','保存尾帧，供连续镜头使用')}{!draft.inputs.draft_run&&toggle('web_search','联网搜索辅助生成')}</div>
  <label className="ark-callback">状态回调（可选）<input aria-label="视频任务回调地址" disabled={busy} type="url" placeholder="https://你的服务地址；本工具会自动查询任务状态" value={opts.callback_url||''} onChange={e=>changeOptions('callback_url',e.target.value||undefined)}/></label>
  <p>1080p MP4、4K或MOV可能需要支持对应编码的播放器；原文件可下载用于后期。</p></details>
 </section>;
}
