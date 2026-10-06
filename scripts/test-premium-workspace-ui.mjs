// Integrated pages with an isolated API. Never calls paid providers or live data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('premium-workspace');let browser;
const states=[];
try{
 await fixture.call('/workspace',{});
 const topic=await fixture.call('/studio/topics',{title:'隔离项目沟通选题',angle:'核对客户使用场景和资料',rationale:'仅用于界面验证',source_ids:[]});
 const flow=await fixture.call('/studio/flow',{new:true,version:0,brief:'隔离创作工作线',topic_id:topic.id,stage:2});
 await fixture.call('/objects/profile',{title:'隔离测试顾问',position:'资料核对',audience:'物业经理'});
 const task=await fixture.call('/tasks/open',{title:'隔离创作对话',source_ids:[],mode:'daily'});
 const saved=await fixture.call('/objects/content',{title:'隔离作品记录',body:'## 仅测试历史作品\n\n核对现场条件。',platform:'wechat'});
 const draft=await fixture.call('/studio/text/drafts',{title:'隔离历史草稿',input:{brief:'仅测试作品列表',format:'公众号文章'}});
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import json,sys; from backend import store as s; d=json.load(sys.stdin); s.init(); s.put(d["owner"],"job",{"status":"done","input":{"action":"studio_text","draft_id":d["draft"]},"result":{"content_id":d["content"]}})'],{env:fixture.env,windowsHide:true,stdio:['pipe','ignore','pipe']});
 let seedError='';seed.stderr.on('data',c=>seedError+=c);seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id,content:saved.id,draft:draft.id}));assert.equal(await new Promise(r=>seed.once('exit',r)),0,seedError);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[];await fixture.attach(page);page.on('pageerror',e=>errors.push(e.message));
 const pages=[['flow','studio/flow?work='+flow.id,'.cf-detail'],['benchmark','benchmark','.benchmark-studio-v2'],['topics','studio/topics','.tlc'],['text','studio/text','.st-editor'],['image','studio/image','.media-workbench'],['video','studio/video','.media-workbench'],['avatar','studio/avatar/text','.st-editor'],['knowledge','knowledge','.knowledge-page'],['identity','studio/brand','.ip-dashboard'],['works','studio/works','.studio-v2 .st-header'],['conversation','task/'+task.id,'.aw-workspace']];
 for(const [name,route,ready] of pages){
  await page.goto(fixture.base+'/?ui=1#'+route);await page.locator(ready).first().waitFor();await settleUI(page);
  const snapshot=await page.evaluate(measureContrast,{scope:'.page-area',excludeUserPaper:true});
  const pale=await page.evaluate(()=>[...document.querySelectorAll('.page-area *')].filter(n=>n.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&!n.closest('svg,.wa-rich-editor,.wa-preview,.md-rendered,.article-preview,.st-paper,.document-editor,.ae-document,.md-body,.ie-stage')).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {selector:n.tagName+'.'+n.className,parent:n.parentElement?.className,html:n.outerHTML.slice(0,200),area:r.width*r.height,bg:s.backgroundColor}}).filter(x=>x.area>12000&&/^rgb\((?:2[34]\d|25[0-5]), (?:2[34]\d|25[0-5]), (?:2[34]\d|25[0-5])\)$/.test(x.bg)));
  states.push({name,checked:snapshot.checked,violations:snapshot.violations,pale});
  await page.screenshot({path:path.join(fixture.directory,name+'.png'),fullPage:true});
  if(name==='benchmark'){
   await page.locator('.bv-options summary').click();await page.getByLabel('备注名称').fill('仅本地输入，不提交');
   const expanded=await page.evaluate(measureContrast,{scope:'.benchmark-studio-v2'});states.push({name:'benchmark-expanded',checked:expanded.checked,violations:expanded.violations,pale:[]});
  }
 }
 await page.goto(fixture.base+'/?ui=1#studio/works');await page.locator('.st-work-record').waitFor();await page.locator('.st-work-record>summary').hover();await settleUI(page);
 const history=await page.evaluate(measureContrast,{scope:'.studio-v2',excludeUserPaper:true});states.push({name:'works-saved-hover',checked:history.checked,violations:history.violations,pale:[]});
 await page.locator('.st-work-record>summary').click();await settleUI(page);const expandedWork=await page.evaluate(measureContrast,{scope:'.studio-v2',excludeUserPaper:true});states.push({name:'works-expanded',checked:expandedWork.checked,violations:expandedWork.violations,pale:[]});
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 const failures=states.flatMap(s=>[...s.violations,...s.pale]);
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:!failures.length,states,private_data:false,paid_generation:false},null,2));
 console.log(JSON.stringify({passed:!failures.length,states:states.length,failures:failures.length,directory:fixture.directory}));assert.equal(failures.length,0);
}catch(e){fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:false,error:e.message,states},null,2));throw e}finally{await browser?.close();fixture.close()}
