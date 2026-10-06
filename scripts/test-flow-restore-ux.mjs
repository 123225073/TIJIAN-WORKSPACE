// Built UI + disposable API. No installed data, providers or real generation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast,workflowMetrics} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('flow-restore-ux');let browser,release;
try{
 await fixture.call('/workspace',{});
 const topic=await fixture.call('/studio/topics',{title:'隔离视觉验收主题',source_ids:[]});
 const work=await fixture.call('/studio/flow',{new:true,version:0,brief:'流程响应验收',stage:2,topic_id:topic.id});
 const drafts=[];for(let i=0;i<8;i++)drafts.push(await fixture.call('/studio/flows/'+work.id+'/drafts',{tool:'text',title:'隔离历史草稿 '+i,input:{brief:'恢复与返回验收内容',format:'通用文案'}}));
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',`import json,sys\nfrom backend import store as s\ns.init();d=json.load(sys.stdin)\nc=s.put(d['owner'],'content',{'title':'尚未选入的已生成文稿','body':'Keep candidate content'})\ns.put(d['owner'],'job',{'input':{'draft_id':d['draft']},'status':'done','result':{'content_id':c['id']}})\nprint(c['id'])`],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let seeded='',seedError='';seed.stdout.on('data',x=>seeded+=x);seed.stderr.on('data',x=>seedError+=x);seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id,draft:drafts[0].id}));assert.equal(await new Promise(resolve=>seed.on('exit',resolve)),0,seedError);
 const candidateId=seeded.trim(),beforeRestore=await fixture.call('/state');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1366,height:768}});await fixture.attach(page);
 const errors=[],reads=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))(r.method()==='GET'?reads:writes).push(new URL(r.url()).pathname)});
 const barrier=new Promise(resolve=>release=resolve);
 await page.route('**/api/state',route=>route.fulfill({json:beforeRestore}));
 await page.route('**/api/studio/flow*',async route=>{const r=route.request();if(new URL(r.url()).pathname==='/api/studio/flow'&&r.method()==='GET')await barrier;await route.continue()});
 await page.goto(fixture.base+'/?ui=1#studio/flow',{waitUntil:'domcontentloaded'});
 await page.getByRole('status').filter({hasText:'正在恢复创作步骤'}).waitFor();
 assert.equal(await page.locator('.cf-skeleton-node').count(),5,'display all steps while restore is held');
 assert.equal(await page.locator('.cf-page :is(input,textarea,select)').count(),0,'no editable cached flow before server validation');
 assert.equal(await page.locator('.cf-page button:not(:disabled)').count(),0,'no flow mutation before validation');
 await page.screenshot({path:path.join(fixture.directory,'restore-skeleton.png')});
 release();await page.locator('.cf-tool-grid button').nth(5).waitFor();await settleUI(page);
 assert.equal(reads.filter(p=>p==='/api/studio/flow').length,1,'canonical redirect consumes the validated response once');
 await page.waitForFunction(()=>!document.querySelector('.cf-data-loading'));
 assert.equal(reads.filter(p=>p==='/api/state').length,1,'flow does not request a second full library refresh');
 const cases=[];
 for(const viewport of [{width:1530,height:1000},{width:1366,height:768},{width:1000,height:700}]){
  await page.setViewportSize(viewport);await settleUI(page);
  const metrics=await workflowMetrics(page);assert(metrics.nodes.every(n=>n.visible&&n.buttonVisible));
  assert(!metrics.scrolls.some(n=>n.content>n.height+2));
  assert.equal(await page.locator('.cf-branch-drafts[open]').count(),0,'history starts collapsed');
  const choices=page.getByRole('group',{name:'选择本次创作工具'});assert.equal(await choices.locator('svg.cf-tool-art').count(),6);
  for(const label of ['文案创作','图片创作','AI 视频','数字人口播','文本配音','素材成片']){
   await choices.getByRole('button',{name:label,exact:true}).click();
   assert.equal(await choices.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
   const contrast=await page.evaluate(measureContrast,{scope:'.cf-tool-grid'});assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations));
  }
  cases.push(viewport);
 }
 await page.setViewportSize({width:1530,height:1000});await choicesIn(page).getByRole('button',{name:'文案创作',exact:true}).click();
 await page.locator('.cf-branch-drafts summary').click();assert.equal(await page.locator('.cf-branch-drafts>div button').count(),8,'all historical drafts remain accessible');
 await page.locator('.cf-branch-drafts summary').click();
 const writeCount=writes.length;const picker=page.getByLabel('切换当前作品');await picker.selectOption(work.id);await page.locator('.cf-tool-grid button').nth(5).waitFor();
 assert.equal(await page.locator('.cf-restoring').count(),0,'same work selection cannot enter an endless restore');assert.equal(writes.length,writeCount);
 await page.screenshot({path:path.join(fixture.directory,'six-content-branches.png')});
 await page.locator('.cf-node>button').nth(3).click();await page.getByLabel('发布文稿').locator('option[value="'+candidateId+'"]').waitFor({state:'attached'});
 await page.locator('.cf-node>button').nth(2).click();
 await page.goto(fixture.base+'/?ui=1#studio/text?draft='+drafts[0].id+'&return='+encodeURIComponent('studio/flow?work='+work.id+'&step=2'));
 await page.getByLabel('创作要求').waitFor();const back=page.locator('.st-flow-context button');await back.waitFor();
 for(const state of ['normal','hover','focus']){
  if(state==='hover')await back.hover();if(state==='focus'){await page.mouse.move(1,1);await back.focus()}
  await settleUI(page);const contrast=await page.evaluate(measureContrast,{scope:'.st-flow-context'});assert.equal(contrast.violations.length,0,JSON.stringify({state,failures:contrast.violations}));
 }
 await page.screenshot({path:path.join(fixture.directory,'return-button.png')});await back.click();await page.locator('.cf-node').nth(4).waitFor();
 assert.equal(new URL(page.url()).hash,'#studio/flow?work='+work.id+'&step=2');
 await page.goto(fixture.base+'/?ui=1#studio/flow?work=missing-foreign-flow');await page.locator('.cf-restoring [role=alert]').waitFor();
 assert.equal(await page.locator('.cf-page :is(input,textarea,select)').count(),0);assert.equal(await page.getByRole('button',{name:'重新读取'}).count(),1);
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,cases,one_restore_read:true,no_extra_full_state:true,protected_restore:true,history_preserved:true,return_contrast:true,private_data:false,paid_generation:false},null,2));
 console.log(JSON.stringify({passed:true,directory:fixture.directory,cases:cases.length}));
}finally{release?.();await browser?.close();fixture.close()}
function choicesIn(page){return page.getByRole('group',{name:'选择本次创作工具'})}
