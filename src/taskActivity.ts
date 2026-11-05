import type {Item} from './api';

export const taskActive=(task:Item)=>task.kind==='operation'?task.pending:['queued','preparing','submitting','running','saving'].includes(task.status)||task.status==='cancelled'&&!task.finished_at&&!!task.cancel_requested_at;
export const taskNeedsAttention=(task:Item)=>!!task.error||['failed','interrupted','unknown','archive_failed','expired','partial','cancelled'].includes(task.status);
export const taskStatus=(task:Item)=>task.kind==='operation'?(task.pending?'正在处理':task.error?'未完成':'已完成'):({queued:'等待执行',preparing:'准备素材',submitting:'正在提交',running:'正在执行',saving:'保存结果',done:'已完成',succeeded:'已完成',partial:'部分完成',failed:'执行失败',interrupted:'已中断',cancelled:task.finished_at?'已停止':'正在停止',unknown:'需要核查',archive_failed:'保存结果失败',expired:'任务已过期'}[task.status as string]||'状态待核查');
export const activityTitle=(task:Item)=>{
 const action=task.input?.action;
 if(['article_illustration_prompt','article_illustration_suggestion'].includes(action)||task.operation_path?.includes('article-illustration-prompt'))return '构思文章配图';
 if(task.kind==='studio_run')return ({text_image:'生成图片',image_edit:'编辑图片',text_video:'生成视频',image_video:'生成视频',text_avatar:'生成数字人视频',audio_avatar:'生成数字人视频',photo_talk:'生成数字人视频',avatar_create:'创建数字人形象',voice_create:'创建声音',tts:'生成配音',compose:'导出视频'}[task.tool as string]||'生成媒体作品');
 return task.activity_label||task.title||'执行任务';
};
export const taskTime=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function taskElapsed(task:Item,now:number){
 const start=taskTime(task.started_at),finish=taskTime(task.finished_at);
 if(start===null||(!taskActive(task)&&finish===null))return '未记录';
 const seconds=Math.max(0,Math.floor(((finish??now)-start)/1000));
 return seconds>=3600?`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分 ${seconds%60} 秒`:seconds>=60?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${seconds} 秒`;
}
export function activityRoute(task:Item){
 if(task.activity_route)return task.activity_route;
 if(task.kind==='studio_run')return ({text_image:'studio/image',image_edit:'studio/image?mode=edit',text_video:'studio/video',image_video:'studio/video',text_avatar:'studio/avatar/text',audio_avatar:'studio/avatar/audio',photo_talk:'studio/avatar/photo',avatar_create:'studio/avatar/create',voice_create:'studio/audio/create',tts:'studio/audio/tts',compose:'studio/compose'}[task.tool as string]||'studio/works');
 if(task.task_id)return 'task/'+task.task_id;
 return task.input?.flow_id?'studio/flow?work='+task.input.flow_id:'tasks';
}
