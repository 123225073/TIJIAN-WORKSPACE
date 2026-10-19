/** Recover the existing work from nested tool/library return routes. */
export function flowOrigin(route:string):string{
 let current=route.replace(/^#/, '');
 for(let depth=0;depth<8;depth++){
  if(current.split('?')[0]==='studio/flow')return current;
  const next=new URLSearchParams(current.split('?')[1]||'').get('return');
  if(!next)return '';
  current=next;
 }
 return '';
}

export const creationChannels=[
 {id:'wechat',label:'公众号',description:'标题、正文与配图',format:'公众号文章',words:1200,tool:'text'},
 {id:'xiaohongshu',label:'小红书',description:'图片、标题、正文与标签',format:'小红书文案',words:500,tool:'text'},
 {id:'moments',label:'朋友圈',description:'图片与自然表达的短文案',format:'朋友圈文案',words:200,tool:'text'},
 {id:'video',label:'短视频',description:'视频号 / 抖音 · 脚本与镜头',format:'短视频脚本',words:300,tool:'text'},
 {id:'avatar',label:'数字人口播',description:'口播文案与数字人视频',format:'口播脚本',words:300,tool:'text'},
] as const;

/** Titles are presentation only. Legacy unbound drafts remain in history. */
export function findBranchDraft(drafts:any[],flowId:string,topicId:string,channel:string,tool:string){
 return drafts.find(d=>!d.archived&&d.flow_id===flowId&&d.topic_id===topicId&&d.creation_channel===channel&&d.tool===tool);
}

/** Keep locally acknowledged creates/edits when an older list finishes later. */
export function mergeFlowDrafts(incoming:any[],known:any[],atRead?:any[]){
 const baseline=atRead&&new Map(atRead.map(d=>[d.id,d]));
 const result=new Map(known.filter(d=>!baseline||!baseline.has(d.id)||(d.version||0)>(baseline.get(d.id)?.version||0)||incoming.some(row=>row.id===d.id)).map(d=>[d.id,d]));
 for(const draft of incoming){const old=result.get(draft.id);if(!old||(draft.version||0)>=(old.version||0))result.set(draft.id,draft)}
 return [...result.values()].filter(d=>!d.archived);
}
