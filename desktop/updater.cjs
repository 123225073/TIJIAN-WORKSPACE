// Independent desktop update lifecycle. The release build supplies app-update.yml.
const fs=require('node:fs'),path=require('node:path');
function registerUpdater({app,ipcMain,win,prepareInstall,updater,configured=fs.existsSync(path.join(process.resourcesPath,'app-update.yml'))}){
 const supported=app.isPackaged&&process.platform==='win32';
 let state={status:!supported?'development':!configured?'unconfigured':'idle',currentVersion:app.getVersion(),message:!supported?'源码运行版不安装更新。':!configured?'尚未配置正式更新渠道。':'可以检查软件新版本。'};
 let checking=false,downloading=false,installing=false;
 const publish=patch=>{state={...state,...patch};if(!win.isDestroyed())win.webContents.send('updates:state',state);return state};
 const authorized=e=>e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame;
 const invoke=(channel,fn)=>ipcMain.handle(channel,(event)=>{if(!authorized(event))throw Error('请求来源无效');return fn()});
 const active=supported&&configured;
 const service=active?(updater||require('electron-updater').autoUpdater):null;
 const fail=()=>publish({status:'error',message:'更新服务暂时不可用或安装包校验失败，请稍后重试。'});
 if(service){
  service.autoDownload=false;service.autoInstallOnAppQuit=false;service.allowDowngrade=false;service.allowPrerelease=false;service.disableWebInstaller=true;
  service.on('checking-for-update',()=>publish({status:'checking',message:'正在检查新版本…'}));
  service.on('update-not-available',()=>publish({status:'current',availableVersion:undefined,message:'当前已是此更新渠道的最新版本。'}));
  service.on('update-available',info=>publish({status:'available',availableVersion:info.version,message:'发现新版本，可下载后选择安装时间。'}));
  service.on('download-progress',p=>publish({status:'downloading',progress:Math.min(100,Math.max(0,p.percent||0)),message:'正在下载安装包…'}));
  service.on('update-downloaded',info=>publish({status:'downloaded',availableVersion:info.version,progress:100,message:'安装包已下载并校验。保存当前编辑后可重启安装。'}));
  service.on('error',()=>{if(state.status!=='downloaded')fail()});
 }
 invoke('updates:get-state',()=>state);
 invoke('updates:check',async()=>{if(!service||checking||downloading||installing||state.status==='downloaded')return state;checking=true;publish({status:'checking',message:'正在检查新版本…'});try{await service.checkForUpdates()}catch{fail()}finally{checking=false}return state});
 invoke('updates:download',async()=>{if(!service||downloading||checking||installing||!state.availableVersion||state.status==='downloaded')return state;downloading=true;publish({status:'downloading',progress:0,message:'正在连接更新服务器…'});try{await service.downloadUpdate()}catch{fail()}finally{downloading=false}return state});
 invoke('updates:install',async()=>{if(!service||state.status!=='downloaded'||installing)return false;installing=true;try{await prepareInstall();setImmediate(()=>service.quitAndInstall(false,true));return true}catch{installing=false;publish({message:'暂时无法退出，请保存工作后重试安装。'});return false}});
 return {getState:()=>state};
}
module.exports={registerUpdater};
