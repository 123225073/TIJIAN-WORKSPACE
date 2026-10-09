// Existing installed account and existing clone, read-only local API + playback.
// No credentials are printed, no provider request or generation is submitted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const exe=path.join(process.env.LOCALAPPDATA,'Programs','elevator-workbench','梯世界工作台.exe');
const directory=path.resolve('.runtime','installed-avatar-'+version);fs.mkdirSync(directory,{recursive:true});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const pidFile=path.join(directory,'launch.pid');
const child=spawn('powershell',['-NoProfile','-Command','$taskPreviewProcess=Start-Process -FilePath $env:TIJIAN_PREVIEW_EXE -ArgumentList @("--remote-debugging-address=127.0.0.1","--remote-debugging-port=$env:TIJIAN_PREVIEW_PORT") -WindowStyle Hidden -PassThru; $taskPreviewProcess.Id | Set-Content -LiteralPath $env:TIJIAN_PREVIEW_PID_FILE'],{windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_PREVIEW_EXE:exe,TIJIAN_PREVIEW_PORT:String(port),TIJIAN_PREVIEW_PID_FILE:pidFile}});
let browser,diagnosticPage;
try {
 for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:'+port+'/json/version')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const context=browser.contexts()[0];let page;
 for(let i=0;i<250;i++){page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:'));if(page)break;await new Promise(r=>setTimeout(r,200))}
 assert(page);diagnosticPage=page;assert(page.url().startsWith('http://127.0.0.1:'));
 page.on('console',m=>{if(m.type()==='error')console.log('PAGE ERROR',m.text().slice(0,250))});
 page.on('pageerror',e=>console.log('RENDER ERROR',e.message));
 // Do not reload while desktop/main.cjs is still awaiting its initial loadURL;
 // that aborts startup itself. Inspect only after the initial document is ready.
 await page.waitForLoadState('domcontentloaded');
 await page.waitForFunction(()=>Boolean(sessionStorage.getItem('tijian-session')),{},{timeout:30000});
 const health=await page.evaluate(()=>fetch('/api/health').then(r=>r.json()));assert.equal(health.version,version);
 const servedIndex=await page.evaluate(()=>fetch('/').then(r=>r.text()));
 assert.equal(servedIndex,fs.readFileSync('dist/index.html','utf8'),'Installed frontend must match this final build');
 const installedBundle=path.join(path.dirname(exe),'resources','backend','tijian-service','_internal','desktop-frontend.zip');
 const fileHash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 assert.equal(fileHash(installedBundle),fileHash('.runtime/desktop-frontend.zip'));
 assert.equal(fileHash(path.join(path.dirname(exe),'resources','backend','tijian-service','tijian-service.exe')),fileHash('.runtime/backend-dist/tijian-service/tijian-service.exe'));
 const clone=await page.evaluate(async()=>{
  const r=await fetch('/api/studio/assets?asset_type=avatar',{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}});if(!r.ok)throw Error('Existing asset list unavailable');
  const data=await r.json();if(data.public_library_enabled!==false||data.items.some(a=>a.visibility==='public'))throw Error('Public avatars should no longer be offered');const asset=data.items.find(a=>a.clone_status==='succeeded'&&a.preview_asset_type==='video'&&a.preview_origin==='creation_source');
  if(!asset)throw Error('Existing completed video clone is missing its creation preview');
  return {id:asset.id,title:asset.title,draft_id:asset.draft_id};
 });
 const speechContract=await page.evaluate(async()=>{const r=await fetch('/api/studio/catalog',{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}});if(!r.ok)throw Error('Catalog unavailable');const d=await r.json();return (d.tools||d.items).filter(t=>['text_avatar','photo_talk','audio_avatar'].includes(t.id)).map(t=>({id:t.id,speech_speed:t.speech_speed}))});
 assert.equal(speechContract.find(t=>t.id==='text_avatar').speech_speed.per_generation,false);assert.equal(speechContract.find(t=>t.id==='audio_avatar').speech_speed.mode,'original_audio');assert.equal(speechContract.find(t=>t.id==='photo_talk').speech_speed.voice_edit.parameters.rate.max,2);
 const forbidden=[];page.on('request',r=>{if(r.method()==='POST'&&/\/studio\/generate|\/publish/.test(new URL(r.url()).pathname))forbidden.push(new URL(r.url()).pathname)});
 await page.evaluate(()=>location.hash='studio/avatar/library');
 const card=page.locator('.st-resource-card').filter({hasText:clone.title});await card.waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.st-resource-card video')].some(v=>v.readyState>=2&&v.videoWidth>0));
 assert.match(await card.innerText(),/飞影已确认克隆完成/);assert.match(await card.innerText(),/创建原视频预览/);
 await card.locator('video').evaluate(v=>{v.muted=true;return v.play()});
 await page.waitForFunction(()=>[...document.querySelectorAll('.st-resource-card video')].some(v=>v.currentTime>.3));
 await card.getByRole('button',{name:/放大预览/}).click();
 const dialog=page.locator('.studio-modal[open]');await dialog.waitFor();
 await page.waitForFunction(()=>document.querySelector('.studio-modal[open] video')?.readyState>=2);
 const media=await dialog.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
 assert(media.width>0&&media.height>0&&media.duration>0);
 await page.screenshot({path:path.join(directory,'actual-avatar-large.png')});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 await page.screenshot({path:path.join(directory,'actual-avatar-library.png'),fullPage:true});
 if(clone.draft_id){
  await page.evaluate(id=>location.hash='studio/avatar/create?draft='+id,clone.draft_id);
  await page.locator('.st-clone-output video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.st-clone-output video')?.readyState>=2);
  assert.match(await page.locator('.st-clone-output').innerText(),/飞影已确认克隆完成/);
  assert.equal(await page.locator('.st-clone-output').getByRole('button',{name:'下载',exact:true}).count(),0);
  assert.equal(await page.locator('.st-human-workspace .st-human-requirements,.st-human-workspace .st-human-async-note').count(),0);
  await page.locator('.st-editor .st-selected-resource').waitFor();
  assert.equal(await page.locator('.st-editor video').count(),0,'Selected source preview should be compact until opened');
  await page.screenshot({path:path.join(directory,'actual-avatar-result.png'),fullPage:true});
 }
 await page.evaluate(()=>location.hash='studio/brand');
 const personalCard=page.locator('.ip-resource-card').filter({hasText:clone.title});await personalCard.waitFor();
 await personalCard.scrollIntoViewIfNeeded();await personalCard.locator('video').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.ip-resource-card video')].some(v=>v.readyState>=2&&v.videoWidth>0));
 await personalCard.locator('video').evaluate(v=>{v.muted=true;return v.play()});
 await page.waitForFunction(()=>[...document.querySelectorAll('.ip-resource-card video')].some(v=>v.currentTime>.2));
 await personalCard.getByRole('button',{name:/放大预览/}).click();await dialog.waitFor();
 await page.waitForFunction(()=>document.querySelector('.studio-modal[open] video')?.readyState>=2);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 await page.screenshot({path:path.join(directory,'actual-personal-ip.png'),fullPage:true});
 const defaults=await page.evaluate(async()=>{const r=await fetch('/api/studio/resource-defaults',{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}});if(!r.ok)throw Error('Default resource preferences unavailable');return r.json()});
 assert('avatar_id' in defaults&&'voice_id' in defaults);
 assert.deepEqual(forbidden,[]);
 const report={passed:true,version,actual_installed_app:true,final_build_matches:true,actual_existing_clone:true,first_frame:true,playback:true,enlargement:true,creation_result:!!clone.draft_id,personal_ip_preview:true,resource_defaults_read:true,public_avatars_removed:true,speech_contract_verified:true,compact_source_preview:true,media,paid_generation:false};
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,directory}));
}catch(error){
 if(diagnosticPage){console.log('LOCAL PAGE',new URL(diagnosticPage.url()).origin);console.log('LOCAL PAGE TEXT',(await diagnosticPage.locator('body').textContent({timeout:5000}).catch(()=>''))?.slice(0,1000));await diagnosticPage.screenshot({path:path.join(directory,'failure.png'),timeout:5000}).catch(()=>{})}
 throw error;
}finally{
 if(browser){await Promise.race([browser.newBrowserCDPSession().then(s=>s.send('Browser.close')).catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);await browser.close().catch(()=>{})}
 if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(r,3000)})
 if(fs.existsSync(pidFile)){
  const owned=Number(fs.readFileSync(pidFile,'utf8').trim());
  if(Number.isInteger(owned)&&owned>0){const stop=spawn('taskkill',['/PID',String(owned),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>stop.once('exit',r))}
 }
}
