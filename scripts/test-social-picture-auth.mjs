// Live isolated backend, actual upload/thumbnail/file endpoints, real PNG bytes.
// No browser response stubs. Only the paid image provider is replaced in the fixture process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const directory=path.resolve('.runtime','social-picture-auth-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const backend='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','tests/social-picture-ui-fixture.py'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1'}});
let logs='';service.stdout.on('data',c=>logs+=c);service.stderr.on('data',c=>logs+=c);
let token='',browser,ui,seed,owner,uploaded;const results=[],findings=[],requests=[],errors=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const api=async(p,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(backend+'/api'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,p+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
const check=async(name,fn)=>{const evidence=await fn();results.push({name,passed:true,evidence});console.log(name)};
try{
 let ready=false;for(let n=0;n<160;n++){try{ready=(await fetch(backend+'/api/health')).ok;if(ready)break}catch{}if(service.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100))}assert(ready,'isolated backend ready');
 const auth=await api('/auth/register',{email:'social-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'Social图片验收'});token=auth.token;owner=auth.user.id;
 seed=await api('/test/social-picture',{});
 const source=fs.readFileSync(path.join(directory,'source.png'));
 const form=new FormData();form.append('file',new Blob([source],{type:'image/png'}),'social-auth.png');
 const upload=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(upload.ok,await upload.clone().text());const raw=await upload.json();uploaded=raw.asset||raw;
 const stranger=await api('/auth/register',{email:'other-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'另一个隔离用户'});
 await check('real PNG upload and owner authorization on thumbnail/file',async()=>{
  for(const endpoint of ['thumbnail','file']){
   const url=backend+'/api/studio/assets/'+uploaded.id+'/'+endpoint;
   assert.equal((await fetch(url)).status,401);
   assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+stranger.token}})).status,404);
   const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);
   const bytes=Buffer.from(await r.arrayBuffer());assert(bytes.length>0);if(endpoint==='file')assert.deepEqual(bytes,source);
  }
  return {bytes:source.length,sha256:hash(source),unauthenticated:401,otherOwner:404};
 });
 const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import SocialPicturePanel from './src/SocialPicturePanel';import FlowDeliverables from './src/FlowDeliverables';import {api} from './src/api';
 const seed=${JSON.stringify(seed)},owner=${JSON.stringify(owner)};
 function Fixture(){const [ids,setIds]=useState([${JSON.stringify(uploaded.id)}]),[assets,setAssets]=useState([]),[displayFlow,setDisplayFlow]=useState(seed.flow.id);window.ids=ids;window.setContentFlow=setDisplayFlow;
 return <><SocialPicturePanel content={{...seed.content,flow_id:displayFlow}} owner={owner} ids={ids} onChange={setIds}/><button type="button" onClick={async()=>{await api('/studio/flows/'+seed.flow.id+'/drafts');const r=await api('/studio/assets');setAssets(r.items);window.deliverableAssets=r.items.filter(a=>a.flow_id===seed.flow.id&&a.status==='ready')}}>刷新流程交付</button><FlowDeliverables contents={[seed.content]} assets={assets.filter(a=>a.flow_id===seed.flow.id&&a.status==='ready')}/></>}
 createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js')});
 const all=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'all.js'),external:['/visuals/*']});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=all.outputFiles.find(f=>f.path.endsWith('.css')).text+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 ui=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname.startsWith('/api/')){const proxy=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',()=>{res.writeHead(502);res.end()});req.pipe(proxy);return}if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:800px;margin:30px auto"><div id="root"></div></main><script src="/fixture.js"></script></body></html>')}});
 await new Promise(r=>ui.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+ui.address().port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1100,height:900},acceptDownloads:true});page.setDefaultTimeout(15000);
 await page.addInitScript(value=>sessionStorage.setItem('tijian-session',value),token);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const r=route.request(),url=new URL(r.url());assert.equal(url.origin,base,'no external browser request');if(url.pathname.startsWith('/api/'))requests.push({path:url.pathname,method:r.method(),authenticated:!!r.headers().authorization,body:r.postDataJSON()});return route.continue()});
 await page.goto(base);
 const decoded=async selector=>{await page.waitForFunction(s=>{const imgs=[...document.querySelectorAll(s)];return imgs.length>0&&imgs.every(img=>img.naturalWidth>0&&img.naturalHeight>0)},selector);return page.locator(selector).evaluateAll(imgs=>imgs.map(img=>({width:img.naturalWidth,height:img.naturalHeight,blob:img.src.startsWith('blob:')})))};
 await check('AssetThumbnail decodes an authenticated real backend thumbnail',async()=>{const dimensions=await decoded('.spp-preview img');assert(requests.some(r=>r.path.endsWith('/thumbnail')&&r.authenticated));assert(dimensions.every(d=>d.blob));return dimensions});
 await check('Social download bytes exactly match uploaded PNG',async()=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载图片 1',exact:true}).click();const file=await event;const bytes=fs.readFileSync(await file.path());assert.deepEqual(bytes,source);return {filename:file.suggestedFilename(),bytes:bytes.length,sha256:hash(bytes)}});
 await check('real picker previews uploaded PNG and deduplicates selection',async()=>{await page.getByRole('button',{name:'选择图片',exact:true}).click();await decoded('.ap-grid img');await page.getByRole('button',{name:'选择这张图片',exact:true}).click();await page.getByRole('button',{name:'确认插入文稿',exact:true}).click();await page.locator('.article-picture-workspace').waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.ids),[uploaded.id])});
 await check('single generation uses scoped draft and reconciles real PNG into FlowDeliverables',async()=>{
  await page.getByRole('button',{name:'生成配图',exact:true}).click();await page.getByLabel('配图提示词',{exact:true}).fill('离线测试电梯图片');await page.getByRole('button',{name:'生成新配图',exact:true}).click();await page.locator('.article-picture-workspace').waitFor({state:'detached'});await decoded('.spp-preview img');
  const ids=await page.evaluate(()=>window.ids);assert.equal(ids.length,2);const generated=ids[1];
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载图片 2',exact:true}).click();const file=await event;assert.deepEqual(fs.readFileSync(await file.path()),source);
  const found=(await api('/studio/assets')).items.find(a=>a.id===generated);assert(found);assert.equal(found.flow_id,seed.flow.id,'flow reconciled before parent refresh');
  assert(requests.some(r=>r.method==='GET'&&r.path==='/api/studio/flows/'+seed.flow.id+'/drafts'),'picker performed scoped reconciliation');
  await page.getByRole('button',{name:'刷新流程交付',exact:true}).click();await page.waitForFunction(()=>Array.isArray(window.deliverableAssets));
  const draftRequest=requests.find(r=>r.method==='POST'&&r.path.endsWith('/drafts'));
  const generation=requests.find(r=>r.path==='/api/studio/generate');
  const visible=await page.evaluate(id=>window.deliverableAssets.some(a=>a.id===id),generated);
  assert.equal(draftRequest.path,'/api/studio/flows/'+seed.flow.id+'/drafts');
  assert.equal(generation.body.flow_id,seed.flow.id);assert.equal(found.flow_id,seed.flow.id);assert.equal(visible,true);
  assert(requests.some(r=>r.method==='GET'&&r.path==='/api/studio/flows/'+seed.flow.id+'/drafts'));
  assert.equal(await page.locator('.cf-deliverables article').filter({hasText:found.title}).count(),1);
  return {generated,decoded:true,downloadMatchesSource:true,flow_id:found.flow_id||null,visibleInFlowDeliverables:visible};
 });
 const retryPending=async(frozenFlow,currentFlow)=>{
  const prompt='原请求冻结的图片要求';
  const draft=await api(frozenFlow?'/studio/flows/'+frozenFlow+'/drafts':'/studio/drafts',{tool:'text_image',title:'原任务图片',input:{prompt},model_id:'fixture-image',options:{}});
  const pending={draft_id:draft.id,version:draft.version,request_id:randomUUID(),confirmed:true,...(frozenFlow?{flow_id:frozenFlow}:{})};
  const key='article-picture:'+owner+':'+seed.content.id;
  await page.evaluate(({key,pending,prompt})=>localStorage.setItem(key,JSON.stringify({pending,prompt,model:'fixture-image',options:{}})),{key,pending,prompt});
  await page.reload();await page.waitForFunction(()=>!!window.setContentFlow);
  await page.evaluate(flow=>window.setContentFlow(flow),currentFlow);
  const from=requests.length;
  await page.getByRole('button',{name:'生成配图',exact:true}).click();
  await page.getByText('尚未找到任务，请核查或重新提交原请求；不会另建收费请求。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'生成新配图',exact:true}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,key),pending);
  await page.getByRole('button',{name:'重新提交原请求',exact:true}).click();
  await page.locator('.article-picture-workspace').waitFor({state:'detached'});
  const dimensions=await decoded('.spp-preview img');const ids=await page.evaluate(()=>window.ids);assert.equal(ids.length,2);
  const calls=requests.slice(from),posts=calls.filter(r=>r.method==='POST'&&r.path==='/api/studio/generate');
  assert.equal(posts.length,1);assert.deepEqual(posts[0].body,pending);
  assert.equal(calls.filter(r=>r.method==='POST'&&r.path.endsWith('/drafts')).length,0);
  const scopedReads=calls.filter(r=>r.method==='GET'&&r.path.startsWith('/api/studio/flows/')&&r.path.endsWith('/drafts'));
  if(frozenFlow){assert(scopedReads.length>0);assert(scopedReads.every(r=>r.path==='/api/studio/flows/'+frozenFlow+'/drafts'))}else assert.equal(scopedReads.length,0);
  const asset=(await api('/studio/assets')).items.find(a=>a.id===ids[1]);assert(asset);assert.equal(asset.flow_id||'',frozenFlow||'');
  const bytes=await fetch(backend+'/api/studio/assets/'+asset.id+'/file',{headers:{Authorization:'Bearer '+token}});assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),source);
  assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).pending,key),null);
  return {originalRequestPreserved:true,newDrafts:0,generationPosts:1,flow_id:asset.flow_id||null,currentContentFlow:currentFlow,decoded:dimensions,downloadMatchesSource:true};
 };
 await check('pending survives reload and retries original flow despite changed content flow',async()=>{const other=await api('/test/social-picture',{});return retryPending(seed.flow.id,other.flow.id)});
 await check('historical unscoped pending is retried unchanged without guessing current flow',()=>retryPending('',seed.flow.id));
 await check('no browser errors and original persisted body unchanged',async()=>{const state=await api('/state/updates?ids='+seed.content.id);assert.equal(state.items[0].body,seed.content.body);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(directory,'social-real-png.png'),fullPage:true});return {apiMocks:0,paidProviderCalls:0}});
}catch(error){results.push({passed:false,error:String(error)});process.exitCode=1;console.error(error)}
finally{await browser?.close();if(ui){ui.closeAllConnections();await new Promise(r=>ui.close(r))}service.kill();await Promise.race([new Promise(r=>service.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);fs.writeFileSync(path.join(directory,'backend.log'),logs);fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,findings,requests,backend:'real isolated HTTP/SQLite/image archive',provider:'offline PNG adapter only',apiMocks:0,paidCalls:0},null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,findings:findings.length}))}
