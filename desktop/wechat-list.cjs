// Account-scoped list parsing. Transport and credentials stay in the desktop main process.
function bizOf(link){try{const u=new URL(link.replaceAll('&amp;','&'));return u.protocol==='https:'&&u.hostname==='mp.weixin.qq.com'?u.searchParams.get('__biz'):null}catch{return null}}
function unpack(value){return typeof value==='string'?JSON.parse(value):value}
function pageOf(data,biz,name){
 if(!data.base_resp||Number(data.base_resp.ret)!==0)throw Error(Number(data.base_resp?.ret)===200013?'平台限制访问频率，请稍后继续，已读取清单保留':'公众号未提供发布列表，请检查登录及列表访问权限；不会转为关键词搜索');
 let p;try{p=unpack(data.publish_page)}catch{throw Error('平台列表格式变化，未确认读取完成')}
 if(!p||!Array.isArray(p.publish_list)||!Number.isInteger(p.total_count)||p.total_count<0)throw Error('平台未返回有效的分页总数');
 const items=[];
 for(const entry of p.publish_list){
  let info;try{info=unpack(entry.publish_info)}catch{throw Error('发布记录解析失败，未跳过该页')}
  if(!Array.isArray(info?.appmsgex)||!info.appmsgex.length)throw Error('发布记录缺少文章，无法确认完整性');
  for(const a of info.appmsgex){
   const url=String(a.link||'').replaceAll('&amp;','&');
   if(bizOf(url)!==biz)throw Error('列表文章的发布账号与原文不一致，已停止读取，未混入其他作者');
   const stamp=Number(info.sent_info?.time||a.create_time||a.update_time);
   const published=stamp>0?new Date(stamp*1000+8*3600000).toISOString().slice(0,10):'';
   items.push({title:String(a.title||''),url,author:name,publisher_biz:biz,published,body:'',key:[biz,a.appmsgid||new URL(url).searchParams.get('mid')||url,a.itemidx||new URL(url).searchParams.get('idx')||1].join(':')});
  }
 }
 return {items,records:p.publish_list.length,total:p.total_count};
}
function scopeOf(data){
 const limit=data.limit===''||data.limit==null?null:Number(data.limit);
 if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1))throw Error('文章数必须为正整数');
 const since=data.since||'',until=data.until||'';
 for(const day of [since,until])if(day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day).toISOString().slice(0,10)!==day))throw Error('日期格式无效');
 if(since&&until&&since>until)throw Error('开始日期不能晚于结束日期');
 return {limit,since,until};
}
function createRun(account,scope){return {account,scope:scopeOf(scope),offset:0,items:[],seen:new Set(),pending:[],total:null,done:false,confirmed:false,needs_confirmation:false,unknown_dates:0,reason:'',pageKeys:new Set()}}
function consume(run){
 const {since,until,limit}=run.scope;
 while(run.pending.length){
  const item=run.pending[0];
  if(run.seen.has(item.key)){run.pending.shift();continue}
  if(!limit&&!since&&!until&&!run.confirmed&&run.items.length===30){run.needs_confirmation=true;return}
  run.pending.shift();run.seen.add(item.key);
  if((since||until)&&!item.published){run.unknown_dates++;continue}
  if((since&&item.published<since)||(until&&item.published>until))continue;
  run.items.push(item);
  if(limit&&run.items.length>=limit){run.done=true;run.reason='limit';return}
 }
 if(run.total!==null&&run.offset>=run.total){run.done=true;run.reason='end'}
}
async function advance(run,fetchPage,confirm=false){
 if(run.done)return;
 if(run.needs_confirmation&&!confirm)return;
 if(confirm){run.confirmed=true;run.needs_confirmation=false}
 consume(run);if(run.done||run.needs_confirmation)return;
 const page=pageOf(await fetchPage(run.offset),run.account.biz,run.account.name);
 if(!page.records&&run.offset<page.total)throw Error('列表提前返回空页，尚未读取完整，请稍后继续');
 const signature=page.items.map(x=>x.key).join('|');
 if(page.records&&run.pageKeys.has(signature))throw Error('平台重复返回同一页，已暂停，不能认定为全部');
 if(run.total!==null&&run.total!==page.total)throw Error('获取期间发布总数发生变化，请重新获取以核对完整列表');
 if(page.records)run.pageKeys.add(signature);
 run.total=page.total;run.offset+=page.records;run.pending.push(...page.items);consume(run);
}
function view(run){return {account:run.account,items:run.items,offset:run.offset,total_records:run.total,done:run.done,needs_confirmation:run.needs_confirmation,unknown_dates:run.unknown_dates,coverage:run.done?(run.reason==='limit'?'已达到指定文章数':run.unknown_dates?'列表已读取至末页，但有日期未知文章未纳入筛选':'平台返回的发布列表已读取至末页'):'尚未读取完整',note:'仅接受发布账号标识一致的文章；发布记录数与文章篇数不同，一次发布可能含多篇文章。'}}
module.exports={bizOf,pageOf,scopeOf,createRun,advance,view};
