// Explicit login window; session cookies travel main process -> local backend only.
const {ipcMain,BrowserWindow}=require('electron'),crypto=require('node:crypto'),hub=require('./platform-sessions.cjs');
module.exports=(getWindow,getBase)=>{
 const windows=new Map();
 ipcMain.handle('weread-session',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  const headers={Authorization:'Bearer '+data.token,'Content-Type':'application/json'};
  const r=await fetch(getBase()+'/api/state',{headers});if(!r.ok)throw Error('请先登录工作台');const state=await r.json();
  const partition='persist:weread-'+crypto.createHash('sha256').update(state.user.id).digest('hex');const ctx=await hub.context(partition,'reader');
  if(data.action==='open'){
   let win=windows.get(state.user.id);
   if(!win||win.isDestroyed()){
    win=new BrowserWindow({show:false,width:1080,height:800,autoHideMenuBar:true,title:'微信读书 · 登录后返回工作台保存连接',webPreferences:hub.securePreferences(partition)});windows.set(state.user.id,win);hub.attach(win,ctx);
    const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['weread.qq.com','open.weixin.qq.com'].includes(u.hostname)}catch{return false}};
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault()});win.webContents.on('will-redirect',(e,url)=>{if(!allowed(url))e.preventDefault()});
    await win.loadURL('https://weread.qq.com/').catch(()=>{});
   }
   win.show();win.focus();setTimeout(()=>{if(!win.isDestroyed())win.show()},200);return {opened:true};
  }
  if(data.action!=='save')throw Error('无效操作');
  const cookies=await ctx.session.cookies.get({url:'https://weread.qq.com/'});
  const selected=cookies.filter(c=>/^wr_[A-Za-z0-9_]+$/.test(c.name)&&!/[\r\n;]/.test(c.value));
  if(!selected.some(c=>c.name==='wr_skey'))throw Error('未发现登录会话，请在微信读书窗口完成登录');
  const result=await fetch(getBase()+'/api/weread/session',{method:'PUT',headers,body:JSON.stringify({cookie:selected.map(c=>c.name+'='+c.value).join('; ')})});
  if(!result.ok)throw Error('保存微信读书会话失败，请重试');
  return {saved:true};
 });
};
