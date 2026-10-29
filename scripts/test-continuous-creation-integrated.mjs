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
const directory=path.resolve('.runtime','article-editing-ui-continuous-'+Date.now());
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
 let ready=false;for(let i=0;i<160;i++){try{ready=(await fetch(backendBase+'/api/health')).ok;if(ready)break}catch{}if(service.exitCode!==null)throw Error(backendLogs);await new Promise(r=>setTimeout(r,100))}assert(ready);
 const account={email:'flow-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'连续创作隔离验收'};
 const auth=await api('/auth/register',account);token=auth.token;owner=auth.user.id;
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>pageErrors.push(e.message));
 await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base){outside.push(url.pathname);return route.abort()}if(req.method()==='POST'&&/\/(generate|optimize|send|publish|sync)(\/|$)/.test(url.pathname)){forbidden.push(url.pathname);return route.abort()}return route.continue()});
 await page.goto(base+'/#studio/home');await page.locator('input[name=email]').fill(account.email);await page.locator('input[name=password]').fill(account.password);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
 await step('未完成IP每次打开提醒，同一打开期间可暂缓',async()=>{await page.getByRole('dialog',{name:'先让梯世界认识你'}).waitFor();await page.getByRole('button',{name:'稍后再做'}).click();await page.reload();await page.getByRole('dialog',{name:'先让梯世界认识你'}).waitFor();await page.getByRole('button',{name:'稍后再做'}).click();assert.equal(await page.locator('.tw-starters button').count(),3);assert.equal(await page.locator('.tw-extra-tools').count(),0);assert.equal(await page.locator('.tw-tools>a').count(),5);return {reminderOnReload:true}});
 await step('完成IP后不再提醒，选择身份即可下一步',async()=>{await api('/objects/profile',{title:'隔离测试IP',position:'服务本地物业',status:'accepted'});await page.reload();await page.locator('.tw-home').waitFor();await page.evaluate(()=>location.hash='studio/flow');await page.getByRole('button',{name:'下一步：选题',exact:true}).click();await page.getByPlaceholder('例如：今天在世纪滨江小区做了电梯现场测量').fill('现场测量如何确认电梯用途');await page.getByRole('button',{name:'确定主题，下一步做内容',exact:true}).click();await page.locator('.cf-channels').waitFor();assert.equal(await page.locator('.ip-startup-reminder').count(),0);await shot('01-topic-and-platforms');return {flow:(await api('/studio/flows')).items[0].id}});
 let wechatDraft,momentsDraft;
 await step('公众号编辑器内嵌，原流程节点保持挂载',async()=>{await page.locator('.cf-timeline').evaluate(el=>el.setAttribute('data-acceptance-stable','yes'));await page.getByRole('button',{name:'开始公众号创作'}).click();await page.locator('.cf-inline-editor textarea').first().waitFor();assert.equal(await page.locator('.cf-timeline').getAttribute('data-acceptance-stable'),'yes');assert.equal(await page.getByLabel('内容形式',{exact:true}).inputValue(),'公众号文章');wechatDraft=new URLSearchParams((await page.evaluate(()=>location.hash)).split('?')[1]).get('draft');await page.getByLabel('创作要求',{exact:false}).fill('公众号独立草稿：只给物业经理看');await shot('02-wechat-in-place');return {wechatDraft}});
 await step('切换朋友圈独立草稿，返回公众号恢复人工修改',async()=>{await page.locator('.cf-channels').getByRole('button',{name:/朋友圈/}).click();await page.waitForFunction(()=>document.querySelector('[data-field=format] select')?.value==='朋友圈文案');momentsDraft=new URLSearchParams((await page.evaluate(()=>location.hash)).split('?')[1]).get('draft');assert.notEqual(momentsDraft,wechatDraft);await page.getByLabel('创作要求',{exact:false}).fill('朋友圈独立草稿：今天工地见闻');await page.locator('.cf-channels').getByRole('button',{name:/公众号/}).click();await page.waitForFunction(id=>new URLSearchParams(location.hash.split('?')[1]).get('draft')===id,wechatDraft);assert.equal(await page.getByLabel('创作要求',{exact:false}).inputValue(),'公众号独立草稿：只给物业经理看');assert.equal(await page.locator('.cf-timeline').getAttribute('data-acceptance-stable'),'yes');return {wechatDraft,momentsDraft}});
 await step('重载恢复正确平台、草稿及字数默认；不新增重复稿',async()=>{await page.reload();await page.locator('.cf-inline-editor textarea').first().waitFor();assert.equal(await page.getByLabel('创作要求',{exact:false}).inputValue(),'公众号独立草稿：只给物业经理看');assert.equal(await page.getByLabel('目标字数',{exact:false}).inputValue(),'1200');flow=(await api('/studio/flows')).items[0];const drafts=(await api('/studio/flows/'+flow.id+'/drafts')).items;assert.equal(drafts.length,2);assert.equal(flow.creation_channel,'wechat');await shot('03-reloaded-draft');return {drafts:drafts.length,channel:flow.creation_channel}});
 await step('发布素材与选题库均保留流程外壳',async()=>{await page.getByRole('button',{name:/^05/}).click();await page.getByRole('heading',{name:'按平台整理，选定一稿再使用',exact:true}).waitFor();assert.equal(await page.locator('.cf-timeline').count(),1);assert.equal(await page.getByText('暂无稿件',{exact:true}).count(),5);await page.getByText('准备平台发布稿',{exact:true}).click();await page.getByRole('button',{name:'填写公众号发布稿',exact:true}).click();await page.locator('.cf-inline-editor .td-page').waitFor();assert.equal(await page.locator('.cf-timeline').count(),1);await shot('04-delivery-in-place');await page.getByRole('button',{name:/^02/}).click();await page.getByRole('button',{name:'打开选题库',exact:true}).click();await page.locator('.cf-inline-editor .td-page').waitFor();assert.equal(await page.locator('.cf-timeline').count(),1);return {emptyDeliverablesTruthful:true,topicsInline:true}});
 await step('窄窗口可操作，无页面级横向溢出',async()=>{await page.setViewportSize({width:1100,height:800});await shot('05-narrow-workspace');const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(dims.scroll<=dims.width+2,JSON.stringify(dims));return dims});
 await step('真实本地API与SQLite，零付费/外网请求',async()=>{assert.deepEqual(pageErrors,[]);assert.deepEqual(outside,[]);assert.deepEqual(forbidden,[]);assert(fs.statSync(path.join(directory,'workbench.sqlite')).size>0);return {apiMocks:0,paidCalls:0}});
}catch(error){process.exitCode=1;console.log(JSON.stringify({error:error.message,directory}))}
finally{
 await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();await Promise.race([new Promise(resolve=>service.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);
 fs.writeFileSync(path.join(directory,'api-network.json'),JSON.stringify(network,null,2));fs.writeFileSync(path.join(directory,'backend.log'),backendLogs);fs.writeFileSync(path.join(directory,'dist-loaded-hashes.json'),JSON.stringify(distHashes,null,2));
 const report={directory,frontend:'existing integrated dist; unmodified full App',backend:'tests/article-ui-fixture.py with real endpoints and isolated SQLite',results,screenshots,imageEvidence,distIndexSHA256:distHashes['index.html'],loadedDistFiles:Object.keys(distHashes).length,outside,forbidden,pageErrors,apiMockResponses:0,paidCalls:0,productionDataTouched:false,buildInvoked:false};fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,apiMockResponses:0,paidCalls:0}));if(results.some(r=>!r.ok)||!results.length)process.exitCode=1;
}
