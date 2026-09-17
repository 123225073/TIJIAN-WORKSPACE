const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=process.argv[2];app.setPath('userData',path.join(dir,'browser'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let w;const logs=[];try{
 w=new BrowserWindow({show:false,width:1530,height:1000,webPreferences:{backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true}});w.webContents.on('console-message',(_e,_level,message)=>logs.push(message));await w.loadURL(process.argv[3]);
 const js=code=>w.webContents.executeJavaScript(code);
 const wait=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI condition timeout: '+code+' / '+await js('document.body.innerText'))};
 await wait("!!Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='微信网页登录态')");
 await js("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='微信网页登录态').click()");
 await wait("Boolean(document.querySelector('input[aria-label=最多获取篇数]'))");
 await js("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='识别账号并获取列表').click()");
 await wait("!!Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('确认获取全部'))");
 assert.equal(await js("document.querySelectorAll('.discovery-entry').length"),30);
 await js("Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('确认获取全部')).click()");
 await wait("document.querySelectorAll('.discovery-entry').length===40 && document.body.innerText.includes('平台返回的发布列表已读取至末页')");
 assert.equal(await js("document.querySelectorAll('.form-error').length"),0);
 await new Promise(r=>setTimeout(r,250));
 const shot=await w.webContents.capturePage();fs.writeFileSync(path.join(dir,'verified.png'),shot.toPNG());
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,articles:40}));
 }catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.message,logs}));process.exitCode=1}finally{w?.destroy();app.exit(process.exitCode||0)}});
