// Real rendered SettingsHub + actual local API/SQLite. External platform status is a fixture.
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=process.argv[2],base=process.argv[3];app.setPath('userData',path.join(dir,'browser'));
app.whenReady().then(async()=>{let win;try{
 ipcMain.handle('remember-login',()=>null);ipcMain.handle('douyin',()=>({ok:true}));
 ipcMain.handle('platform-account',()=>({code:'unknown',status:'测试状态',detail:'未执行外部平台登录'}));
 const auth=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'entry@example.test',password:'entry-isolated-test',name:'账号入口验收'})})).json();
 win=new BrowserWindow({show:false,width:1530,height:1000,webPreferences:{preload:path.resolve('desktop/preload.cjs'),contextIsolation:true,sandbox:true}});
 const js=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI condition timed out: '+code)};
 const visible="(()=>{const b=document.querySelector('.accounts-toolbar button');const r=b?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0&&getComputedStyle(b).visibility!=='hidden'})()";
 await win.loadURL(base);await js(`sessionStorage.setItem('tijian-session',${JSON.stringify(auth.token)})`);await win.loadURL(base+'/?entry=1#settings/accounts');
 await wait(visible);assert.equal(await js("document.querySelectorAll('.account-card').length"),0);
 await js("document.querySelector('.accounts-toolbar button').click()");await wait("!!document.querySelector('[aria-label=\"添加平台账号\"] form')");
 await js(`(()=>{const f=document.querySelector('.modal form');f.elements.title.value='验收抖音账号';f.elements.platform.value='douyin';f.requestSubmit()})()`);
 await wait("document.querySelector('.account-card h2')?.textContent==='验收抖音账号'");
 const state=await(await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+auth.token}})).json();const saved=state.objects.filter(x=>x.kind==='channel');assert.equal(saved.length,1);assert.equal(saved[0].platform,'douyin');
 await win.reload();await wait(visible);await wait("document.querySelector('.account-card h2')?.textContent==='验收抖音账号'");
 for(const width of [1530,1000]){win.setSize(width,1000);await new Promise(r=>setTimeout(r,200));assert.ok(await js(visible));fs.writeFileSync(path.join(dir,'accounts-'+width+'.png'),(await win.webContents.capturePage()).toPNG())}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['empty and populated settings entry visible','add form opens','Douyin account saved in SQLite','reload preserves account','1530 and 1000px visible'],external_login_tested:false}));
 }catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.message}));process.exitCode=1}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)}});
