const {BrowserWindow,ipcMain}=require('electron');
const crypto=require('node:crypto');
const hub=require('./platform-sessions.cjs');
// This function reads only the rendered article; no challenge automation or secret extraction.
function extract(){
 const u=new URL(location.href),el=document.querySelector('#js_content');
 if(u.hostname!=='mp.weixin.qq.com'||!/^\/s(?:\/|$)/.test(u.pathname)||!el||el.innerText.trim().length<100)return null;
 const raw=Array.from(document.scripts).map(x=>x.textContent).join('\n');
 const value=name=>raw.match(new RegExp('\\b(?:var\\s+)?'+name+'\\s*=\\s*["\x27]([^"\x27]+)["\x27]'))?.[1];
 const biz=value('biz')||value('__biz')||u.searchParams.get('__biz')||'';
 const mid=u.searchParams.get('mid')||value('mid')||'',idx=u.searchParams.get('idx')||value('idx')||'';
 return {url:u.href,title:document.querySelector('#activity-name')?.innerText||document.title,body:el.innerText.slice(0,100000),publisher_name:document.querySelector('#js_name')?.innerText||'',publisher_biz:biz,article_key:mid&&idx?[biz,mid,idx].join('|'):''};
}
function reveal(win){if(win.isMinimized())win.restore();win.show();win.focus();setTimeout(()=>{if(!win.isDestroyed()&&!win.isVisible()){win.show();win.focus()}},200)}
const read=async win=>{try{return await hub.bound(win.webContents.executeJavaScript('('+extract.toString()+')()'),3000)}catch{return null}};
module.exports=(getWindow,getBase)=>{
 const pumps=new Map();
 ipcMain.handle('wechat-body',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  const headers={Authorization:'Bearer '+data.token,'Content-Type':'application/json'};
  const call=async(route,body)=>{const r=await fetch(getBase()+'/api'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok)throw Error(typeof v.detail==='string'?v.detail:'采集服务不可用');return v};
  const state=await call('/state');
  if(data.action==='show'){
   const pump=pumps.get(state.user.id);if(pump?.window&&!pump.window.isDestroyed()){reveal(pump.window);return {ok:true}}throw Error('验证窗口尚未就绪，请稍候');
  }
  if(data.action!=='start')throw Error('无效操作');
  const job=await call('/wechat/collect',{ids:data.ids,benchmark_id:data.benchmark_id,mode:'browser'});
  const current=pumps.get(state.user.id);if(current)current.generation++;
  if(!current){
   const pump={window:null,generation:0};pumps.set(state.user.id,pump);
   void (async()=>{
    const partition='persist:reader-'+crypto.createHash('sha256').update(state.user.id).digest('hex');
    const ctx=await hub.context(partition,'reader');
    try{
     while(true){
      const generation=pump.generation;const queue=await call('/wechat/browser/pending');if(!queue.active&&!queue.items.length){if(generation!==pump.generation)continue;break}
      if(!queue.items.length){await new Promise(r=>setTimeout(r,300));continue}
      const ticket=queue.items[0];let win=pump.window;
      if(!win||win.isDestroyed()){
       win=new BrowserWindow({show:false,width:1080,height:820,title:'梯见 · 微信正文采集',autoHideMenuBar:true,webPreferences:hub.securePreferences(partition)});hub.attach(win,ctx);pump.window=win;
       win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
       const guard=(e,url)=>{try{const u=new URL(url);if(u.protocol!=='https:'||!['mp.weixin.qq.com','open.weixin.qq.com'].includes(u.hostname))e.preventDefault()}catch{e.preventDefault()}};win.webContents.on('will-navigate',guard);win.webContents.on('will-redirect',guard);
      }
      try{
       try{await hub.bound(win.loadURL(ticket.url),25000)}catch{if(win.isDestroyed())throw Error('closed')}
       let page=await read(win);
       if(!page){
        await call('/wechat/browser/'+ticket.id,{waiting:true});win.setTitle('请完成微信验证 · 完成后自动继续采集');reveal(win);
        while(!page){
         if(win.isDestroyed()){await call('/wechat/browser/'+ticket.id,{cancelled:true});break}
         await new Promise(r=>setTimeout(r,1000));
         const live=await call('/wechat/browser/pending');if(!live.items.some(x=>x.id===ticket.id))break;
         if(!win.isDestroyed()&&!win.webContents.isLoadingMainFrame())page=await read(win);
        }
       }
       if(page){await call('/wechat/browser/'+ticket.id,page);if(!win.isDestroyed())win.hide()}
      }catch{await call('/wechat/browser/'+ticket.id,{error:'浏览器正文读取中断，请检查微信窗口或网络后重新采集'}).catch(()=>{})}
     }
    }finally{if(pump.window&&!pump.window.isDestroyed())pump.window.destroy();pumps.delete(state.user.id)}
   })().catch(()=>{});
  }
  return job;
 });
};
module.exports.extract=extract;
