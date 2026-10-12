// Actual populated platform forms, including late feature CSS and scroll states.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('delivery-chrome');
const states=[],errors=[],red=process.argv.includes('--expect-red'),sourceCSS=process.argv.includes('--source-css');
let browser,page;
try{
 await fixture.call('/workspace',{});
 const topic=await fixture.call('/studio/topics',{title:'隔离测试：电梯价格与现场条件',angle:'用户已有选题，核对资料后表达。',source_ids:[],origin:'隔离历史资料'});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 page=await browser.newPage({viewport:{width:1530,height:1000}});page.on('pageerror',e=>errors.push(e.message));await fixture.attach(page);
 // Pure local HTML preview, not publication or a provider request.
 await page.route('**/api/wechat-publish/preview',route=>route.continue());
 const scan=async(name,scope='.td-page')=>{await settleUI(page);const result=await page.evaluate(measureContrast,{scope,excludeUserPaper:true});assert(result.checked>0);states.push({name,...result});await page.screenshot({path:path.join(fixture.directory,name+'.png'),fullPage:true});};
 for(const platform of ['douyin','channels','wechat']){
  await page.goto(fixture.base+'/?ui=1#studio/topics?topic='+topic.id+'&platform='+platform);
  await page.locator('.td-publish-card,.wa-card').first().waitFor();
  if(sourceCSS)await page.addStyleTag({content:fs.readFileSync('src/studio-theme.css','utf8')});
  await scan(platform+'-default');
  const control=page.locator('.td-publish button:not(:disabled)').last();await control.hover();await scan(platform+'-hover');await control.focus();await scan(platform+'-focus');
  await control.evaluate(n=>n.disabled=true);await scan(platform+'-disabled');await control.evaluate(n=>n.disabled=false);
  await page.locator('.page-area').evaluate(n=>n.scrollTop=n.scrollHeight);await scan(platform+'-scrolled');
  if(platform==='wechat'){
   const paper=page.locator('.wa-rich-editor');assert.equal(await paper.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(247, 248, 252)','authored white paper remains intact');
  }
 }
 // Connected-account branches use explicit UI fixtures; no real account or keys.
 const saved=await fixture.call('/studio/deliveries',{topic_id:topic.id,platform:'wechat',title:'隔离历史稿件',body:'## 已有正文\n\n先核对现场条件。'});
 await page.route('**/api/wechat-publish/accounts',route=>route.fulfill({json:{items:[{id:'isolated-account',name:'隔离账号样式',app_id:'fixture-account',enabled:true,has_secret:true}]}}));
 let publishState='draft';
 await page.route('**/api/wechat-publish/records/*',route=>route.fulfill({json:{items:[{id:'isolated-record',account_id:'isolated-account',delivery_id:saved.id,delivery_version:saved.version,status:publishState,synced_at:'2026-10-01T00:00:00Z'}]}}));
 for(const status of ['draft','failed','uncertain','published']){
  publishState=status;await page.goto(fixture.base+'/?ui=1#studio/topics?topic='+topic.id+'&platform=wechat');await page.reload();await page.locator('.wp-steps').waitFor({timeout:8000}).catch(async e=>{await page.screenshot({path:path.join(fixture.directory,'account-failure.png'),fullPage:true});console.log(JSON.stringify({failure:e.message,body:await page.locator('.wp-panel').innerText(),directory:fixture.directory}));throw e;});
  if(sourceCSS)await page.addStyleTag({content:fs.readFileSync('src/studio-theme.css','utf8')});
  await scan('wechat-account-'+status);
 }
 await page.goto(fixture.base+'/?ui=1#studio/topics');await page.getByRole('button',{name:'找题 / 添加选题',exact:true}).click();await page.locator('.td-add-drawer').waitFor();
 if(sourceCSS)await page.addStyleTag({content:fs.readFileSync('src/studio-theme.css','utf8')});
 await scan('topic-add-ai-drawer','.td-add-drawer');await page.getByRole('tab',{name:'自己添加',exact:true}).click();await scan('topic-add-manual-drawer','.td-add-drawer');
 const violations=states.flatMap(s=>s.violations.map(v=>({state:s.name,...v})));
 const passed=red?violations.some(v=>v.contrast<1.5):violations.length===0&&errors.length===0;
 const report={passed,red,sourceCSS,fixture_only:true,real_paid_model:false,states,violations,errors,guard:fixture.guard};
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed,red,states:states.length,checked:states.reduce((n,s)=>n+s.checked,0),violations:violations.length,errors,directory:fixture.directory,examples:violations.slice(0,6)}));
 assert(passed,'see populated platform-form contrast report');assert.equal(fixture.guard.external.length,0);assert.equal(fixture.guard.forbidden.length,0);
}finally{await browser?.close();fixture.close();}
