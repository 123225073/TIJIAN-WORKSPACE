// Integrated existing dist + real App routes + real HTTP APIs + isolated SQLite.
// Uses tests/article-ui-fixture.py only for safe test setup/offline providers.
// No browser API responses are mocked. No build, production data or paid calls.
// node scripts/test-article-handoff-integrated.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';

const root=process.cwd(),dist=path.resolve('dist'),python=path.resolve('.runtime/venv/Scripts/python.exe');
const directory=path.resolve('.runtime','article-editing-ui-integrated-handoff-'+Date.now());
assert(directory.startsWith(path.resolve('.runtime')+path.sep));assert(!fs.existsSync(directory));fs.mkdirSync(directory,{recursive:true});
assert(fs.existsSync(path.join(dist,'index.html')),'Main worker must supply an existing integrated dist; this test never builds');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Freeze index.html and cache each hashed dist asset actually served. Packaging
// may run concurrently; the test never edits or copies the product checkout.
const staticCache=new Map([['index.html',fs.readFileSync(path.join(dist,'index.html'))]]);
const distHashes={'index.html':hash(staticCache.get('index.html'))};
const freePort=async()=>{const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p};
const backendPort=await freePort(),backendBase='http://127.0.0.1:'+backendPort;
const childEnv={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(backendPort),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
const service=spawn(python,['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnv});
let backendLogs='';service.stdout.on('data',chunk=>backendLogs+=chunk);service.stderr.on('data',chunk=>backendLogs+=chunk);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
const ui=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Isolated backend unavailable')});req.pipe(upstream);return;
 }
 try{
  const relative=url.pathname.startsWith('/assets/')||url.pathname.startsWith('/visuals/')?decodeURIComponent(url.pathname.slice(1)):'index.html';
  const file=path.resolve(dist,relative);assert(file.startsWith(dist+path.sep));
  if(!staticCache.has(relative)){const bytes=fs.readFileSync(file);staticCache.set(relative,bytes);distHashes[relative]=hash(bytes)}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(staticCache.get(relative));
 }catch{res.statusCode=404;res.end('Existing dist asset not found')}
});
await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ui.address().port;
const results=[],network=[],outside=[],forbidden=[],pageErrors=[],screenshots=[],imageEvidence=[];
let browser,page,token='',owner='',sourceTask,sourceContent,sourceSaved,flow,delivery,deliverySaved;
const api=async(p,data,method=data===undefined?'GET':'POST')=>{
 const response=await fetch(backendBase+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 assert(response.ok,p+' '+response.status+' '+(response.ok?'':await response.text()));return response.json();
};
const objects=async ids=>(await api('/state/updates?ids='+ids.join(','))).items;
const read=async id=>{const row=(await objects([id]))[0];assert(row,'Real stored object '+id+' exists');return row};
const upload=async(file,p)=>{const form=new FormData();form.append('file',new Blob([fs.readFileSync(file)],{type:'image/png'}),path.basename(file));const response=await fetch(backendBase+'/api'+p,{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(response.ok,await response.clone().text());return response.json()};
const shot=async name=>{const filename=name+'.png';await page.screenshot({path:path.join(directory,filename),fullPage:true});screenshots.push(filename)};
const step=async(name,fn)=>{try{const evidence=await fn();results.push({name,ok:true,evidence});console.log(JSON.stringify({name,ok:true}));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results},null,2))}catch(error){results.push({name,ok:false,error:error.stack});console.log(JSON.stringify({name,ok:false,error:error.message}));if(page){await shot('failure').catch(()=>{});fs.writeFileSync(path.join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}};
const imagesReady=async(selector,count)=>{await page.waitForFunction(({selector,count})=>{const images=[...document.querySelectorAll(selector+' img')];return images.length===count&&images.every(img=>img.naturalWidth>0&&img.naturalHeight>0)},{selector,count});return page.locator(selector+' img').evaluateAll(images=>images.map(img=>({alt:img.alt,width:img.naturalWidth,height:img.naturalHeight}))) };
const imageBytes=async p=>{const response=await fetch(backendBase+p,{headers:{Authorization:'Bearer '+token}});assert(response.ok,p+' '+response.status);if(p.startsWith('/api/illustrations/')){const data=(await response.json()).data_uri;assert(/^data:image\//.test(data));return Buffer.from(data.split(',')[1],'base64')}return Buffer.from(await response.arrayBuffer())};
try{
 let ready=false;for(let i=0;i<160;i++){try{ready=(await fetch(backendBase+'/api/health')).ok;if(ready)break}catch{}if(service.exitCode!==null)throw Error('Isolated backend exited: '+backendLogs);await new Promise(resolve=>setTimeout(resolve,100))}assert(ready,backendLogs);
 // A random password/token exists only in memory. Neither is logged or saved
 // in screenshots, source, reports or API evidence.
 const account={email:'integrated-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'隔离真实E2E'};
 const auth=await api('/auth/register',account);token=auth.token;owner=auth.user.id;
 const seeded=await api('/test/article',{});sourceTask=seeded.task;sourceContent=seeded.content;
 const imageFiles=[0,1,2].map(i=>path.join(directory,'local-fixture-image-'+i+'.png'));
 const generated=spawnSync(python,['-B','-X','utf8','-c','from PIL import Image,ImageDraw; import json,sys; files=json.load(sys.stdin); colors=["#315e78","#087f5b","#80452c"];\nfor i,p in enumerate(files):\n im=Image.new("RGB",(160,96),colors[i]); ImageDraw.Draw(im).text((8,40),"LOCAL E2E IMAGE "+str(i),(255,255,255)); im.save(p)'],{encoding:'utf8',input:JSON.stringify(imageFiles),windowsHide:true,env:childEnv});assert.equal(generated.status,0,generated.stderr);
 const a=await upload(imageFiles[0],'/studio/upload'),b=await upload(imageFiles[1],'/studio/upload'),c=await upload(imageFiles[2],'/content/'+sourceContent.id+'/illustrations/upload');
 const assets=[a.asset||a,b.asset||b],originalPaths=['/api/studio/assets/'+assets[0].id+'/file','/api/studio/assets/'+assets[1].id+'/file','/api/illustrations/'+c.illustration_id+'/file'];
 const seededBody='【隔离端到端种子，不是真实AI输出】\n\n正文：人工核对电梯维保记录。\n\n'+originalPaths.map((p,i)=>'![本地E2E图片'+(i+1)+']('+p+')').join('\n\n')+'\n\n结尾：资料请由作者核实。';
 // The existing seed endpoint intentionally has no task/outcome linkage. Set
 // only these freshly created records directly in this disposable database.
 // Product APIs correctly prohibit editing task linkage through generic PATCH.
 const seedProgram='import os,json,sys; from pathlib import Path; from backend import store as s; d=json.load(sys.stdin); assert Path(os.environ["TIJIAN_DATA"]).resolve()==Path(d["directory"]).resolve(); assert "article-editing-ui-integrated-handoff-" in Path(d["directory"]).name; t=s.get(d["owner"],d["task"]); c=s.get(d["owner"],d["content"]); c=s.put(d["owner"],"content",{**c,"title":"隔离E2E种子标题","body":d["body"],"summary":"隔离E2E种子摘要","platform":"wechat","cover_asset_id":d["cover"],"wechat_style":{"font_size":"16","line_height":"1.8","paragraph_gap":"12","accent":"forest"}},c["id"],c["version"]); t=s.put(d["owner"],"task",{**t,"title":"隔离E2E源对话：完整路由与图片验证","platform_outcomes":{"wechat":c["id"]},"active_outcome":"wechat","identity_skipped":True,"messages":[{"role":"assistant","text":"本地隔离种子，不是真实AI输出，不调用模型或发布。"}]},t["id"],t["version"]); print(json.dumps({"task":t,"content":c},ensure_ascii=False))';
 const seedResult=spawnSync(python,['-B','-X','utf8','-c',seedProgram],{encoding:'utf8',input:JSON.stringify({directory,owner,task:sourceTask.id,content:sourceContent.id,body:seededBody,cover:assets[0].id}),windowsHide:true,env:childEnv});assert.equal(seedResult.status,0,seedResult.stderr);({task:sourceTask,content:sourceContent}=JSON.parse(seedResult.stdout));
 browser=await chromium.launch({headless:true,executablePath:process.env.ARTICLE_INTEGRATED_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 page=await browser.newPage({viewport:{width:1530,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base){outside.push(request.url());return route.abort()}if(request.method()==='POST'&&/^\/api\//.test(url.pathname)&&/\/(?:generate|optimize|send|publish|sync|jobs)(?:\/|$)/.test(url.pathname)){forbidden.push(request.method()+' '+url.pathname);return route.abort()}return route.continue()});
 page.on('request',request=>{const p=new URL(request.url()).pathname;if(p.startsWith('/api/'))network.push({event:'request',method:request.method(),path:p,body:p.startsWith('/api/auth/')?'[redacted]':request.postData()})});
 page.on('response',response=>{const p=new URL(response.url()).pathname;if(p.startsWith('/api/'))network.push({event:'response',method:response.request().method(),path:p,status:response.status()})});
 await step('真实网页登录isolated账号并加载完整dist App与源成果',async()=>{
  await page.goto(base+'/#task/'+sourceTask.id);await page.locator('input[name=email]').fill(account.email);await page.locator('input[name=password]').fill(account.password);await page.getByRole('button',{name:'进入工作台',exact:true}).click();await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();
  const uiToken=await page.evaluate(()=>sessionStorage.getItem('tijian-session'));assert(uiToken);token=uiToken;assert.equal((await api('/auth/me')).user.id,owner);assert.equal(await page.getByLabel('成果标题').inputValue(),sourceContent.title);const images=await imagesReady('.article-rich-editor',3);await shot('01-source-real-login');return {loggedIn:true,owner,sourceTaskId:sourceTask.id,sourceContentId:sourceContent.id,images,frontend:'existing integrated dist; complete App executed'};
 });
 const sourceTitle='E2E人工标题：核对电梯记录',sourceSummary='E2E人工摘要：来源已保留，图片应完整带入。',sourceAppend='E2E源稿人工补充：保存后必须出现在发布稿。';
 await step('源成果UI人工编辑并通过真实PATCH保存到SQLite',async()=>{
  await page.getByLabel('成果标题').fill(sourceTitle);await page.getByLabel('成果摘要').fill(sourceSummary);const editor=page.getByRole('textbox',{name:'公众号文章正文'});await editor.focus();await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially(sourceAppend);
  const outcome='/api/tasks/'+sourceTask.id+'/outcomes/'+sourceContent.id;const pending=page.waitForResponse(r=>new URL(r.url()).pathname===outcome&&r.request().method()==='PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();const response=await pending;assert.equal(response.status(),200);const savedResponse=await response.json();sourceSaved=await read(sourceContent.id);assert.equal(sourceSaved.title,sourceTitle);assert.equal(sourceSaved.summary,sourceSummary);assert(sourceSaved.body.includes(sourceAppend));for(const p of originalPaths)assert(sourceSaved.body.includes(p));assert.equal(sourceSaved.version,savedResponse.version,'use actual returned row, including local file metadata revisions');assert(sourceSaved.version>sourceContent.version);await imagesReady('.article-rich-editor',3);await shot('02-source-real-patch');return {savedVersion:sourceSaved.version,title:sourceSaved.title,summary:sourceSaved.summary,inlineImages:3,sqlite:true};
 });
 await step('真实handoff POST与应用路由进入TopicDelivery，标题摘要正文及图片完整出现',async()=>{
  const handoff='/api/tasks/'+sourceTask.id+'/outcomes/'+sourceContent.id+'/handoff';const pending=page.waitForResponse(r=>new URL(r.url()).pathname===handoff&&r.request().method()==='POST');await page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();const response=await pending;assert.equal(response.status(),200);const result=await response.json();flow=result.flow;assert.equal(JSON.parse(response.request().postData()).version,sourceSaved.version);
  await page.locator('.td-page .wa-form').waitFor();assert.equal(await page.evaluate(()=>location.hash),'#'+result.route);assert.equal(await page.getByPlaceholder('一句话说明文章回答的问题').inputValue(),sourceTitle);assert.equal(await page.getByPlaceholder('概括文章能帮读者解决什么问题').inputValue(),sourceSummary);const editor=page.getByRole('textbox',{name:'公众号文章正文'});assert((await editor.innerText()).includes(sourceAppend));const images=await imagesReady('.wa-form .article-rich-editor',3);delivery=await read(flow.delivery_id);const copied=await read(flow.content_id),topic=await read(flow.topic_id);
  assert.equal(delivery.platform,'wechat');assert.equal(delivery.title,sourceTitle);assert.equal(delivery.summary,sourceSummary);assert.equal(copied.body,delivery.body);assert.equal(flow.source_task_id,sourceTask.id);assert.equal(flow.source_outcome_id,sourceContent.id);assert.equal(flow.source_version,sourceSaved.version);assert.equal(flow.identity_skipped,true);assert.deepEqual(topic.source_ids,[flow.content_id]);assert.deepEqual(delivery.source_ids,[flow.content_id]);assert(!copied.task_id);
  const clonedPaths=[...delivery.body.matchAll(/!\[[^\]]*\]\((\/api\/(?:studio\/assets|illustrations)\/[a-f0-9]{32,64}\/file)\)/g)].map(m=>m[1]);assert.equal(clonedPaths.length,3);for(let i=0;i<3;i++){assert.notEqual(clonedPaths[i],originalPaths[i]);const original=await imageBytes(originalPaths[i]),clone=await imageBytes(clonedPaths[i]);assert.equal(hash(clone),hash(original));imageEvidence.push({original:originalPaths[i],clone:clonedPaths[i],sha256:hash(clone),bytes:clone.length})}assert.equal(delivery.cover_asset_id,clonedPaths[0].split('/').at(-2));assert.equal(network.filter(r=>r.event==='request'&&r.path===handoff).length,1);await shot('03-topic-delivery-real-route');return {route:result.route,flowId:flow.id,topicId:flow.topic_id,deliveryId:flow.delivery_id,sourceVersion:flow.source_version,images,mediaByteHashesEqual:3,independentClone:true};
 });
 const deliveryTitle='E2E发布稿人工修订标题',deliverySummary='E2E发布稿人工修订摘要，独立保存。',deliveryAppend='E2E发布稿人工补充：原对话不能被覆盖。';
 await step('TopicDelivery UI编辑发布稿，真实delivery PATCH保存且重载持久化',async()=>{
  await page.getByPlaceholder('一句话说明文章回答的问题').fill(deliveryTitle);await page.getByPlaceholder('概括文章能帮读者解决什么问题').fill(deliverySummary);const editor=page.getByRole('textbox',{name:'公众号文章正文'});await editor.focus();await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially(deliveryAppend);
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/deliveries/'+flow.delivery_id&&r.request().method()==='PATCH');await page.getByRole('button',{name:'保存发布稿',exact:true}).click();const response=await pending;assert.equal(response.status(),200);deliverySaved=await read(flow.delivery_id);assert.equal(deliverySaved.title,deliveryTitle);assert.equal(deliverySaved.summary,deliverySummary);assert(deliverySaved.body.includes(deliveryAppend));assert.equal(deliverySaved.version,(await response.json()).version);assert(deliverySaved.version>delivery.version);assert.deepEqual(await read(sourceContent.id),sourceSaved);await page.reload();await page.locator('.td-page .wa-form').waitFor();assert.equal(await page.getByPlaceholder('一句话说明文章回答的问题').inputValue(),deliveryTitle);assert.equal(await page.getByPlaceholder('概括文章能帮读者解决什么问题').inputValue(),deliverySummary);assert((await page.getByRole('textbox',{name:'公众号文章正文'}).innerText()).includes(deliveryAppend));await imagesReady('.wa-form .article-rich-editor',3);await shot('04-delivery-real-patch-reloaded');return {deliveryVersion:deliverySaved.version,persistedAfterReload:true,sourceUnchanged:true,images:3};
 });
 await step('保存并返回真实flow step=4，源对话反向链接及媒体均保留',async()=>{
  await page.locator('.td-flow-return').click();await page.locator('.cf-page').waitFor();const current=await page.evaluate(()=>location.hash);const params=new URLSearchParams(current.split('?')[1]);assert(current.startsWith('#studio/flow?'));assert.equal(params.get('work'),flow.id);assert.equal(params.get('step'),'4');assert.equal(await page.getByRole('link',{name:'返回原对话 →',exact:true}).getAttribute('href'),'#task/'+sourceTask.id);assert.match(await page.locator('.cf-source-link').innerText(),new RegExp('v'+sourceSaved.version));assert.equal((await read(flow.delivery_id)).body,deliverySaved.body);const assets=(await api('/studio/assets')).items;for(const item of imageEvidence.filter(x=>x.clone.includes('/studio/assets/'))){const stored=assets.find(a=>a.id===item.clone.split('/').at(-2));assert(stored);assert.equal(stored.flow_id,flow.id);assert.equal(hash(await imageBytes(item.clone)),item.sha256)}await shot('05-flow-step4-source-backlink');return {route:current,backlink:'#task/'+sourceTask.id,mediaObjectsAndFilesIntact:true};
 });
 await step('沿真实反向链接回源对话，同版本再次handoff复用作品且发布稿不被覆盖',async()=>{
  await page.getByRole('link',{name:'返回原对话 →',exact:true}).click();await page.getByLabel('成果标题').waitFor();assert.equal(await page.getByLabel('成果标题').inputValue(),sourceTitle);assert.equal(await page.getByLabel('成果摘要').inputValue(),sourceSummary);assert((await page.getByRole('textbox',{name:'公众号文章正文'}).innerText()).includes(sourceAppend));assert(!(await page.getByRole('textbox',{name:'公众号文章正文'}).innerText()).includes(deliveryAppend));await imagesReady('.article-rich-editor',3);
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/handoff')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存并进入平台准备',exact:true}).click();const response=await pending;assert.equal(response.status(),200);assert.equal((await response.json()).flow.id,flow.id);await page.locator('.td-page .wa-form').waitFor();assert.equal(await page.getByPlaceholder('一句话说明文章回答的问题').inputValue(),deliveryTitle);assert.deepEqual(await read(sourceContent.id),sourceSaved);assert.deepEqual(await read(flow.delivery_id),deliverySaved);const works=(await api('/studio/flows')).items;assert.equal(works.filter(w=>w.source_outcome_id===sourceContent.id).length,1);await shot('06-real-backlink-idempotent-handoff');return {sameFlow:true,worksForSource:1,sourceAndDeliveryIndependent:true};
 });
 await step('隔离/持久化证据：零外网/生成/发布请求，真实SQLite数据存在',async()=>{
  assert.deepEqual(outside,[]);assert.deepEqual(forbidden,[]);assert.deepEqual(pageErrors,[]);const jobs=(await api('/state')).objects.filter(o=>o.kind==='job');assert.equal(jobs.length,0);assert(fs.statSync(path.join(directory,'workbench.sqlite')).size>0);
  const query=spawnSync(python,['-B','-X','utf8','-c','import sqlite3,json,sys; db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); rows=db.execute("select kind,count(*) from objects group by kind").fetchall(); print(json.dumps(dict(rows))); db.close()',path.join(directory,'workbench.sqlite')],{encoding:'utf8',windowsHide:true,env:childEnv});assert.equal(query.status,0,query.stderr);const counts=JSON.parse(query.stdout);assert.equal(counts.studio_flow,1);assert.equal(counts.studio_delivery,1);return {database:path.join(directory,'workbench.sqlite'),counts,actualHTTPAndSQLite:true,apiMockResponses:0,paidCalls:0,externalRequests:0,productionDataTouched:false};
 });
}catch(error){process.exitCode=1;console.log(JSON.stringify({error:error.message,directory}))}
finally{
 await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();await Promise.race([new Promise(resolve=>service.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);
 fs.writeFileSync(path.join(directory,'api-network.json'),JSON.stringify(network,null,2));fs.writeFileSync(path.join(directory,'backend.log'),backendLogs);fs.writeFileSync(path.join(directory,'dist-loaded-hashes.json'),JSON.stringify(distHashes,null,2));
 const report={directory,frontend:'existing integrated dist; unmodified full App',backend:'tests/article-ui-fixture.py with real endpoints and isolated SQLite',results,screenshots,imageEvidence,distIndexSHA256:distHashes['index.html'],loadedDistFiles:Object.keys(distHashes).length,outside,forbidden,pageErrors,apiMockResponses:0,paidCalls:0,productionDataTouched:false,buildInvoked:false};fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,apiMockResponses:0,paidCalls:0}));if(results.some(r=>!r.ok)||!results.length)process.exitCode=1;
}
