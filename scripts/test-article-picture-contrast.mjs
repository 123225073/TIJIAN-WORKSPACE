// Actual React portals + the application's complete CSS cascade. All APIs are
// intercepted in a fresh browser context. No backend, credentials, paid models,
// real generation, production database, or publication is used by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const baseline=process.env.ARTICLE_PICTURE_BASELINE==='1';
// Isolate issue 5's former condition without reverting the current styles.
const taskStateBaseline=process.argv.includes('--task-state-baseline');
assert(!(baseline&&taskStateBaseline),'Choose one baseline at a time');
const distCSS=process.argv.includes('--dist-css'),sourceCSS=process.argv.includes('--source-css');
const directory=path.resolve('.runtime',`article-picture-${baseline||taskStateBaseline?'red':'green'}-${Date.now()}`);
fs.mkdirSync(directory,{recursive:true});
const plugins=baseline?[{name:'original-picture-picker',setup(builder){
 builder.onLoad({filter:/[\\/]src[\\/](?:ArticleImagePicker\.tsx|article-image-picker\.css)$/},({path:filename})=>{
  const source=spawnSync('git',['show','HEAD:src/'+path.basename(filename)],{encoding:'utf8',windowsHide:true});
  assert.equal(source.status,0,source.stderr);
  return {contents:source.stdout,loader:filename.endsWith('.css')?'css':'tsx',resolveDir:path.resolve('src')};
 });
}}]:taskStateBaseline?[{name:'previous-task-state-condition',setup(builder){
 builder.onLoad({filter:/[\\/]src[\\/]ArticleImagePicker\.tsx$/},({path:filename})=>{
  const current=fs.readFileSync(filename,'utf8');
  const fixed="const active=waiting(run),uncertain=!!pending&&!active||!!run&&['unknown','archive_failed'].includes(run.status);";
  assert(current.includes(fixed),'Task-state baseline must replace the actual repaired condition');
  return {contents:current.replace(fixed,'const active=waiting(run),uncertain=!!pending&&!run;').replace('{uncertain&&<div className="ap-run-status">',"{(uncertain||run&&['unknown','archive_failed'].includes(run.status))&&<div className=\"ap-run-status\">"),loader:'tsx',resolveDir:path.resolve('src')};
 });
}}]:[];
// Compile the real main entry for its stylesheet order; do not execute App or
// write dist. No hand-written DOM or test-only CSS replaces the picker.
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),external:['/visuals/*'],plugins});
let css=app.outputFiles.find(file=>file.path.endsWith('.css')).text;
if(distCSS){
 assert(!baseline,'Build the original revision separately to test baseline dist');
 const html=fs.readFileSync('dist/index.html','utf8');
 const links=[...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(match=>match[1]);
 assert(links.length,'Actual dist stylesheet links must exist');
 css=links.map(link=>fs.readFileSync(path.join('dist',link.replace(/^\//,'')),'utf8')).join('\n');
}
if(sourceCSS){
 const original=baseline?spawnSync('git',['show','HEAD:src/article-image-picker.css'],{encoding:'utf8',windowsHide:true}).stdout:fs.readFileSync('src/article-image-picker.css','utf8');
 css+='\n'+original;
}
const content={id:'picture-contrast-content',title:'隔离配图验收',version:1,body:'第一段前半后半。\n\n<span data-wa-color="blue" style="color:#315ed6">用户自定义内容</span>\n\n第二段正文。'};
const entry=`import {createRoot} from 'react-dom/client';
import ArticleEditor from './src/ArticleEditor';
import ImageLightbox from './src/ImageLightbox';
const asset=${JSON.stringify(content)};
const t={state:{user:{id:'isolated-picture-owner'}},refresh:async()=>{}};
createRoot(document.getElementById('root')).render(<><ArticleEditor asset={asset} t={t}/><ImageLightbox/></>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'harness.js'),plugins});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/harness.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}
 else if(pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}
 else if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>')}
 else {res.statusCode=503;res.end('Unexpected request; no backend is connected')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263b59"/><rect x="125" y="30" width="70" height="120" fill="#9abbff"/><text x="12" y="170" fill="#edf2fb">LOCAL TEST IMAGE - NO PAID GENERATION</text></svg>';
const assets=Array.from({length:18},(_,index)=>({id:(index+1).toString(16).padStart(32,'0'),title:'隔离测试图片 '+(index+1),asset_type:'image',status:'ready',width:320,height:180,created:'2026-10-13',mime_type:'image/svg+xml',file_url:'/api/studio/assets/'+(index+1).toString(16).padStart(32,'0')+'/file'}));
const owner='isolated-picture-owner',pictureKey='article-picture:'+owner+':'+content.id;
const candidate=('【隔离模拟提示词，未调用模型】物业经理检查电梯维保记录，沿用深色行业插画风格。\n').repeat(12);
const results=[],shots=[],browserErrors=[],unexpected=[];
let browser;
const test=async(name,fn)=>{try{const evidence=await fn();results.push({name,ok:true,evidence})}catch(error){results.push({name,ok:false,error:error.message})}console.log(JSON.stringify(results.at(-1)))};
const shot=async(page,name)=>{await settleUI(page);const filename=name+'.png';await page.screenshot({path:path.join(directory,filename),fullPage:true});shots.push(filename)};
const open=async(viewport={width:1366,height:768})=>{
 const context=await browser.newContext({viewport});const page=await context.newPage();
 page.setDefaultTimeout(6000);page.on('pageerror',error=>browserErrors.push(error.message));
 const fixture={requests:[],run:null,done:false,failGenerate:false,failInsert:false,uploads:0,generateStatus:'running',promptStatus:'done',promptJobStatus:'done',promptResult:{suggested_prompt:candidate}};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){unexpected.push(request.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname.slice(4),method=request.method(),body=request.headers()['content-type']?.includes('application/json')&&request.postData()?request.postDataJSON():undefined;
  // Multipart image insertion is not JSON.
  fixture.requests.push({path:p,method,body});
  const json=(data,status=200)=>route.fulfill({status,json:data});
  if(p==='/studio/catalog')return json({tools:[{id:'text_image',binding:'fixture-image',enabled:true,models:[{id:'fixture-image',title:'隔离测试模型（不收费）',configured:true,options:{size:['1024x1024','1536x1024'],quality:['standard','high']}}]}]});
  if(p==='/studio/assets')return json({items:assets});
  if(p==='/studio/text/article-illustration-prompt'||p==='/studio/prompt/optimize')return json({id:'fixture-prompt',status:fixture.promptStatus,result:fixture.promptResult,error:fixture.promptStatus==='failed'?'隔离模拟：整理失败':undefined});
  if(p==='/jobs/fixture-prompt')return json({id:'fixture-prompt',status:fixture.promptJobStatus,result:fixture.promptResult,error:fixture.promptJobStatus==='failed'?'隔离模拟：整理失败':undefined});
  if(p==='/studio/drafts'){const count=fixture.requests.filter(x=>x.path===p).length;return json({id:count===1?'fixture-draft':'fixture-draft-'+count,version:1})}
  if(p==='/studio/generate'){
   if(fixture.failGenerate){fixture.failGenerate=false;return json({detail:'隔离模拟：响应中断，请核查原请求'},503)}
   fixture.run={id:fixture.run&&fixture.run.request_id!==body.request_id?'fixture-run-new':'fixture-run',request_id:body.request_id,status:fixture.generateStatus,asset_ids:[]};return json({run:fixture.run});
  }
  if(p==='/studio/runs')return json({items:fixture.run?[fixture.run]:[]});
  if(p==='/studio/runs/'+fixture.run?.id+'/refresh')return json({run:{...fixture.run,status:fixture.done?'succeeded':fixture.run.status,asset_ids:fixture.done?[assets[0].id]:[]}});
  if(/^\/studio\/assets\/[^/]+\/file$/.test(p)||/^\/illustrations\/[^/]+\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:svg});
  if(p==='/content/'+content.id+'/illustrations/upload'){
   fixture.uploads++;await new Promise(resolve=>setTimeout(resolve,150));
   return fixture.failInsert?json({detail:'隔离模拟插入失败'},503):json({illustration_id:'a'.repeat(32)});
  }
  unexpected.push(method+' '+p);return route.abort();
 });
 await page.goto(base);await page.getByRole('tab',{name:'编辑',exact:true}).click();
 const editor=page.getByLabel('编辑生成文稿');
 await editor.evaluate(el=>{el.focus();el.setSelectionRange(5,5);el.dispatchEvent(new Event('select',{bubbles:true}))});
 return {context,page,editor,fixture};
};
const openPicker=async(page,tab='generate')=>{
 await page.getByRole('button',{name:tab==='generate'?'AI 生成配图':'素材库插图',exact:true}).click();
 await page.getByLabel('配图来源').waitFor();
 await page.waitForFunction(()=>document.querySelector('.ap-grid article')||[...document.querySelectorAll('select[aria-label="配图模型"] option')].some(el=>el.value==='fixture-image'));
 assert.equal(await page.locator('body > dialog.studio-modal[open]').count(),1,'Must measure the actual body portal');
 assert.equal(await page.locator('#root dialog').count(),0);
};
const visual=async(page,name,required)=>{
 for(const selector of required)assert(await page.locator(selector).count(),name+' missing actual state '+selector);
 const state=page.locator('.ap-candidate,.ap-confirm,.ap-generate > .ap-run-status').first();
 if(await state.count())await state.scrollIntoViewIfNeeded();
 await shot(page,name);
 const contrast=await page.evaluate(measureContrast,{scope:'body > .studio-modal[open]'});
 fs.writeFileSync(path.join(directory,name+'-contrast.json'),JSON.stringify(contrast,null,2));
 assert(contrast.checked>10,'Actual populated text/fields/buttons must be measured');
 assert.equal(contrast.unmeasured.length,0,'Unmeasured surfaces require investigation');
 assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations.map(x=>({selector:x.selector,text:x.text,ratio:x.contrast,minimum:x.minimum})),null,2));
 return {checked:contrast.checked,minimumContrast:Math.min(...contrast.entries.map(x=>x.contrast))};
};
const geometry=async(page,name)=>{
 const before=await page.locator('.studio-modal[open] > header').boundingBox();
 await page.evaluate(()=>{const modal=document.querySelector('.studio-modal[open]');modal.scrollTop=10000;for(const el of modal.querySelectorAll('.article-picture-workspace,main,.ap-preview'))el.scrollTop=10000});
 await settleUI(page);await shot(page,name);
 const metrics=await page.evaluate(()=>{
  const modal=document.querySelector('.studio-modal[open]'),header=modal.querySelector(':scope > header'),workspace=modal.querySelector('.article-picture-workspace');
  const h=header.getBoundingClientRect(),w=workspace.getBoundingClientRect(),s=getComputedStyle(header);
  return {header:{top:h.top,bottom:h.bottom},workspace:{top:w.top,bottom:w.bottom},headerPosition:s.position,headerPaint:s.backgroundColor,modalScroll:modal.scrollTop,horizontalOverflow:modal.scrollWidth>modal.clientWidth+1,viewportHeight:innerHeight};
 });
 assert.equal(metrics.headerPosition,'static','Title must remain outside the scrolling content');
 assert(!metrics.headerPaint.endsWith(', 0)')&&metrics.headerPaint!=='transparent','Title needs an opaque surface');
 assert(metrics.workspace.top>=metrics.header.bottom-1,'Scrolling content overlaps title');
 assert(Math.abs(metrics.header.top-before.y)<1,'Title moved while scrolling');
 assert.equal(metrics.modalScroll,0,'Scroll the body panes, not the whole dialog');
 assert.equal(metrics.horizontalOverflow,false,'No horizontal overflow');
 assert(metrics.workspace.bottom<=metrics.viewportHeight,'Content stays inside viewport');return metrics;
};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 const session=await open();const {page,editor,fixture}=session;
 await openPicker(page);
 await page.getByLabel('配图画面想法').fill('用户自定义想法：不要替换正文');
 await page.getByLabel('配图风格').fill('用户自定义深色插画风格');
 await test('prompt / immediate result auto-adopts without another click or generation',async()=>{
  await page.getByRole('button',{name:'AI 整理画面提示词'}).click();
  await page.waitForFunction(value=>document.querySelector('[aria-label="配图提示词"]').value===value,candidate);
  const request=fixture.requests.find(x=>x.path==='/studio/text/article-illustration-prompt');
  assert.equal(request.body.body,content.body);assert.equal(request.body.body.slice(request.body.start,request.body.end),'第一段前半后半。');
  assert.equal(request.body.idea,'用户自定义想法：不要替换正文');assert.equal(request.body.style,'用户自定义深色插画风格');
  assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts').length,0);
  assert.equal(await editor.inputValue(),content.body);
  assert.equal(await page.getByRole('button',{name:'采用 AI 提示词'}).count(),0);
  assert.equal(await page.locator('.ap-candidate').count(),0);
  await page.waitForFunction(({key,value})=>JSON.parse(localStorage.getItem(key)).prompt===value,{key:pictureKey,value:candidate});
 });
 await test('adopted prompt / actual portal contrast',()=>visual(page,'adopted-prompt',['.ap-opt','.ap-preview','.ap-context']));
 await test('generate / hover contrast',async()=>{await page.getByRole('button',{name:'生成新配图',exact:true}).hover();return visual(page,'generate-hover',['.ap-opt'])});
 await test('generate / keyboard focus contrast',async()=>{await page.getByRole('button',{name:'生成新配图',exact:true}).focus();return visual(page,'generate-focus',['.ap-opt'])});
 await test('adopted prompt / reload preserves result and allows manual editing',async()=>{
  await page.getByRole('button',{name:'关闭弹窗'}).click();await page.reload();await page.getByRole('tab',{name:'编辑',exact:true}).click();await openPicker(page);
  assert.equal(await page.getByLabel('配图提示词').inputValue(),candidate);
  await page.getByLabel('配图提示词').fill('用户人工确认后的配图要求');
 });
 await test('generate / one click submits immediately, double click creates only one request',async()=>{
  await page.getByRole('button',{name:'生成新配图',exact:true}).evaluate(el=>{el.click();el.click()});
  await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。',{exact:true}).waitFor();
  assert.equal(await page.locator('.ap-confirm').count(),0);assert.equal(await page.getByRole('button',{name:'确认生成配图',exact:true}).count(),0);
  const drafts=fixture.requests.filter(x=>x.path==='/studio/drafts'),calls=fixture.requests.filter(x=>x.path==='/studio/generate');
  assert.equal(drafts.length,1);assert.equal(calls.length,1);assert.equal(drafts[0].body.input.prompt,'用户人工确认后的配图要求');assert.equal(calls[0].body.confirmed,true);
  assert.equal(await page.getByLabel('配图模型').isDisabled(),true);
 });
 await test('running / disabled fields and actual portal contrast',()=>visual(page,'running',['.ap-generate [role=status]','.ap-preview','select:disabled']));
 await test('running / title and scroll at 1366x768',()=>geometry(page,'running-scroll'));
 await test('running / close, reload, recover same request and original bookmark',async()=>{
  assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate').length,1);assert.equal(fixture.requests.filter(x=>x.path==='/studio/drafts').length,1);
  const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey);
  await page.getByRole('button',{name:'关闭弹窗'}).click();assert.equal(await editor.inputValue(),content.body);
  await page.reload();await page.getByRole('tab',{name:'编辑',exact:true}).click();
  await editor.evaluate(el=>{el.focus();el.setSelectionRange(el.value.length,el.value.length)});
  await openPicker(page);await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('配图提示词').inputValue(),'用户人工确认后的配图要求');
  assert.equal(await page.getByLabel('配图风格').inputValue(),'用户自定义深色插画风格');
  assert.equal(await page.getByLabel('配图模型').isDisabled(),true);
  fixture.done=true;await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
  const value=await editor.inputValue();assert(value.indexOf('![')<value.indexOf('后半'),'Generated picture must return to the original caret');
  assert(value.includes('<span data-wa-color="blue" style="color:#315ed6">用户自定义内容</span>'));
  assert.equal(value.match(/!\[/g).length,1);assert.equal(fixture.uploads,1);
  assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate').length,1);
  assert.equal(fixture.run.request_id,pending.request_id);
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey),null);
  await page.reload();await page.getByRole('tab',{name:'编辑',exact:true}).click();assert.equal(await editor.inputValue(),value);
  return {simulatedGeneration:true,paidCalls:0,originalCaret:5,inserts:fixture.uploads};
 });
 await session.context.close();
 for(const viewport of [{width:1000,height:700},{width:1000,height:480},{width:390,height:844}]){
  const {context,page,editor,fixture}=await open(viewport);
  try{
   await openPicker(page,'library');await page.getByRole('button',{name:'选择这张图片'}).first().click();
   await page.waitForFunction(()=>document.querySelector('.ap-large img')?.naturalWidth>0);
   await page.getByLabel('配图说明').fill('用户自定义图片说明');
   const size=viewport.width+'x'+viewport.height;
   await test('selected / contrast '+size,()=>visual(page,'selected-'+size,['.ap-grid article.selected','.ap-preview','.ap-large img']));
   await test('selected / title and scroll '+size,()=>geometry(page,'selected-scroll-'+size));
   await test('selected / insert once at bookmark '+size,async()=>{
    await page.getByRole('button',{name:'确认插入文稿'}).evaluate(el=>{el.click();el.click()});
    await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
    const value=await editor.inputValue();assert.equal(value.match(/!\[/g).length,1);assert(value.indexOf('![用户自定义图片说明]')<value.indexOf('后半'));
    assert(value.includes('用户自定义内容'));assert.equal(fixture.uploads,1);
    assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate').length,0);
   });
  }finally{await context.close()}
 }
 await test('interrupted response / retry reuses idempotency key and draft',async()=>{
  const {context,page,fixture}=await open();try{
   fixture.failGenerate=true;await openPicker(page);await page.getByLabel('配图提示词').fill('隔离失败恢复测试');
   await page.getByRole('dialog').getByRole('button',{name:'生成新配图',exact:true}).click();
   await page.getByRole('button',{name:'重新提交原请求'}).waitFor();
   await visual(page,'uncertain-error',['.ap-error','[role=alert]']);
   await page.getByRole('button',{name:'关闭弹窗'}).click();await openPicker(page);
   await page.getByRole('button',{name:'重新提交原请求'}).evaluate(el=>{el.click();el.click()});
   await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。',{exact:true}).waitFor();
   const calls=fixture.requests.filter(x=>x.path==='/studio/generate');assert.equal(calls.length,2);assert.deepEqual(calls[0].body,calls[1].body);assert.equal(fixture.requests.filter(x=>x.path==='/studio/drafts').length,1);
   return {sameRequestId:true,simulatedGeneration:true,paidCalls:0};
  }finally{await context.close()}
 });
 // Seed persisted original requests, then recover actual unknown/archive_failed
 // runs through the real React portal. These are UI fixtures, never paid calls.
 const seedPending=async(page,fixture,status)=>{
  // Capture the actual editor bookmark before simulating a persisted task.
  await openPicker(page);await page.getByRole('button',{name:'关闭弹窗'}).click();
  const originalContext=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).context,'article-position:'+owner+':'+content.id);
  const pending={draft_id:'saved-original-draft',version:7,request_id:'saved-original-request-'+status,confirmed:true};
  const saved={prompt:'原草稿要求：行业维保场景',idea:'原画面想法',style:'原定墨绿米白插画风格',model:'fixture-image',options:{requested_ratio:'2.32:1',requested_resolution:'2K',quality:'high'},pending,context:originalContext};
  fixture.run={id:'fixture-run',request_id:pending.request_id,status,asset_ids:[]};
  await page.evaluate(({key,saved})=>localStorage.setItem(key,JSON.stringify(saved)),{key:pictureKey,saved});
  await openPicker(page);
  await page.waitForFunction(()=>document.querySelector('.ap-generate > .ap-run-status button')?.textContent==='核查配图任务');
  await page.waitForFunction(()=>document.querySelector('[aria-label="配图模型"]')?.value==='fixture-image');
  assert(fixture.requests.some(x=>x.path==='/studio/runs/fixture-run/refresh'),'Must recover a real run status, not just pending without a run');
  return saved;
 };
 const assertLocked=async(page)=>{
  for(const label of ['配图画面想法','配图风格','配图模型','画面比例','图片分辨率','自定义宽高比','配图参数 quality'])assert.equal(await page.getByLabel(label,{exact:true}).isDisabled(),true,label+' must be locked');
  assert.equal(await page.getByLabel('配图提示词',{exact:true}).evaluate(el=>el.readOnly),true,'Prompt must be read-only');
  for(const name of ['AI 整理画面提示词','生成新配图'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true,name+' must be disabled');
 };
 for(const status of ['unknown','archive_failed']){
  await test(status+' / actual portal locks requirements and preserves original draft and request',async()=>{
   const {context,page,fixture}=await open();try{
    const saved=await seedPending(page,fixture,status);
    await assertLocked(page);
    assert.equal(await page.getByRole('button',{name:'核查配图任务'}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'重新提交原请求'}).isEnabled(),true);
    await page.getByLabel('配图提示词',{exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Control+Enter');await page.keyboard.type('不应写入的新要求');
    for(const name of ['AI 整理画面提示词','生成新配图'])await page.getByRole('button',{name,exact:true}).evaluate(el=>el.click());
    assert.equal(await page.locator('.ap-confirm').count(),0);
    assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts'||x.path.includes('/prompt')||x.path.includes('article-illustration-prompt')).length,0,'Unknown recovery must not generate, create drafts or optimize');
    for(const [label,value] of [['配图提示词',saved.prompt],['配图画面想法',saved.idea],['配图风格',saved.style]])assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),value);
    await visual(page,status+'-locked',['.ap-generate > .ap-run-status','.ap-preview','select:disabled']);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey),saved.pending);
    await page.getByRole('button',{name:'关闭弹窗'}).click();await page.reload();await page.getByRole('tab',{name:'编辑',exact:true}).click();await openPicker(page);
    await assertLocked(page);
    const restored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),pictureKey);
    for(const name of ['prompt','idea','style','model','options','pending','context'])assert.deepEqual(restored[name],saved[name],name+' must survive reload unchanged');
    fixture.generateStatus=status;
    await page.getByRole('button',{name:'重新提交原请求'}).evaluate(el=>{el.click();el.click()});
    await page.waitForFunction(()=>!document.querySelector('.ap-generate > .ap-run-status button')?.disabled);
    const retries=fixture.requests.filter(x=>x.path==='/studio/generate');assert.equal(retries.length,1);assert.deepEqual(retries[0].body,saved.pending);
    assert.equal(fixture.requests.filter(x=>x.path==='/studio/drafts').length,0,'Safe retry cannot replace the saved draft');
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey),saved.pending);
    await assertLocked(page);
    return {status,actualPortal:true,originalDraft:saved.pending.draft_id,originalRequest:saved.pending.request_id,retries:1,newDrafts:0,paidCalls:0};
   }finally{await context.close()}
  });
  await test(status+' / original task recovery completes and inserts once',async()=>{
   const {context,page,editor,fixture}=await open();try{
    const saved=await seedPending(page,fixture,status);
    fixture.done=true;await page.getByRole('button',{name:'核查配图任务'}).click();await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
    const value=await editor.inputValue();assert.equal(value.split('![').length-1,1);assert(value.indexOf('![')<value.indexOf('后半'),'Retain the persisted insertion bookmark');assert(value.includes('用户自定义内容'));
    assert.equal(fixture.uploads,1);assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts').length,0);
    assert.equal(fixture.run.request_id,saved.pending.request_id);assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey),null);
    return {status,originalTask:true,inserts:1,newGeneration:0,paidCalls:0};
   }finally{await context.close()}
  });
  await test(status+' / confirmed failure unlocks new requirements with a new key',async()=>{
   const {context,page,fixture}=await open();try{
    const saved=await seedPending(page,fixture,status);
    fixture.run.status='failed';fixture.run.error='隔离模拟：原任务已明确失败';
    await page.getByRole('button',{name:'核查配图任务'}).click();await page.getByText(fixture.run.error,{exact:true}).waitFor();
    assert.equal(await page.getByLabel('配图提示词',{exact:true}).evaluate(el=>el.readOnly),false);
    for(const label of ['配图画面想法','配图风格','配图模型','画面比例','图片分辨率','自定义宽高比','配图参数 quality'])assert.equal(await page.getByLabel(label,{exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'重新提交原请求'}).count(),0);
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey),null);
    await page.getByLabel('配图画面想法').fill('明确失败后的新画面想法');await page.getByLabel('配图风格').fill('保留原画风的新风格细节');
    await page.getByRole('button',{name:'AI 整理画面提示词'}).click();await page.waitForFunction(value=>document.querySelector('[aria-label="配图提示词"]').value===value,candidate);
    const prompt='明确失败后用户确认的新要求';await page.getByLabel('配图提示词',{exact:true}).fill(prompt);
    await page.getByLabel('配图参数 quality',{exact:true}).selectOption(JSON.stringify('standard'));
    assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts').length,0,'Failure must not automatically create a new paid request');
    fixture.generateStatus='running';await page.getByRole('button',{name:'生成新配图',exact:true}).click();
    await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。',{exact:true}).waitFor();
    const drafts=fixture.requests.filter(x=>x.path==='/studio/drafts'),calls=fixture.requests.filter(x=>x.path==='/studio/generate');
    assert.equal(drafts.length,1);assert.equal(drafts[0].body.input.prompt,prompt);assert.equal(drafts[0].body.options.quality,'standard');assert.equal(calls.length,1);
    assert.notEqual(calls[0].body.draft_id,saved.pending.draft_id);assert.notEqual(calls[0].body.request_id,saved.pending.request_id);assert.equal(calls[0].body.confirmed,true);
    return {status,explicitFailure:true,newConfirmedDraft:true,newRequestKey:true,paidCalls:0};
   }finally{await context.close()}
  });
 }
 await test('prompt / queued result auto-adopts, optimization and generation cannot race',async()=>{
  const {context,page,fixture}=await open();try{
   fixture.promptStatus='queued';fixture.promptJobStatus='running';
   await openPicker(page);await page.getByLabel('配图提示词').fill('整理前的原始要求');
   await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('.ap-generate button')];
    const optimize=buttons.find(el=>el.textContent==='AI 整理画面提示词');
    optimize.click();optimize.click();buttons.find(el=>el.textContent==='生成新配图').click();
   });
   await page.waitForFunction(()=>document.querySelector('.ap-opt button')?.textContent==='正在准备…');
   assert.equal(await page.getByRole('button',{name:'生成新配图',exact:true}).isDisabled(),true);
   await page.getByLabel('配图提示词').press('Enter');
   assert.equal(fixture.requests.filter(x=>x.path.includes('article-illustration-prompt')).length,1);
   assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts').length,0);
   assert.equal(await page.getByLabel('配图提示词').inputValue(),'整理前的原始要求');
   fixture.promptJobStatus='done';
   await page.waitForFunction(value=>document.querySelector('[aria-label="配图提示词"]').value===value,candidate);
   assert.equal(await page.getByRole('button',{name:'生成新配图',exact:true}).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'采用 AI 提示词'}).count(),0);
   assert(fixture.requests.some(x=>x.path==='/jobs/fixture-prompt'));
   const prompt=page.getByLabel('配图提示词');await prompt.fill('回车一次生成');await prompt.press('Control+Enter');
   assert.equal(await prompt.inputValue(),'回车一次生成\n');assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate').length,0);
   await prompt.evaluate(el=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
   await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。',{exact:true}).waitFor();
   const drafts=fixture.requests.filter(x=>x.path==='/studio/drafts');assert.equal(drafts.length,1);assert.equal(drafts[0].body.input.prompt,'回车一次生成\n');assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate').length,1);
   return {queuedPrompt:true,autoAdopted:true,enterRequests:1,paidCalls:0};
  }finally{await context.close()}
 });
 for(const mode of ['empty','failed','queued-failed'])await test('prompt / '+mode+' preserves original requirements and permits retry',async()=>{
  const {context,page,fixture}=await open();try{
   fixture.promptStatus=mode==='queued-failed'?'queued':mode==='failed'?'failed':'done';fixture.promptJobStatus='failed';fixture.promptResult={suggested_prompt:'  '};
   await openPicker(page);await page.getByLabel('配图提示词').fill('需要保留的原要求');
   await page.getByRole('button',{name:'AI 整理画面提示词'}).click();await page.locator('.ap-error').waitFor();
   assert.equal(await page.getByLabel('配图提示词').inputValue(),'需要保留的原要求');
   assert.equal(await page.getByRole('button',{name:'AI 整理画面提示词'}).isEnabled(),true);
   assert.equal(await page.getByRole('button',{name:'生成新配图',exact:true}).isEnabled(),true);
   fixture.promptStatus='done';fixture.promptResult={optimized_prompt:candidate};
   await page.getByRole('button',{name:'AI 整理画面提示词'}).click();await page.waitForFunction(value=>document.querySelector('[aria-label="配图提示词"]').value===value,candidate);
   assert.equal(fixture.requests.filter(x=>x.path==='/studio/generate'||x.path==='/studio/drafts').length,0);
  }finally{await context.close()}
 });
 await test('insert failure / keep selected picture, draft and retry',async()=>{
  const {context,page,editor,fixture}=await open();try{
   fixture.failInsert=true;await openPicker(page,'library');await page.getByRole('button',{name:'选择这张图片'}).first().click();await page.getByRole('button',{name:'确认插入文稿'}).click();
   await page.locator('.ap-error').waitFor();assert.equal(await editor.inputValue(),content.body);assert.equal(await page.locator('.ap-grid article.selected').count(),1);
   fixture.failInsert=false;await page.getByRole('button',{name:'确认插入文稿'}).click();await page.locator('.studio-modal[open]').waitFor({state:'hidden'});assert.equal((await editor.inputValue()).match(/!\[/g).length,1);
  }finally{await context.close()}
 });
 for(const place of ['start','end'])await test('selection / insertion position '+place,async()=>{
  const {context,page,editor}=await open();try{
   await openPicker(page,'library');await page.getByRole('button',{name:'选择这张图片'}).first().click();
   await page.getByLabel('配图插入位置').selectOption(place);await page.getByRole('button',{name:'确认插入文稿'}).click();await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
   const value=await editor.inputValue();assert.equal(value.match(/!\[/g).length,1);
   assert(place==='start'?value.indexOf('![')<value.indexOf('第一段'):value.indexOf('![')>value.indexOf('第二段'));assert(value.includes('用户自定义内容'));
  }finally{await context.close()}
 });
 await test('close / Escape restores unchanged article and custom prompt',async()=>{
  const {context,page,editor}=await open();try{
   await openPicker(page);await page.getByLabel('配图提示词').fill('用户自定义草稿，关闭后保留');await page.keyboard.press('Escape');await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
   assert.equal(await editor.inputValue(),content.body);await openPicker(page);assert.equal(await page.getByLabel('配图提示词').inputValue(),'用户自定义草稿，关闭后保留');
  }finally{await context.close()}
 });
 await test('isolation / no real APIs, no browser exceptions',async()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(browserErrors,[]);return {backendStarted:false,productionDatabaseTouched:false,realGeneration:false,paidCalls:0}});
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 const report={baseline,taskStateBaseline,distCSS,sourceCSS,version:JSON.parse(fs.readFileSync('package.json','utf8')).version,realGeneration:false,paidCalls:0,productionDatabaseTouched:false,directory,results,screenshots:shots,browserErrors,unexpected};
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({directory,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,realGeneration:false,paidCalls:0}));
 if(results.some(x=>!x.ok)||!results.length)process.exitCode=1;
}
