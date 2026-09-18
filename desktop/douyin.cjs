const {BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hub=require('./platform-sessions.cjs'),dataOf=require('./douyin-data.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const profileURL=sec=>'https://www.douyin.com/user/'+sec;
function platformURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='douyin.com'||u.hostname.endsWith('.douyin.com'))}catch{return false}}

async function windowFor(pump,owner,channel,url){
 if(!pump.testElectron)return require('./douyin-chrome.cjs').open(pump,owner,false,url);
 const partition=channel?hub.partitionFor(owner,channel.id):'persist:douyin-reader-'+crypto.createHash('sha256').update(owner).digest('hex');
 if(pump.window&&!pump.window.isDestroyed()&&pump.partition===partition)return pump.window;
 if(pump.window&&!pump.window.isDestroyed())pump.window.destroy();
 pump.partition=partition;pump.ctx=await hub.context(partition,channel?'douyin':'reader');
 const win=new BrowserWindow({show:false,width:1150,height:850,title:'梯见 · 抖音作品读取',autoHideMenuBar:true,webPreferences:{...hub.securePreferences(partition),backgroundThrottling:false}});pump.window=win;hub.attach(win,pump.ctx);
 win.webContents.setWindowOpenHandler(({url})=>{if(platformURL(url))void win.loadURL(url).catch(()=>{});return {action:'deny'}});
 const guard=(event,url)=>{if(!platformURL(url))event.preventDefault()};win.webContents.on('will-navigate',guard);win.webContents.on('will-redirect',guard);
 return win;
}
// Fixed endpoint transport for the pinned upstream API client. No clicks, scrolling or AI.
async function pageRequest(win,ticket,pump,call,signal=new AbortController().signal){
 const wc=win.webContents;
 if(!['/aweme/v1/web/aweme/post/','/aweme/v1/web/aweme/detail/'].includes(ticket.path))throw Error('抖音接口不在允许范围内');
 if(ticket.path.endsWith('/post/')&&ticket.params?.sec_user_id!==ticket.sec_uid)throw Error('抖音请求账号不匹配');
 const target=profileURL(ticket.sec_uid);
 if(wc.getURL().split('?')[0]!==target||wc.__platformError){
  try{await hub.bound(win.loadURL(target),25000)}catch(e){const code=String(e.message).match(/ERR_[A-Z_]+/)?.[0]||'TIMEOUT';throw Error('抖音页面连接失败（'+code+'）。请检查内置窗口和当前浏览器的网络连接差异后重试')}
  await pause(1500);
 }
 signal.throwIfAborted();
 if(win.isDestroyed()||!platformURL(wc.getURL()))throw Error('抖音窗口已关闭或地址变化');
 const input={path:ticket.path,params:ticket.params};
 const code=`(async(input)=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
  try{
   const version=navigator.userAgent.split('Chrome/')[1]?.split(' ')[0]||'';
   const params={device_platform:'webapp',aid:'6383',channel:'channel_pc_web',pc_client_type:'1',version_code:'290100',version_name:'29.1.0',cookie_enabled:String(navigator.cookieEnabled),screen_width:String(screen.width),screen_height:String(screen.height),browser_language:navigator.language,browser_platform:navigator.platform,browser_name:'Chrome',browser_version:version,browser_online:String(navigator.onLine),engine_name:'Blink',engine_version:version,os_name:'Windows',os_version:'10',cpu_core_num:String(navigator.hardwareConcurrency||8),device_memory:String(navigator.deviceMemory||8),platform:'PC',...input.params};
   const query=new URLSearchParams(params);const response=await window.fetch(input.path+'?'+query.toString(),{credentials:'include',signal:controller.signal});
   const text=await response.text();if(text.length>8000000)return {http_status:502,body:null,text:'response too large'};
   let body=null;try{body=JSON.parse(text)}catch{}
   return {http_status:response.status,body,text:body?'':text.slice(0,100)};
  }catch{return {http_status:0,body:null,text:'page network request failed'}}finally{clearTimeout(timer)}
 })(${JSON.stringify(input)})`;
 const result=await hub.bound(wc.executeJavaScript(code),30000);signal.throwIfAborted();
 if(!pump.mediaCache)pump.mediaCache=new Map();
 for(const row of dataOf.rows(result.body,ticket.sec_uid))pump.mediaCache.set(row.sec_uid+':'+row.aweme_id,{at:Date.now(),row});
 while(pump.mediaCache.size>500)pump.mediaCache.delete(pump.mediaCache.keys().next().value);
 const needsUser=[401,403,429].includes(result.http_status)||result.body?.status_code===2483||result.body?.verify_ticket;
 if(needsUser&&!ticket.automatic){await win.show();await call('/douyin/browser/'+ticket.id,{progress:'请在抖音窗口完成登录或验证，然后重试获取作品'});}
 return result;
}

