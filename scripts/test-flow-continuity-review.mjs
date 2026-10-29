import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=process.cwd(),directory=path.resolve('.runtime','article-editing-ui-flow-review-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const files=['src/CreationFlow.tsx','src/Studio.tsx','src/flow-navigation.ts','src/IPStartupReminder.tsx','src/App.tsx','backend/workflows.py','src/FlowDeliverables.tsx'];
const useDist=process.argv.includes('--dist'),visualOnly=process.argv.includes('--visual-only'),deliveryOnly=process.argv.includes('--delivery-visual-only'),transferOnly=process.argv.includes('--transfer-only');
if(useDist)fs.cpSync(path.resolve('dist'),path.join(directory,'dist'),{recursive:true});
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
if(!useDist){const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),jsx:'automatic',external:['/visuals/*'],define:{'process.env.NODE_ENV':'"development"'}});
for(const file of bundle.outputFiles)fs.writeFileSync(file.path,file.contents);}
const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
const backend='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
let log='';service.stdout.on('data',c=>log+=c);service.stderr.on('data',c=>log+=c);
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(useDist&&!u.pathname.startsWith('/api/')){const file=path.resolve(directory,'dist',u.pathname==='/'?'index.html':'.'+u.pathname);if(file.startsWith(path.join(directory,'dist')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html;charset=utf-8':'application/octet-stream');res.end(fs.readFileSync(file));return}}if(u.pathname.startsWith('/api/')){const p=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(p);return}if(['/app.js','/app.css'].includes(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(directory,u.pathname.slice(1))));return}if(u.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');return}res.writeHead(404);res.end()});
await new Promise(r=>ui.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+ui.address().port;
let token='',browser,page;const results=[],network=[],errors=[],blocked=[];
const api=async(p,data,method=data===undefined?'GET':'POST')=>{const r=await fetch(backend+'/api'+p,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:data===undefined?undefined:JSON.stringify(data)});assert(r.ok,p+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
const step=async(name,fn)=>{if(transferOnly&&!name.includes('transfer')&&!name.startsWith('oral editor'))return;if(visualOnly&&!name.startsWith('full App'))return;if(deliveryOnly&&!/^(full App|WeChat real|social )/.test(name))return;try{const evidence=await fn();results.push({name,ok:true,evidence});console.log(JSON.stringify({name,evidence}))}catch(e){results.push({name,ok:false,error:e.stack});console.log(JSON.stringify({name,error:e.message}));if(page){await page.screenshot({path:path.join(directory,'failed-'+results.length+'.png')}).catch(()=>{});fs.writeFileSync(path.join(directory,'failed-'+results.length+'.txt'),await page.locator('body').innerText().catch(()=>''))}process.exitCode=1}};
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
 token=(await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'流程隔离审查'})).token;
 await api('/workspace',{path:path.join(directory,'workspace')});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(15000);
 await page.addInitScript(value=>{if(window===window.top)sessionStorage.setItem('tijian-session',value)},token);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==base||(q.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(u.pathname))){blocked.push(u.pathname);return r.abort()}return r.continue()});
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),at:Date.now(),hash:page.url().split('#')[1],...(new URL(r.url()).pathname==='/api/studio/flow'&&r.request().method()==='POST'?{stage:r.request().postDataJSON().stage}: {})})});
 const a=await topic('审查主题A'),f=await flow(a.title,a),d=await draft(f,'公众号 · '+a.title,a.title);
 await step('startup reminder dismissal and explicit scoped draft loading',async()=>{await goto(flowRoute(f.id));await page.getByRole('button',{name:'稍后再做',exact:true}).click();await channel().click();await brief().waitFor();assert.equal(await brief().inputValue(),a.title);return {flow:f.id,draft:d.id}});
 await step('fast platform switch preserves unsynced draft locally',async()=>{await brief().fill('仅本机快速修改 A');await page.locator('.cf-channels button').filter({has:page.getByText('小红书',{exact:true})}).click();await page.waitForFunction(()=>document.querySelector('select[id*="format"]')?.value==='小红书文案');await channel().click();await page.waitForFunction(()=>document.querySelector('select[id*="format"]')?.value==='公众号文章');assert.equal(await brief().inputValue(),'仅本机快速修改 A');return {restored:true}});

 await step('slow branch-list refresh reuses the synchronously registered draft',async()=>{const t=await topic('慢速分支读取'),w=await flow(t.title,t);await goto(flowRoute(w.id));const modal=page.getByRole('button',{name:'稍后再做',exact:true});if(await modal.isVisible())await modal.click();let release;const gate=new Promise(r=>release=r);const pattern='**/api/studio/flows/'+w.id+'/drafts';const handler=async r=>{if(r.request().method()==='GET')await gate;await r.continue().catch(()=>{})};await page.route(pattern,handler);try{await channel().click();await page.waitForFunction(()=>location.hash.startsWith('#studio/text?'));await channel().click();await new Promise(r=>setTimeout(r,500));const list=(await api('/studio/flows/'+w.id+'/drafts')).items;assert.equal(list.length,1);return {count:list.length,ids:list.map(d=>d.id)}}finally{release();await page.unroute(pattern,handler)}});

 await step('same-tick branch clicks issue only one draft POST',async()=>{
  const tr=await topic('分支同步锁'),w=await flow(tr.title,tr);await goto(flowRoute(w.id));await page.waitForLoadState('networkidle');
  const pattern='**/api/studio/flows/'+w.id+'/drafts';let posts=0;
  const handler=async route=>{if(route.request().method()==='POST'){posts++;await new Promise(r=>setTimeout(r,200))}await route.continue()};await page.route(pattern,handler);
  try{await channel().evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>location.hash.startsWith('#studio/text?'));await page.waitForLoadState('networkidle');const list=(await api('/studio/flows/'+w.id+'/drafts')).items;assert.equal(posts,1);assert.equal(list.length,1);return {posts,ids:list.map(d=>d.id)}}finally{await page.unroute(pattern,handler)}
 });
 await step('title prefix collision must not resume previous topic draft',async()=>{const prefix='电梯维保现场核对与物业管理责任说明'.repeat(4);const old=await topic(prefix+'旧项目'),current=await topic(prefix+'新项目');const w=await flow(old.title,old);const oldDraft=await draft(w,'公众号 · '+old.title.slice(0,55),old.title);await api('/studio/flow',{...w,brief:current.title,topic_id:current.id,stage:2});await goto(flowRoute(w.id));const modal=page.getByRole('button',{name:'稍后再做',exact:true});if(await modal.isVisible())await modal.click();await channel().click();await brief().waitFor();const actual=await brief().inputValue();assert.equal(actual,current.title);return {expected:current.title,actual,openedDraft:new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('draft'),oldDraft:oldDraft.id,bug:actual===old.title}});
 await page.screenshot({path:path.join(directory,'collision.png'),fullPage:true});
 await step('branch identity survives draft PATCH and full reload; title rename reuses; channel separates',async()=>{
  const tr=await topic('稳定分支标识'),w=await flow(tr.title,tr);await goto(flowRoute(w.id));await channel().click();await brief().waitFor();
  const id=new URLSearchParams(locationHash()).get('draft');
  let row=(await api('/studio/flows/'+w.id+'/drafts')).items.find(d=>d.id===id);assert.equal(row.topic_id,tr.id);assert.equal(row.creation_channel,'wechat');
  row=await api('/studio/flows/'+w.id+'/drafts/'+id,{version:row.version,title:'用户改过的草稿名',input:row.input},'PATCH');assert.equal(row.topic_id,tr.id);assert.equal(row.creation_channel,'wechat');
  await page.reload();await page.locator('.cf-continuous').waitFor();const modal=page.getByRole('button',{name:'稍后再做',exact:true});if(await modal.isVisible())await modal.click();await page.waitForLoadState('networkidle');
  await channel().click();await page.waitForLoadState('networkidle');assert.equal(new URLSearchParams(locationHash()).get('draft'),id);
  await page.locator('.cf-channels button').filter({has:page.getByText('小红书',{exact:true})}).click();await page.waitForFunction(previous=>new URLSearchParams(location.hash.split('?')[1]).get('draft')!==previous,id);const other=new URLSearchParams(locationHash()).get('draft');
  await channel().click();await page.waitForFunction(previous=>new URLSearchParams(location.hash.split('?')[1]).get('draft')===previous,id);
  const list=(await api('/studio/flows/'+w.id+'/drafts')).items;assert.equal(list.length,2);return {topic:tr.id,wechat:id,xiaohongshu:other,afterPatchAndReload:true};
 });
 const owner=(await api('/auth/me')).user.id;
 const seedOutput=async(w,d)=>{
  const imagePath=path.join(directory,'output.png');const image=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-c','from PIL import Image; import sys; Image.new("RGB",(160,100),(20,60,90)).save(sys.argv[1])',imagePath],{windowsHide:true});assert.equal(image.status,0);
  const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(imagePath)],{type:'image/png'}),'review-local-output.png');const response=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});assert(response.ok);const raw=await response.json(),asset=raw.asset||raw;
  const program='import json,sys,os; from pathlib import Path; from backend import store as s; v=json.load(sys.stdin); assert Path(os.environ["TIJIAN_DATA"]).resolve()==Path(v["directory"]).resolve(); assert "article-editing-ui-flow-review-" in v["directory"]; d=s.get(v["owner"],v["draft"]); a=s.get(v["owner"],v["asset"]); a=s.put(v["owner"],"studio_asset",{**a,"flow_id":v["flow"]},a["id"],a["version"]); c=s.put(v["owner"],"content",{"title":"审查文章标题","body":"隔离种子正文，非模型生成。\\n\\n![隔离本地图](/api/studio/assets/"+a["id"]+"/file)","summary":"隔离摘要","format":"公众号文章","status":"draft","flow_id":v["flow"],"draft_id":d["id"]}); j=s.put(v["owner"],"job",{"title":"隔离种子完成记录（非模型调用）","status":"done","flow_id":v["flow"],"input":{"action":"studio_text","draft_id":d["id"],"draft_version":d["version"]},"result":{"content_id":c["id"]}}); s.put(v["owner"],d["kind"],{**d,"job_ids":[j["id"]],"job_versions":{j["id"]:d["version"]}},d["id"],d["version"]); print(json.dumps(c,ensure_ascii=False))';
  const result=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c',program],{cwd:root,env:{...process.env,TIJIAN_DATA:directory,PYTHONUTF8:'1'},windowsHide:true,encoding:'utf8',input:JSON.stringify({directory,owner,flow:w.id,draft:d.id,asset:asset.id})});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 await step('oral editor is plain text and returns from avatar',async()=>{
  const tr=await topic('口播独立编辑'),w=await flow(tr.title,tr),d=await draft(w,tr.title,tr.title);let output=await seedOutput(w,d);
  const polluted='电梯价格热视频本次口播输出约束：输出完整、可直接朗读的纯口播正文，保留用户明确要求';
  output=await api('/objects/'+output.id,{version:output.version,format:'口播脚本',title:polluted,body:'你好，先核对记录。\n最后保留完整结论。'},'PATCH');
  await goto('studio/text?draft='+d.id+'&mode=text&return='+encodeURIComponent(flowRoute(w.id)+'&step=2'));await page.reload();await page.locator('.cf-continuous').waitFor();const modal=page.getByRole('button',{name:'稍后再做',exact:true});if(await modal.isVisible())await modal.click();await page.getByRole('button',{name:'内容编辑',exact:true}).click();await page.locator('.oral-editor').waitFor();
  assert.equal(await page.locator('.oral-editor .md-format').count(),0);assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),output.body);assert.equal(await page.getByText('仅用于管理，不会朗读').count(),1);
  const title=page.getByLabel('文稿标题');await page.waitForFunction(()=>document.querySelector('input[aria-label="文稿标题"]')?.value==='电梯价格热视频');
  assert.equal((await api('/state/updates?ids='+output.id)).items[0].title,polluted,'仅打开旧稿不能直接写服务器');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/objects/'+output.id&&r.request().method()==='PATCH');await page.locator('.oral-editor').getByRole('button',{name:'保存修改'}).click();assert.equal((await saved).status(),200);
  assert.equal((await api('/state/updates?ids='+output.id)).items[0].title,'电梯价格热视频');
  await title.fill('用户自己编辑的新名称');await page.reload();await page.locator('.cf-continuous').waitFor();const again=page.getByRole('button',{name:'稍后再做',exact:true});if(await again.isVisible())await again.click();await page.getByRole('button',{name:'内容编辑',exact:true}).click();await page.locator('.oral-editor').waitFor();assert.equal(await page.getByLabel('文稿标题').inputValue(),'用户自己编辑的新名称','重新打开不得覆盖未保存的手工标题');
  await page.getByLabel('编辑生成文稿').fill('修改后可直接朗读。');await page.getByRole('button',{name:'用于文字口播',exact:true}).click();await page.getByRole('button',{name:'返回文案修改',exact:true}).click();await page.locator('.oral-editor').waitFor();assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),'修改后可直接朗读。');
  return {plain:true,returned:true,saved:true,legacyTitleRepaired:true,manualTitlePreserved:true};
 });
 const outputChain=async(saveEdit)=>{
  const topicRow=await topic('真实产物链路隔离核查 '+saveEdit),w=await flow(topicRow.title,topicRow),draftRow=await draft(w,'公众号 · '+topicRow.title,topicRow.title);const output=await seedOutput(w,draftRow);
  await goto('studio/text?draft='+draftRow.id+'&mode=text&return='+encodeURIComponent(flowRoute(w.id)+'&step=2'));
  await page.reload();await page.locator('.cf-continuous').waitFor();const modal=page.getByRole('button',{name:'稍后再做',exact:true});await modal.waitFor();await modal.click();const contentTab=page.getByRole('button',{name:'内容编辑',exact:true});if(await contentTab.isVisible())await contentTab.click();await page.locator('.article-editor').waitFor();await page.getByRole('tab',{name:'编辑',exact:true}).click();
  const marker='作者最终修订-'+saveEdit;await page.getByLabel('编辑生成文稿').fill(output.body+'\n\n'+marker);
  if(saveEdit){const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/objects/'+output.id&&r.request().method()==='PATCH');await page.locator('.article-editor').getByRole('button',{name:'保存修改',exact:true}).click();assert.equal((await saved).status(),200);await page.getByText(/已保存稿件 v/).first().waitFor();}
  await page.getByRole('button',{name:/确认此内容，加入本次作品|加入本次作品并返回/}).click();await page.locator('.cf-channel-welcome').waitFor();await new Promise(r=>setTimeout(r,1000));await page.waitForLoadState('networkidle');await page.locator('.cf-timeline .cf-node>button').nth(3).click();await page.locator('.cf-asset-grid').waitFor();assert.equal(await page.locator('.cf-asset-grid select').first().inputValue(),output.id);
  await page.getByRole('button',{name:/确认，选择发布平台/}).click();await page.locator('.cf-deliverables').waitFor();await page.getByText('准备平台发布稿',{exact:true}).click();await page.getByRole('button',{name:/填写公众号发布稿/}).click();await page.locator('.td-page .wa-form').waitFor();
  await page.waitForFunction(title=>document.querySelector('input[placeholder="一句话说明文章回答的问题"]')?.value===title,output.title);assert.equal(await page.getByPlaceholder('一句话说明文章回答的问题').inputValue(),output.title);const body=await page.getByRole('textbox',{name:'公众号文章正文'}).innerText();await page.waitForFunction(()=>document.querySelector('.wa-form .article-rich-editor img')?.naturalWidth>0);const imageCount=await page.locator('.wa-form .article-rich-editor img').count();
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/deliveries'&&r.request().method()==='POST');await page.getByRole('button',{name:'保存发布稿',exact:true}).click();const result=await pending;assert.equal(result.status(),200);const delivery=await result.json();assert.equal(delivery.flow_id,w.id);assert.equal(delivery.topic_id,topicRow.id);assert.equal(imageCount,1);assert(delivery.body.includes('/api/studio/assets/'));
  await page.screenshot({path:path.join(directory,'delivery-'+saveEdit+'.png'),fullPage:true});
  const local=await page.evaluate(({owner,id})=>JSON.parse(localStorage.getItem('studio-content-edit:'+owner+':'+id)||'null'),{owner,id:output.id});
  return {savedBeforeAttach:saveEdit,flow:w.id,output:output.id,delivery:delivery.id,deliveryVersion:delivery.version,imageCount,receivedLatestEdit:body.includes(marker),persistedLatestEdit:delivery.body.includes(marker),localStillHasEdit:local?.values?.body?.includes(marker),bug:!body.includes(marker),outputOrigin:'isolated explicit content/job seed, uploaded real PNG, no model invocation'};
 };
 await step('saved output -> attach -> confirm -> actual delivery -> SQLite save',async()=>{const r=await outputChain(true);assert.equal(r.bug,false);return r}).catch(()=>{});
 await step('unsaved output -> attach -> confirm -> actual delivery saves latest content',async()=>{const r=await outputChain(false);assert.equal(r.bug,false);return r}).catch(()=>{});

 const transferCase=async({oldScript=false,double=false,video=false}={})=>{
  const tr=await topic('转交审查'),w=await flow(tr.title,tr),d=await draft(w,'公众号 · '+tr.title,tr.title);let output=await seedOutput(w,d);
  if(oldScript)output=await api('/objects/'+output.id,{version:output.version,script:'旧版口播内容，尚未修改。'},'PATCH');
  await goto('studio/text?draft='+d.id+'&mode=text&return='+encodeURIComponent(flowRoute(w.id)+'&step=2'));await page.reload();await page.locator('.cf-continuous').waitFor();await page.getByRole('button',{name:'稍后再做',exact:true}).click();await page.getByRole('button',{name:'内容编辑',exact:true}).click();await page.locator('.article-editor').waitFor();await page.getByRole('tab',{name:'编辑',exact:true}).click();
  const edited='# 审查文章标题\n\n这是作者最新修改的口播正文。';await page.getByLabel('编辑生成文稿').fill(edited);
  const creations=[];const capture=async r=>{if(new URL(r.url()).pathname==='/api/studio/flows/'+w.id+'/drafts'&&r.request().method()==='POST')creations.push(await r.json())};page.on('response',capture);
  const button=page.getByRole('button',{name:video?'用此脚本制作视频':'用于文字口播',exact:true});
  if(double){const pattern='**/api/state/updates?ids='+output.id;await page.route(pattern,async r=>{await new Promise(resolve=>setTimeout(resolve,200));await r.continue()});await button.dblclick();}else await button.click();
  await page.waitForFunction(()=>location.hash.startsWith('#studio/avatar/text?')||location.hash.startsWith('#studio/video?'));await new Promise(r=>setTimeout(r,350));page.off('response',capture);
  const saved=(await api('/state/updates?ids='+output.id)).items.find(x=>x.id===output.id),list=(await api('/studio/flows/'+w.id+'/drafts')).items.filter(x=>x.tool===(video?'text_video':'text_avatar'));
  assert.equal(saved.body,edited);assert(list.length);const value=list[0].input[video?'prompt':'text'];
  await page.getByRole('button',{name:'返回文案修改',exact:true}).click();await page.locator('.article-editor').waitFor();
  assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),edited);assert.equal(new URLSearchParams(locationHash()).get('draft'),d.id);
  return {oldScript,double,video,savedBody:saved.body,actualTransferred:value,targetDraftCount:list.length,targetIds:list.map(x=>x.id),cleanedTitle:!value.includes('# 审查文章标题'),receivedLatest:value.includes('作者最新修改'),returnToEditor:true,bug:!value.includes('作者最新修改')||list.length>1};
 };
 await step('unsaved article edit -> avatar transfer actual persisted text',async()=>{const r=await transferCase();assert.equal(r.bug,false);assert(r.cleanedTitle);return r});
 await step('unsaved article edit -> video transfer actual persisted prompt',async()=>{const r=await transferCase({video:true});assert.equal(r.bug,false);return r});
 await step('edited body with old script field -> avatar transfer',async()=>{const r=await transferCase({oldScript:true});assert.equal(r.bug,false);assert(r.cleanedTitle);return r});
 await step('double click transfer creates target draft once',async()=>{const r=await transferCase({double:true});assert.equal(r.bug,false);return r});


 await step('late actual flow GET cannot rewind a newer saved version',async()=>{
  const tr=await topic('迟到恢复响应'),w=await flow(tr.title,tr);await draft(w,'公众号 · '+tr.title,tr.title);await goto(flowRoute(w.id));await channel().click();await brief().waitFor();await page.waitForLoadState('networkidle');
  let release,captured;const gate=new Promise(r=>release=r),received=new Promise(r=>captured=r);let held=false,snapshot;
  const pattern='**/api/studio/flows/'+w.id+'/bootstrap';
  const handler=async route=>{if(held||route.request().method()!=='GET')return route.continue();held=true;const response=await route.fetch();snapshot=(await response.json()).flow;captured();await gate;await route.fulfill({response}).catch(()=>{})};await page.route(pattern,handler);
  try{
   await page.locator('.cf-timeline .cf-node>button').nth(3).click();await received;await page.locator('.cf-asset-grid').waitFor();
   const nextSave=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/flow'&&r.request().method()==='POST'&&r.request().postDataJSON().stage===1);
   await page.locator('.cf-timeline .cf-node>button').nth(1).click();const saved=await (await nextSave).json();release();await page.waitForLoadState('networkidle');
   const active=await page.locator('.cf-node.current strong').innerText(),remote=await api('/studio/flow?work_id='+w.id);
   const conflict=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/flow'&&r.request().method()==='POST'&&r.request().postDataJSON().stage===0);
   await page.locator('.cf-timeline .cf-node>button').nth(0).click();const conflictStatus=(await conflict).status();
   assert.equal(active,'选好主题');assert.equal(conflictStatus,200);
   return {snapshotVersion:snapshot.version,newerSavedVersion:saved.version,actualUIAfterLateRead:active,serverStage:remote.stage,nextSaveStatus:conflictStatus,bug:active!=='选好主题'||conflictStatus===409};
  }finally{release();await page.unroute(pattern,handler)}
 });

 await step('late GET cannot replace a local edit before its autosave',async()=>{
  const tr=await topic('本地未保存编辑'),w=await flow(tr.title,tr);await goto(flowRoute(w.id));await channel().click();await brief().waitFor();await page.waitForLoadState('networkidle');
  let release,captured;const gate=new Promise(r=>release=r),received=new Promise(r=>captured=r);let held=false;
  const pattern='**/api/studio/flows/'+w.id+'/bootstrap';
  const handler=async route=>{if(held)return route.continue();held=true;const response=await route.fetch();captured();await gate;await route.fulfill({response}).catch(()=>{})};await page.route(pattern,handler);
  try{
   await page.locator('.cf-timeline .cf-node>button').nth(1).click();await received;const editor=page.getByLabel('今天想讲什么？');await editor.waitFor();const text='本地尚未保存的新主题';
   await editor.fill(text);release();await page.waitForLoadState('networkidle');assert.equal(await editor.inputValue(),text);
   await page.waitForTimeout(900);const remote=await api('/studio/flow?work_id='+w.id);assert.equal(remote.brief,text);assert.equal(remote.topic_id,'');return {flow:w.id,body:remote.brief,version:remote.version};
  }finally{release();await page.unroute(pattern,handler)}
 });

 const socialCase=async(manualCover=false,wechat=false)=>{
  const tr=await topic('社交图文独立配图'),w=await flow(tr.title,tr),d=await draft(w,'社交图文',tr.title);let output=await seedOutput(w,d);
  const originalImages=(await api('/studio/assets')).items.filter(a=>a.flow_id===w.id),original=originalImages[0];assert(original);
  const uploadWith=async(auth,name)=>{const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(path.join(directory,'output.png'))],{type:'image/png'}),name);const r=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+auth},body:fd});assert(r.ok);const value=await r.json();return value.asset||value};
  const unscoped=await uploadWith(token,'社交首图.png'),archived=await uploadWith(token,'已归档.png');
  const foreignToken=(await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'另一隔离用户'})).token,foreign=await uploadWith(foreignToken,'他人图片.png');
  const otherFlow=await flow('另一作品',tr),otherImport=await api('/studio/flows/'+otherFlow.id+'/imports',{field:'cover_id',source_id:unscoped.id,version:otherFlow.version});
  const otherAsset=otherImport.asset;
  const ids=[foreign.id,'f'.repeat(32),archived.id,otherAsset.id,unscoped.id,original.id,unscoped.id];
  const imageRef=id=>'/api/studio/assets/'+id+'/file';
  const body=wechat?['纯文本链接 '+imageRef(unscoped.id),'`![行内代码]('+imageRef(unscoped.id)+')`','```md\n![围栏代码]('+imageRef(unscoped.id)+')\n```','![他人图片]('+imageRef(foreign.id)+')','![另一流程图片]('+imageRef(otherAsset.id)+')','![批量首图]('+imageRef(original.id)+')','![批量第二图]('+imageRef(unscoped.id)+')'].join('\n\n'):'朋友圈正文保持不变。';
  const program='import json,sys,os; from pathlib import Path; from backend import store as s; v=json.load(sys.stdin); assert Path(os.environ["TIJIAN_DATA"]).resolve()==Path(v["directory"]).resolve(); assert "article-editing-ui-flow-review-" in v["directory"]; c=s.get(v["owner"],v["content"]); a=s.get(v["owner"],v["archived"]); s.put(v["owner"],a["kind"],{**a,"archived":True},a["id"],a["version"]); c=s.put(v["owner"],"content",{**c,"format":v["format"],"author":"隔离测试作者","body":v["body"],"image_asset_ids":v["images"]},c["id"],c["version"]); print(json.dumps(c,ensure_ascii=False))';
  const seeded=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','-c',program],{cwd:root,env:{...process.env,TIJIAN_DATA:directory,PYTHONUTF8:'1'},windowsHide:true,encoding:'utf8',input:JSON.stringify({directory,owner,content:output.id,archived:archived.id,images:ids,body,format:wechat?'公众号文章':'朋友圈文案'})});assert.equal(seeded.status,0,seeded.stderr);output=JSON.parse(seeded.stdout);
  const current=await api('/studio/flow?work_id='+w.id);await api('/studio/flow',{...current,stage:3,content_id:output.id,cover_id:manualCover?original.id:''});
  await goto(flowRoute(w.id));await page.reload();await page.locator('.cf-asset-grid').waitFor();await page.getByRole('button',{name:'稍后再做',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.cf-data-loading'));
  const imports=[];const capture=async r=>{if(new URL(r.url()).pathname==='/api/studio/flows/'+w.id+'/imports'&&r.request().method()==='POST')imports.push(await r.json())};page.on('response',capture);
  await page.getByRole('button',{name:'确认，选择发布平台',exact:true}).click();await page.locator('.cf-deliverables').waitFor();await page.waitForLoadState('networkidle');page.off('response',capture);
  if(!wechat)await page.getByRole('tab',{name:/朋友圈/}).click();
  const pictureRows=page.locator('[data-content-id="'+output.id+'"] [data-image-asset-id]');
  const rendered=await pictureRows.evaluateAll(nodes=>nodes.filter(n=>n.querySelector('button[aria-label^="下载"]:not([disabled])')).map(n=>n.dataset.imageAssetId));assert.deepEqual(rendered,wechat?[original.id,unscoped.id]:[unscoped.id,original.id]);
  for(const ident of rendered){const target=page.locator('[data-content-id="'+output.id+'"] [data-image-asset-id="'+ident+'"]');await target.scrollIntoViewIfNeeded();const preview=target.locator('img');await preview.waitFor({state:'visible'});await preview.evaluate(image=>new Promise((resolve,reject)=>{if(image.complete&&image.naturalWidth>0)return resolve();image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true})}))}
  const savedFlow=await api('/studio/flow?work_id='+w.id),allAssets=(await api('/studio/assets')).items,savedCover=allAssets.find(a=>a.id===savedFlow.cover_id);
  assert(savedCover);assert.equal(savedCover.flow_id,w.id);assert.equal(imports.length,manualCover||wechat?0:1);assert.equal(manualCover||wechat?savedCover.id:savedCover.imported_from,manualCover||wechat?original.id:unscoped.id);
  const savedContent=(await api('/state/updates?ids='+output.id)).items.find(c=>c.id===output.id);assert.equal(savedContent.body,output.body);assert.deepEqual(savedContent.image_asset_ids,ids);assert.equal(savedContent.version,output.version);
  const imageDownload=page.waitForEvent('download').then(value=>({value}),error=>({error}));await pictureRows.locator('button[aria-label^="下载"]:not([disabled])').first().click();const imageResult=await imageDownload;assert(imageResult.value,imageResult.error?.message);const imageTarget=path.join(directory,'delivered-image-'+manualCover+'-'+wechat+'.png');await imageResult.value.saveAs(imageTarget);assert.deepEqual(fs.readFileSync(imageTarget),fs.readFileSync(path.join(directory,'output.png')),'Independent image download must preserve actual file bytes');
  if(wechat){
   // The adversarial body above intentionally references another owner. Prove that
   // export refuses it, then use a valid saved body for the independent export test.
   const denied=await fetch(backend+'/api/content/'+output.id+'/export?format=html',{headers:{Authorization:'Bearer '+token}});assert(!denied.ok);
   await api('/objects/'+output.id,{version:savedContent.version,body:'这是实际交付的正文。\n\n![首图]('+imageRef(original.id)+')\n\n![第二图]('+imageRef(unscoped.id)+')'},'PATCH');
   await page.reload();await page.locator('.cf-deliverables').waitFor();const reminder=page.getByRole('button',{name:'稍后再做',exact:true});if(await reminder.isVisible())await reminder.click();
   const exportResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/content/'+output.id+'/export');const downloaded=page.waitForEvent('download').then(value=>({value}),error=>({error}));await page.locator('.cf-deliverables').getByRole('button',{name:'下载文稿',exact:true}).click();const response=await exportResponse;assert.equal(response.status(),200);assert.equal(new URL(response.url()).searchParams.get('include_metadata'),'true');const downloadResult=await downloaded;assert(downloadResult.value,downloadResult.error?.message);const target=path.join(directory,'wechat-with-metadata.html');await downloadResult.value.saveAs(target);const html=fs.readFileSync(target,'utf8');assert(html.includes('<h1>'+output.title+'</h1>'),'Downloaded file missing title');assert(html.includes('作者：隔离测试作者'),'Downloaded file missing author');
   await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});const copyResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/content/'+output.id+'/export');await page.locator('.cf-deliverables').getByRole('button',{name:'复制图文',exact:true}).click();const copied=await copyResponse;assert.equal(new URL(copied.url()).searchParams.has('include_metadata'),false);assert.equal(copied.status(),200);await page.getByText('图文已复制，请粘贴后核对图片与排版。',{exact:true}).waitFor();const clipboard=await page.evaluate(async()=>{for(const item of await navigator.clipboard.read())if(item.types.includes('text/html'))return (await item.getType('text/html')).text();return ''});assert(clipboard.includes('这是实际交付的正文。'),'Clipboard missing actual body');assert(!clipboard.includes('作者：隔离测试作者'),'Clipboard incorrectly includes author');fs.writeFileSync(path.join(directory,'wechat-clipboard.html'),clipboard);
  }
  await page.screenshot({path:path.join(directory,'social-images-'+manualCover+'-'+wechat+'.png'),fullPage:true});
  return {manualCover,wechat,otherFlowExcluded:otherAsset.id,flow:w.id,content:output.id,rendered,foreignExcluded:foreign.id,archivedExcluded:archived.id,cover:savedCover.id,importedFrom:savedCover.imported_from,importCount:imports.length,contentUnchanged:true};
 };
 await step('social image references preserve order, reject foreign/missing/archived IDs and import first cover',()=>socialCase(false));
 await step('social default cover preserves an explicitly selected cover and leaves body/order untouched',()=>socialCase(true));
 await step('WeChat real inline images choose owned first cover; download metadata and copy-body stay separate',()=>socialCase(false,true));

 const visualCase=async(social)=>{
  const tr=await topic('选电梯前，先把使用场景想清楚');let w=await flow(tr.title,tr);
  if(social)w=await api('/studio/flow',{...w,creation_channel:'xiaohongshu'});
  const d=social?await api('/studio/flows/'+w.id+'/drafts',{tool:'text',title:tr.title,topic_id:tr.id,creation_channel:'xiaohongshu',input:{brief:tr.title,format:'小红书文案',target_words:1200},profile_id:'',source_ids:[]}):await draft(w,tr.title,tr.title);let output=await seedOutput(w,d);
  const images=[];
  for(let i=1;i<=3;i++){
   const fd=new FormData();fd.append('file',new Blob([fs.readFileSync('public/visuals/elevator-atrium-v1.png')],{type:'image/png'}),'电梯场景-'+i+'.png');
   const r=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});assert(r.ok);const raw=await r.json();images.push(raw.asset||raw);
  }
  const body=Array.from({length:16},(_,i)=>'## '+(i+1)+'、先看用途，再谈配置\n\n住宅、写字楼和医院，对电梯的需求并不一样。先明确谁来用、什么场景使用，再确认客流高峰、载重和后续维护，选型才有依据。\n\n'+(!social&&i<3?'![电梯场景](/api/studio/assets/'+images[i].id+'/file)\n\n':'')).join('\n');
  output=await api('/objects/'+output.id,{version:output.version,title:tr.title,author:'小沙说电梯',format:social?'小红书文案':'公众号文章',body,image_asset_ids:social?images.map(a=>a.id):[]},'PATCH');
  const currentDraft=(await api('/studio/flows/'+w.id+'/drafts')).items.find(row=>row.id===d.id);await api('/studio/flows/'+w.id+'/drafts/'+d.id,{version:currentDraft.version,input:{...currentDraft.input,format:output.format}},'PATCH');
  await goto('studio/text?draft='+d.id+'&mode=text&return='+encodeURIComponent(flowRoute(w.id)+'&step=2'));await page.reload();await page.locator('.cf-continuous').waitFor();const reminder=page.getByRole('button',{name:'稍后再做',exact:true});if(await reminder.isVisible())await reminder.click();await page.getByRole('button',{name:'内容编辑',exact:true}).click();await page.locator('.article-editor').waitFor();await page.getByRole('tab',{name:'编辑',exact:true}).click();
  assert.equal(await page.getByLabel('文稿标题',{exact:true}).inputValue(),tr.title);
  if(social){for(const card of await page.locator('.spp-grid>li').all()){await card.scrollIntoViewIfNeeded();await card.locator('img').waitFor();await card.locator('img').evaluate(img=>img.decode());}await page.waitForFunction(()=>document.querySelectorAll('.spp-preview img').length===3&&[...document.querySelectorAll('.spp-preview img')].every(i=>i.naturalWidth>0));}else{assert.equal(await page.getByLabel('文稿作者',{exact:true}).inputValue(),'小沙说电梯');assert.equal(await page.getByRole('button',{name:'一键配图 · 3张',exact:true}).count(),1);}
  const measures=[];
  for(const width of [1600,1100]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
   await page.locator('.article-metadata').evaluate(el=>el.scrollIntoView({block:'start'}));
   await page.screenshot({path:path.join(directory,(social?'xhs':'wechat')+'-app-'+width+'.png')});
   const editor=page.getByLabel('编辑生成文稿');await editor.scrollIntoViewIfNeeded();await editor.hover();
   const before=await page.locator('.md-format').boundingBox();await page.mouse.wheel(0,2200);await page.waitForTimeout(200);
   const measure=await page.evaluate(()=>{const t=document.querySelector('.article-editor textarea'),bar=document.querySelector('.article-editor .md-format'),r=bar.getBoundingClientRect(),c=document.querySelector('.cf-inline-editor');return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,contentWidth:c.clientWidth,contentScrollWidth:c.scrollWidth,textareaHeight:t.clientHeight,textareaScrollHeight:t.scrollHeight,textareaScrollTop:t.scrollTop,toolbarTop:r.top,toolbarBottom:r.bottom,toolbarVisible:r.top>=0&&r.bottom<=innerHeight,stylesheets:document.styleSheets.length}});
   await page.screenshot({path:path.join(directory,(social?'xhs':'wechat')+'-scroll-'+width+'.png')});
   assert(measure.pageWidth<=width+1,'App horizontal overflow '+JSON.stringify(measure));assert(measure.contentScrollWidth<=measure.contentWidth+1,'Editor horizontal overflow '+JSON.stringify(measure));assert(measure.textareaScrollTop>0,'Body did not scroll '+JSON.stringify(measure));assert(measure.toolbarVisible,'Toolbar not visible '+JSON.stringify(measure));assert(Math.abs(measure.toolbarTop-before.y)<2,'Toolbar moved while body scrolled');measures.push(measure);
  }
  return {mode:useDist?'dist':'source',flow:w.id,content:output.id,images:images.map(a=>a.id),imageOrigin:'three real uploads of existing project visual; isolated seeded completed content, no model call',measures};
 };
 await step('full App WeChat title author batch button and body scrolling at 1600/1100',()=>visualCase(false));
 await step('full App XHS three real images and body scrolling at 1600/1100',()=>visualCase(true));

}catch(e){process.exitCode=1;console.log(e.message);if(page)fs.writeFileSync(path.join(directory,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''));}
finally{await browser?.close();ui.closeAllConnections();await new Promise(r=>ui.close(r));service.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,hashes,dist:useDist?fs.readFileSync(path.join(directory,'dist','index.html'),'utf8'):null,errors,blocked,network,realBackend:true,apiMocks:0,paidCalls:0},null,2));fs.writeFileSync(path.join(directory,'backend.log'),log);console.log(JSON.stringify({directory,results:results.length}));}
