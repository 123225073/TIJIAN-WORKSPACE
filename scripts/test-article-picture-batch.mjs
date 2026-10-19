// Real ArticleEditor + ArticlePictureBatch + native dialog portal. Every API is
// intercepted; no backend, model, provider, production data or paid call is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const red=process.argv.includes('--unsafe-body-baseline');
const directory=path.resolve('.runtime',`article-picture-batch-${red?'red':'green'}-${Date.now()}`);fs.mkdirSync(directory,{recursive:true});
const owner='batch-fixture-owner',id='batch-article-a',key='article-picture-batch:'+owner+':'+id;
const original='第一段：选电梯之前先了解使用场景。\n\n中间段：住宅、医院和工厂关注不同需求。\n\n结尾段：先看长期服务，再比较报价。';
const content={id,kind:'content',title:'离线三图测试',format:'公众号文章',version:1,body:original};
const plugins=red?[{name:'unsafe-body-baseline',setup(b){b.onLoad({filter:/[\\/]article-picture-batch\.ts$/},({path:file})=>{
 const source=fs.readFileSync(file,'utf8'),guard='if(current!==b.expected&&current!==next)throw Error';assert(source.includes(guard));
 return {contents:source.replace(guard,'if(false)throw Error'),loader:'ts',resolveDir:path.resolve('src')};
})}}]:[];
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import ArticleEditor from './src/ArticleEditor';import {setToken} from './src/api';import {batchResult,planPictures} from './src/article-picture-batch';import './src/style.css';import './src/studio-theme.css';import './src/work-pages.css';
setToken('fixture-A');window.switchFixtureToken=setToken;window.batchLogic={batchResult,planPictures};
function Harness(){const [which,setWhich]=useState('a');window.navigateArticle=setWhich;const a=which==='a'?{...${JSON.stringify(content)},...window.fixtureOverrides}:{...${JSON.stringify(content)},id:'batch-article-b',body:'文章B自己的正文'};return <ArticleEditor key={a.id} asset={a} t={{state:{user:{id:'${owner}'}},refresh:async()=>{}}} onSaveReady={fn=>{window.registeredSave=fn}}/>}createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js'),plugins});
// Compile only into memory to obtain the real application's CSS order. No dist/build output.
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'css-source.js'),external:['/visuals/*']});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=app.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const results=[],unexpected=[],errors=[];let browser;
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(e){results.push({name,ok:false,error:e.stack})}console.log(JSON.stringify(results.at(-1)))};
const open=async(options={})=>{
 const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 const overrides={format:options.format||content.format,flow_id:options.flow_id||'',cover_asset_id:'existing-cover'};
 await context.addInitScript(value=>{window.fixtureOverrides=value},overrides);
 const f={requests:[],drafts:[],runs:[],assets:[],jobs:[],row:{...content,...overrides},...options};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base){unexpected.push(req.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname.slice(4),method=req.method(),body=req.postData()?req.postDataJSON():undefined;f.requests.push({p,method,body,account:req.headers().authorization==='Bearer fixture-B'?'B':'A'});const json=(data,status=200)=>route.fulfill({status,json:data});
  const gate=async stage=>{if(f.hold===stage){f.held=stage;await new Promise(r=>{f.release=r});f.hold='';f.held=''}};
  if(p.startsWith('/state/updates'))return json({items:[f.row]});
  if(p==='/objects/'+id&&method==='PATCH'){if(f.failSave)return json({detail:'离线保存失败'},503);f.row={...f.row,...body,version:f.row.version+1};await gate('save');return json(f.row)}
  if(p==='/studio/catalog'){await gate('catalog');return json({tools:[{id:'text_image',binding:'fixture-default',enabled:true,models:[{id:'fixture-default',configured:true}]}]})}
  if(p==='/studio/text/article-illustration-prompt'){
   if(f.rejectPrompt)return json({detail:'请选择有效正文'},f.rejectPrompt);
   const index=f.jobs.length,j={id:'job-'+index,status:f.promptStatus||'done',result:{suggested_prompt:f.emptyPrompt?'':'离线提示词 '+body.idea}};f.jobs.push(j);
   await gate('prompt');
   if(f.delayPrompt)await new Promise(r=>setTimeout(r,f.delayPrompt));
   if(f.losePrompt)return json({detail:'离线响应丢失'},503);return json(j);
  }
  if(p.startsWith('/jobs/')){const j=f.jobs.find(x=>x.id===p.slice(6));await gate('job');return json({...j,status:f.finishPrompts?'done':j.status})}
  if(p==='/studio/drafts'||/^\/studio\/flows\/[^/]+\/drafts$/.test(p)){
   const flow=p==='/studio/drafts'?'':decodeURIComponent(p.split('/')[3]);
   if(method==='GET'){
    // Match workflows._sync_flow_outputs on the existing scoped draft read.
    if(flow)for(const a of f.assets){const run=f.runs.find(r=>r.asset_ids.includes(a.id));const draft=f.drafts.find(d=>d.id===run?.draft_id);if(draft?.flow_id===flow)a.flow_id=flow}
    return json({items:f.drafts.filter(d=>(d.flow_id||'')===flow)});
   }
   if(f.rejectDraft)return json({detail:'草稿明确拒绝'},f.rejectDraft);
   const d={...body,id:'draft-'+f.drafts.length,version:flow?2:1,...(flow?{flow_id:flow}:{})};f.drafts.push(d);await gate('draft');
   if(f.delayDraft)await new Promise(r=>setTimeout(r,f.delayDraft));
   if(f.loseDraft){f.loseDraft=false;return json({detail:'草稿响应丢失'},503)}return json(d);
  }
  if(p==='/studio/generate'){
   if(f.rejectGenerate)return json({detail:'请先配置生图模型'},f.rejectGenerate);
   const draft=f.drafts.find(d=>d.id===body.draft_id);
   if((draft?.flow_id||'')!==(body.flow_id||''))return json({detail:'生成草稿不属于当前创作范围'},409);
   const n=f.runs.length,asset_id=(n+1).toString(16).padStart(32,'0');
   const run={id:'run-'+n,draft_id:body.draft_id,request_id:body.request_id,status:f.statuses?.[n]||f.runStatus||'succeeded',asset_ids:[asset_id]};f.runs.push(run);f.assets.push({id:asset_id,asset_type:'image',status:'ready'});
   await gate('generate');
   if(f.delayGenerate)await new Promise(r=>setTimeout(r,f.delayGenerate));
   if(f.loseGenerate){f.loseGenerate=false;return json({detail:'生成响应丢失'},503)}return json({run});
  }
  if(p==='/studio/runs')return json({items:f.hideRuns?[]:f.runs});
  if(/^\/studio\/runs\/.+\/refresh$/.test(p)){const r=f.runs.find(r=>p.includes('/'+r.id+'/'));await gate('refresh');return json({run:{...r,status:f.finishRuns?'succeeded':r.status}})}
  if(p==='/studio/assets')return json({items:f.assets});
  if(/^\/studio\/assets\/.+\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text y="20">OFFLINE</text></svg>'});
  unexpected.push(method+' '+p);return route.abort();
 });
 await page.goto(base);return {page,context,f};
};
const start=async p=>{await p.getByRole('button',{name:'一键配图 · 3张',exact:true}).click();await p.getByRole('dialog').waitFor();assert.equal(await p.locator('body > dialog[open]').count(),1)};
const close=async p=>p.getByRole('button',{name:'关闭弹窗',exact:true}).click();
const state=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),key);
const wait=async(p,predicate)=>p.waitForFunction(({key,code})=>{const b=JSON.parse(localStorage.getItem(key)||'null');return b&&new Function('b','return '+code)(b)},{key,code:predicate});
const posts=(f,p)=>f.requests.filter(r=>r.p===p&&r.method==='POST');
const editor=async p=>{await p.getByRole('tab',{name:'编辑',exact:true}).click();return p.getByLabel('编辑生成文稿')};
const check=async p=>{if(!await p.getByRole('dialog').count())await p.getByRole('button',{name:'查看三图进度',exact:true}).click();await p.getByRole('button',{name:'核查任务',exact:true}).click()};
const held=async(f,stage)=>{const end=Date.now()+8000;while(f.held!==stage&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.equal(f.held,stage)};

try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const stage of ['save','catalog','prompt','job','draft','generate','refresh'])await test('账号切换挂起 '+stage+'：零B请求、保留已返回ID并原账号恢复',async()=>{
  const {page,context,f}=await open({hold:stage,...(stage==='job'?{promptStatus:'running',finishPrompts:true}:{}),...(stage==='refresh'?{runStatus:'running',finishRuns:true}:{})});
  if(stage==='save')await (await editor(page)).fill(original+' 最新保存');
  await start(page);await held(f,stage);const before=await state(page);await page.evaluate(()=>window.switchFixtureToken('fixture-B'));f.release();
  await page.getByRole('alert').filter({hasText:'账号已切换'}).waitFor();const stopped=await state(page);
  assert.equal(f.requests.filter(r=>r.account==='B').length,0);
  if(stage==='prompt'){assert.equal(stopped.slots[0].job_id,'job-0');assert.equal(stopped.slots[0].status,'prompt_ready')}
  if(stage==='draft'){assert.equal(stopped.slots[0].draft_id,'draft-0');assert.equal(stopped.slots[0].status,'prepared')}
  if(stage==='generate')assert.equal(stopped.slots[0].run_id,'run-0');
  if(stopped.slots.length)assert.deepEqual(stopped.slots.map(s=>s.request_id),before.slots.map(s=>s.request_id));
  await close(page);await page.evaluate(()=>{window.switchFixtureToken('fixture-A');window.navigateArticle('b')});await page.waitForFunction(()=>document.body.textContent.includes('文章B自己的正文'));await page.evaluate(()=>window.navigateArticle('a'));
  if(['save','catalog'].includes(stage)){await page.getByRole('button',{name:'查看三图进度',exact:true}).click();await page.getByRole('button',{name:'继续保存并配图'}).click()}
  else await check(page);
  await wait(page,'b.applied.length===3');assert.equal(f.jobs.length,3);assert.equal(f.drafts.length,3);assert.equal(f.runs.length,3);assert.equal(f.requests.filter(r=>r.account==='B').length,0);await context.close();return {restored:true,generations:3,otherAccountRequests:0};
 });
 for(const status of [400,403,404])await test('明确草稿拒绝 '+status+' 可显式重新准备',async()=>{
  const {page,context,f}=await open({rejectDraft:status});await start(page);await wait(page,"b.slots.every(s=>s.status==='failed')");assert.equal(f.runs.length,0);f.rejectDraft=0;await page.getByRole('button',{name:'重试失败项 · 按用量计费',exact:true}).click();await wait(page,'b.applied.length===3');assert.equal(f.jobs.length,3);assert.equal(f.drafts.length,3);assert.equal(f.runs.length,3);await context.close();
 });
 for(const kind of ['Prompt','Generate'])for(const status of [400,409,503])await test(kind+' HTTP '+status+'：仅确定400允许显式重试',async()=>{
  const {page,context,f}=await open({['reject'+kind]:status});await start(page);await wait(page,status===400?"b.slots.every(s=>s.status==='failed')":`b.slots.every(s=>s.status==='${kind==='Prompt'?'prompt_unknown':'unknown'}')`);const before=f.requests.filter(r=>r.method==='POST').length;await check(page);assert.equal(f.requests.filter(r=>r.method==='POST').length,before);f['reject'+kind]=0;
  if(status===400){await page.getByRole('button',{name:'重试失败项 · 按用量计费',exact:true}).click();await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3)}else{await check(page);assert.equal(f.runs.length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,before)}await context.close();
 });
 await test('慢核查时点击失败重试：异操作排队不吞掉、成功项不重复',async()=>{
  const {page,context,f}=await open({statuses:['running','failed','succeeded']});await start(page);await wait(page,"b.slots[1].status==='failed'&&b.applied.length===1");f.hold='refresh';f.finishRuns=true;await check(page);await held(f,'refresh');await page.getByRole('button',{name:'重试失败项 · 按用量计费',exact:true}).evaluate(b=>{b.click();b.click()});f.release();await wait(page,'b.applied.length===3');assert.equal(f.runs.length,4);assert.equal(f.jobs.length,3);assert.equal(f.drafts.length,4);await context.close();
 });
 await test('旧卡offset随合成块移动：稳定映射并保留正文/失败卡',async()=>{
  const {page,context}=await open();const proof=await page.evaluate(()=>{const body='Intro\n\n▧ 文章配图 · title\n图片内容建议：picture\n\nEnd';const plan=window.batchLogic.planPictures(body,'legacy');const b={base:body,...plan};b.slots.forEach((s,i)=>{s.status='succeeded';s.asset_id=(i+1).toString(16).padStart(32,'0')});const all=window.batchLogic.batchResult(b);b.slots[0].status='failed';delete b.slots[0].asset_id;return {all,partial:window.batchLogic.batchResult(b)}});assert(proof.all.includes('Intro'));assert(proof.all.includes('End'));assert(!proof.all.includes('图片内容建议'));assert.equal((proof.all.match(/!\[/g)||[]).length,3);assert(proof.partial.includes('▧ 文章配图 · title\n图片内容建议：picture'));await context.close();
 });
 await test('先保存最新正文；三份提示、默认模型、独立请求并且只回填图片',async()=>{
  const {page,context,f}=await open();const field=await editor(page);await field.fill(original+'\n\n本次新增正文');await start(page);await wait(page,'b.applied.length===3');
  assert.equal(posts(f,'/studio/generate').length,3);assert.equal(f.drafts.length,3);assert.equal(new Set(f.runs.map(r=>r.request_id)).size,3);
  assert(f.requests.findIndex(r=>r.method==='PATCH')<f.requests.findIndex(r=>r.p==='/studio/text/article-illustration-prompt'));
  assert(f.jobs.every(j=>j.result.suggested_prompt.includes('配图')));assert.equal(new Set(f.jobs.map(j=>j.result.suggested_prompt)).size,3);
  assert(f.drafts.every(d=>d.model_id==='fixture-default'&&JSON.stringify(d.options)==='{}'));
  assert(posts(f,'/studio/text/article-illustration-prompt').every(r=>r.body.body.includes('本次新增正文')));
  const b=await state(page);assert.equal(b.content_version,2);assert.equal((b.expected.match(/!\[/g)||[]).length,3);assert(!b.expected.includes('article-production'));assert(!b.expected.includes('图片内容建议'));
  await page.screenshot({path:path.join(directory,'success-portal.png'),fullPage:true});
  await close(page);assert.equal(await page.evaluate(()=>typeof window.registeredSave),'function');await page.evaluate(()=>window.registeredSave());assert.equal(f.row.body,b.expected);
  await page.screenshot({path:path.join(directory,'success-editor.png'),fullPage:true});await context.close();return {generations:3,savedVersion:2,onSaveReady:true};
 });
 await test('保存失败：零提示词、零生图请求',async()=>{const {page,context,f}=await open({failSave:true});await (await editor(page)).fill(original+'改');await start(page);await wait(page,"b.status==='setup_failed'");assert.equal(f.jobs.length,0);assert.equal(f.runs.length,0);await context.close()});
 for(const format of ['口播文案','短视频脚本','小红书','朋友圈'])await test(format+'不显示文章三图入口，不自动生图',async()=>{const {page,context,f}=await open({format});assert.equal(await page.locator('[data-article-picture-batch]').count(),0);assert.equal(f.jobs.length,0);assert.equal(f.runs.length,0);await context.close()});
 await test('flow文章：scoped草稿、同flow生成/素材、保留既选cover',async()=>{
  const {page,context,f}=await open({flow_id:'flow-fixture',loseDraft:true,loseGenerate:true});await start(page);await wait(page,'b.applied.length===3');assert.equal(posts(f,'/studio/drafts').length,0);assert.equal(posts(f,'/studio/flows/flow-fixture/drafts').length,3);assert(f.drafts.every(d=>d.flow_id==='flow-fixture'&&d.source_ids.includes(id)));assert(posts(f,'/studio/generate').every(r=>r.body.flow_id==='flow-fixture'&&r.body.version===2));assert(f.assets.every(a=>a.flow_id==='flow-fixture'));assert.equal(f.row.cover_asset_id,'existing-cover');assert(!f.requests.some(r=>r.p==='/studio/flow'&&r.method==='POST'));assert.equal(f.runs.length,3);await context.close();return {drafts:3,flowAssets:3,coverUnchanged:true};
 });
 for(const fixture of [{promptStatus:'failed'},{emptyPrompt:true}])await test('提示词失败或为空不调用生图 '+JSON.stringify(fixture),async()=>{const {page,context,f}=await open(fixture);await start(page);await wait(page,"b.slots.every(s=>s.status==='failed')");assert.equal(f.runs.length,0);assert.equal(f.drafts.length,0);assert.equal((await state(page)).expected,original);await context.close()});
 await test('同一事件双击：仅三次生图',async()=>{const {page,context,f}=await open({delayDraft:200});await page.getByRole('button',{name:'一键配图 · 3张',exact:true}).evaluate(b=>{b.click();b.click()});await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3);assert.equal(f.drafts.length,3);await context.close()});
 await test('提示词处理中关闭重开，轮询原job，自动采用',async()=>{const {page,context,f}=await open({promptStatus:'running'});await start(page);await wait(page,"b.slots.every(s=>s.status==='prompt_pending')");await close(page);f.finishPrompts=true;await page.getByRole('button',{name:'查看三图进度',exact:true}).click();await wait(page,'b.applied.length===3');assert.equal(f.jobs.length,3);assert.equal(f.runs.length,3);await context.close()});
 await test('草稿POST未响应时切走再返回，不创建重复请求、不串文章B',async()=>{
  const {page,context,f}=await open({delayDraft:500});await start(page);await wait(page,"b.slots.some(s=>s.status==='draft_submitting')");await page.evaluate(()=>window.navigateArticle('b'));await page.waitForFunction(()=>document.body.textContent.includes('文章B自己的正文'));await page.evaluate(()=>window.navigateArticle('a'));await check(page);await wait(page,'b.applied.length===3');assert.equal(f.drafts.length,3);assert.equal(f.runs.length,3);assert.equal(await page.evaluate(o=>localStorage.getItem('article-picture-batch:'+o+':batch-article-b'),owner),null);await context.close();
 });
 await test('生成处理中关闭并刷新页面：原request/draft/version不变',async()=>{
  const {page,context,f}=await open({runStatus:'running'});await start(page);await wait(page,"b.slots.every(s=>s.status==='running')");const before=(await state(page)).slots.map(s=>[s.request_id,s.draft_id,s.version]);await close(page);await page.reload();f.finishRuns=true;await check(page);await wait(page,'b.applied.length===3');assert.deepEqual((await state(page)).slots.map(s=>[s.request_id,s.draft_id,s.version]),before);assert.equal(f.runs.length,3);await context.close();
 });
 for(const status of ['unknown','archive_failed'])await test(status+'恢复只核查原任务，不重发POST',async()=>{
  const {page,context,f}=await open({runStatus:status});await start(page);await wait(page,`b.slots.every(s=>s.status==='${status}')`);const before=(await state(page)).slots.map(s=>s.request_id);await check(page);await close(page);await page.reload();f.finishRuns=true;await check(page);await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3);assert.deepEqual((await state(page)).slots.map(s=>s.request_id),before);await context.close();
 });
 await test('部分失败：两图保留，仅显式重试失败项',async()=>{
  const {page,context,f}=await open({statuses:['succeeded','failed','succeeded']});await start(page);await wait(page,'b.applied.length===2');assert.equal(f.runs.length,3);const b=await state(page);assert.equal((b.expected.match(/!\[/g)||[]).length,2);await page.getByRole('button',{name:'重试失败项 · 按用量计费',exact:true}).evaluate(b=>{b.click();b.click()});await wait(page,'b.applied.length===3');assert.equal(f.runs.length,4);assert.equal(f.jobs.length,3);assert.equal(f.drafts.length,4);const after=await state(page);assert.equal(after.slots[0].request_id,b.slots[0].request_id);assert.equal(after.slots[2].request_id,b.slots[2].request_id);await context.close();
 });
 await test('三图全部失败，正文不加入占位/解释，核查不重试',async()=>{const {page,context,f}=await open({runStatus:'failed'});await start(page);await wait(page,"b.slots.every(s=>s.status==='failed')");await check(page);assert.equal((await state(page)).expected,original);assert.equal(f.runs.length,3);await context.close()});
 await test('正文在生成期间变化：禁止覆盖，三图保留素材库',async()=>{
  const {page,context,f}=await open({runStatus:'running'});await start(page);await wait(page,"b.slots.every(s=>s.status==='running')");await close(page);const field=await editor(page);await field.fill('用户新的完整正文');f.finishRuns=true;await check(page);await wait(page,"b.slots.every(s=>s.status==='succeeded')");await page.getByRole('alert').filter({hasText:'正文已变化'}).waitFor();assert.equal((await state(page)).applied.length,0);assert.equal(await page.getByRole('link',{name:'去素材库使用已生成图片'}).getAttribute('href'),'#studio/assets');await close(page);assert.equal(await field.inputValue(),'用户新的完整正文');assert.equal(f.assets.length,3);await page.getByRole('button',{name:'素材库插图',exact:true}).click();await page.getByRole('tab',{name:'素材库',exact:true}).waitFor();await page.getByRole('button',{name:'选择这张图片',exact:true}).first().waitFor();await context.close();
 });
 await test('原单图pending互斥：三图不保存/不调用模型',async()=>{const {page,context,f}=await open();await page.evaluate(({owner,id})=>localStorage.setItem('article-picture:'+owner+':'+id,JSON.stringify({pending:{request_id:'old',draft_id:'old',version:1}})),{owner,id});await start(page);await page.getByRole('alert').filter({hasText:'原单图任务'}).waitFor();assert.equal(f.jobs.length,0);assert.equal(f.runs.length,0);await context.close()});
 await test('三图pending时禁止单图生成入口',async()=>{const {page,context}=await open({runStatus:'running'});await start(page);await wait(page,"b.slots.every(s=>s.status==='running')");await close(page);await editor(page);await page.getByRole('button',{name:'AI 生成配图',exact:true}).click();await page.getByRole('alert').filter({hasText:'三图任务尚未结束'}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);await context.close()});
 await test('生成响应丢失，按原request_id找回，不再POST',async()=>{const {page,context,f}=await open({loseGenerate:true});await start(page);await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3);assert.equal(posts(f,'/studio/generate').length,3);await context.close()});
 await test('草稿响应丢失，按独有标题/模型/提示词找回，不另建draft',async()=>{const {page,context,f}=await open({loseDraft:true});await start(page);await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3);assert.equal(f.drafts.length,3);await context.close()});
 await test('提示词响应丢失：保留unknown，重开核查不重复收费请求',async()=>{const {page,context,f}=await open({losePrompt:true});await start(page);await wait(page,"b.slots.every(s=>s.status==='prompt_unknown')");await close(page);await page.reload();await check(page);assert.equal(f.jobs.length,3);assert.equal(f.runs.length,0);assert.equal(f.drafts.length,0);await context.close()});
 await test('本机持久化失败：任何付费请求之前停止',async()=>{const {page,context,f}=await open();await page.evaluate(()=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('article-picture-batch:'))throw Error('离线模拟存储已满');return old.call(this,k,v)}});await start(page);await page.getByRole('alert').filter({hasText:'存储已满'}).waitFor();assert.equal(f.jobs.length,0);assert.equal(f.runs.length,0);await context.close()});
 await test('复用既有三处production目标；批量替换不残留说明/重复图片',async()=>{
  const {page,context}=await open();const proof=await page.evaluate(()=>{const body=['开头正文','中间正文','结尾正文'].map((s,i)=>s+'\n\n:::article-production illustration pic-'+i+'\n图片内容建议：画面'+i+'\n:::end-article-production').join('\n\n');const plan=window.batchLogic.planPictures(body,'test');const b={base:body,...plan};b.slots.forEach((s,i)=>{s.status='succeeded';s.asset_id=(i+1).toString(16).padStart(32,'0')});const result=window.batchLogic.batchResult(b);return {result,ids:b.slots.map(s=>s.id),synthetic:b.slots.map(s=>s.synthetic)}});assert.deepEqual(proof.ids,['pic-0','pic-1','pic-2']);assert.deepEqual(proof.synthetic,[false,false,false]);assert(!proof.result.includes('article-production'));assert.equal((proof.result.match(/!\[/g)||[]).length,3);await context.close();return proof.ids;
 });
 await test('真实编辑器中三处已有占位：部分成功替换、失败原文保留，补齐后全部清理',async()=>{
  const {page,context,f}=await open({statuses:['succeeded','failed','succeeded']});const body=['开头正文','中间正文','结尾正文'].map((s,i)=>s+'\n\n:::article-production illustration pic-'+i+'\n图片内容建议：画面'+i+'\n:::end-article-production').join('\n\n');await (await editor(page)).fill(body);await start(page);await wait(page,'b.applied.length===2');const partial=await state(page);assert(partial.expected.includes('illustration pic-1'));assert(!partial.expected.includes('illustration pic-0'));assert(!partial.expected.includes('illustration pic-2'));await page.getByRole('button',{name:'重试失败项 · 按用量计费',exact:true}).click();await wait(page,'b.applied.length===3');assert(!(await state(page)).expected.includes('图片内容建议'));assert.equal(f.runs.length,4);await context.close();
 });
 await test('同源两窗口同时启动：仅一批三图',async()=>{
  const {page,context,f}=await open({delayDraft:150});const other=await context.newPage();await other.goto(base);await Promise.all([page.getByRole('button',{name:'一键配图 · 3张',exact:true}).click(),other.getByRole('button',{name:'一键配图 · 3张',exact:true}).click()]);await wait(page,'b.applied.length===3');assert.equal(f.runs.length,3);assert.equal(f.drafts.length,3);await context.close();
 });
}finally{
 await browser?.close();await new Promise(r=>server.close(r));
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({offline:true,paidCalls:0,red,results,unexpected,errors},null,2));
 console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,unexpected,errors}));
 if(results.some(r=>!r.ok)||unexpected.length||errors.length)process.exitCode=1;
}
