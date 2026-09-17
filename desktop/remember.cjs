const {app,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
module.exports=(getWindow,getBase)=>{
 ipcMain.handle('remember-login',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  const file=path.join(app.getPath('userData'),'remembered-login.bin');
  if(data.action==='clear'){if(fs.existsSync(file))fs.unlinkSync(file);return null;}
  if(!safeStorage.isEncryptionAvailable())throw Error('本机加密不可用，无法记住登录');
  if(data.action==='read'){try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))}catch{return null;}}
  if(data.action!=='save'||typeof data.token!=='string'||data.token.length>200)throw Error('无效登录凭证');
  const r=await fetch(getBase()+'/api/state',{headers:{Authorization:'Bearer '+data.token}});
  if(!r.ok)throw Error('登录已过期，请重新登录');
  const state=await r.json();
  fs.writeFileSync(file,safeStorage.encryptString(JSON.stringify({token:data.token,email:state.user.email})));return null;
 });
};
