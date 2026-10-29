// Real App/API/SQLite with the explicit offline model fixture; local fault injection only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {startIsolatedUI} from './test-studio-color-states.mjs';
const f=await startIsolatedUI('home-chat-0300'),checks=[],errors=[],requests=[];
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1000,height:700}});page.setDefaultTimeout(12000);
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname)});
const home=async()=>{await page.goto(f.base+'/#studio/home');await page.locator('.tw-chat').waitFor();await page.waitForFunction(()=>!document.querySelector('.tw-send')?.disabled)};
const input=()=>page.getByRole('textbox',{name:'向梯世界提问'}),send=()=>page.getByRole('button',{name:'开始对话',exact:true});
const saved=async()=> (await f.call('/state')).objects.filter(x=>x.kind==='task');
const step=async(name,fn)=>{await fn();checks.push(name);console.log(JSON.stringify({passed:name}));};
try{
 await f.call('/workspace',{path:path.join(f.directory,'workspace')});
 await f.call('/objects/profile',{title:'首页测试 IP',status:'accepted',position:'仅为离线界面测试'});
 await f.attach(page);await page.reload();await home();
 await step('空白发送只打开聊天：零消息、零模型请求，刷新后输入框仍为空',async()=>{
  const before=requests.filter(x=>x.endsWith('/send')).length;
  await send().click();await page.locator('.aw-workspace').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'对话要求'}).inputValue(),'');
  assert.equal(await page.locator('.aw-message').count(),0);
  assert.equal(requests.filter(x=>x.endsWith('/send')).length,before);
  assert.equal((await saved()).length,1);assert.equal((await saved())[0].messages.length,0);
  await page.reload();await page.locator('.aw-workspace').waitFor();assert.equal(await page.getByRole('textbox',{name:'对话要求'}).inputValue(),'');
  await page.screenshot({path:path.join(f.directory,'empty-chat-1000.png')});
 });
 await step('首页输入跨页面和重载保留；中文输入法确认不误发送',async()=>{
  await home();await input().fill('尚未发送的首页输入');await page.evaluate(()=>location.hash='studio/works');await page.locator('.st-work-tabs').waitFor().catch(()=>page.locator('.studio-v2').waitFor());
  await home();assert.equal(await input().inputValue(),'尚未发送的首页输入');await page.reload();await input().waitFor();assert.equal(await input().inputValue(),'尚未发送的首页输入');
  const count=(await saved()).length;await input().dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal((await saved()).length,count);
 });
 await step('正常首页发送只提交一次，消息与离线测试回复可见',async()=>{
  await input().fill('你好');const before=requests.filter(x=>x.endsWith('/send')).length;
  await send().click();await page.locator('.aw-message.user').waitFor();await page.locator('.aw-message.assistant').waitFor();
  assert.equal(await page.locator('.aw-message.user').count(),1);assert.equal(requests.filter(x=>x.endsWith('/send')).length,before+1);
  assert.match(await page.locator('.aw-message.assistant').innerText(),/隔离模型测试/);
  assert.equal(await page.getByRole('textbox',{name:'对话要求'}).inputValue(),'');
  await page.screenshot({path:path.join(f.directory,'visible-response.png')});
 });
 await step('发送被拒绝时错误留在首页，重试复用对话并保留原文',async()=>{
  await home();await input().fill('发送失败恢复测试');
  await page.route('**/api/tasks/*/send',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({detail:'隔离故障注入：模型暂不可用'})}));
  await send().click();await page.locator('.tw-chat-error').filter({hasText:'模型暂不可用'}).waitFor();assert.equal(await input().inputValue(),'发送失败恢复测试');
  const before=(await saved()).length;await page.unroute('**/api/tasks/*/send');await send().click();await page.locator('.aw-message.user').waitFor();assert.equal((await saved()).length,before);
 });
 await step('服务已收到但响应丢失：再次点击不会重复提交或创建',async()=>{
  await home();await input().fill('响应丢失恢复测试');
  let serverAccepted=false;await page.route('**/api/tasks/*/send',async r=>{const response=await r.fetch();assert(response.ok());serverAccepted=true;await r.abort('failed')});
  await send().click();await page.locator('.tw-chat-error').waitFor();assert(serverAccepted);
  const count=(await saved()).length,submits=requests.filter(x=>x.endsWith('/send')).length;
  await page.unroute('**/api/tasks/*/send');await send().click();await page.locator('.aw-message.user').waitFor();
  assert.equal((await saved()).length,count);assert.equal(requests.filter(x=>x.endsWith('/send')).length,submits);
 });
 await step('发送后读取失败仍保留问题，重试恢复已接受的消息',async()=>{
  await home();await input().fill('读取失败恢复测试');
  await page.route('**/api/state/updates?*',r=>r.abort('failed'));
  await send().click();await page.locator('.tw-chat-error').waitFor();assert(page.url().endsWith('#studio/home'));assert.equal(await input().inputValue(),'读取失败恢复测试');
  const count=(await saved()).length,submits=requests.filter(x=>x.endsWith('/send')).length;
  await page.unroute('**/api/state/updates?*');await send().click();await page.locator('.aw-message.user').waitFor();
  assert.equal((await saved()).length,count);assert.equal(requests.filter(x=>x.endsWith('/send')).length,submits);
 });
 await step('新聊天不等待整库刷新；离开首页后不会被迟到响应拉回',async()=>{
  await home();await input().fill('');let stateReads=0;
  await page.route('**/api/state',async r=>{stateReads++;await new Promise(resolve=>setTimeout(resolve,1800));await r.continue()});
  const start=Date.now();await send().click();await page.locator('.aw-workspace').waitFor();assert.equal(stateReads,0);assert(Date.now()-start<1800);
  await page.unroute('**/api/state');await home();
  await page.route('**/api/tasks/open',async r=>{await new Promise(resolve=>setTimeout(resolve,800));await r.continue()});
  await send().click();await page.evaluate(()=>location.hash='studio/works');await page.waitForTimeout(1400);assert(page.url().endsWith('#studio/works'));
  await page.unroute('**/api/tasks/open');
 });
 await step('未配置模型仍可空白进入，不伪装发送成功',async()=>{
  const result=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',"from backend import store as s;s.set_config('models',[]);s.set_config('bindings',{})"],{env:f.env,windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  await page.reload();await home();await input().fill('');assert.equal(await send().isEnabled(),true);
  const before=requests.filter(x=>x.endsWith('/send')).length;await send().click();await page.locator('.aw-workspace').waitFor();assert.equal(requests.filter(x=>x.endsWith('/send')).length,before);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(f.guard.external,[]);assert.deepEqual(f.guard.forbidden,[]);
}catch(e){process.exitCode=1;errors.push(e.stack);console.error(e.stack);await page.screenshot({path:path.join(f.directory,'failure.png')});}
finally{await browser.close();f.close();fs.writeFileSync(path.join(f.directory,'results.json'),JSON.stringify({checks,errors,requests,guard:f.guard,paidCalls:0,fixtureModel:true,integration:f.integration},null,2));console.log(JSON.stringify({directory:f.directory,passed:checks.length,failed:errors.length}));}
