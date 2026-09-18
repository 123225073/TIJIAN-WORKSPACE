const {app,BrowserWindow,dialog,shell,ipcMain}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const net=require('node:net');
// An explicit development-test directory keeps acceptance data and locks isolated.
if(process.env.TIJIAN_DESKTOP_DATA)app.setPath('userData',path.resolve(process.env.TIJIAN_DESKTOP_DATA));
let backend,win,base;
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
async function start(){
 const root=path.resolve(__dirname,'..');
 const port=await freePort();base=`http://127.0.0.1:${port}`;
 const devPython=path.join(root,'.runtime','venv','Scripts','python.exe');
 const program=app.isPackaged?path.join(process.resourcesPath,'backend','tijian-service','tijian-service.exe'):require('node:fs').existsSync(devPython)?devPython:path.join(root,'.venv','Scripts','python.exe');
 const args=app.isPackaged?[]:['-m','backend.run'];
 backend=spawn(program,args,{cwd:app.isPackaged?app.getPath('userData'):root,windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_PORT:String(port),TIJIAN_DATA:app.isPackaged?path.join(app.getPath('userData'),'data'):path.join(root,'.runtime')}});
 let exited=false;backend.on('error',()=>exited=true);backend.on('exit',()=>exited=true);
 let ready=false;
 for(let i=0;i<120;i++){
   if(exited)throw Error('本地服务未能启动。请检查安全软件拦截记录，或重新打开应用。');
   try{const r=await fetch(base+'/api/health');const d=await r.json();if(d.ok&&d.persistence==='sqlite+markdown'){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('本地服务启动超时，请稍后重新打开。');
 win=new BrowserWindow({width:1530,height:1000,minWidth:1000,minHeight:700,backgroundColor:'#eef1ed',title:'梯见工作台',autoHideMenuBar:true,show:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url)&&!url.startsWith(base+'/'))shell.openExternal(url);return {action:'deny'};});
 win.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==base){e.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url);}});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
 win.once('ready-to-show',()=>win.show());await win.loadURL(base);
}
ipcMain.handle('choose-workspace',async event=>{if(event.sender!==win?.webContents)return null;const r=await dialog.showOpenDialog(win,{title:'选择空目录作为工作区',properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
require('./weread.cjs')(()=>win,()=>base);
require('./wechat-body.cjs')(()=>win,()=>base);
require('./wechat-discovery.cjs')(()=>win,()=>base);
require('./discovery.cjs')(()=>win,()=>base);
require('./douyin.cjs')(()=>win,()=>base);
require('./accounts.cjs')(()=>win,()=>base);
require('./remember.cjs')(()=>win,()=>base);
app.whenReady().then(start).catch(e=>{dialog.showErrorBox('梯见启动失败',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
let flushed=false,flushing=false;
app.on('before-quit',event=>{
 if(flushed){if(backend)backend.kill();return;}
 event.preventDefault();
 if(flushing)return;flushing=true;
 require('./platform-sessions.cjs').bound(require('./platform-sessions.cjs').flushAll(),5000).catch(()=>{}).finally(()=>{flushed=true;app.quit();});
});
