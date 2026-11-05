// Isolated local HTTP fixtures; no model/provider calls or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const directory=path.resolve('.runtime','article-image-rail-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const owner='rail-owner',id='rail-content',key='social-picture-batch:'+owner+':'+id;
const body='## 电梯报价中的土建边界\n\n设备安装和土建施工应分别列明范围。\n\n## 现场核对\n\n部件、底坑与施工恢复应按实际条件确认，不能虚构价格和合同责任。';
const entry=`import {createRoot} from 'react-dom/client';import ArticleImageRail from './src/ArticleImageRail';import ImageLightbox from './src/ImageLightbox';import {setToken} from './src/api';import {socialPicturePrompt} from './src/social-picture-batch';window.socialPicturePrompt=socialPicturePrompt;setToken('isolated-token');window.switchAccount=()=>setToken('another-token');window.insertions=[];window.saveCalls=0;window.originalBody=${JSON.stringify(body)};const content={id:'${id}',body:${JSON.stringify(body)},title:'土建边界',version:1,format:'公众号文章'};function Harness(){return <><main style={{width:310,margin:'20px auto'}}><ArticleImageRail content={content} owner='${owner}' getBody={()=>content.body} save={async()=>{window.saveCalls++;return content}} onInsert={async(asset,caption,place)=>{if(window.failInsert)throw Error('正文保存冲突，图片已保留');window.insertions.push({id:asset.id,caption,place})}}/></main><ImageLightbox/></>}createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,external:['/visuals/*'],outfile:path.join(directory,'fixture.js')});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(req.url==='/visuals/image-style-atlas-v2.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync('public/visuals/image-style-atlas-v2.png'))}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body style="background:#101720;margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,results=[],errors=[],unexpected=[];let browser;
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(e){results.push({name,ok:false,error:e.stack})}console.log(JSON.stringify(results.at(-1)))};
const open=async(options={})=>{
 const context=await browser.newContext({viewport:{width:1280,height:1100}}),page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(e.message));
 const f={drafts:[],runs:[],assets:[],requests:[],running:false,failedAt:-1,...options};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base){unexpected.push(req.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();const p=url.pathname.slice(4),method=req.method(),data=req.postData()?req.postDataJSON():undefined;f.requests.push({p,method,data});const json=(obj,status=200)=>route.fulfill({json:obj,status});
  if(p==='/studio/catalog')return json({tools:[{id:'text_image',binding:'fixture-image',enabled:true,models:[{id:'fixture-image',configured:true,options:{size:f.sizes||['1024x1024','768x1024','1024x768','1536x864']}}]}]});
  if(p==='/studio/assets')return json({items:f.assets});
  if(p==='/studio/text/article-illustration-prompt')return json({id:'job-'+f.requests.length,status:'done',result:{suggested_prompt:f.omitPromptStyle?'电梯现场设备特写。':'电梯行业现场插画。'+data.idea}});
  if(p==='/studio/drafts'){
   if(method==='GET')return json({items:f.drafts});
   const draft={...data,id:'draft-'+f.drafts.length,version:1};f.drafts.push(draft);if(f.loseDraftOnce){f.loseDraftOnce=false;return json({detail:'模拟草稿响应丢失'},503)}return json(draft);
  }
  if(p==='/studio/generate'){
   const existing=f.runs.find(r=>r.request_id===data.request_id);if(existing)return json({run:existing});
   const index=f.runs.length,asset={id:(index+1).toString(16).repeat(32),asset_type:'image',status:'ready',title:'配图'+(index+1),file_url:'/api/studio/assets/'+(index+1).toString(16).repeat(32)+'/file'};
   f.assets.push(asset);const run={...data,snapshot:JSON.parse(JSON.stringify(f.drafts.find(d=>d.id===data.draft_id))),id:'run-'+index,status:f.running?'running':f.failedAt===index?'failed':'succeeded',asset_ids:[asset.id],error:f.failedAt===index?'明确失败':''};f.runs.push(run);
   if(f.loseGenerateOnce){f.loseGenerateOnce=false;return json({detail:'模拟生成响应丢失'},503)}return json({run});
  }
  if(p==='/studio/runs')return json({items:f.runs});
  if(/^\/studio\/runs\/[^/]+\/refresh$/.test(p)){const run=f.runs.find(r=>r.id===p.split('/')[3]);if(!f.running&&run.status==='running')run.status='succeeded';return json({run})}
  if(/^\/studio\/assets\/[^/]+\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#f8f5ec"/><rect x="235" y="100" width="170" height="300" fill="#21615a"/><path d="M320 100v300" stroke="#d9b784" stroke-width="8"/><rect x="80" y="350" width="80" height="50" fill="#d9b784"/></svg>'});
  unexpected.push(method+' '+p);return route.abort();
 });await page.goto(base);return {page,context,f};
};
const done=page=>page.waitForFunction(key=>{const b=JSON.parse(localStorage.getItem(key)||'null');return b&&b.slots.every(s=>['succeeded','failed'].includes(s.status))},key);
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 await test('直显比例数量，用户点击前没有付费请求，文章构思和真实尺寸传入',async()=>{
  const {page,context,f}=await open();assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);const galleryOffset=await page.evaluate(()=>document.querySelector('.air-gallery-heading').getBoundingClientRect().top-document.querySelector('.article-image-rail').getBoundingClientRect().top);assert(galleryOffset<310,'加入风格后配图素材应仍在控件起点310px内，实际'+galleryOffset);assert.equal(await page.getByRole('button',{name:'4:3 横图'}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('button',{name:'3 张',exact:true}).getAttribute('aria-pressed'),'true');assert.equal((await page.getByRole('button',{name:/^画面风格：/}).innerText()).includes('自动匹配文章风格'),true);
  await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await done(page);await page.locator('.air-gallery article').last().waitFor();assert.equal(f.runs.length,3);assert.equal(f.drafts.length,3);assert(f.drafts.every(d=>d.options.size==='1024x768'));const prompts=f.requests.filter(r=>r.p==='/studio/text/article-illustration-prompt');assert(prompts.every(r=>r.data.body===body&&r.data.idea.includes('电梯行业文章')&&!r.data.idea.includes('小红书')));assert.equal(await page.evaluate(()=>window.saveCalls),1);assert.deepEqual(await page.evaluate(()=>window.insertions),[]);
  await page.locator('.air-gallery img').first().waitFor();await page.locator('.air-gallery img').first().click();await page.locator('.image-lightbox[open]').waitFor();await page.locator('.image-lightbox header button').last().click();await page.getByRole('button',{name:'插入文末',exact:true}).first().click();assert.equal((await page.evaluate(()=>window.insertions))[0].place,'end');assert.equal(f.runs.length,3);await page.screenshot({path:path.join(directory,'rail-default.png'),fullPage:true});await context.close();return {paidFixtureCalls:3,noAutomaticInsertion:true,galleryOffset};
 });
 await test('一次4张宽屏，下一组保留旧图，插入后不会自动再生成',async()=>{
  const {page,context,f}=await open();await page.getByRole('button',{name:'16:9 宽屏'}).click();await page.getByRole('button',{name:'4 张',exact:true}).click();await page.getByRole('button',{name:'生成 4 张配图',exact:true}).click();await done(page);assert(f.drafts.every(d=>d.options.size==='1536x864'));await page.getByRole('button',{name:'1 张',exact:true}).click();await page.getByRole('button',{name:'生成 1 张配图',exact:true}).click();await done(page);await page.waitForFunction(()=>document.querySelectorAll('.air-gallery article').length===5);assert.equal(f.runs.length,5);await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.air-gallery article').length===5);assert.equal(f.runs.length,5);assert.equal(await page.getByRole('button',{name:'1 张',exact:true}).getAttribute('aria-pressed'),'true');await context.close();
 });
 await test('内置风格真正传入画面构思和生图，刷新后保留选择，运行中冻结',async()=>{
  const {page,context,f}=await open({running:true,omitPromptStyle:true});const picker=page.getByRole('button',{name:/^画面风格：/}),gallery=page.getByRole('dialog',{name:'看图，选择这次的画面风格',exact:true});await picker.click();assert.equal(await gallery.locator('.image-style-card').count(),12);await gallery.getByRole('button',{name:'工程细节',exact:true}).click();assert((await page.locator('.image-style-description').textContent()).includes('部件'));await page.reload();assert((await picker.innerText()).includes('工程细节'));assert.equal(f.runs.length,0);
  await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.slots.every(s=>s.status==='running'),key);assert(await picker.isDisabled());const prompts=f.requests.filter(r=>r.p==='/studio/text/article-illustration-prompt');assert.equal(prompts.length,3);assert(prompts.every(r=>r.data.style.includes('工程细节摄影')&&r.data.idea.includes('真实材料')&&!r.data.idea.includes('墨绿')));assert(f.drafts.every(d=>d.input.prompt==='电梯现场设备特写。'));assert(f.drafts.every(d=>d.input.image_style.id==='engineering'&&d.input.image_style.prompt.includes('工程细节摄影')));assert(f.runs.every(r=>r.snapshot.input.image_style.id==='engineering'&&r.snapshot.input.image_style.prompt.includes('工程细节摄影')));const frozen=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).style_prompt,key);assert(frozen.includes('工程细节摄影'));assert(f.drafts.every(d=>d.input.image_style.prompt===frozen));await page.reload();assert((await picker.innerText()).includes('工程细节'));assert(await picker.isDisabled());assert.equal(f.runs.length,3);f.running=false;await done(page);await picker.click();await gallery.getByRole('button',{name:'生活家居',exact:true}).click();await page.reload();assert((await picker.innerText()).includes('生活家居'));await context.close();return {templates:12,style:'engineering',requests:3,frozen:true,actualDraftSnapshot:true,modelOmissionCannotDropStyle:true};
 });
 await test('草稿和生成响应丢失后复用原任务，重载不重复计费',async()=>{
  const {page,context,f}=await open({loseDraftOnce:true,loseGenerateOnce:true});await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await done(page);assert.equal(f.drafts.length,3);assert.equal(f.runs.length,3);const requests=f.runs.map(r=>r.request_id);await page.reload();await page.waitForTimeout(2600);assert.deepEqual(f.runs.map(r=>r.request_id),requests);assert.equal(f.drafts.length,3);await context.close();
 });
 await test('仅重跑失败图，其他完成图片保留',async()=>{
  const {page,context,f}=await open({failedAt:1});await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await done(page);await page.getByRole('button',{name:'仅重试失败图片 · 按用量计费',exact:true}).click();await done(page);assert.equal(f.runs.length,4);await page.waitForFunction(()=>document.querySelectorAll('.air-gallery article').length===3);await context.close();
 });
 await test('模型不支持比例时提示实际调整，不伪装所选尺寸',async()=>{
  const {page,context,f}=await open({sizes:['1024x1024']});await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await done(page);assert((await page.locator('.article-image-rail').textContent()).includes('4:3 → 1:1'));assert(f.drafts.every(d=>d.options.size==='1024x1024'));await context.close();
 });
 await test('账号切换后原账号生成暂停，无后续写请求',async()=>{
  const {page,context,f}=await open({running:true});await page.getByRole('button',{name:'生成 3 张配图',exact:true}).click();await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.slots.every(s=>s.status==='running'),key);await page.evaluate(()=>window.switchAccount());const writes=f.requests.filter(r=>r.method!=='GET').length;await page.waitForTimeout(2500);assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);assert((await page.locator('.article-image-rail').textContent()).includes('账号已切换'));await context.close();
 });
 await test('插入遇到保存冲突时不标记完成、不重复生成，图片和正文保留',async()=>{
  const {page,context,f}=await open();await page.getByRole('button',{name:'1 张',exact:true}).click();await page.getByRole('button',{name:'生成 1 张配图',exact:true}).click();await done(page);await page.getByRole('button',{name:'插入文末',exact:true}).waitFor();await page.evaluate(()=>window.failInsert=true);await page.getByRole('button',{name:'插入文末',exact:true}).click();await page.getByRole('alert').filter({hasText:'正文保存冲突'}).waitFor();assert.deepEqual(await page.evaluate(()=>window.insertions),[]);assert.equal(await page.evaluate(()=>window.originalBody),body);assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).attached,key),[]);assert.equal(await page.locator('.air-gallery article').count(),1);await page.evaluate(()=>window.failInsert=false);await page.getByRole('button',{name:'插入文末',exact:true}).click();assert.equal((await page.evaluate(()=>window.insertions)).length,1);assert.equal(f.runs.length,1);await context.close();
 });
 await test('原社交提示词保持小红书卡片行为，文章分支没有污染旧流程',async()=>{
  const {page,context,f}=await open();const prompt=await page.evaluate(()=>window.socialPicturePrompt({body:'测试文章',slots:[{},{},{},{}],style:'cards'},0));assert(prompt.includes('为小红书制作一组 4 张图'));assert(prompt.includes('小红书现代知识卡片'));assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await context.close();
 });
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({offline:true,paidCalls:0,results,errors,unexpected},null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,errors,unexpected}));if(results.some(r=>!r.ok)||errors.length||unexpected.length)process.exitCode=1}
