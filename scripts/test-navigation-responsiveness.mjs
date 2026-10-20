import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=process.cwd(),directory=path.resolve('.runtime','article-editing-ui-navigation-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const files=['src/CreationFlow.tsx','src/Studio.tsx','src/flow-navigation.ts','src/IPStartupReminder.tsx','src/App.tsx','backend/workflows.py','src/FlowDeliverables.tsx'];
const useDist=process.argv.includes('--dist'),visualOnly=false,deliveryOnly=false;
if(useDist)fs.cpSync(path.resolve('dist'),path.join(directory,'dist'),{recursive:true});
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
if(!useDist){const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),jsx:'automatic',external:['/visuals/*'],define:{'process.env.NODE_ENV':'"development"'}});
for(const file of bundle.outputFiles)fs.writeFileSync(file.path,file.contents);}
const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
const backend='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
let log='';service.stdout.on('data',c=>log+=c);service.stderr.on('data',c=>log+=c);
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(useDist&&!u.pathname.startsWith('/api/')){const file=path.resolve(directory,'dist',u.pathname==='/'?'index.html':'.'+u.pathname);if(file.startsWith(path.join(directory,'dist')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html;charset=utf-8':'application/octet-stream');res.end(fs.readFileSync(file));return}}if(u.pathname.startsWith('/api/')){const p=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(p);return}if(['/app.js','/app.css'].includes(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(directory,u.pathname.slice(1))));return}if(u.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta charset="UTF-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');return}res.writeHead(404);res.end()});
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
try{
 for(let i=0;i<150;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100));}
 token=(await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'导航响应验收'})).token;
 await api('/workspace',{path:path.join(directory,'workspace')});
 const profile=await api('/objects/profile',{title:'导航验收 IP',position:'隔离验收',status:'accepted'}),tr=await topic('导航隔离选题');
 const work=await api('/studio/flow',{new:true,version:0,profile_id:profile.id,topic_id:tr.id,brief:tr.title,stage:2});
 const form=new FormData();form.append('file',new Blob([fs.readFileSync('public/visuals/elevator-atrium-v1.png')],{type:'image/png'}),'导航真实图片.png');
 const uploaded=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(uploaded.ok);const asset=await uploaded.json();
 const edit=await api('/studio/drafts',{tool:'image_edit',title:'导航验收图片编辑',input:{image_id:asset.id,image_ids:[asset.id],prompt:'隔离验收，不调用模型'},options:{}});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1530,height:1000}});page.setDefaultTimeout(10000);
 await page.addInitScript(value=>{if(window===window.top)sessionStorage.setItem('tijian-session',value)},token);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(u.origin!==base||(req.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(u.pathname))){blocked.push(u.pathname);return r.abort()}return r.continue()});
 await page.goto(base+'/#studio/home');await page.locator('.tw-home').waitFor();
 await step('supporting flow data starts while restore is still in flight',async()=>{
  let release;const gate=new Promise(r=>release=r),pattern='**/api/studio/flow?work_id='+work.id;
  await page.route(pattern,async r=>{await gate;await r.continue()});
  try{
   const assets=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/assets'&&r.request().method()==='GET'),topics=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/topics');
   await page.evaluate(id=>location.hash='studio/flow?work='+id,work.id);await page.locator('.cf-restoring').waitFor();
   await Promise.all([assets,topics]);assert.equal(await page.locator('.cf-restoring').count(),1);release();await page.locator('.cf-continuous').waitFor();await page.waitForFunction(()=>!document.querySelector('.cf-data-loading'));
   await page.screenshot({path:path.join(directory,'parallel-flow.png')});return {supportingReadsBeforeRestore:true,responseMocks:0};
  }finally{release();await page.unroute(pattern)}
 });
 await step('cold and repeat picture editor navigation remain usable with original image',async()=>{
  const times=[];
  for(let i=0;i<2;i++){
   await page.evaluate(()=>location.hash='studio/home');await page.locator('.tw-home').waitFor();const started=Date.now();
   await page.evaluate(id=>location.hash='studio/image?mode=image_edit&draft='+id,edit.id);await page.locator('.ie-workspace').waitFor();
   await page.waitForFunction(()=>{const image=document.querySelector('.ie-stage img');return image?.naturalWidth>0});
   const elapsed=Date.now()-started;times.push(elapsed);assert(elapsed<4000,'Editor took '+elapsed+'ms on isolated local backend');
  }
  await page.screenshot({path:path.join(directory,'image-editor-ready.png')});return {readyWithOriginalImageMs:times,apiMocks:0,realBackend:true};
 });
 await step('no errors or paid provider submissions',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);return {errors,blocked}});
}catch(e){process.exitCode=1;console.log(e.stack);if(page)fs.writeFileSync(path.join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''));}
finally{await browser?.close();ui.closeAllConnections();await new Promise(r=>ui.close(r));service.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,hashes,errors,blocked,realBackend:true,apiMocks:0,paidCalls:0},null,2));fs.writeFileSync(path.join(directory,'backend.log'),log);console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));}