async function saveMedia(ctx,row,directory,signal=new AbortController().signal){
 signal=AbortSignal.any([signal,AbortSignal.timeout(300000)]);
 if(!path.isAbsolute(directory))throw Error('下载目录无效');
 const files=[];let total=0;
 for(let i=0;i<row.media.length&&i<30;i++){
  signal.throwIfAborted();let success=false,lastError='';
  for(const candidate of row.media[i].slice(0,6)){
   if(!dataOf.mediaURL(candidate))continue;
   let response,tmp;
   try{
    let url=candidate;
    for(let n=0;n<4;n++){
     response=await ctx.session.fetch(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),headers:{Referer:'https://www.douyin.com/'}});
     if(response.status>=300&&response.status<400){const next=dataOf.mediaURL(new URL(response.headers.get('location'),url).href);if(!next)throw Error('媒体跳转地址不可用');await response.body?.cancel();url=next;continue}break;
    }
    if(!response?.ok||!response.body)throw Error('媒体下载被平台拒绝（HTTP '+(response?.status||0)+'）');
    const type=response.headers.get('content-type')||'';const ext=row.media_type==='video'?'mp4':type.includes('png')?'png':type.includes('webp')?'webp':'jpg';
    if(!/video\/|image\/|octet-stream/.test(type))throw Error('平台返回的不是媒体文件');
    const name=(i+1)+'.'+ext;tmp=path.join(directory,name+'.'+crypto.randomUUID()+'.part');const handle=await fs.promises.open(tmp,'wx');let size=0,first=Buffer.alloc(0);
    try{for await(const chunk of response.body){signal.throwIfAborted();const bytes=Buffer.from(chunk);if(first.length<32)first=Buffer.concat([first,bytes]).subarray(0,32);size+=bytes.length;total+=bytes.length;if(size>300*1024*1024||total>500*1024*1024)throw Error('单文件300MB或单作品500MB上限已到');await handle.write(bytes)}}finally{await handle.close()}
    const valid=row.media_type==='video'?first.includes(Buffer.from('ftyp')):first[0]===255&&first[1]===216||first.subarray(1,4).toString()==='PNG'||first.subarray(0,4).toString()==='RIFF';
    const expected=Number(response.headers.get('content-length')||0);
    if(size<128||!valid||(expected&&!response.headers.get('content-encoding')&&expected!==size))throw Error('媒体文件校验失败');
    signal.throwIfAborted();
    await fs.promises.rename(tmp,path.join(directory,name));tmp=null;files.push(name);success=true;break;
   }catch(e){lastError=e.message?.includes('媒体')?e.message:'连接中断或超时';if(tmp)await fs.promises.unlink(tmp).catch(()=>{})}finally{await response?.body?.cancel().catch(()=>{})}
  }
  if(!success)throw Error('部分媒体未能下载（'+lastError+'），已保留完成文件；请检查平台访问状态后重试');
 }
 if(!files.length||row.media.length>30)throw Error('媒体缺失或图文超过30张，本次未标记完整下载');
 return files;
}

