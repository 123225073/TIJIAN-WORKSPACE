const {BrowserWindow,ipcMain,dialog}=require('electron');
const crypto=require('node:crypto');
const hub=require('./platform-sessions.cjs'),list=require('./wechat-list.cjs');
// Read-only WeChat publisher lists. No session token/cookie crosses the application bridge.
module.exports=(getWindow,getBase)=>{
 const runs=new Map();
 ipcMain.handle('wechat-discovery',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  const headers={Authorization:'Bearer '+data.token,'Content-Type':'application/json'};
  const response=await fetch(getBase()+'/api/state',{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('请先登录工作台');const state=await response.json();
  if(data.action==='cancel'){const r=runs.get(data.id);if(r?.owner===state.user.id)runs.delete(data.id);return {cancelled:true}}
  let run;
  if(data.action==='start'){
   const scope=list.scopeOf(data);
   const identity=await fetch(getBase()+'/api/discovery/account',{method:'POST',headers,body:JSON.stringify({input:data.input,platform:'公众号'}),signal:AbortSignal.timeout(35000)});
   const result=await identity.json();if(!identity.ok)throw Error(typeof result.detail==='string'?result.detail:'文章发布账号识别失败');
   if(!result.account?.biz)throw Error('未确认文章发布账号');
   const channels=state.objects.filter(x=>x.kind==='channel'&&!x.archived&&x.platform==='wechat');
   let selected=data.channel_id?channels.find(x=>x.id===data.channel_id):channels.length===1?channels[0]:null;
   if(data.channel_id&&!selected)throw Error('所选公众号登录账号不存在');
   if(!channels.length)throw Error('已识别发布账号；请先在“平台账号”添加并登录你自己的微信公众号，再读取该博主列表');
   if(!selected){const choice=await dialog.showMessageBox(getWindow(),{type:'question',title:'选择公众号登录账号',message:'使用哪个已登录账号读取发布列表？',buttons:[...channels.map(x=>x.title),'取消'],cancelId:channels.length,noLink:true});selected=channels[choice.response];if(!selected)throw Error('已取消')}
   const ctx=await hub.context(hub.partitionFor(state.user.id,selected.id),'wechat');
   run={...list.createRun(result.account,scope),id:crypto.randomUUID(),owner:state.user.id,channel:selected.id,ctx,lastRequest:0,active:false};
   runs.set(run.id,run);
  }else if(data.action==='next'){
   run=runs.get(data.id);if(!run||run.owner!==state.user.id)throw Error('读取记录已失效，请重新获取');
   if(!state.objects.some(x=>x.id===run.channel&&x.kind==='channel'&&!x.archived&&x.platform==='wechat'))throw Error('登录账号已移除，请重新选择');
  }else throw Error('无效操作');
  if(run.active)throw Error('正在读取，请稍候');run.active=true;
  try{
   if(!run.fetchPage)await connect(run);
   await list.advance(run,run.fetchPage,data.confirm_all===true);
   return {id:run.id,channel_id:run.channel,...list.view(run)};
  }catch(e){if(e.message?.includes('登录'))run.fetchPage=null;return {id:run.id,channel_id:run.channel,...list.view(run),error:e.message||'读取失败，未完成全量获取'}}
  finally{run.active=false}
 });
 async function connect(run){
  const {ctx}=run;let home=hub.accountWindows(ctx).find(w=>{try{const u=new URL(w.webContents.getURL());return u.hostname==='mp.weixin.qq.com'&&/^\d+$/.test(u.searchParams.get('token')||'')}catch{return false}});
  let created=false;
  if(!home){created=true;home=new BrowserWindow({show:false,width:1100,height:820,webPreferences:hub.securePreferences(ctx.partition)});hub.attach(home,ctx);try{await hub.bound(home.loadURL('https://mp.weixin.qq.com/'),15000)}catch{home.destroy();throw Error('公众号后台打开失败，请检查网络')}}
  const token=new URL(home.webContents.getURL()).searchParams.get('token');
  if(!/^\d+$/.test(token||'')){home.show();home.focus();throw Error('请在已打开的公众号后台完成登录，再点击继续读取')}
  if(created)home.destroy();
  async function request(endpoint,params){
   const delay=Math.max(0,800-(Date.now()-run.lastRequest));if(delay)await new Promise(r=>setTimeout(r,delay));run.lastRequest=Date.now();
   const url=new URL('https://mp.weixin.qq.com/cgi-bin/'+endpoint);url.search=new URLSearchParams({...params,token,lang:'zh_CN',f:'json',ajax:'1'}).toString();
   let response;try{response=await ctx.session.fetch(url.href,{redirect:'error',signal:AbortSignal.timeout(20000)})}catch{throw Error('公众号列表请求超时或被拒绝；已保留读取位置，可稍后继续')}
   if(!response.ok)throw Error('公众号后台拒绝列表读取，未取得完整列表');
   let body;try{body=await response.json()}catch{throw Error('公众号返回登录或验证页面，请重新检查登录状态')}
   if(Number(body.base_resp?.ret)!==0)throw Error(Number(body.base_resp?.ret)===200013?'平台限制访问频率，请稍后继续':'公众号列表接口不可用或登录失效；不会用搜索结果冒充该账号文章');
   return body;
  }
  const search=await request('searchbiz',{action:'search_biz',begin:'0',count:'20',query:run.account.name});
  const candidates=(search.list||[]).filter(x=>x.nickname===run.account.name&&x.fakeid);
  if(!candidates.length)throw Error('公众号后台没有返回该发布账号；无法确认全量文章');
  const page=(fakeid,begin)=>request('appmsgpublish',{sub:'list',search_field:'null',begin:String(begin),count:'5',query:'',fakeid,type:'101_1',free_publish_type:'1',sub_action:'list_ex'});
  let selected;
  for(const candidate of candidates.slice(0,5)){
   const raw=await page(candidate.fakeid,0);
   try{const parsed=list.pageOf(raw,run.account.biz,run.account.name);if(parsed.items.length){if(selected)throw Error('多个同名账号无法唯一确认');selected={fakeid:candidate.fakeid,raw}}}catch(e){if(!e.message.includes('发布账号与原文不一致'))throw e}
  }
  if(!selected)throw Error('未找到与原文发布账号标识一致的列表，不会返回其他作者文章');
  run.fetchPage=begin=>begin===0?Promise.resolve(selected.raw):page(selected.fakeid,begin);
 }
};
