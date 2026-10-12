// Real source components; every API is intercepted. No dist/build output,
// backend, production DB, model, publication or paid request is used.
// node scripts/test-article-insert-race.mjs
// node scripts/test-article-insert-race.mjs --base  (real HEAD picker; expected red)
// --dist-css uses final dist styles with the same real source components.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const baseline=process.argv.includes('--base');
const distCSS=process.argv.includes('--dist-css');
const directory=path.resolve('.runtime',`article-insert-race-${baseline?'base':'source'}-${Date.now()}`);
fs.mkdirSync(directory,{recursive:true});
const git=argument=>{const result=spawnSync('git',argument,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout};
const picker=baseline?git(['show','HEAD:src/ArticleImagePicker.tsx']):fs.readFileSync('src/ArticleImagePicker.tsx','utf8');
const pickerHash=createHash('sha256').update(picker).digest('hex');
// Pin the source read above, including during concurrent fixes by another worker.
// Baseline uses the actual committed component, never a rewritten fake handler.
const plugins=[{name:'pinned-real-picker',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]ArticleImagePicker\.tsx$/},()=>({contents:picker,loader:'tsx',resolveDir:path.resolve('src')}))}}];
const owner='isolated-insert-race-owner';
const content={id:'isolated-insert-race-content',title:'配图并发隔离验收',version:1,body:'第一段前半后半。\n\n<span data-wa-color="blue" style="color:#315ed6">用户自定义内容</span>\n\n完整结尾。'};
const editedBody=content.body+'\n用户已有手改，不能丢失。';
const pictureKey='article-picture:'+owner+':'+content.id;
const positionKey='article-position:'+owner+':'+content.id;
const editKey='studio-content-edit:'+owner+':'+content.id;
const assets=[{id:'1'.repeat(32),title:'隔离配图',asset_type:'image',status:'ready',width:320,height:180,mime_type:'image/svg+xml',file_url:'/api/studio/assets/'+'1'.repeat(32)+'/file'}];
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263b59"/></svg>';
const entry=`import {createRoot} from 'react-dom/client';import ArticleEditor from './src/ArticleEditor';import ImageLightbox from './src/ImageLightbox';createRoot(document.getElementById('root')).render(<><ArticleEditor asset={${JSON.stringify(content)}} t={{state:{user:{id:${JSON.stringify(owner)}}},refresh:async()=>{}}}/><ImageLightbox/></>);`;
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),external:['/visuals/*'],plugins});
let css=app.outputFiles.find(file=>file.path.endsWith('.css')).text;
const distStyles=[];
if(distCSS){
 const html=fs.readFileSync('dist/index.html','utf8');
 const links=[...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(match=>match[1]);
 assert(links.length,'Final dist must have actual stylesheet links');
 css=links.map(link=>{const filename=path.join('dist',link.replace(/^\//,'')),text=fs.readFileSync(filename,'utf8');distStyles.push({file:filename,sha256:createHash('sha256').update(text).digest('hex')});return text}).join('\n');
}
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'harness.js'),plugins});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 if(pathname==='/harness.js'){response.setHeader('Content-Type','application/javascript');response.end(js)}
 else if(pathname==='/app.css'){response.setHeader('Content-Type','text/css');response.end(css)}
 else if(pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>')}
 else {response.statusCode=503;response.end('Unexpected request; no backend is connected')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const results=[],unexpected=[],browserErrors=[];
let browser;
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve});return {promise,release}};
const until=async(predicate,message)=>{const limit=Date.now()+6000;while(!predicate()){assert(Date.now()<limit,message);await new Promise(resolve=>setTimeout(resolve,20))}};
const open=async(status)=>{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
 page.setDefaultTimeout(6000);page.on('pageerror',error=>browserErrors.push(error.message));
 const fixture={status,done:false,requests:[],uploads:[],refreshGate:null};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){unexpected.push(request.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname.slice(4);fixture.requests.push({path:p,method:request.method()});
  if(p==='/studio/catalog')return route.fulfill({json:{tools:[{id:'text_image',binding:'fixture-image',enabled:true,models:[{id:'fixture-image',title:'隔离测试模型',configured:true,options:{}}]}]}});
  if(p==='/studio/assets')return route.fulfill({json:{items:assets}});
  const run={id:'fixture-run',request_id:'insert-race-'+status,status:fixture.status,asset_ids:[]};
  if(p==='/studio/runs')return route.fulfill({json:{items:[run]}});
  if(p==='/studio/runs/fixture-run/refresh'){
   const held=fixture.refreshGate;if(held)await held.promise;
   return route.fulfill({json:{run:{...run,status:fixture.done?'succeeded':fixture.status,asset_ids:fixture.done?[assets[0].id]:[]}}});
  }
  if(/^\/(?:studio\/assets|illustrations)\/[^/]+\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:svg});
  if(p==='/content/'+content.id+'/illustrations/upload'){
   const held={...gate(),failed:false,id:(fixture.uploads.length+1).toString(16).padStart(32,'0')};fixture.uploads.push(held);
   await held.promise;
   return held.failed?route.fulfill({status:503,json:{detail:'隔离模拟：上传失败，允许保留图片后重试'}}):route.fulfill({json:{illustration_id:held.id}});
  }
  unexpected.push(request.method()+' '+p);return route.abort();
 });
 await page.goto(base);await page.getByRole('tab',{name:'编辑',exact:true}).click();
 const editor=page.getByLabel('编辑生成文稿');await editor.fill(editedBody);
 await editor.evaluate(el=>{el.focus();el.setSelectionRange(5,5);el.dispatchEvent(new Event('select',{bubbles:true}))});
 await page.getByRole('button',{name:'AI 生成配图',exact:true}).click();await page.getByLabel('配图来源').waitFor();
 await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 const bookmark=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).context,positionKey);
 assert.equal(bookmark.body,editedBody,'Use the actual bookmark of the existing user edit');
 const pending={draft_id:'original-draft',version:7,request_id:runRequestId(status),confirmed:true};
 await page.evaluate(({key,pending,bookmark})=>localStorage.setItem(key,JSON.stringify({prompt:'保留原任务要求',model:'fixture-image',options:{},pending,context:bookmark})),{key:pictureKey,pending,bookmark});
 await page.getByRole('button',{name:'AI 生成配图',exact:true}).click();await page.getByRole('button',{name:'核查配图任务',exact:true}).waitFor();
 await until(()=>fixture.requests.some(r=>r.path==='/studio/runs/fixture-run/refresh'),'Recover the actual original run');
 return {context,page,editor,fixture};
};
const runRequestId=status=>'insert-race-'+status;
const insertButton=page=>page.locator('.ap-preview button.st-primary');
const recoverSuccess=async(session)=>{
 // Remount a persisted original request. This also reaches success on the old
 // HEAD component whose check button did not restart a same-id polling effect.
 await session.page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 session.fixture.done=true;
 await session.page.getByRole('button',{name:'AI 生成配图',exact:true}).click();
 await session.page.getByLabel('配图来源').waitFor();
};
const noGeneration=fixture=>assert.equal(fixture.requests.filter(r=>r.path==='/studio/generate'||r.path==='/studio/drafts'||r.path.includes('/prompt')).length,0,'Recover/insert must not create a paid request');
const finishConcurrentUploads=async({page,fixture})=>{
 // Complete the first insertion before a competing upload. This observes the
 // final body after both callbacks, rather than mistaking the first close for
 // completion of the whole race (or depending on response arrival order).
 fixture.uploads[0].release();
 await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
 fixture.uploads.slice(1).forEach(upload=>upload.release());
 await page.waitForTimeout(200);
};
const completed=async(session,count)=>{
 const {page,editor,fixture}=session;
 await page.locator('.studio-modal[open]').waitFor({state:'hidden'});
 const value=await editor.inputValue(),refs=[...value.matchAll(/!\[[^\]]*\]\(\/api\/illustrations\/[a-f0-9]{32}\/file\)/g)];
 const cache=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),editKey);
 const evidence={uploads:fixture.uploads.length,visibleImageReferences:refs.length,body:value,preservedUserEdit:value.replace(/\n\n!\[[^\]]*\]\(\/api\/illustrations\/[a-f0-9]{32}\/file\)\n\n/g,'')===editedBody,localCache:cache,generationRequests:fixture.requests.filter(r=>r.path==='/studio/generate').length};
 assert.equal(fixture.uploads.length,count,JSON.stringify(evidence));assert.equal(refs.length,1,JSON.stringify(evidence));assert(evidence.preservedUserEdit,JSON.stringify(evidence));
 assert.equal(cache.values.body,value,'Keep the full inserted body and existing edit in local storage');noGeneration(fixture);return evidence;
};
const scenario=async(name,status,execute)=>{
 let session;try{session=await open(status);const evidence=await execute(session);results.push({name,ok:true,evidence})}
 catch(error){const evidence=session?{uploads:session.fixture.uploads.length,body:await session.editor.inputValue().catch(()=>''),requests:session.fixture.requests}:undefined;results.push({name,ok:false,error:error.message,evidence});if(session)await session.page.screenshot({path:path.join(directory,name.replace(/[^a-z0-9-]/gi,'-')+'-failure.png'),fullPage:true}).catch(()=>{})}
 finally{if(session){session.fixture.refreshGate?.release();session.fixture.uploads.forEach(upload=>upload.release());await session.context.close()}}
 const result=results.at(-1);console.log(JSON.stringify({name:result.name,ok:result.ok,uploads:result.evidence?.uploads,visibleImageReferences:result.evidence?.visibleImageReferences,error:result.error?.slice(0,200)}));
};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 for(const status of ['unknown','archive_failed']){
  await scenario(status+'-auto-manual-exclusion',status,async session=>{
   const {page,fixture}=session;await recoverSuccess(session);
   await until(()=>fixture.uploads.length===1,'Automatic insertion must reach the held upload');
   const button=insertButton(page);await button.waitFor();const disabled=await button.isDisabled();
   const place=page.getByLabel('配图插入位置'),placeDisabled=await place.isDisabled(),captionDisabled=await page.getByLabel('配图说明').isDisabled();if(!placeDisabled)await place.selectOption('end');
   await button.evaluate(el=>{el.click();el.click()});await page.waitForTimeout(200);
   const attemptsWhileAutoHeld=fixture.uploads.length;
   await page.screenshot({path:path.join(directory,status+'-auto-held.png'),fullPage:true});
   await finishConcurrentUploads(session);
   const evidence=await completed(session,1);
   assert(disabled,'Manual insertion must be disabled while automatic insertion uploads');assert(placeDisabled,'Insertion position stays disabled during upload');assert(captionDisabled,'Caption stays disabled during upload');assert.equal(attemptsWhileAutoHeld,1,'A manual click cannot compete with automatic insertion');
   return {...evidence,manualDisabledDuringAuto:disabled,placeDisabled,captionDisabled,attemptsWhileAutoHeld};
  });
  await scenario(status+'-auto-failure-manual-retry',status,async session=>{
   const {page,editor,fixture}=session;await recoverSuccess(session);
   await until(()=>fixture.uploads.length===1,'Automatic insertion starts');fixture.uploads[0].failed=true;fixture.uploads[0].release();
   await page.locator('.ap-error').waitFor();assert.equal(await editor.inputValue(),editedBody,'Failure must preserve the existing user edit');
   const button=insertButton(page);await button.waitFor();assert.equal(await button.isEnabled(),true,'Automatic failure must release the mutex for a manual retry');
   await button.evaluate(el=>{el.click();el.click()});await until(()=>fixture.uploads.length===2,'Manual retry starts');await page.waitForTimeout(200);
   assert.equal(fixture.uploads.length,2,'Double-click retry must initiate just one further upload');assert.equal(await button.isDisabled(),true,'Retry stays locked until completion');
   fixture.uploads[1].release();return {...await completed(session,2),failedUploads:1,successfulRetries:1};
  });
 }
 await scenario('manual-first-auto-recovery-exclusion','unknown',async session=>{
  const {page,fixture}=session;fixture.refreshGate=gate();
  const before=fixture.requests.filter(r=>r.path.endsWith('/refresh')).length;
  await recoverSuccess(session);await until(()=>fixture.requests.filter(r=>r.path.endsWith('/refresh')).length>before,'Hold the success response before starting manual insertion');
  await page.getByRole('tab',{name:'素材库',exact:true}).click();await page.getByRole('button',{name:'选择这张图片',exact:true}).click();
  await insertButton(page).click();await until(()=>fixture.uploads.length===1,'Manual insertion starts');
  const reads=fixture.requests.filter(r=>r.path==='/studio/assets').length;fixture.refreshGate.release();
  await until(()=>fixture.requests.filter(r=>r.path==='/studio/assets').length>reads,'Automatic success has actually reached the asset read');await page.waitForTimeout(200);
  const attemptsWhileManualHeld=fixture.uploads.length;await finishConcurrentUploads(session);
  const evidence=await completed(session,1);assert.equal(attemptsWhileManualHeld,1,'Automatic recovery cannot compete with manual insertion');return {...evidence,attemptsWhileManualHeld};
 });
 assert.deepEqual(unexpected,[],'No external or unhandled API requests');assert.deepEqual(browserErrors,[],'No browser exceptions');
}catch(error){results.push({name:'harness-isolation',ok:false,error:error.message})}
finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 const report={passed:results.length===5&&results.every(result=>result.ok),baseline,baselineRevision:baseline?git(['rev-parse','HEAD']).trim():null,pickerHash,sourceComponents:true,distCSS,distStyles,distTouched:false,backendStarted:false,productionDatabaseTouched:false,realGeneration:false,paidCalls:0,results,browserErrors,unexpected,directory};
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:results.filter(result=>result.ok).length,failed:results.filter(result=>!result.ok).length,baseline,pickerHash,paidCalls:0}));
 if(!report.passed)process.exitCode=1;
}
