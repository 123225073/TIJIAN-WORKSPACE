// Actual desktop UI + supplied local image; isolated profile, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const exe=process.env.TIJIAN_CHECK_EXE||path.resolve('release',version,'win-unpacked','梯世界工作台.exe');
const photo=process.env.TIJIAN_REAL_IMAGE;assert(photo&&fs.existsSync(photo));
const before=fs.readFileSync(photo),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const old=process.env.TIJIAN_EXPECT_MPO_REJECT==='1';
const directory=path.resolve('.runtime','hifly-ui-real-photo-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const child=spawn(exe,['--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_DESKTOP_DATA:directory}});
let browser;
try{
 for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:'+port+'/json/version')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const context=browser.contexts()[0];let page;
 for(let i=0;i<150;i++){page=context.pages()[0];if(page?.url().startsWith('http://127.0.0.1:'))break;await new Promise(r=>setTimeout(r,200))}assert(page);
 const base=new URL(page.url()).origin,health=await(await fetch(base+'/api/health')).json();
 const auth=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();assert(auth.token);
 const dataDir=path.join(directory,'data');
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
from pathlib import Path
from backend import store as s
assert s.DATA.resolve().is_relative_to(Path('.runtime').resolve()) and s.DATA.parent.name.startswith('hifly-ui-real-photo-')
s.init()
s.set_config('providers',[{'id':'fixture','title':'Isolated no-call provider','base_url':'https://example.invalid','protocol':'chat','secret':'fixture-only'}])
s.set_config('models',[{'id':'fixture-image','provider':'fixture','model':'gpt-image-1','title':'隔离参考图验证','verified':True,'published':True,'capability':'image'}])
s.set_config('bindings',{'text_image':'fixture-image','image_edit':'fixture-image'})
`],{windowsHide:true,stdio:'pipe',env:{...process.env,TIJIAN_DATA:dataDir}});let seedError='';seed.stderr.on('data',x=>seedError+=x);assert.equal(await new Promise(r=>seed.once('exit',r)),0,seedError);
 const headers={Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
 assert((await fetch(base+'/api/workspace',{method:'POST',headers,body:'{}'})).ok);
 const blocked=[];await context.route('**/*',r=>{const u=new URL(r.request().url());if(!['data:','blob:'].includes(u.protocol)&&u.origin!==base){blocked.push(u.origin);return r.abort()}if(r.request().method()==='POST'&&/generate|publish|\/jobs(?:\/|$)/.test(u.pathname)){blocked.push(u.pathname);return r.abort()}return r.continue()});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/avatar/create');await page.locator('.st-avatar-create').waitFor();await page.getByRole('button',{name:'人物照片创建',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.st-upload-inline input[type=file]')?.disabled);
 const uploadResponse=page.waitForResponse(r=>r.url().endsWith('/api/studio/upload')&&r.request().method()==='POST');
 await page.locator('.st-upload-inline input[type=file]').setInputFiles(photo);const uploaded=await uploadResponse;assert.equal(uploaded.status(),old?400:200);const asset=await uploaded.json();
 if(old)await page.getByText('图片编码不支持，请使用 JPEG、PNG 或 WebP',{exact:true}).waitFor();
 else{
  await page.getByText(/MPO.*主照片/).waitFor();assert.equal(asset.mime_type,'image/jpeg');assert.equal(asset.width,1737);assert.equal(asset.height,3088);assert.equal(await page.getByLabel('人物照片',{exact:false}).inputValue(),asset.id);
  const original=await fetch(base+asset.original_file_url,{headers});assert(Buffer.from(await original.arrayBuffer()).equals(before));await page.locator('.st-human-preview-inline img').waitFor();
 }
 await page.evaluate(()=>location.hash='studio/image');await page.waitForFunction(()=>document.querySelector('.media-refs-row')?.textContent.includes('/ 16'));
 const referenceResponse=page.waitForResponse(r=>r.url().endsWith('/api/studio/upload')&&r.request().method()==='POST');await page.locator('.media-refs input[type=file]').setInputFiles(photo);const reference=await referenceResponse;assert.equal(reference.status(),old?400:200);
 if(old)await page.locator('.media-refs .mw-error').filter({hasText:'图片编码不支持'}).waitFor();
 else{await page.locator('.media-refs-progress').filter({hasText:'MPO'}).waitFor();const item=await reference.json();await page.waitForFunction(value=>document.querySelector('.media-refs-selected')?.textContent.includes(value.id)||document.querySelector('.media-refs-selected')?.textContent.includes(value.name),{id:item.id,name:path.basename(photo)});}
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);assert.equal(hash(fs.readFileSync(photo)),hash(before));
 const result={passed:true,version:health.version,actual_desktop:true,actual_user_photo:true,avatarStatus:uploaded.status(),referenceStatus:reference.status(),source_unchanged:true,original_preserved:!old,no_provider_calls:true};fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,directory}));
}finally{if(browser){await Promise.race([browser.newBrowserCDPSession().then(s=>s.send('Browser.close')).catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);await Promise.race([browser.close().catch(()=>{}),new Promise(r=>setTimeout(r,1000))])}if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(r,3000)})}
