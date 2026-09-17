const {BrowserWindow,ipcMain}=require('electron');
const hub=require('./platform-sessions.cjs');
const platforms=require('./platforms.json');
module.exports=(getWindow,getBase)=>{
  ipcMain.handle('platform-account',async(event,{token,id,action})=>{
    if(event.sender!==getWindow()?.webContents || event.senderFrame!==event.sender.mainFrame || new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
    if(!['open','check','status','logout','retry'].includes(action))throw Error('无效操作');
    const response=await fetch(getBase()+'/api/state',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('请先登录工作台');
    const state=await response.json(),record=state.objects.find(x=>x.id===id&&x.kind==='channel'&&!x.archived);
    const platform=platforms.find(p=>p.value===record?.platform);
    if(!record||!platform)throw Error('平台账号不存在');
    const ctx=await hub.context(hub.partitionFor(state.user.id,id),record.platform);
    return hub.serial(ctx,async()=>{
      if(action==='logout')return hub.logout(ctx);
      if(action==='status')return hub.status(ctx);
      let window=hub.accountWindows(ctx).find(w=>w.__accountHome);
      if(!window)window=hub.accountWindows(ctx).find(w=>{try{return new URL(w.webContents.getURL()).hostname===new URL(platform.url).hostname}catch{return false}});
      let temporary=false;
      if(!window){
        temporary=action==='check';
        window=new BrowserWindow({width:1100,height:820,title:platform.label+' · 平台账号',autoHideMenuBar:true,show:!temporary,webPreferences:hub.securePreferences(ctx.partition)});
        window.__accountHome=true;hub.attach(window,ctx);
        try{await hub.bound(window.loadURL(platform.url),15000)}catch{if(!window.isDestroyed())window.webContents.__platformError='平台页面加载超时或失败，请打开窗口重试';}
      }else if(action==='retry'){
        for(const child of hub.accountWindows(ctx))if(child!==window&&child.webContents.__platformOAuth)child.destroy();
        try{await hub.bound(window.loadURL(platform.url),15000)}catch{if(!window.isDestroyed())window.webContents.__platformError='平台页面重试失败，请检查网络';}
      }
      if(!temporary && !window.isDestroyed()){window.show();window.focus();}
      let result=await hub.status(ctx);
      if(action==='check'){
        for(let i=0;i<4&&['checking','unknown'].includes(result.code);i++){await new Promise(r=>setTimeout(r,750));result=await hub.status(ctx);}
      }
      if(temporary && !window.isDestroyed()){
        if(result.code==='authenticated'){window.destroy();result.windowOpen=false;}
        else{window.show();window.focus();result.windowOpen=true;}
      }
      return result;
    });
  });
};