module.exports=(getWindow,getBase,options={})=>{
 const pumps=new Map();
 ipcMain.handle('douyin',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  if(!['connect','open','disconnect'].includes(data.action))throw Error('未知抖音操作');
  if(data.action==='disconnect'){for(const [owner,p] of pumps)if(p.token===data.token){p.stopped=true;p.controller?.abort();if(p.window&&!p.window.isDestroyed())p.window.destroy();pumps.delete(owner)}return {ok:true}}
  const headers={Authorization:'Bearer '+data.token,'Content-Type':'application/json'};
  const call=async(route,body)=>{const res=await fetch(getBase()+'/api'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const value=await res.json();if(!res.ok)throw Error(typeof value.detail==='string'?value.detail:'抖音任务已停止');return value};
  const state=await call('/state');let pump=pumps.get(state.user.id);
  if(data.action==='disconnect'){if(pump){pump.stopped=true;if(pump.window&&!pump.window.isDestroyed())pump.window.destroy();pumps.delete(state.user.id)}return {ok:true}}
  if(!pump){pump={stopped:false,window:null,active:false,token:data.token,testElectron:options.testElectron};pumps.set(state.user.id,pump);
   void (async()=>{try{while(!pump.stopped){
    const queue=await call('/douyin/pending');
    for(const ticket of queue.items.slice(0,1)){
     pump.active=true;pump.controller=new AbortController();const signal=pump.controller.signal;
     let checking=false;const monitor=setInterval(async()=>{if(checking)return;checking=true;try{const q=await call('/douyin/pending');if(!q.items.some(x=>x.id===ticket.id))pump.controller.abort()}catch{pump.controller.abort()}finally{checking=false}},2000);
     try{
      const latest=await call('/state');const channels=latest.objects.filter(x=>x.kind==='channel'&&!x.archived&&x.platform==='douyin');
      const bound=latest.objects.find(x=>x.id===ticket.benchmark_id)?.douyin_channel_id;
      const channel=channels.find(x=>x.id===bound)||(channels.length===1?channels[0]:null);
      const win=await windowFor(pump,state.user.id,channel,ticket.url);
      if(ticket.action==='api'){
       const result=await pageRequest(win,ticket,pump,call,signal);await call('/douyin/browser/'+ticket.id,result);
      }else if(ticket.action==='download'){
       const cached=pump.mediaCache?.get(ticket.sec_uid+':'+ticket.aweme_id);
       if(!cached||Date.now()-cached.at>600000){await call('/douyin/browser/'+ticket.id,{needs_detail:true});continue}
       const row=cached.row;const files=await saveMedia(pump.ctx,row,ticket.directory,signal);signal.throwIfAborted();
       await call('/douyin/browser/'+ticket.id,{aweme_id:row.aweme_id,sec_uid:row.sec_uid,files});
      }else throw Error('抖音任务类型无效');
     }catch(e){await call('/douyin/browser/'+ticket.id,{error:e.message?.includes('抖音')||e.message?.includes('媒体')?e.message:'抖音读取或下载中断，请检查平台窗口后重试'}).catch(()=>{})}finally{clearInterval(monitor);pump.active=false}
    }
    await pause(2500);
   }}finally{if(pump.window&&!pump.window.isDestroyed())pump.window.destroy();if(pumps.get(state.user.id)===pump)pumps.delete(state.user.id)}})().catch(()=>{});
  }
  if(data.action==='open'){
   const a=state.objects.find(x=>x.id===data.benchmark_id&&x.kind==='benchmark'&&!x.archived);if(!a)throw Error('对标账号不存在');
   const status=await call('/douyin/'+a.id+'/status');
   if(pump.active){if(pump.window&&!pump.window.isDestroyed()){await pump.window.show();await pump.window.focus()}return {ok:true}}
   const channels=state.objects.filter(x=>x.kind==='channel'&&!x.archived&&x.platform==='douyin');const channel=channels.find(x=>x.id===a.douyin_channel_id)||(channels.length===1?channels[0]:null);
   const target=profileURL(status.sec_uid);
   const win=pump.testElectron?await windowFor(pump,state.user.id,channel):await require('./douyin-chrome.cjs').open(pump,state.user.id,true,target);await win.show();await win.focus();
   if(win.webContents.getURL().split('?')[0]!==target||win.webContents.__platformError){try{await win.loadURL(target)}catch{throw Error('抖音窗口连接失败，请在打开的窗口刷新并检查网络后重试')}}
  }
  if(data.action==='connect')await call('/douyin/pending');
  return {ok:true};
 });
};
module.exports.pageRequest=pageRequest;module.exports.saveMedia=saveMedia;
