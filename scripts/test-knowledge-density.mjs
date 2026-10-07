// Real built React + disposable SQLite. No provider traffic or live user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';
const f=await startIsolatedUI('knowledge-density');let browser;
const colors=[],layouts=[],checks=[];
try {
 await f.call('/workspace',{});
 const entries=[];
 for(let i=0;i<12;i++)entries.push(await f.call('/import/text',{title:i===0?'专项检验资料':'电梯资料 '+i+'：项目条件与来源记录需要完整保留',body:'资料序号 '+i+'。本机隔离资料，用于测试知识库筛选、选择和阅读。\n\n## 资料内容\n\n完整正文保留，不调用供应商。'}));
 const folder=await f.call('/objects/folder',{title:'项目档案',library:'source'});
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',"import json,sys;from backend import store as s;s.init();d=json.load(sys.stdin);f=s.put(d['owner'],'feed',{'title':'隔离信源','url':'https://example.invalid'});s.put(d['owner'],'news',{'title':'隔离阅读摘要','body':'原文摘要，仅用于本机显示验证。','feed_id':f['id']})"],{env:f.env,windowsHide:true,stdio:['pipe','ignore','pipe']});seed.stdin.end(JSON.stringify({owner:f.auth.user.id}));assert.equal(await new Promise(r=>seed.on('exit',r)),0);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await f.attach(page);
 await page.goto(f.base+'/?ui=1#knowledge/source');await page.locator('.knowledge-entry').first().waitFor();
 assert.equal(await page.locator('.knowledge-tabs button').count(),5);assert.equal(await page.locator('.knowledge-more-tabs').count(),0);
 for(const state of ['normal','hover','focus','selected-hover']){
  const row=page.locator('.knowledge-select').first();if(state==='hover')await row.hover();if(state==='focus')await row.focus();if(state==='selected-hover'){await row.click();await row.hover()}
  await settleUI(page);colors.push({state,...await page.evaluate(measureContrast,{scope:'.knowledge-page'})});
 }
 await page.getByLabel('全选当前结果',{exact:true}).check();assert.equal(await page.locator('.entry-check input:checked').count(),12);
 await page.getByRole('button',{name:'取消选择',exact:true}).click();assert.equal(await page.locator('.entry-check input:checked').count(),0);
 await page.getByLabel('搜索当前分类',{exact:true}).fill('专项检验');assert.equal(await page.locator('.knowledge-entry').count(),1);
 await page.getByLabel('全选当前结果',{exact:true}).check();assert.equal(await page.locator('.entry-check input:checked').count(),1);
 await page.getByLabel('移动到文件夹').selectOption(folder.id);await page.waitForFunction(()=>!document.querySelector('[aria-label="移动到文件夹"]'));
 assert.equal((await f.call('/state')).objects.find(x=>x.title==='专项检验资料').folder_id,folder.id);
 await page.getByLabel('搜索当前分类',{exact:true}).fill('');await page.getByRole('button',{name:'项目档案',exact:false}).click();assert.equal(await page.locator('.knowledge-entry').count(),1);
 await page.locator('.knowledge-select').click();assert.equal(await page.locator('.knowledge-reader>h2').innerText(),'专项检验资料');checks.push('search-select-move-open');
 await page.getByRole('button',{name:'全部内容',exact:true}).click();await page.locator('.knowledge-entry').nth(11).waitFor();
 for(const width of [1530,1024,800,520]){
  await page.setViewportSize({width,height:900});await settleUI(page);
  const layout=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const r=rect('.knowledge-reader'),l=rect('.knowledge-list'),row=rect('.knowledge-entry');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,rowHeight:row.height,readerWidth:r.width,readerX:r.x,listRight:l.right,stacked:r.top>=l.bottom-1,toolbarHeight:rect('.knowledge-list-toolbar').height}});
  layouts.push(layout);assert(!layout.overflow,JSON.stringify(layout));assert(layout.rowHeight<=115,JSON.stringify(layout));assert(layout.toolbarHeight<=100);if(width>1000)assert(layout.readerWidth>=320);if(width===520)assert(layout.stacked);
  await page.screenshot({path:path.join(f.directory,'knowledge-'+width+'.png')});
 }
 for(const kind of ['knowledge','memory']){
  const job=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',"import json,sys;from backend import store as s;s.init();d=json.load(sys.stdin);print(json.dumps(s.put(d['owner'],d['kind'],{'title':'隔离历史'+d['kind'],'body':'保留的正文与版本。','status':'accepted'})))"],{env:f.env,windowsHide:true,stdio:['pipe','pipe','pipe']});let raw='';job.stdout.on('data',c=>raw+=c);job.stdin.end(JSON.stringify({owner:f.auth.user.id,kind}));assert.equal(await new Promise(r=>job.on('exit',r)),0);const record=JSON.parse(raw);
  await f.call('/objects/'+record.id,{title:record.title,body:'修改后的版本正文。',version:record.version},'PATCH');
  await page.goto(f.base+'/?ui=1#knowledge/'+kind+'/'+record.id);await page.reload();await page.locator('.wiki-history summary').click();await page.locator('.wiki-history>div').first().waitFor();
  assert(await page.locator('.wiki-history').evaluate(el=>getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3).every(v=>Number(v)<80)));
  colors.push({state:kind+'-history',...await page.evaluate(measureContrast,{scope:'.wiki-history'})});checks.push(kind+'-history');
 }
 await page.setViewportSize({width:1530,height:1000});await page.goto(f.base+'/?ui=1#radar');await page.locator('.news-actions button').first().click();await page.getByRole('dialog').waitFor();
 const footer=page.locator('.drawer-actions');assert.equal(await footer.count(),1);
 assert(await footer.evaluate(el=>getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3).every(v=>Number(v)<80)),'drawer footer must match dark chrome');
 colors.push({state:'radar-reader',...await page.evaluate(measureContrast,{scope:'.detail-drawer'})});await page.screenshot({path:path.join(f.directory,'radar-reader.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(f.guard,{external:[],forbidden:[]});assert.deepEqual(colors.flatMap(c=>c.violations),[]);
 fs.writeFileSync(path.join(f.directory,'result.json'),JSON.stringify({passed:true,checks,colors,layouts,integration:f.integration,providerCalls:false},null,2));console.log(JSON.stringify({passed:true,checks,states:colors.length,layouts,directory:f.directory}));
}finally{await browser?.close();f.close()}
