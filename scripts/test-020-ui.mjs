import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const dir=path.resolve('.runtime','020-ui-'+Date.now());
fs.mkdirSync(dir,{recursive:true});
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
 windowsHide:true,stdio:['ignore','ignore','pipe'],
 env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let errors='',browser;
service.stderr.on('data',chunk=>errors+=chunk);
const base='http://127.0.0.1:'+port;
try{
 let ready=false;
 for(let i=0;i<150;i++){
  try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 if(!ready)throw Error(errors||'Fixture not ready');
 const auth=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'release-020@example.test',password:'isolated-test-only',name:'界面验收'})})).json();
 const api=async(url,body)=>{const r=await fetch(base+'/api'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json()};
 await api('/workspace',{});
 await api('/objects/profile',{title:'我的电梯 IP',position:'电梯知识讲解',audience:'物业经理',agency_brands:'代理品牌资料写在 IP 内'});
 browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),checks=[],pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(base);await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/home');
 const route=async value=>{await page.evaluate(v=>location.hash=v,value);await page.waitForFunction(v=>location.hash==='#'+v&&!!document.querySelector('.studio-shell'),value);await page.waitForTimeout(450)};
 const shot=async name=>page.screenshot({path:path.join(dir,name+'.png'),fullPage:false});
 await page.waitForSelector('.studio-shell');
 await route('studio/brand');
 await page.waitForFunction(()=>document.querySelector('.ip-dashboard')?.innerText.includes('我的电梯 IP'));
 assert(!await page.locator('.ip-dashboard').innerText().then(x=>x.includes('手动新建品牌')));
 assert(await page.locator('.ip-assets').innerText().then(x=>x.includes('数字人形象')&&x.includes('我的声音')));
 await shot('personal-ip');checks.push('single IP with avatar and voice assets');
 await route('knowledge');await page.waitForFunction(()=>document.body.innerText.includes('我的知识库'));
 assert(!await page.locator('body').innerText().then(x=>x.includes('整理为 Wiki / 记忆')));checks.push('personal knowledge has no manual Wiki action');
 await route('studio/video');await page.waitForSelector('.media-workbench .mw-panel');
 assert.equal(await page.locator('.vs-compact .vs-tabs button').count(),4);
 assert(await page.locator('.media-refs').count()===1&&await page.locator('.mw-stage').count()===1);
 await shot('video-studio');checks.push('four video scenarios, integrated references and output stage');
 await page.locator('.studio-sidebar-toggle').click();
 await page.waitForFunction(()=>document.querySelector('.studio-shell')?.classList.contains('sidebar-is-compact'));
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).width==='74px');
 assert.equal(await page.locator('.sidebar').evaluate(e=>getComputedStyle(e).width),'74px');
 await shot('compact-nav');checks.push('icon-only sidebar remains compact');
 await route('studio/avatar/audio');await page.waitForSelector('.st-model-select select');
 await page.locator('.st-model-select select').selectOption('media:wavespeed-infinitetalk');
 await page.waitForFunction(()=>document.querySelector('.st-fields')?.innerText.includes('参考图片'));
 assert(!await page.locator('.st-fields').innerText().then(x=>x.includes('出镜形象')));
 await shot('digital-human');checks.push('InfiniteTalk uses photo and audio');
 const adminPage=await browser.newPage({viewport:{width:1530,height:1000}});
 adminPage.on('pageerror',error=>pageErrors.push(error.message));
 await adminPage.goto(base+'/admin.html');
 await adminPage.getByLabel('管理员账号').fill('admin');
 await adminPage.getByLabel('密码').fill('admin');
 await adminPage.getByRole('button',{name:'登录管理后台'}).click();
 await adminPage.getByRole('heading',{name:'模型与服务'}).waitFor();
 await adminPage.getByRole('button',{name:'视频、图片与数字人模型'}).click();
 await adminPage.getByText('WaveSpeedAI',{exact:false}).first().waitFor();
 await adminPage.screenshot({path:path.join(dir,'admin-services.png'),fullPage:false});
 await adminPage.close();checks.push('admin/admin login opens model and service management');
 assert(!pageErrors.some(x=>/ReferenceError|TypeError|Minified React|Maximum update depth/.test(x)),pageErrors.join('\n'));
 console.log(JSON.stringify({passed:true,checks,dir,pageErrors}));
}finally{if(browser)await browser.close();service.kill()}
