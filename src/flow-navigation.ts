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

// A child editor must flush pending shell changes before it updates the same
// work. The shell supplies its promise synchronously for the matching work.
export const FLOW_PREPARE_SAVE='tijian-flow-prepare-save';
export type FlowPrepareSave={flowId:string;claimed:boolean;tasks:Promise<void>[]};

export const matrixChannels=[
 {id:'website',label:'官网 / 品牌博客',description:'常见问题、品牌案例与完整说明',format:'官网文章',words:1400,tool:'text'},
 {id:'wechat',label:'微信公众号',description:'有结构的深度图文与品牌文章',format:'公众号文章',words:1200,tool:'text'},
 {id:'xiaohongshu',label:'小红书',description:'场景体验、选购清单与话题',format:'小红书文案',words:500,tool:'text'},
 {id:'zhihu',label:'知乎',description:'先给答案，再展开证据和条件',format:'知乎回答',words:1200,tool:'text'},
 {id:'baijiahao',label:'百家号',description:'便于搜索的行业知识文章',format:'百家号文章',words:1100,tool:'text'},
 {id:'toutiao',label:'今日头条',description:'短段落的资讯与实用观察',format:'今日头条文章',words:800,tool:'text'},
 {id:'jianshu',label:'简书',description:'经验叙事与观点长文',format:'简书文章',words:1100,tool:'text'},
 {id:'sohu',label:'搜狐号',description:'行业观察和专业资讯解读',format:'搜狐号文章',words:1000,tool:'text'},
] as const;

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
