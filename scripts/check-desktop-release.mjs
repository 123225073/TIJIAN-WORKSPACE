// Runs the actual packaged app with an isolated userData directory; no provider keys.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const dir=path.resolve('.runtime','desktop-check-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const exe=path.resolve('release',version,'win-unpacked','梯见工作台.exe');
const child=spawn(exe,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_DESKTOP_DATA:dir}});
let exited=false;child.once('exit',()=>exited=true);let ws;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let page;for(let i=0;i<150;i++){if(exited)throw Error('Desktop exited before loading');try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=pages.find(x=>x.type==='page'&&x.url.startsWith('http://127.0.0.1:'));if(page)break}catch{}await pause(200)}
 if(!page)throw Error('Desktop renderer not ready');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let id=0;const pending=new Map();ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id&&pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'))},15000);pending.set(n,d=>{clearTimeout(timer);d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result)});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 let text='';for(let i=0;i<60;i++){text=await evaluate('document.body.innerText');if(text.includes(version))break;await pause(100)}
 if(!text.includes(version))throw Error('Wrong desktop UI version');
 const health=await evaluate("fetch('/api/health').then(r=>r.json())");if(health.version!==version)throw Error('Wrong backend version');
 const check=await evaluate(`(async()=>{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'packaged@example.test',password:'packaged-isolated-test',name:'桌面包验收'})});const d=await r.json();const capabilities=await fetch('/api/admin/capabilities',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());if(!['daily','writing','research','benchmark','topics','profile','check','knowledge'].every(p=>capabilities.items?.some(x=>x.id==='role:'+p&&x.kind==='role')))throw Error('Missing packaged system capabilities');const preview=await fetch('/api/admin/capabilities/preview/profile',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());if(!preview.text?.includes('个人定位访谈顾问'))throw Error('Missing packaged prompt composer');const settings=await fetch('/api/wechat/settings',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());const pending=await fetch('/api/wechat/browser/pending',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());const libraryHeaders={Authorization:'Bearer '+d.token,'Content-Type':'application/json'};const folder=await fetch('/api/objects/folder',{method:'POST',headers:libraryHeaders,body:JSON.stringify({title:'打包验收文件夹',library:'source'})}).then(r=>r.json());const source=await fetch('/api/import/text',{method:'POST',headers:libraryHeaders,body:JSON.stringify({title:'长文打包验证',body:'例行记录。'.repeat(4000)+'最后编号紫铜海豚392。',folder_id:folder.id})}).then(r=>r.json());const evidence=await fetch('/api/library/preview',{method:'POST',headers:libraryHeaders,body:JSON.stringify({query:'紫铜海豚编号',scope:{mode:'selected',modules:[],folder_ids:[folder.id],item_ids:[],excluded_ids:[]}})}).then(r=>r.json());const synthesis=await fetch('/api/synthesis',{headers:libraryHeaders}).then(r=>r.json());if(!evidence.excerpts?.some(x=>x.text.includes('紫铜海豚392')&&x.start>15000)||synthesis.settings?.time!=='02:00')throw Error('Packaged Wiki/retrieval service failed');const radar=await fetch('/api/discovery/source',{method:'POST',headers:libraryHeaders,body:JSON.stringify({url:'https://v.douyin.com/packaged-test/',keywords:''})}).then(r=>r.json());if(radar.status!=='needs_browser'||radar.items.length)throw Error('Packaged source capability reporting failed');return {radar_api:true,library_api:true,configured:settings.configured,url:settings.service_url,browserBridge:typeof window.tijianDesktop.wechatBody==='function',browserQueue:pending.active===false&&pending.items.length===0}})()`);
 if(!await evaluate("typeof window.tijianDesktop.wereadSession==='function'"))throw Error('Missing free subscription bridge');
 if(!check.library_api||!check.browserBridge||!check.browserQueue||check.configured||check.url!=='https://www.cimidata.com/api-service')throw Error('Packaged API settings incorrect');
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,version,actual_packaged_desktop:true,library_api:true,system_capabilities:true,isolated_data:true,api_settings:true}));
 console.log(JSON.stringify({passed:true,version,actual_packaged_desktop:true,library_api:true,system_capabilities:true,api_settings:true,dir}));
 await call('Browser.close').catch(()=>{});
}finally{
 ws?.close();for(let i=0;i<30&&!exited;i++)await pause(100);
 if(!exited){const stop=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>stop.once('exit',r))}
}
