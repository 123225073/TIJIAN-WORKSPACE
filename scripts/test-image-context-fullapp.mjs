import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=process.cwd(),directory=path.resolve('.runtime','article-editing-ui-image-context-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const files=['src/Studio.tsx','src/ImageEditWorkspace.tsx','src/image-edit-workspace.css','src/ImageLightbox.tsx','src/image-edit-handoff.ts','src/MediaWorkbench.tsx','src/AssetPicker.tsx','src/ResourcePreview.tsx'];
const useDist=process.argv.includes('--dist'),visualOnly=false,deliveryOnly=false;
if(useDist)fs.cpSync(path.resolve('dist'),path.join(directory,'dist'),{recursive:true});
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
if(!useDist){const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),jsx:'automatic',external:['/visuals/*'],define:{'process.env.NODE_ENV':'"development"'}});
for(const file of bundle.outputFiles)fs.writeFileSync(file.path,file.contents);}
const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
const backend='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
let log='';service.stdout.on('data',c=>log+=c);service.stderr.on('data',c=>log+=c);
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/visuals/image-context-source.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(directory,'source.png')));return}if(useDist&&!u.pathname.startsWith('/api/')){const file=path.resolve(directory,'dist',u.pathname==='/'?'index.html':'.'+u.pathname);if(file.startsWith(path.join(directory,'dist')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html;charset=utf-8':'application/octet-stream');res.end(fs.readFileSync(file));return}}if(u.pathname.startsWith('/api/')){const p=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(p);return}if(['/app.js','/app.css'].includes(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(directory,u.pathname.slice(1))));return}if(u.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta charset="UTF-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');return}res.writeHead(404);res.end()});
await new Promise(r=>ui.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+ui.address().port;
let token='',browser,page;const results=[],network=[],errors=[],blocked=[];
const api=async(p,data,method=data===undefined?'GET':'POST')=>{const r=await fetch(backend+'/api'+p,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:data===undefined?undefined:JSON.stringify(data)});assert(r.ok,p+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
const step=async(name,fn)=>{if(visualOnly&&!name.startsWith('full App'))return;if(deliveryOnly&&!/^(full App|WeChat real|social )/.test(name))return;try{const evidence=await fn();results.push({name,ok:true,evidence});console.log(JSON.stringify({name,evidence}))}catch(e){results.push({name,ok:false,error:e.stack});console.log(JSON.stringify({name,error:e.message}));if(page){await page.screenshot({path:path.join(directory,'failed-'+results.length+'.png')}).catch(()=>{});fs.writeFileSync(path.join(directory,'failed-'+results.length+'.txt'),await page.locator('body').innerText().catch(()=>''))}process.exitCode=1}};
const flowRoute=id=>'studio/flow?work='+id;
const goto=async route=>{await page.goto(base+'/#'+route);await page.locator('.cf-continuous').waitFor();await page.waitForFunction(()=>!document.querySelector('.cf-data-loading'));};
const locationHash=()=>new URL(page.url()).hash.split('?')[1];
const channel=()=>page.locator('.cf-channels button').filter({has:page.getByText('公众号',{exact:true})});
const brief=()=>page.getByLabel('创作要求',{exact:true});
const topic=title=>api('/studio/topics',{title,angle:'隔离审查',source_ids:[],status:'selected',origin:'隔离审查'});
const flow=async(title,t)=>api('/studio/flow',{new:true,version:0,brief:title,topic_id:t.id,stage:2,creation_channel:'wechat'});
const draft=(f,title,input)=>api('/studio/flows/'+f.id+'/drafts',{tool:'text',title,topic_id:f.topic_id,creation_channel:'wechat',input:{brief:input,format:'公众号文章',target_words:1200},profile_id:'',source_ids:[]});
const seedProgram=`import json,sys,os,base64
from pathlib import Path
from backend import store as s
v=json.load(sys.stdin)
assert Path(os.environ['TIJIAN_DATA']).resolve()==Path(v['directory']).resolve() and 'article-editing-ui-image-context-' in v['directory']
content=s.put(v['owner'],'content',{'title':'旧文章配图验收','body':'原文章正文。','format':'公众号文章','status':'draft'})
legacy=s.put(v['owner'],'illustration',{'content_id':content['id'],'data_uri':'data:image/png;base64,'+base64.b64encode(Path(v['image']).read_bytes()).decode()})
content=s.put(v['owner'],'content',{**content,'body':'原文章正文。\\n\\n![旧配图](/api/illustrations/'+legacy['id']+'/file)'+chr(10)+chr(10)+'![静态原图](/visuals/image-context-source.png)'},content['id'],content['version'])
run=s.put(v['owner'],'studio_run',{'tool':'image_edit','status':'succeeded','draft_id':v['draft'],'title':'真实PNG结果种子（非AI生成）','model_id':'fixture-image','asset_ids':v['assets'],'generation':{'input':{'prompt':'隔离验收结果'},'model_id':'fixture-image','options':{}}})
print(json.dumps({'content':content,'legacy':legacy,'run':run},ensure_ascii=False))`;
let original,source,resultAssets=[],legacySeed;
const imageReady=async()=>{await page.locator('.ie-workspace').waitFor();await page.waitForFunction(()=>{const i=document.querySelector('.ie-canvas-image>img');return i&&i.naturalWidth>0})};
const menu=async image=>{await image.click({button:'right'});await page.getByRole('dialog',{name:'图片操作',exact:true}).waitFor();};
const add=()=>page.getByRole('menuitem',{name:'添加到图片编辑区域',exact:true}).click();
const editRoute=id=>'studio/image?mode=image_edit&draft='+id;
const openEditor=async id=>{await page.goto(base+'/#'+editRoute(id));await imageReady()};
const routeDraft=()=>new URLSearchParams(page.url().split('?')[1]).get('draft');
try{
 for(let i=0;i<150;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100));}
 const auth=await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'图片右键隔离验收'});token=auth.token;const owner=auth.user.id;
 await api('/workspace',{path:path.join(directory,'workspace')});await api('/objects/profile',{title:'图片验收IP',position:'设备服务说明',status:'accepted'});
 const picture=path.join(directory,'source.png');const rendered=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-c','from PIL import Image,ImageDraw; import sys; i=Image.new("RGB",(1280,720),"#283f59"); d=ImageDraw.Draw(i); d.rectangle((400,80,880,650),fill="#8faac8"); d.line((640,80,640,650),fill="#edf2fb",width=8); d.text((40,35),"REAL PNG - ISOLATED UI ACCEPTANCE",fill="white"); i.save(sys.argv[1])',picture],{windowsHide:true});assert.equal(rendered.status,0);
 const upload=async name=>{const form=new FormData();form.append('file',new Blob([fs.readFileSync(picture)],{type:'image/png'}),name);const response=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(response.ok,await response.clone().text());const raw=await response.json();return raw.asset||raw};
 source=await upload('原图.png');for(let i=0;i<9;i++)resultAssets.push(await upload('结果'+(i+1)+'.png'));
 original=await api('/studio/drafts',{tool:'image_edit',title:'已有编辑草稿',input:{image_id:source.id,image_ids:[source.id],prompt:'保留原有要求',edit_marks:[{id:'kept-mark',x:.2,y:.2,width:.3,height:.2,instruction:'保留原来的区域备注'}],image_layers:[]},model_id:'fixture-image',options:{}});
 const seed=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c',seedProgram],{windowsHide:true,cwd:root,env:{...process.env,TIJIAN_DATA:directory,PYTHONUTF8:'1'},encoding:'utf8',input:JSON.stringify({directory,owner,image:picture,draft:original.id,assets:resultAssets.map(a=>a.id)})});assert.equal(seed.status,0,seed.stderr);legacySeed=JSON.parse(seed.stdout);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true});page.setDefaultTimeout(12000);
 await page.addInitScript(value=>{if(window===window.top)sessionStorage.setItem('tijian-session',value)},token);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base||(q.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(u.pathname))){blocked.push(u.pathname);return r.abort()}if(u.pathname.startsWith('/api/'))network.push({method:q.method(),path:u.pathname,body:q.postData()});return r.continue()});
 await openEditor(original.id);
 await step('full App canvas fills bottom space and result rail stays aligned, single row and scrollable',async()=>{
  await page.locator('.ie-result-card').nth(8).waitFor();
  const geometry=await page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};const rail=document.querySelector('.ie-result-rail');return {canvas:rect('.ie-stage'),results:rect('.ie-latest-result'),workspace:rect('.ie-workspace'),submit:rect('.ie-submit-bar'),rail:{width:rail.clientWidth,scrollWidth:rail.scrollWidth},background:getComputedStyle(document.querySelector('.ie-stage')).backgroundImage}});
  assert(geometry.canvas.height>390,JSON.stringify(geometry));assert(Math.abs(geometry.results.x-geometry.canvas.x)<2);assert(Math.abs(geometry.results.width-geometry.canvas.width)<2);assert(geometry.workspace.bottom-geometry.results.bottom<18,JSON.stringify(geometry));assert(Math.abs(geometry.submit.bottom-geometry.results.bottom)<8);assert(geometry.rail.scrollWidth>geometry.rail.width);assert.equal(geometry.background,'none');
  const rail=page.locator('.ie-result-rail');await rail.hover();await page.mouse.wheel(0,450);await page.waitForTimeout(80);assert(await rail.evaluate(e=>e.scrollLeft)>0);await page.screenshot({path:path.join(directory,'canvas-1600.png')});return geometry;
 });
 await step('result buttons and toolbar retain dark readable normal hover disabled states',async()=>{
  const states=async locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return {color:s.color,background:s.backgroundColor,opacity:s.opacity}});
  const action=page.locator('.ie-result-actions button').first();await action.scrollIntoViewIfNeeded();const normal=await states(action);await action.hover();await page.waitForTimeout(200);const hover=await states(action);assert.notEqual(normal.color,normal.background);assert.notEqual(hover.color,hover.background);assert.notEqual(normal.background,hover.background);assert(!/255, 255, 255/.test(hover.background));
  await page.getByRole('button',{name:'清空标注',exact:true}).click();const disabled=page.getByRole('button',{name:'清空标注',exact:true});assert(await disabled.isDisabled());const off=await states(disabled);assert.notEqual(off.color,off.background);assert.equal(off.opacity,'1');await page.getByRole('button',{name:'+ 添加区域',exact:true}).click();return {normal,hover,disabled:off};
 });
 await step('right click generated result opens separate image_edit draft with original ID and saves prior edits',async()=>{
  const text='这条新要求尚未手动保存，右键离开后必须保留';await page.getByLabel('整图共同要求',{exact:true}).fill(text);const beforeAssets=(await api('/studio/assets')).items.length;
  const clickedOriginal=await page.locator('.ie-result-preview img').first().getAttribute('data-original-src');await menu(page.locator('.ie-result-preview img').first());await add();await page.waitForFunction(id=>location.hash.includes('mode=image_edit')&&!location.hash.includes(id),original.id);await imageReady();const next=(await api('/studio/drafts')).items.find(d=>d.id===routeDraft());assert(next);assert.notEqual(next.id,original.id);assert(clickedOriginal.includes('/'+next.input.image_id+'/file'));assert.equal(next.input.prompt||'','');const previous=(await api('/studio/drafts')).items.find(d=>d.id===original.id);assert.equal(previous.input.prompt,text);assert.equal(previous.input.image_id,source.id);assert(previous.input.edit_marks.length>0);assert.equal((await api('/studio/assets')).items.length,beforeAssets);return {separateDraft:true,originalIdReused:true,oldPromptSaved:true};
 });
 await step('all-assets thumbnail uses stable full original instead of preview Blob',async()=>{
  await page.goto(base+'/#studio/assets');const image=page.locator('.page-area img[data-original-src*="/api/studio/assets/"]').first();await image.waitFor();const expected=await image.getAttribute('data-original-src');assert(expected.endsWith('/file'));await menu(image);await add();await imageReady();const next=(await api('/studio/drafts')).items.find(d=>d.id===routeDraft());assert(expected.includes('/'+next.input.image_id+'/file'));return {originalPathUsed:true};
 });
 await step('legacy article illustration imports actual PNG without changing original article or generating',async()=>{
  const before=(await api('/studio/assets')).items;await page.goto(base+'/#studio/works?record='+legacySeed.content.id);const image=page.locator('.search-record-panel img[data-local-image]').first();await image.waitFor();await page.waitForFunction(()=>document.querySelector('.search-record-panel img')?.naturalWidth>0);await menu(image);await add();await imageReady();const next=(await api('/studio/drafts')).items.find(d=>d.id===routeDraft());const response=await fetch(backend+'/api/studio/assets/'+next.input.image_id+'/file',{headers:{Authorization:'Bearer '+token}});assert(response.ok);assert(Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(picture)));assert.equal((await api('/studio/assets')).items.length,before.length+1);const actual=(await api('/state/updates?ids='+legacySeed.content.id)).items.find(c=>c.id===legacySeed.content.id);assert.equal(actual.body,legacySeed.content.body);return {PNGBytesMatch:true,sourceArticlePreserved:true};
 });
 await step('same-origin static article image imports full PNG through existing upload',async()=>{
  const before=(await api('/studio/assets')).items.length;await page.goto(base+'/#studio/works?record='+legacySeed.content.id);const image=page.locator('.search-record-panel img[src="/visuals/image-context-source.png"]');await image.waitFor();await image.evaluate(i=>i.decode());await menu(image);await add();await imageReady();const next=(await api('/studio/drafts')).items.find(d=>d.id===routeDraft());const response=await fetch(backend+'/api/studio/assets/'+next.input.image_id+'/file',{headers:{Authorization:'Bearer '+token}});assert(response.ok);assert(Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(picture)));assert.equal((await api('/studio/assets')).items.length,before+1);return {sameOriginPNGBytesMatch:true};
 });
 await step('source read failure stays on original page with specific message and no new draft',async()=>{
  await openEditor(original.id);const before=(await api('/studio/drafts')).items.length,hash=page.url();await menu(page.locator('.ie-hit'));const failure='**/api/studio/assets/'+source.id+'/file';await page.route(failure,r=>r.fulfill({status:404,json:{detail:'隔离模拟原图缺失'}}));await add();await page.locator('.image-context-error').filter({hasText:'原图读取失败'}).waitFor();assert.equal(page.url(),hash);assert.equal((await api('/studio/drafts')).items.length,before);await page.unroute(failure);await page.getByRole('menuitem',{name:'关闭菜单',exact:true}).click();
 });
 await step('draft save failure preserves pending text and prevents handoff; retry saves then opens',async()=>{
  const marker='保存失败也绝不能丢的编辑要求';await page.getByLabel('整图共同要求',{exact:true}).fill(marker);const before=(await api('/studio/drafts')).items.length,hash=page.url();const failSave='**/api/studio/drafts/'+original.id;await page.route(failSave,r=>r.request().method()==='PATCH'?r.fulfill({status:503,json:{detail:'隔离模拟保存失败'}}):r.continue());await menu(page.locator('.ie-result-preview img').first());await add();await page.locator('.image-context-error').filter({hasText:'当前草稿尚未保存'}).waitFor();assert.equal(page.url(),hash);assert.equal((await api('/studio/drafts')).items.length,before);assert.equal(await page.getByLabel('整图共同要求',{exact:true}).inputValue(),marker);await page.unroute(failSave);await add();await page.waitForFunction(id=>!location.hash.includes(id),original.id);await imageReady();const saved=(await api('/studio/drafts')).items.find(d=>d.id===original.id);assert.equal(saved.input.prompt,marker);return {failureRetained:true,retrySaved:true};
 });
 await step('hidden retained editors do not register extra handoff saves',async()=>{
  await page.evaluate(()=>{location.hash='studio/image'});await page.locator('.media-workbench:not(.image-edit-mode)').waitFor();await page.evaluate(()=>{location.hash='studio/image?mode=image_edit'});await imageReady();await page.waitForTimeout(950);assert(await page.locator('.st-retained-editor[hidden] .media-workbench').count()>0);const start=network.length;await page.getByLabel('整图共同要求',{exact:true}).fill('仅保存当前可见编辑稿');await menu(page.locator('.ie-hit'));await add();await page.waitForFunction(()=>location.hash.includes('&draft='));await imageReady();const writes=network.slice(start).filter(r=>r.method==='PATCH'&&r.path.startsWith('/api/studio/drafts/'));assert.equal(new Set(writes.map(w=>w.path)).size,1);return {saveTargets:new Set(writes.map(w=>w.path)).size};
 });
 await step('compact viewport keeps usable canvas and reachable one-row results and submit footer',async()=>{
  await openEditor(original.id);await page.setViewportSize({width:1366,height:768});
  const small=await page.evaluate(()=>{const canvas=document.querySelector('.ie-stage'),results=document.querySelector('.media-workbench .mw-results');return {canvasHeight:canvas.getBoundingClientRect().height,scrollHeight:results.scrollHeight,height:results.clientHeight,width:innerWidth,page:document.documentElement.scrollWidth}});
  assert(small.canvasHeight>=300,JSON.stringify(small));assert(small.scrollHeight>small.height);assert(small.page<=small.width+1);await page.screenshot({path:path.join(directory,'canvas-1366.png')});
  await page.locator('.ie-submit-bar').scrollIntoViewIfNeeded();assert(await page.locator('.ie-submit-bar').isVisible());await page.screenshot({path:path.join(directory,'canvas-1366-footer.png')});
  await page.setViewportSize({width:900,height:850});await page.screenshot({path:path.join(directory,'canvas-900.png')});
  const narrow=await page.evaluate(()=>({width:innerWidth,page:document.documentElement.scrollWidth,resultsOverflow:getComputedStyle(document.querySelector('.media-workbench .mw-results')).overflow}));assert(narrow.page<=narrow.width+1);assert.equal(narrow.resultsOverflow,'visible');
  await page.locator('.ie-submit-bar').scrollIntoViewIfNeeded();assert(await page.locator('.ie-submit-bar').isVisible());await page.screenshot({path:path.join(directory,'canvas-900-footer.png')});return {small,narrow};
 });
 await step('no JavaScript errors or paid provider submissions',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);return {errors,blocked,paidCalls:0}});
}catch(e){process.exitCode=1;console.log(e.stack);if(page)fs.writeFileSync(path.join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''));}
finally{await browser?.close();ui.closeAllConnections();await new Promise(r=>ui.close(r));service.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,hashes,errors,blocked,network,realBackend:true,apiMocks:'failure injections only',paidCalls:0},null,2));fs.writeFileSync(path.join(directory,'backend.log'),log);console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));}
