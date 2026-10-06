import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const dir=path.resolve('.runtime','topic-library-ui-'+Date.now());
fs.mkdirSync(dir,{recursive:true});
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
 windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let errors='',browser;
service.stderr.on('data',chunk=>errors+=chunk);
try{
 let ready=false;
 for(let i=0;i<150;i++){try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(resolve=>setTimeout(resolve,150))}
 if(!ready)throw Error(errors||'Fixture not ready');
 const login=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'topic@example.test',password:'isolated-test-only',name:'选题测试'})});
 assert.equal(login.status,200);
 const auth=await login.json(),headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 assert.equal((await fetch(base+'/api/workspace',{method:'POST',headers,body:'{}'})).status,200);
 for(const title of ['电梯选型核对','维保资料整理']){
  const result=await fetch(base+'/api/studio/topics',{method:'POST',headers,body:JSON.stringify({title,angle:'检查实际现场条件，保留完整参数与客户需求。',rationale:'选题来自客户的实际疑问，可用现场信息和完整资料解释，避免凭空编造价格或项目案例。',origin:'隔离来源核对'})});
  assert.equal(result.status,200);
 }
 browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1480,height:960}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(base);
 await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/topics');
 await page.getByRole('region',{name:'选题库列表管理'}).waitFor();
 await page.getByRole('row').filter({hasText:'电梯选型核对'}).waitFor();
 const layout=[];
 for(const viewport of [{width:1530,height:1000},{width:1366,height:768},{width:1000,height:700}]){
  await page.setViewportSize(viewport);await page.getByRole('searchbox',{name:'搜索选题'}).focus();await settleUI(page);
  const metrics=await page.evaluate(()=>{
   const search=document.querySelector('.tlc-search'),input=search.querySelector('input'),svg=search.querySelector('svg'),rect=search.getBoundingClientRect(),ir=input.getBoundingClientRect(),sr=svg.getBoundingClientRect(),style=getComputedStyle(input);
   const statuses=[...document.querySelectorAll('.tlc-status .tlc-next')].map(n=>{const r=document.createRange();r.selectNodeContents(n);return {lines:r.getClientRects().length,whiteSpace:getComputedStyle(n).whiteSpace}});
   return {height:rect.height,width:rect.width,inline:Math.abs((ir.top+ir.height/2)-(sr.top+sr.height/2))<2,border:style.borderTopWidth,inputShadow:style.boxShadow,statuses,overflow:document.documentElement.scrollWidth>innerWidth+2};
  });
  assert.equal(metrics.height,40,'search is one compact 40px row');assert(metrics.inline,'search icon and input align horizontally');assert.equal(metrics.border,'0px');assert.equal(metrics.inputShadow,'none','focus ring belongs to the outer control only');assert(metrics.statuses.every(s=>s.lines===1&&s.whiteSpace==='nowrap'),'next-action status must stay on one line');assert(!metrics.overflow,'narrow viewport scrolls inside the table, not the page');
  const contrast=await page.evaluate(measureContrast,{scope:'.tlc'});assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations));
  await page.screenshot({path:path.join(dir,'topics-'+viewport.width+'.png')});layout.push({viewport,...metrics});
 }
 await page.setViewportSize({width:1480,height:960});
 const search=page.getByRole('searchbox',{name:'搜索选题'});await search.fill('电梯选型');assert.equal(await page.locator('.tlc-title').count(),1);await page.getByRole('button',{name:'清空选题搜索'}).click();assert.equal(await search.inputValue(),'');assert.equal(await page.locator('.tlc-title').count(),2);
 await page.getByRole('row').filter({hasText:'电梯选型核对'}).getByRole('button',{name:'编辑'}).click();
 await page.getByRole('textbox',{name:'切入角度'}).fill('先核对参数与使用场景');
 await page.getByRole('button',{name:'保存选题'}).click();
 await page.getByText('选题已保存').waitFor();
 await page.getByRole('checkbox',{name:'选择当前列表全部选题'}).check();
 const selectedContrast=await page.evaluate(measureContrast,{scope:'.tlc'});assert.equal(selectedContrast.violations.length,0,JSON.stringify(selectedContrast.violations));
 await page.getByRole('button',{name:/批量删除/}).click();
 await page.getByText('已移入回收区 2 条选题').waitFor();
 await page.getByRole('button',{name:'回收区'}).click();
 await page.getByText('电梯选型核对').waitFor();
 await page.getByRole('checkbox',{name:'选择当前列表全部选题'}).check();
 await page.getByRole('button',{name:/批量恢复/}).click();
 await page.getByRole('button',{name:'可用选题'}).click();
 await page.getByText('先核对参数与使用场景').waitFor();
 const topics=await(await fetch(base+'/api/studio/topics',{headers})).json();
 assert.equal(topics.items.length,2);
 assert(topics.items.some(x=>x.title==='电梯选型核对'&&x.angle==='先核对参数与使用场景'));
 assert.deepEqual(pageErrors,[]);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,layout,search_filter_and_clear:true,private_data:false,live_providers_called:false},null,2));
 console.log(JSON.stringify({passed:true,checks:['compact inline search with one focus border','three viewport layouts','readable status columns','search and clear','inline topic edit','batch soft delete','recycle bin restore','persisted edit'],dir}));
}finally{if(browser)await browser.close();service.kill()}
