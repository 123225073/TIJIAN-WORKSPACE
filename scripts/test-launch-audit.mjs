// Integrated UI audit with disposable SQLite and labelled fixtures. No live provider calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startIsolatedUI, measureContrast, settleUI} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('launch-audit');
const selected=process.argv.find(arg=>arg.startsWith('--routes='))?.slice(9).split(',');
const results=[],errors=[];
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage();page.setDefaultTimeout(12000);
page.setDefaultNavigationTimeout(15000);
page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));
const routes=['studio/home','studio/flow','benchmark','studio/topics','studio/text','studio/image','studio/video','studio/avatar/text','studio/audio/tts','studio/audio/clone','studio/avatar/video','studio/avatar/photo','studio/compose','studio/brand','studio/works','knowledge','studio/assistant','studio/memory-settings','studio/about','settings/accounts','settings/ai','settings/radar','settings/workspace','settings/memory','settings/benchmark','settings/cimi','review','records','content','identity','radar','tasks'];
const scan=async(name,scope)=>{
 console.log('Measuring '+name);
 await settleUI(page);
 const layout=await page.evaluate(scope=>{
  const root=document.querySelector(scope);
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility==='visible'&&!el.closest('details:not([open])')};
  const outside=[...(root?.querySelectorAll('button,input,select,textarea,a')||[])].filter(visible).map(el=>{const r=el.getBoundingClientRect();return {text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.tagName).trim().slice(0,70),left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)}}).filter(r=>r.left < -2 || r.right>innerWidth+2);
  return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:root?root.scrollWidth-root.clientWidth:0,outside,heading:root?.querySelector('h1,h2')?.textContent,bodyText:root?.innerText.slice(0,650),fatal:!!document.querySelector('.fatal')};
 },scope);
 const contrast=await page.evaluate(measureContrast,{scope,excludeUserPaper:true,viewportOnly:true});
 const screenshot=name.replaceAll('/','-')+'.png';
 await page.screenshot({path:path.join(fixture.directory,screenshot),fullPage:false});
 results.push({name,...layout,contrast:{checked:contrast.checked,violations:contrast.violations},screenshot});
 console.log(JSON.stringify({name,overflow:layout.documentOverflow,outside:layout.outside.length,contrast:contrast.violations.length}));
};
try{
 await fixture.call('/workspace',{path:path.join(fixture.directory,'workspace')});
 await fixture.call('/objects/profile',{title:'隔离验收：电梯服务顾问',position:'真实资料为先',status:'accepted'});
 await fixture.call('/import/text',{title:'隔离验收：资料保存与阅读',body:'本记录只用于上线检查，不是真实行业新闻。\n\n检查资料保存、阅读和页面排版。'});
 await fixture.call('/studio/topics',{title:'隔离验收：维保沟通准备',angle:'资料核对',status:'selected',source_ids:[]});
 console.log('Fixture seeded; opening UI');
 await fixture.attach(page);
 console.log('UI attached');
 const admin=await(await fetch(fixture.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();assert(admin.token);
 await page.evaluate(token=>sessionStorage.setItem('tijian-admin-session',token),admin.token);
 await page.reload();
 for(const size of [{width:1530,height:950},{width:1000,height:700}]){
  await page.setViewportSize(size);
  for(const route of routes.filter(route=>!selected||selected.includes(route))){
   const name=size.width+'-'+route;
   console.log('Opening '+name);
   try{await page.goto(fixture.base+'/#'+route);await page.locator('.page-area').waitFor();await page.waitForFunction(()=>!document.querySelector('.cf-data-loading,.cf-restoring'));await page.waitForTimeout(180);await scan(name,'.page-area');if(route==='studio/assistant'){await page.locator('.ka-starters').scrollIntoViewIfNeeded();assert(await page.locator('.ka-starters button').evaluateAll(buttons=>buttons.every(button=>getComputedStyle(button).display==='grid'&&button.querySelector('strong').getBoundingClientRect().height<40)),'Question cards keep readable horizontal titles');await scan(name+'-cards','.ka-starters');}}
   catch(e){results.push({name,error:e.message});console.log(JSON.stringify({name,error:e.message}));}
  }
  for(const tab of selected?[]:['models','bindings','benchmark','knowledge','skills','users','audit']){
   const name=size.width+'-admin-'+tab;
   try{await page.goto(fixture.base+'/admin.html#'+tab);await page.locator('.admin-main').waitFor();await page.waitForTimeout(180);await scan(name,'.admin-main');}catch(e){results.push({name,error:e.message});}
  }
 }
}finally{
 await browser.close();fixture.close();
 const failures=results.filter(r=>r.error||r.fatal||r.documentOverflow>2||r.outside?.length||r.contrast?.violations.length);
 fs.writeFileSync(path.join(fixture.directory,'results.json'),JSON.stringify({results,errors,guard:fixture.guard,integration:fixture.integration,paidCalls:0,fixtureOnly:true},null,2));
 console.log(JSON.stringify({directory:fixture.directory,states:results.length,failures:failures.map(r=>r.name),errors,guard:fixture.guard}));
 if(failures.length||errors.length||fixture.guard.forbidden.length)process.exitCode=1;
}
