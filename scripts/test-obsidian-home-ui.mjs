// Built UI and disposable data only. No real provider, publication or user files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('obsidian-home');let browser;
try{
 await fixture.call('/workspace',{});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage(),errors=[],states=[];await fixture.attach(page);page.on('pageerror',e=>errors.push(e.message));
 for(const viewport of [{width:1530,height:1000},{width:1366,height:768},{width:1000,height:700}]){
  await page.setViewportSize(viewport);await page.goto(fixture.base+'/?ui=1#studio/home');await page.locator('.tw-chat').waitFor();await settleUI(page);
  for(const state of ['default','focus','typed','hover','image-selected','video-selected']){
   if(state==='focus')await page.locator('.tw-chat textarea').focus();
   if(state==='typed')await page.locator('.tw-chat textarea').fill('只用于对比度验证，不发送');
   if(state==='hover')await page.locator('.tw-tool').first().hover();
   if(state==='image-selected')await page.getByRole('button',{name:'图片',exact:true}).click();
   if(state==='video-selected')await page.getByRole('button',{name:'视频',exact:true}).click();
   await settleUI(page);const scan=await page.evaluate(measureContrast,{scope:'.tw-home'});assert(scan.checked>10);assert.equal(scan.violations.length,0,JSON.stringify({viewport,state,violations:scan.violations}));states.push({viewport,state,checked:scan.checked});
  }
  const colours=await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,heading:getComputedStyle(document.querySelector('.tw-hero-title h1')).color,field:getComputedStyle(document.querySelector('.tw-chat textarea')).color,overflow:document.documentElement.scrollWidth>innerWidth+2}));
  assert.equal(colours.body,'rgb(11, 13, 18)');assert.equal(colours.heading,'rgb(245, 247, 252)');assert.equal(colours.field,'rgb(245, 247, 252)');assert(!colours.overflow);
  await page.evaluate(()=>document.querySelector('.page-area')?.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(fixture.directory,'home-'+viewport.width+'.png'),fullPage:true});
 }
 for(const [route,heading] of [['knowledge','.knowledge-heading h1'],['benchmark','.bv-header h1'],['studio/text','.st-header h1'],['studio/topics','.td-head h1']]){
  await page.goto(fixture.base+'/?ui=1#'+route);await page.locator(heading).waitFor();await settleUI(page);
  const scan=await page.evaluate(measureContrast,{scope:heading});assert.equal(scan.violations.length,0,JSON.stringify(scan.violations));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,states,headings:true,private_data:false,paid_generation:false},null,2));console.log(JSON.stringify({passed:true,states:states.length,directory:fixture.directory}));
}finally{await browser?.close();fixture.close()}
