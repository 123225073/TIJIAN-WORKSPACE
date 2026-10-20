import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=process.cwd(),directory=path.resolve('.runtime','article-editing-ui-platform-deliverables-'+Date.now());fs.mkdirSync(directory,{recursive:true});
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
 token=(await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'平台素材隔离验收'})).token;
 await api('/workspace',{path:path.join(directory,'workspace')});
 const owner=(await api('/auth/me')).user.id;
 await api('/objects/profile',{title:'素材验收 IP',position:'服务本地物业',status:'accepted'});
 const oldTopic=await topic('旧选题：运输费用'),currentTopic=await topic('当前选题：土建费用');
 let work=await api('/studio/flow',{new:true,version:0,brief:currentTopic.title,topic_id:currentTopic.id,stage:4,creation_channel:'wechat'});
 const seed=async({title,channel='wechat',topicId=currentTopic.id,color=50,scoped=true})=>{
  const d=await api('/studio/flows/'+work.id+'/drafts',{tool:'text',title,topic_id:topicId,creation_channel:channel,input:{brief:title,format:channel==='wechat'?'公众号文章':'小红书文案',target_words:500}});
  const imagePath=path.join(directory,d.id+'.png');const img=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-c','from PIL import Image; import sys; Image.new("RGB",(160,100),(int(sys.argv[2]),60,90)).save(sys.argv[1])',imagePath,String(color)],{windowsHide:true});assert.equal(img.status,0);
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(imagePath)],{type:'image/png'}),'验收配图.png');const upload=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(upload.ok);const result=await upload.json(),asset=result.asset||result;
  const program=`import json,sys,os
from pathlib import Path
from backend import store as s
v=json.load(sys.stdin)
assert Path(os.environ['TIJIAN_DATA']).resolve()==Path(v['directory']).resolve() and 'article-editing-ui-platform-deliverables-' in v['directory']
d=s.get(v['owner'],v['draft']); a=s.get(v['owner'],v['asset'])
a=s.put(v['owner'],'studio_asset',{**a,'flow_id':v['flow']},a['id'],a['version'])
c=s.put(v['owner'],'content',{'title':v['title'],'body':'隔离验收数据，非 AI 调用。\\n\\n![配图](/api/studio/assets/'+a['id']+'/file)','image_asset_ids':[a['id']],'format':v['format'],'status':'draft','flow_id':v['flow']})
if v['scoped']:
 s.put(v['owner'],'job',{'title':'隔离验收种子，不是模型执行','status':'done','flow_id':v['flow'],'input':{'action':'studio_text','draft_id':d['id'],'draft_version':d['version']},'result':{'content_id':c['id']}})
print(json.dumps(c,ensure_ascii=False))`;
  const child=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c',program],{windowsHide:true,cwd:root,env:{...process.env,TIJIAN_DATA:directory,PYTHONUTF8:'1'},encoding:'utf8',input:JSON.stringify({directory,owner,draft:d.id,asset:asset.id,flow:work.id,title,format:channel==='wechat'?'公众号文章':'小红书文案',scoped})});assert.equal(child.status,0,child.stderr);return {content:JSON.parse(child.stdout),asset,bytes:fs.readFileSync(imagePath)};
 };
 const wx1=await seed({title:'公众号稿件甲',color:30}),wx2=await seed({title:'公众号稿件乙',color:90}),xhs=await seed({title:'小红书稿件',channel:'xiaohongshu',color:160});
 const old=await seed({title:'旧选题历史稿',topicId:oldTopic.id,color:210}),unknown=await seed({title:'未归类旧稿',scoped:false,color:230});
 work=await api('/studio/flow',{...work,content_id:wx2.content.id,stage:4});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true});page.setDefaultTimeout(15000);
 await page.addInitScript(value=>{if(window===window.top)sessionStorage.setItem('tijian-session',value)},token);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base||(q.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(u.pathname))){blocked.push(u.pathname);return r.abort()}return r.continue()});
 await goto(flowRoute(work.id));await page.locator('.fd-version').waitFor();
 await step('current topic separated by platform; history not mixed into current drafts',async()=>{
  const manifest=await api('/studio/flows/'+work.id+'/deliverables');assert.equal(manifest.groups.find(g=>g.platform==='wechat').versions.length,2);assert.equal(manifest.groups.find(g=>g.platform==='xiaohongshu').versions.length,1);assert.deepEqual(new Set(manifest.history.map(v=>v.content_id)),new Set([old.content.id,unknown.content.id]));
  assert.equal(await page.locator('.fd-version').getAttribute('data-content-id'),wx2.content.id);assert.equal(await page.locator('.fd-picture-grid li').count(),1);assert(!(await page.locator('.fd-version').innerText()).includes(wx2.asset.id));
  for(const [width,height] of [[1600,1050],[1366,768],[1100,800]]){await page.setViewportSize({width,height});const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dims.scroll<=width+1);await page.screenshot({path:path.join(directory,'platforms-'+width+'.png')})}
  await page.getByRole('tab',{name:/小红书/}).click();assert.equal(await page.locator('.fd-version').getAttribute('data-content-id'),xhs.content.id);assert.equal(await page.locator('.fd-picture-grid li').getAttribute('data-image-asset-id'),xhs.asset.id);return {wechat:2,xiaohongshu:1,history:2,apiMocks:0};
 });
 const download=async(button,name)=>{const pending=page.waitForEvent('download');await button.click();const item=await pending;const file=path.join(directory,name);await item.saveAs(file);assert.equal(await item.failure(),null);return file};
 await step('real single PNG and ZIP contain only selected platform picture',async()=>{
  await page.locator('.fd-picture-preview').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.fd-picture-preview img')?.naturalWidth>0);const single=await download(page.getByRole('button',{name:'下载小红书稿件配图1',exact:true}),'single.png');assert(fs.readFileSync(single).equals(xhs.bytes));
  const zip=await download(page.getByRole('button',{name:'一键下载本稿配图',exact:true}),'xhs.zip');const verify=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c','import zipfile,sys,json,hashlib; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"hashes":[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()]},ensure_ascii=False))',zip],{encoding:'utf8',windowsHide:true});assert.equal(verify.status,0,verify.stderr);const values=JSON.parse(verify.stdout);assert.deepEqual(values.names,['01-小红书配图.png']);assert.deepEqual(values.hashes,[createHash('sha256').update(xhs.bytes).digest('hex')]);return {singleBytes:xhs.bytes.length,...values};
 });
 await step('picture lightbox wheel zoom; version selection and refresh preserve scope',async()=>{
  await page.locator('.fd-picture-preview img').click();await page.locator('.image-lightbox[open]').waitFor();await page.locator('.image-lightbox-stage').hover();await page.mouse.wheel(0,-300);await page.waitForFunction(()=>document.querySelector('.image-lightbox output')?.textContent!=='100%');const zoom=await page.locator('.image-lightbox output').innerText();await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('tab',{name:/公众号/}).click();await page.getByLabel('选择平台稿件版本',{exact:true}).selectOption(wx1.content.id);assert.equal(await page.locator('.fd-picture-grid li').getAttribute('data-image-asset-id'),wx1.asset.id);
  await page.getByRole('button',{name:'刷新素材',exact:true}).click();await page.locator('.fd-version').waitFor();assert.equal(await page.locator('.fd-version').getAttribute('data-content-id'),wx1.content.id);
  await page.getByText('找回历史与未归类素材',{exact:false}).click();await page.getByRole('button',{name:/查看历史稿件/}).click();await page.getByLabel('选择历史稿件',{exact:true}).selectOption(old.content.id);assert.equal(await page.locator('.fd-history .fd-version').getAttribute('data-content-id'),old.content.id);await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();return {zoom,restoredVersion:wx1.content.id};
 });
 await step('no JavaScript errors or paid/external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);return {errors,blocked,paidCalls:0}});
}catch(e){process.exitCode=1;console.log(e.stack);if(page)fs.writeFileSync(path.join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''));}
finally{await browser?.close();ui.closeAllConnections();await new Promise(r=>ui.close(r));service.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,hashes,errors,blocked,realBackend:true,apiMocks:0,paidCalls:0},null,2));fs.writeFileSync(path.join(directory,'backend.log'),log);console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));}
