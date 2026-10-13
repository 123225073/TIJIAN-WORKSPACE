// Independent real-source UI audit. Every HTTP API below is an explicitly
// labelled local fixture, including simulated image generation and handoff.
// No production build, backend service, database or paid model is used.
// node scripts/test-outcome-link-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const directory=path.resolve('.runtime','outcome-link-ui-'+Date.now());fs.mkdirSync(directory,{recursive:true});
// Pin source files for both fixture JS and the complete real CSS cascade while
// the main worker is editing the shared workspace. No source file is rewritten.
const snapshot=new Map(fs.readdirSync('src',{recursive:true}).filter(file=>/\.(?:tsx?|css)$/.test(file)).map(file=>{const full=path.resolve('src',file);return [full,fs.readFileSync(full,'utf8')]}));
const testScriptSHA256=createHash('sha256').update(fs.readFileSync('scripts/test-outcome-link-ui.mjs')).digest('hex');
const sourceSnapshotHashes=Object.fromEntries([...snapshot].sort(([a],[b])=>a.localeCompare(b)).map(([file,text])=>[path.relative(process.cwd(),file).replaceAll('\\','/'),createHash('sha256').update(text).digest('hex')]));
const sourceSnapshotSHA256=createHash('sha256').update(JSON.stringify(sourceSnapshotHashes)).digest('hex');
const plugins=[{name:'real-source-snapshot',setup(builder){builder.onLoad({filter:/[\\/]src[\\/].+\.(?:tsx?|css)$/},({path:filename})=>({contents:snapshot.get(filename),loader:filename.endsWith('.tsx')?'tsx':filename.endsWith('.css')?'css':'ts',resolveDir:path.dirname(filename)}))}}];
const owner='isolated-outcome-link-owner',id='isolated-outcome-link-content',taskId='isolated-outcome-link-task';
const legacy=JSON.parse(fs.readFileSync('tests/fixtures/article-production.json','utf8'))[0];
const explicit={name:'three explicit production blocks',prompts:['门机检查：本地fixture画面一。','记录对照：本地fixture画面二。','检查清单：本地fixture画面三。'],body:'正文应正常讨论提示词。\n\n:::article-production illustration fixture-plan-1\n图片内容建议：门机检查：本地fixture画面一。\n制作说明：仅为本地测试。\n:::end-article-production\n\n中段手工改为先看记录。\n\n:::article-production illustration fixture-plan-2\n图片内容建议：记录对照：本地fixture画面二。\n:::end-article-production\n\n末段请带上检查清单。\n\n:::article-production illustration fixture-plan-3\n图片内容建议：检查清单：本地fixture画面三。\n:::end-article-production'};
const rows=[{key:'legacy',...legacy},{key:'explicit',...explicit}];
const contentFor=body=>({id,kind:'content',task_id:taskId,title:'[LOCAL API FIXTURE] 三张配图与成果衔接',version:7,body,summary:'本地fixture摘要',wechat_style:{font_size:'16',line_height:'1.8',paragraph_gap:'12',accent:'forest'}});
const oldAsset={id:'1'.repeat(32),kind:'studio_asset',title:'[LOCAL API FIXTURE] 旧缓存图片',asset_type:'image',status:'ready',width:320,height:180,file_url:'/api/studio/assets/'+'1'.repeat(32)+'/file'};
const newAsset={...oldAsset,id:'2'.repeat(32),title:'[LOCAL API FIXTURE] 第二计划模拟生成图',file_url:'/api/studio/assets/'+'2'.repeat(32)+'/file'};
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import TaskWorkspace from './src/TaskWorkspace';import {api} from './src/api';import {useArticleDraft} from './src/article-draft';import OutcomeHandoff from './src/OutcomeHandoff';import {installFormKeys} from './src/inputKeys';import {parseArticleProduction,productionBookmark,replaceProductionInstruction} from './src/article-production';import {readerArticleText} from './src/wechat-rich';
installFormKeys();
window.outcomeTestModules={parseArticleProduction,productionBookmark,replaceProductionInstruction,readerArticleText};
// This second fixture invokes the REAL hook and REAL handoff component. Its
// editable input supplies a concurrent draft change while the PATCH is held.
function DraftRace(){const f=window.outcomeLinkFixture;const draft=useArticleDraft({content:f.content,key:'${'platform-draft:'+owner+':'+id}',fields:r=>({title:r.title,body:r.body}),path:'/tasks/${taskId}/outcomes/${id}',refresh:async()=>{}});return <div className="aw-outcome"><label>并发编辑fixture<input aria-label="保存期间人工修订" value={draft.values.title} onChange={e=>draft.change('title',e.target.value)}/></label><OutcomeHandoff content={f.content} task={f.task} platform="wechat" save={draft.save} disabled={false} onBusy={()=>{}} t={{refresh:async()=>{}}}/></div>}
function Fixture(){const f=window.outcomeLinkFixture;const [content,setContent]=useState(f.content);const state={user:{id:'${owner}'},models:[],complete:true,objects:[content,...f.assets]};const refresh=async()=>{const r=await api('/state/updates?ids='+content.id);setContent(r.items[0])};const t={state,task:f.task,get:id=>state.objects.find(x=>x.id===id),list:kind=>state.objects.filter(x=>x.kind===kind),opts:()=>[],refresh,setError:e=>{throw Error(e)},setNotice:()=>{},action:async fn=>fn()};return f.mode==='draft-race'?<DraftRace/>:<TaskWorkspace {...t}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),external:['/visuals/*'],plugins});
const css=app.outputFiles.find(file=>file.path.endsWith('.css')).text;
const fixtureBundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js'),plugins});
const js=fixtureBundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;if(p==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(p==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}else{res.statusCode=503;res.end('LOCAL API FIXTURE ONLY: no backend connected')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263b59"/><text x="15" y="90" fill="#edf2fb">LOCAL API FIXTURE - NO MODEL CALL</text></svg>';
const draftKey='platform-draft:'+owner+':'+id,pictureKey='article-picture:'+owner+':'+id,positionKey='article-position:'+owner+':'+id;
const results=[],screenshots=[],browserErrors=[],unexpected=[],apiEvidence=[];let browser;
const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release}};
const pureRender=(body,settings)=>{const result=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c','import json,sys; from backend.wechat_layout import render; d=json.load(sys.stdin); print(json.dumps({"html":render(d["body"],d.get("settings"))},ensure_ascii=False))'],{encoding:'utf8',windowsHide:true,input:JSON.stringify({body,settings}),env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',TIJIAN_DATA:path.join(directory,'pure-render-isolated')}});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout).html};
const capture=async(page,name)=>{await settleUI(page);const filename=name+'.png';await page.screenshot({path:path.join(directory,filename),fullPage:true});screenshots.push(filename)};
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(error){results.push({name,ok:false,error:error.stack});console.log('FAIL '+name+' '+error.message)}console.log(JSON.stringify({name,ok:results.at(-1).ok}));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,screenshots},null,2))};
const open=async(row=rows[0],viewport={width:1366,height:900},mode='task')=>{
 const context=await browser.newContext({viewport}),page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>browserErrors.push(e.message));
 const f={row,server:contentFor(row.body),requests:[],draft:null,run:null,generation:'success',completePending:false,handoffHold:null,saveHold:null,saveFailure:false,handoffFailure:false,externalSwapAfterSave:false,savedResponse:null,works:new Map()};
 const task={id:taskId,kind:'task',title:'[LOCAL API FIXTURE] 工作成果验收',active_outcome:'wechat',platform_outcomes:{wechat:id},messages:[{role:'assistant',text:'隔离API fixture，生成与衔接均为模拟响应，不会付费或发布。'}]};
 await context.addInitScript(({fixture,pictureKey})=>{if(window!==window.top)return;window.outcomeLinkFixture=fixture;if(!localStorage.getItem(pictureKey))localStorage.setItem(pictureKey,JSON.stringify({prompt:'旧缓存提示词，绝不能用于第二计划',generated_id:'1'.repeat(32),idea:'旧画面想法',model:'local-fixture-model',context:{body:'旧文稿',start:0,end:3,text:'旧文稿'}}))},{fixture:{content:f.server,task,assets:[oldAsset],mode},pictureKey});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base){unexpected.push(request.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();const p=url.pathname.slice(4),method=request.method();const event={order:f.requests.length,path:p,method,body:request.postData()&&method!=='GET'?request.postDataJSON():null};f.requests.push(event);
  const answer=(json,status=200)=>route.fulfill({status,json,headers:{'X-Local-API-Fixture':'outcome-link-ui-no-real-service'}});
  if(p==='/studio/catalog')return answer({tools:[{id:'text_image',binding:'local-fixture-model',enabled:true,models:[{id:'local-fixture-model',title:'[LOCAL API FIXTURE] 不付费模型',configured:true,options:{}}]}]});
  if(p==='/studio/assets')return answer({items:[oldAsset,...(f.run?.status==='succeeded'?[newAsset]:[])]});
  if(p==='/studio/runs')return answer({items:f.run?[f.run]:[]});
  if(p==='/studio/drafts'){f.draft={...event.body,id:'local-fixture-image-draft',version:1};return answer(f.draft)}
  if(p==='/studio/generate'){f.run={id:'local-fixture-image-run',request_id:event.body.request_id,status:'running',asset_ids:[]};return answer({run:f.run})}
  if(p==='/studio/runs/local-fixture-image-run/refresh'){
   if(f.generation==='failure')f.run={...f.run,status:'failed',error:'[LOCAL API FIXTURE] 故意模拟生成失败'};
   else if(f.generation==='success'||f.completePending)f.run={...f.run,status:'succeeded',asset_ids:[newAsset.id]};
   else if(f.generation==='unknown')f.run={...f.run,status:'unknown',error:'[LOCAL API FIXTURE] 故意模拟状态待核查'};
   return answer({run:f.run});
  }
  if(/^\/studio\/assets\/[12]{32}\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:svg});
  if(p==='/wechat-publish/preview')return answer({html:pureRender(event.body.body,event.body.wechat_style)});
  if(p==='/state/updates'){
   const reply=structuredClone(f.server);
   // The save hook's own refresh receives v8. Another window changes the real
   // fixture state to v9 immediately afterwards. An extra handoff GET would
   // silently obtain v9; using the PATCH's saved row must instead submit v8.
   if(f.externalSwapAfterSave&&f.savedResponse){f.externalSwapAfterSave=false;f.server={...f.server,title:'外窗新标题，不能静默转入',body:'外窗新正文，不能静默转入',version:f.server.version+1}}
   return answer({items:[reply]});
  }
  const outcome='/tasks/'+taskId+'/outcomes/'+id;
  if(p===outcome&&method==='PATCH'){if(f.saveHold)await f.saveHold.promise;if(f.saveFailure)return answer({detail:'[LOCAL API FIXTURE] 故意模拟保存失败'},503);assert.equal(event.body.version,f.server.version,'fixture save version');f.server={...f.server,...event.body,version:f.server.version+1};f.savedResponse=structuredClone(f.server);return answer(f.savedResponse)}
  if(p===outcome+'/handoffs')return answer({items:[...f.works.values()]});
  if(p===outcome+'/handoff'){
   if(f.handoffHold)await f.handoffHold.promise;if(f.handoffFailure)return answer({detail:'[LOCAL API FIXTURE] 故意模拟衔接失败'},503);
   if(event.body.version!==f.server.version)return answer({detail:'[LOCAL API FIXTURE] 保存后版本变化，已阻止衔接'},409);
   const key=event.body.version,reused=f.works.has(key);if(!reused)f.works.set(key,{id:'local-fixture-work-v'+key,source_version:key,brief:'LOCAL API FIXTURE WORK'});
   return answer({route:'studio/flow?work='+f.works.get(key).id+'&step=4',reused,fixture:true});
  }
  unexpected.push(method+' '+p);return route.abort();
 });
 await page.goto(base);if(mode==='draft-race')await page.getByLabel('保存期间人工修订').waitFor();else await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();
 f.page=page;f.context=context;apiEvidence.push(f);
 return f;
};
const parsed=(page,body)=>page.evaluate(body=>window.outcomeTestModules.parseArticleProduction(body),body);
const localBody=async f=>f.page.evaluate(({key,body})=>JSON.parse(localStorage.getItem(key)||'null')?.values.body??body,{key:draftKey,body:f.row.body});
const close=async f=>{f.handoffHold?.release();f.saveHold?.release();await f.context.close()};
const assertPortal=async page=>{const placement=await page.locator('.studio-modal:has(.article-picture-workspace)').evaluate(el=>({outsideRoot:!document.getElementById('root').contains(el),bodyChild:el.parentElement===document.body,modal:el.matches(':modal')}));assert.deepEqual(placement,{outsideRoot:true,bodyChild:true,modal:true},'real createPortal + native modal dialog');return placement};
const openPlan=async(f,index=1)=>{const plans=f.page.locator('.aw-production-plans');await plans.locator('summary').click();assert.equal(await plans.locator('article').count(),3);await plans.getByRole('button',{name:'为此位置生成配图',exact:true}).nth(index).click();await f.page.getByLabel('配图提示词',{exact:true}).waitFor();await assertPortal(f.page);const pending=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}').pending,pictureKey);if(!pending)await f.page.waitForFunction(()=>document.querySelector('.ap-generate>.st-primary')&&!document.querySelector('.ap-generate>.st-primary').disabled)};
const generate=async f=>{await f.page.locator('.ap-generate').getByRole('button',{name:'生成新配图',exact:true}).click();await f.page.getByRole('button',{name:'确认生成配图',exact:true}).click()};
const exactReplacement=async f=>{const original=await parsed(f.page,f.row.body),second=original.instructions[1];const next=await localBody(f),expected=f.row.body.slice(0,second.start)+'![正文配图]('+newAsset.file_url+')'+f.row.body.slice(second.end);assert.equal(next,expected,'only the second production block is replaced; every other source character survives');const remaining=await parsed(f.page,next);assert.equal(remaining.instructions.length,2);assert.equal(remaining.instructions[0].raw,original.instructions[0].raw);assert.equal(remaining.instructions[1].raw,original.instructions[2].raw);return {remaining:2,secondOnly:true,sourceCharactersPreserved:true}};
const finishCase=async(f,name)=>{await capture(f.page,name);await close(f)};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.OUTCOME_LINK_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 for(const row of rows){
  await test(row.key+' / 第二计划prompt覆盖旧缓存，成功仅替换第二块',async()=>{const f=await open(row);try{
   const original=await parsed(f.page,row.body);assert.equal(original.instructions.length,3);assert.deepEqual(original.instructions.map(x=>x.prompt),row.prompts);
   await openPlan(f);assert.equal(await f.page.getByLabel('配图提示词',{exact:true}).inputValue(),row.prompts[1]);assert.equal(await f.page.getByLabel('配图画面想法').inputValue(),'');assert.equal(await f.page.getByRole('button',{name:'确认插入文稿',exact:true}).count(),0,'old cached image must not remain selected');
   const mark=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),positionKey);assert.equal(mark.instruction_id,original.instructions[1].id);
   await generate(f);await f.page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(f.draft.input.prompt,row.prompts[1]);assert.equal(f.requests.filter(r=>r.path==='/studio/generate').length,1);const evidence=await exactReplacement(f);
   await f.page.waitForFunction(()=>document.querySelector('.article-rich-editor img')?.naturalWidth>0);await capture(f.page,row.key+'-second-replaced');return {...evidence,submittedPrompt:f.draft.input.prompt,apiFixture:true};
  }finally{await close(f)}});
  await test(row.key+' / 模拟生成失败保留全部三个计划和正文',async()=>{const f=await open(row);try{
   f.generation='failure';await openPlan(f);await generate(f);await f.page.getByRole('alert').filter({hasText:'故意模拟生成失败'}).waitFor();assert.equal(await localBody(f),row.body);assert.equal((await parsed(f.page,await localBody(f))).instructions.length,3);await capture(f.page,row.key+'-generation-failure');return {unchanged:true,plans:3};
  }finally{await close(f)}});
  await test(row.key+' / 关闭重载pending后点击第一计划仍恢复第二书签',async()=>{const f=await open(row);try{
   f.generation='pending';await openPlan(f);await generate(f);await f.page.locator('.ap-run-status').filter({hasText:'配图生成中'}).waitFor();const mark=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),positionKey),pending=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,pictureKey);assert(pending?.request_id);
   await f.page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await f.page.reload();await openPlan(f,0);
   const after=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),positionKey);assert.deepEqual(after,mark);assert.equal(await f.page.getByLabel('配图提示词',{exact:true}).inputValue(),row.prompts[1]);assert.equal(await f.page.getByLabel('配图提示词',{exact:true}).isEditable(),false);
   f.completePending=true;await f.page.getByRole('dialog').waitFor({state:'hidden',timeout:10000});assert.equal(f.requests.filter(r=>r.path==='/studio/generate').length,1);const evidence=await exactReplacement(f);await capture(f.page,row.key+'-pending-recovered');return {...evidence,originalInstruction:after.instruction_id,sameRequest:true};
  }finally{await close(f)}});
  await test(row.key+' / 实际Portal unknown重载锁定原要求，核查成功只替换第二计划',async()=>{const f=await open(row);try{
   f.generation='unknown';await openPlan(f);await generate(f);await f.page.getByRole('button',{name:'核查配图任务',exact:true}).waitFor();
   const saved=await f.page.evaluate(({positionKey,pictureKey})=>({bookmark:JSON.parse(localStorage.getItem(positionKey)),picture:JSON.parse(localStorage.getItem(pictureKey))}),{positionKey,pictureKey});assert(saved.picture.pending?.request_id);assert.equal(saved.picture.prompt,row.prompts[1]);assert.equal(await localBody(f),row.body);
   const prompt=f.page.getByLabel('配图提示词',{exact:true});assert.equal(await prompt.isEditable(),false);await prompt.focus();await prompt.press('Control+End');await prompt.press('Control+Enter');await prompt.press('Enter');await prompt.pressSequentially('不应写入锁定的提示词');assert.equal(await prompt.inputValue(),row.prompts[1]);assert.equal(await f.page.locator('.ap-confirm').count(),0);assert.equal(f.requests.filter(r=>r.path==='/studio/generate').length,1);
   await f.page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await f.page.reload();await openPlan(f,0);await f.page.getByRole('button',{name:'核查配图任务',exact:true}).waitFor();
   const recovered=await f.page.evaluate(({positionKey,pictureKey})=>({bookmark:JSON.parse(localStorage.getItem(positionKey)),picture:JSON.parse(localStorage.getItem(pictureKey))}),{positionKey,pictureKey});assert.deepEqual(recovered.bookmark,saved.bookmark);assert.deepEqual(recovered.picture.pending,saved.picture.pending);assert.deepEqual(recovered.picture.context,saved.picture.context);assert.equal(recovered.picture.prompt,row.prompts[1]);assert.equal(await prompt.isEditable(),false);assert.equal(await f.page.getByLabel('配图模型').isDisabled(),true);assert.equal(await f.page.getByLabel('配图画面想法').isDisabled(),true);
   const portal=await assertPortal(f.page);await capture(f.page,row.key+'-unknown-reloaded-portal');f.completePending=true;await f.page.getByRole('button',{name:'核查配图任务',exact:true}).click();await f.page.getByRole('dialog').waitFor({state:'hidden'});const evidence=await exactReplacement(f);assert.equal(f.requests.filter(r=>r.path==='/studio/generate').length,1);assert.equal(f.requests.filter(r=>r.path==='/studio/drafts').length,1);await f.page.waitForFunction(()=>document.querySelector('.article-rich-editor img')?.naturalWidth>0);await capture(f.page,row.key+'-unknown-recovered-success');return {...evidence,portal,sameRequest:true,readOnlyKeyboardGuard:true,originalInstruction:recovered.bookmark.instruction_id,simulation:'unknown → reload → manual refresh → succeeded'};
  }finally{await close(f)}});
  await test(row.key+' / UI阅读预览和真实后端纯render无制作文本',async()=>{const f=await open(row);try{
   const frontend=await f.page.evaluate(body=>window.outcomeTestModules.readerArticleText(body),row.body),backend=pureRender(row.body);assert(!frontend.includes(row.prompts[0])&&!frontend.includes(row.prompts[1])&&!frontend.includes(row.prompts[2]));assert(!/图片内容建议|:::article-production|制作说明：/.test(backend));assert(frontend.includes('正文应正常讨论提示词')&&backend.includes('中段手工改为先看记录'));
   await f.page.getByRole('button',{name:'阅读预览',exact:true}).click();const frame=f.page.frameLocator('iframe[title="公众号排版预览"]');await frame.getByText('中段手工改为先看记录。',{exact:true}).waitFor();const reader=await frame.locator('body').innerText();assert(!/图片内容建议|:::article-production|制作说明：/.test(reader));assert(!reader.includes(row.prompts[1]));assert(reader.includes('正文应正常讨论提示词'));assert.equal(await localBody(f),row.body);await capture(f.page,row.key+'-clean-preview');return {frontendClean:true,backendPureRenderClean:true,sourceRetained:true};
  }finally{await close(f)}});
 }
 await test('成果衔接保存最新人工修改，使用返回row.version；快速二击仅POST一次',async()=>{const f=await open();try{
  await f.page.getByLabel('成果标题').fill('人工修订标题 · LOCAL API FIXTURE');const editor=f.page.getByRole('textbox',{name:'公众号文章正文'});await editor.focus();await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially('人工补充观点必须保留。');const edited=await localBody(f);assert(edited.includes('人工补充观点必须保留'));
  f.handoffHold=gate();const button=f.page.getByRole('button',{name:'保存并进入平台准备',exact:true});await button.scrollIntoViewIfNeeded();await button.evaluate(el=>{el.click();el.click()});await f.page.waitForFunction(()=>document.querySelector('.aw-handoff>button')?.disabled);for(let i=0;i<100&&!f.requests.some(r=>r.path.endsWith('/handoff'));i++)await new Promise(resolve=>setTimeout(resolve,30));
  const posts=f.requests.filter(r=>r.path.endsWith('/handoff'));assert.equal(posts.length,1);const patch=f.requests.find(r=>r.method==='PATCH');assert(patch);assert.equal(patch.body.body,edited);assert.equal(patch.body.title,'人工修订标题 · LOCAL API FIXTURE');assert.equal(posts[0].body.version,f.savedResponse.version);assert.equal(f.server.version,8);assert.equal(f.server.body,edited);assert.equal(f.requests.filter(r=>r.path==='/state/updates'&&r.order<posts[0].order).length,2,'only save preflight and hook refresh; no extra latest-version GET by OutcomeHandoff');
  assert.equal(await f.page.getByLabel('成果标题').isDisabled(),true);assert.equal(await f.page.locator('.aw-editor-actions button').first().isDisabled(),true);assert.equal(await f.page.locator('.aw-article-editor-body').evaluate(el=>getComputedStyle(el).pointerEvents),'none');assert.equal(await editor.isEditable(),false,'handoff locks the real contentEditable surface');
  f.handoffHold.release();await f.page.waitForFunction(()=>location.hash.includes('local-fixture-work-v8'));await button.waitFor();const route=await f.page.evaluate(()=>location.hash);await button.click();await f.page.waitForFunction(()=>!document.querySelector('.aw-handoff>button')?.disabled);assert.equal(f.requests.filter(r=>r.path.endsWith('/handoff')).length,2);assert.equal(f.requests.filter(r=>r.method==='PATCH').length,1);assert.equal(f.works.size,1);assert.equal(await f.page.evaluate(()=>location.hash),route);await capture(f.page,'handoff-current-version');return {firstActionPosts:1,rapidSecondClickIgnored:true,savedVersion:8,repeatVersion:8,fixtureWorks:1,idempotencyScope:'fixture response only; real backend not started'};
 }finally{await close(f)}});
 await test('保存后外窗换稿：仍提交保存返回的v8，409阻止静默转入v9',async()=>{const f=await open();try{
  await f.page.getByLabel('成果标题').fill('我的人工稿，保存返回版本8');f.externalSwapAfterSave=true;await f.page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();await f.page.locator('.aw-handoff [role=alert]').filter({hasText:'版本变化'}).waitFor();const posts=f.requests.filter(r=>r.path.endsWith('/handoff'));assert.equal(posts.length,1);assert.equal(f.savedResponse.version,8);assert.equal(f.server.version,9);assert.equal(posts[0].body.version,8);assert.equal(f.works.size,0);assert.equal(await f.page.evaluate(()=>location.hash),'');const cache=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey);assert.equal(cache.values.title,'我的人工稿，保存返回版本8');assert.equal(cache.version,8);await capture(f.page,'handoff-external-version-rejected');return {savedVersion:8,externalVersion:9,submittedVersion:8,routeUnchanged:true,localManualDraftRetained:true};
 }finally{await close(f)}});
 await test('真实useArticleDraft保存期间又有人工修改：保留新稿并停止导航',async()=>{const f=await open(rows[0],{width:1366,height:900},'draft-race');try{
  const title=f.page.getByLabel('保存期间人工修订');await title.fill('提交保存时的人工稿');f.saveHold=gate();await f.page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();for(let i=0;i<100&&!f.requests.some(r=>r.method==='PATCH');i++)await new Promise(resolve=>setTimeout(resolve,30));assert(f.requests.some(r=>r.method==='PATCH'));await title.fill('保存期间继续改的新稿必须保留');f.saveHold.release();await f.page.locator('.aw-handoff [role=alert]').filter({hasText:'保存期间文稿又有修改'}).waitFor();assert.equal(f.requests.filter(r=>r.path.endsWith('/handoff')).length,0);assert.equal(f.server.title,'提交保存时的人工稿');const cache=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey);assert.equal(cache.values.title,'保存期间继续改的新稿必须保留');assert.equal(cache.baseline.title,'提交保存时的人工稿');assert.equal(cache.version,8);assert.equal(await f.page.evaluate(()=>location.hash),'');await capture(f.page,'handoff-dirty-during-save-stopped');return {savedVersion:8,newLocalEditRetained:true,handoffPosts:0,routeUnchanged:true,components:'real useArticleDraft + real OutcomeHandoff with editable race fixture'};
 }finally{await close(f)}});
 await test('成果衔接失败后服务器已保存且本机人工稿完整保留',async()=>{const f=await open();try{
  await f.page.getByLabel('成果标题').fill('衔接失败也保留的人工标题');f.handoffFailure=true;await f.page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();await f.page.getByRole('region',{name:'使用工作成果'}).getByRole('alert').waitFor();assert.equal(f.server.title,'衔接失败也保留的人工标题');assert.equal(f.server.version,8);const cache=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey);assert.equal(cache.values.title,f.server.title);assert.equal(cache.values.body,f.server.body);assert.equal(await f.page.getByLabel('成果标题').inputValue(),f.server.title);assert.equal(await f.page.evaluate(()=>location.hash),'');await capture(f.page,'handoff-failure-preserved');return {saved:true,localDraftPreserved:true,routeUnchanged:true};
 }finally{await close(f)}});
 await test('保存失败阻止handoff POST，本地未保存稿仍可恢复',async()=>{const f=await open();try{
  await f.page.getByLabel('成果标题').fill('保存失败的本地人工稿');f.saveFailure=true;await f.page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();await f.page.locator('.aw-handoff [role=alert]').waitFor();assert.equal(f.requests.filter(r=>r.path.endsWith('/handoff')).length,0);const cache=await f.page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey);assert.equal(cache.values.title,'保存失败的本地人工稿');assert.equal(f.server.version,7);await f.page.reload();assert.equal(await f.page.getByLabel('成果标题').inputValue(),'保存失败的本地人工稿');return {handoffPosts:0,unsavedDraftRecovered:true};
 }finally{await close(f)}});
 for(const viewport of [{width:1366,height:900},{width:390,height:844}])await test(`布局与文字对比度 ${viewport.width}×${viewport.height}`,async()=>{const f=await open(rows[0],viewport);try{
  await f.page.locator('.aw-production-plans summary').click();await f.page.locator('.aw-production-plans').scrollIntoViewIfNeeded();const plansContrast=await f.page.evaluate(measureContrast,{scope:'.aw-production-plans',viewportOnly:false});await capture(f.page,'plans-layout-'+viewport.width);
  const planLayout=await f.page.locator('.aw-production-plans').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scrollWidth:el.scrollWidth,width:el.clientWidth,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth}));assert(planLayout.left>=0&&planLayout.right<=viewport.width+1&&planLayout.scrollWidth<=planLayout.width+1&&planLayout.pageWidth<=viewport.width+1,'plan list fits screen');
  await f.page.locator('.aw-handoff').scrollIntoViewIfNeeded();const handoffContrast=await f.page.evaluate(measureContrast,{scope:'.aw-handoff',viewportOnly:false});await capture(f.page,'handoff-layout-'+viewport.width);const handoffLayout=await f.page.locator('.aw-handoff').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scrollWidth:el.scrollWidth,width:el.clientWidth,pageWidth:document.documentElement.scrollWidth}));
  await f.page.locator('.aw-production-plans').getByRole('button',{name:'为此位置生成配图',exact:true}).nth(1).click();await f.page.getByLabel('配图提示词',{exact:true}).waitFor();const dialogContrast=await f.page.evaluate(measureContrast,{scope:'.studio-modal:has(.article-picture-workspace)',viewportOnly:false});await capture(f.page,'plan-dialog-layout-'+viewport.width);
  const evidence={planLayout,handoffLayout,contrasts:{plans:plansContrast,handoff:handoffContrast,dialog:dialogContrast}};fs.writeFileSync(path.join(directory,'layout-contrast-'+viewport.width+'.json'),JSON.stringify(evidence,null,2));assert(handoffLayout.left>=0&&handoffLayout.right<=viewport.width+1&&handoffLayout.scrollWidth<=handoffLayout.width+1&&handoffLayout.pageWidth<=viewport.width+1,'handoff fits screen');
  const violations=[...plansContrast.violations,...handoffContrast.violations,...dialogContrast.violations];assert.equal(violations.length,0,JSON.stringify(violations.map(v=>({text:v.text,contrast:v.contrast,minimum:v.minimum,selector:v.selector}))));return {horizontalOverflow:false,checked:plansContrast.checked+handoffContrast.checked+dialogContrast.checked,contrastViolations:0};
 }finally{await close(f)}});
 await test('隔离边界：无真实请求/数据库/付费生成，源码未被本测试写入',async()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(browserErrors,[]);assert(!fs.existsSync(path.join(directory,'pure-render-isolated','workbench.sqlite')));return {productionDataTouched:false,backendStarted:false,realGeneration:false,paidCalls:0,sourceMutationsByTest:0,apiFixture:true}});
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 const files=['src/PlatformArticleOutcome.tsx','src/ArticleRichEditor.tsx','src/ArticleImagePicker.tsx','src/OutcomeHandoff.tsx','src/article-draft.tsx','src/article-production.ts','src/WechatLayoutProof.tsx','src/wechat-rich.ts','src/inputKeys.ts','src/outcome-handoff.css','src/article-image-picker.css','src/article-scroll.css','src/studio-theme.css'];
 const sourceHashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(snapshot.get(path.resolve(file))).digest('hex')]));
 const drift=[...snapshot].filter(([file,text])=>fs.readFileSync(file,'utf8')!==text).map(([file])=>path.relative(process.cwd(),file).replaceAll('\\','/'));
 fs.writeFileSync(path.join(directory,'source-snapshot-hashes.json'),JSON.stringify(sourceSnapshotHashes,null,2));
 const apiLogs=apiEvidence.map(f=>({syntax:f.row.key,requests:f.requests}));fs.writeFileSync(path.join(directory,'api-fixture-log.json'),JSON.stringify(apiLogs,null,2));
 const report={directory,fixture:'LOCAL API FIXTURE - NOT REAL GENERATION OR HANDOFF',testScriptSHA256,sourceSnapshotSHA256,sourceHashes,sourceChangedAfterSnapshot:drift,results,screenshots,unexpected,browserErrors,productionDataTouched:false,backendStarted:false,realGeneration:false,paidCalls:0};fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,sourceChangedAfterSnapshot:drift,paidCalls:0}));if(results.some(r=>!r.ok)||!results.length)process.exitCode=1;
}
