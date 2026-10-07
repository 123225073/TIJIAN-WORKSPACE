// Run a real desktop executable in a disposable profile. No user's account/data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const exe=process.env.TIJIAN_CHECK_EXE||path.resolve('release',version,'win-unpacked','梯世界工作台.exe');
const input=process.env.TIJIAN_MEDIA_INPUT;assert(input);
const old=process.env.TIJIAN_EXPECT_OLD==='1';
const directory=path.resolve('.runtime','desktop-media-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const child=spawn(exe,['--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_DESKTOP_DATA:directory}});
let browser;
try{
 for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:'+port+'/json/version')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const context=browser.contexts()[0];let page;for(let i=0;i<150;i++){page=context.pages()[0];if(page)break;await new Promise(r=>setTimeout(r,200))}assert(page);await page.waitForURL(/http:\/\/127.0.0.1:/);const base=new URL(page.url()).origin;
 const health=await(await fetch(base+'/api/health')).json();
 const auth=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();assert(auth.token);
 const upload=async(name,mime)=>{const body=new FormData();body.append('file',new Blob([fs.readFileSync(path.join(input,name))],{type:mime}),name);const r=await fetch(base+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+auth.token},body});return {status:r.status,asset:await r.json()}};
 const normal=await upload('normal.jpg','image/jpeg'),mislabeled=await upload('looks-like-jpg.jpg','image/jpeg'),large=await upload('large.jpg','image/jpeg');
 assert.equal(normal.status,200);assert.equal(mislabeled.status,old?400:200);assert.equal(large.status,old?400:200);
 const checks={version:health.version,normalJPEG:normal.status,mislabeledJPEG:mislabeled.status,largeJPEG:large.status};
 if(!old){
  assert.equal(large.asset.width,4096);const bytes=fs.readFileSync(path.join(input,'large.jpg'));
  const original=await fetch(base+large.asset.original_file_url,{headers:{Authorization:'Bearer '+auth.token}});assert(Buffer.from(await original.arrayBuffer()).equals(bytes));checks.originalPreserved=true;
 }
 const video=await upload('playback.mp4','video/mp4');assert.equal(video.status,200);
 await page.evaluate(async({token,file})=>{const response=await fetch(file,{headers:{Authorization:'Bearer '+token}}),url=URL.createObjectURL(await response.blob());const video=document.createElement('video');video.id='native-fullscreen-proof';video.src=url;video.controls=true;document.body.append(video);const button=document.createElement('button');button.id='fullscreen-proof-button';button.textContent='Full screen acceptance';button.onclick=()=>video.requestFullscreen().catch(()=>{});document.body.append(button)}, {token:auth.token,file:video.asset.file_url});
 await page.waitForFunction(()=>document.querySelector('#native-fullscreen-proof')?.readyState>=2);
 await page.locator('#fullscreen-proof-button').click();await page.waitForTimeout(250);checks.nativeFullscreen=await page.evaluate(()=>document.fullscreenElement?.id==='native-fullscreen-proof');assert.equal(checks.nativeFullscreen,!old);
 if(checks.nativeFullscreen)await page.evaluate(()=>document.exitFullscreen());
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({passed:true,checks,isolated:true,exe},null,2));console.log(JSON.stringify({passed:true,checks,directory}));
}finally{if(browser){await Promise.race([browser.newBrowserCDPSession().then(s=>s.send('Browser.close')).catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);await Promise.race([browser.close().catch(()=>{}),new Promise(r=>setTimeout(r,1000))])}if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(r,3000)})}
