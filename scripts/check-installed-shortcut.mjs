// Read-only UI smoke test launched through the installed desktop shortcut.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const directory=path.resolve('.runtime','installed-shortcut-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const shortcut=process.env.TIJIAN_VERIFY_SHORTCUT||path.join(process.env.USERPROFILE,'Desktop','梯世界工作台.lnk');
if(!fs.existsSync(shortcut))throw Error('Installed shortcut is missing');
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const launch=spawn('powershell',['-NoProfile','-Command','Start-Process -FilePath $env:TIJIAN_VERIFY_SHORTCUT -ArgumentList @("--disable-gpu","--remote-debugging-address=127.0.0.1","--remote-debugging-port=$env:TIJIAN_VERIFY_PORT") -WindowStyle Hidden'],{windowsHide:true,stdio:'pipe',env:{...process.env,TIJIAN_VERIFY_SHORTCUT:shortcut,TIJIAN_VERIFY_PORT:String(port)}});
const launched=await new Promise(resolve=>launch.once('exit',resolve));if(launched!==0)throw Error('Shortcut launch failed');
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));let ws;
try{
 let page;for(let i=0;i<150;i++){try{const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:'));if(page)break}catch{}await pause(200)}
 if(!page)throw Error('Installed application did not load through shortcut');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let sequence=0;const pending=new Map();ws.onmessage=event=>{const value=JSON.parse(event.data);if(value.id&&pending.has(value.id)){pending.get(value.id)(value);pending.delete(value.id)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'))},15000);pending.set(id,value=>{clearTimeout(timer);value.error?reject(Error(method+' failed')):resolve(value.result)});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error('Installed page check failed');return result.result.value};
 let ready=false;for(let i=0;i<100;i++){try{ready=await evaluate("Boolean(document.body)&&document.body.innerText.includes('梯世界') && !document.body.innerText.includes('正在打开工作区')")}catch{}if(ready)break;await pause(150)}
 if(!ready)throw Error('Installed UI did not become ready');
 const health=await evaluate("fetch('/api/health').then(r=>r.json())");if(health.version!==version)throw Error('Installed backend version differs');
 const ui=await evaluate(`(async()=>{const visual=await fetch('/visuals/elevator-atrium-v1.png');return {workspace_background:getComputedStyle(document.body).backgroundColor,workspace_text:getComputedStyle(document.body).color,branded:document.body.innerText.includes('梯世界'),background:visual.ok&&visual.headers.get('content-type').startsWith('image/'),workspace:Boolean(document.querySelector('.app-shell')),home:Boolean(document.querySelector('.tw-chat')),editor:Boolean(document.querySelector('.mw-mode-switch')),login:Boolean(document.querySelector('.auth-form')),clipboard:typeof window.tijianDesktop?.readClipboardImage==='function'}})()`);
 if(ui.workspace_background!=='rgb(11, 13, 18)'||ui.workspace_text!=='rgb(237, 242, 251)'||!ui.branded||!ui.background||!ui.clipboard||!ui.home&&!ui.login&&!ui.editor&&!ui.workspace)throw Error('Installed homepage or bridge is incomplete');
 const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(directory,'installed.png'),Buffer.from(screenshot.data,'base64'));
 const report={passed:true,version,launched_from_shortcut:true,installed_backend:true,read_only_page_checks:true,...ui};fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,directory}));
 await call('Browser.close').catch(()=>{});
}finally{ws?.close()}
