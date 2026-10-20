// Match the local Ark request contract; changing a mode never discards a user's files.
export const videoModes:Record<string,{label:string;hint:string}>={
 text:{label:'文字生视频',hint:'只需描述画面、动作和镜头，不使用参考素材。'},
 first_frame:{label:'首帧生视频',hint:'需要 1 张图片作为开场画面，再描述画面如何运动。'},
 first_last_frame:{label:'首尾帧',hint:'分别选择首帧（开场画面）和尾帧（结束画面），再描述两张画面之间如何过渡。'},
 reference:{label:'多素材参考',hint:'组合图片、视频或音频，描述各素材的用途；也可以先用文字构思。'},
 edit:{label:'编辑视频',hint:'需要原视频，描述要修改的部分；保持原片比例与时长。'},
 extend:{label:'延长视频',hint:'需要原视频，描述接下来发生什么；保持原片比例。'},
};
export const videoFrameKey=(ref:any)=>ref.id?'id:'+ref.id:'url:'+ref.url;
export function videoFrameRefs(inputs:any){
 const ids=inputs.image_ids?.length?inputs.image_ids:inputs.image_id?[inputs.image_id]:[];
 return [...ids.map((id:string)=>({id})),...(inputs.remote_references||[]).filter((r:any)=>r.kind==='image')];
}
export function videoFrameSlots(inputs:any):Record<string,string>{
 if(inputs.frame_slots)return inputs.frame_slots;
 const refs=videoFrameRefs(inputs);
 return {first_frame:refs[0]?videoFrameKey(refs[0]):'',last_frame:refs[1]?videoFrameKey(refs[1]):''};
}
export function videoReferenceCounts(inputs:any){
 return Object.fromEntries(['image','video','audio'].map(kind=>[kind,
  (inputs[kind+'_ids']?.length||(kind==='image'&&inputs.image_id?1:0))+
  (inputs.remote_references||[]).filter((r:any)=>r.kind===kind).length,
 ])) as Record<'image'|'video'|'audio',number>;
}
export function videoInputIssue(draft:any,model:any):string {
 if(model?.provider!=='ark'||draft.inputs.draft_run)return '';
 const input=draft.inputs,mode=input.reference_mode||'reference',n=videoReferenceCounts(input);
 if(model.modes&&!model.modes.includes(mode))return '当前模型不支持此创作方式，请重新选择。';
 if(model.family==='seedance-2.5'&&['first_frame','first_last_frame','edit','extend'].includes(mode)&&draft.options?.ratio&&draft.options.ratio!=='adaptive')return '旧草稿的比例与当前方式不一致，请重新点击当前创作方式，恢复按素材比例生成。';
 if(mode==='edit'&&draft.options?.duration!==undefined&&draft.options.duration!==-1)return '编辑视频需要沿用原片时长，请重新点击“编辑视频”恢复智能时长。';
 if(mode==='text'&&(n.image+n.video+n.audio))return '文字生视频不使用素材。已保留原素材，请移除选中素材，或改用多素材参考。';
 if(mode==='text'&&!input.prompt?.trim())return '请先描述你想做的画面。';
 if(['first_frame','first_last_frame'].includes(mode)){
  const required=mode==='first_frame'?1:2;
  const slots=videoFrameSlots(input),keys=videoFrameRefs(input).map(videoFrameKey);
  if(!slots.first_frame||!keys.includes(slots.first_frame))return '请添加首帧图片，作为视频的开场画面。';
  if(required===2&&(!slots.last_frame||!keys.includes(slots.last_frame)))return '请添加尾帧图片，作为视频的结束画面。';
  if(n.image!==required||n.video||n.audio)return `此方式需要 ${required} 张图片${required===2?'（按首帧、尾帧排列）':''}，不能混用视频或音频。已有素材保留，可在下方调整。`;
 }
 if(['edit','extend'].includes(mode)&&!n.video)return '请先加入需要编辑或延长的原视频。';
 if(model.family!=='seedance-2.5'&&n.audio&&!n.image&&!n.video)return '当前模型的音频参考需要同时加入图片或视频。';
 const limits=model.reference_limits||{};
 if((['image','video','audio'] as const).some(k=>n[k]>(limits[k]||0)))return '参考素材超过当前模型上限，请移除多余素材。';
 if(n.video&&!model.storage_ready&&input.video_ids?.length)return '本地视频参考需要管理员配置视频素材存储；草稿和素材已保留。';
 return '';
}
export function videoReferenceModel(draft:any,model:any){
 if(model?.provider!=='ark')return model;
 const mode=draft.inputs.reference_mode||'reference',counts=videoReferenceCounts(draft.inputs);
 const limits={...model.reference_limits};
 if(['text','first_frame','first_last_frame'].includes(mode)){
  for(const kind of ['image','video','audio']){
   const required=kind==='image'?(mode==='text'?0:mode==='first_frame'?1:2):0;
   // Existing incompatible selections remain visible and removable.
   limits[kind]=Math.max(Math.min(model.reference_limits?.[kind]||0,required),counts[kind as keyof typeof counts]);
  }
 }
 return {...model,reference_limits:limits};
}
// Studio's scenario callback can use this patch without creating a new draft,
// resetting options, or replacing references already selected in the workbench.
export function videoScenarioPatch(inputs:any,prompt:string,imageId:string,scenario:string,videoId:string){
 const add=(ids:string[]|undefined,id:string)=>Array.from(new Set([...(ids||[]),...(id?[id]:[])]));
 const image_ids=add(inputs.image_ids?.length?inputs.image_ids:inputs.image_id?[inputs.image_id]:[],imageId);
 const video_ids=add(inputs.video_ids,scenario==='remix'?videoId:'');
 const hasReferences=image_ids.length||video_ids.length||inputs.audio_ids?.length||inputs.remote_references?.length;
 const templateHasMedia=!!imageId||(scenario==='remix'&&!!videoId);
 const reference_mode=templateHasMedia?'reference':inputs.reference_mode||(hasReferences?'reference':'text');
 return {prompt,image_ids,image_id:image_ids[0]||'',video_ids,reference_mode};
}
