// Actual React components, isolated HTTP fixtures only; no provider or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const directory=path.resolve('.runtime','feedback-editors-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const owner='feedback-owner',id='feedback-content',key='social-picture-batch:'+owner+':'+id;
const body=Array.from({length:60},(_,i)=>`## 第 ${i+1} 个行业知识点\n\n电梯行业图文验收。选型与维保应根据实际需求和服务条件。第 ${i+1} 段的知识只用于隔离测试。`).join('\n\n');
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import ArticleEditor from './src/ArticleEditor';import WechatArticleForm from './src/WechatArticleForm';import ImageLightbox from './src/ImageLightbox';import {setToken} from './src/api';setToken('isolated-token');
function Harness(){const [row,setRow]=useState(window.fixture);window.setRow=setRow;return <><main className="shell">{row.form?<WechatArticleForm draft={row} assets={[]} busy={false} generating={false} onChange={(k,v)=>setRow(r=>({...r,[k]:v}))} onSave={()=>{}} onDownload={()=>{}} onOptimize={()=>{}} onCreateCover={()=>{}} onAssetsChanged={async()=>{}} worksHref="studio/assets"/>:<ArticleEditor key={row.format} asset={row} t={{state:{user:{id:'${owner}'}},refresh:async()=>{}}}/>}</main><ImageLightbox/></>};createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js')});
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),external:['/visuals/*']});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,results=[],errors=[],unexpected=[];let browser;
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(e){results.push({name,ok:false,error:e.stack})}console.log(JSON.stringify(results.at(-1)))};
const open=async(options={})=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 const f={row:{id,kind:'content',format:'小红书文案',title:'现场维保知识',body,version:1,image_asset_ids:[],...options},drafts:[],runs:[],assets:[],requests:[],running:false,failedAt:-1,...options};
 await context.addInitScript(row=>{window.fixture=row},f.row);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base){unexpected.push(req.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();const p=url.pathname.slice(4),method=req.method(),data=req.postData()?req.postDataJSON():undefined;f.requests.push({p,method,data});const json=(obj,status=200)=>route.fulfill({json:obj,status});
  if(p==='/studio/catalog')return json({tools:[{id:'text_image',binding:'fixture-image',enabled:true,models:[{id:'fixture-image',title:'本地模型夹具',configured:true,options:{size:f.sizes||['1024x1024','768x1024','1024x768']}}]}]});
  if(p==='/studio/assets')return json({items:f.assets});
  if(p==='/studio/text/article-illustration-prompt'){const job={id:'job-'+f.requests.length,status:'done',result:{suggested_prompt:'围绕完整文章与当前段落制作简洁知识配图。'+data.idea}};return json(job)}
  if(p==='/auth/me')return json({user:{id:owner}});
  if(p.startsWith('/state/updates'))return json({items:[f.row]});
  if(p==='/objects/'+id&&method==='PATCH'){f.row={...f.row,...data,version:f.row.version+1};return json(f.row)}
  if(p==='/wechat-publish/preview')return json({html:data.body.split('\n\n').map(x=>'<p>'+x+'</p>').join('')});
  if(p==='/studio/drafts'){
   if(method==='GET')return json({items:f.drafts});
   if(Array.from(data.input.prompt).length>1500)return json({detail:'prompt超出后端1500字符限制'},400);const draft={...data,id:'draft-'+f.drafts.length,version:1};f.drafts.push(draft);if(f.loseDraftOnce){f.loseDraftOnce=false;return json({detail:'模拟响应丢失'},503)}return json(draft);
  }
  if(p==='/studio/generate'){
   const existing=f.runs.find(r=>r.request_id===data.request_id);if(existing)return json({run:existing});
   const index=f.runs.length,asset={id:String(index+1).repeat(32),asset_type:'image',status:'ready',title:'配图'+(index+1),file_url:'/api/studio/assets/'+String(index+1).repeat(32)+'/file'};
   f.assets.push(asset);const run={...data,id:'run-'+index,status:f.runStatus|| (f.running?'running':f.failedAt===index?'failed':'succeeded'),asset_ids:[asset.id],error:f.failedAt===index?'模拟明确失败':''};f.runs.push(run);
   if(f.loseGenerateOnce){f.loseGenerateOnce=false;return json({detail:'模拟响应丢失'},503)}return json({run});
  }
  if(p==='/studio/runs')return json({items:f.runs});
  if(/^\/studio\/runs\/[^/]+\/refresh$/.test(p)){if(f.holdRefresh){f.refreshHeld=true;await new Promise(resolve=>{f.releaseRefresh=resolve});f.refreshHeld=false}if(f.failRefresh)return json({detail:'模拟进度查询失败'},503);const run=f.runs.find(r=>r.id===p.split('/')[3]);if(!f.running&&run.status==='running')run.status='succeeded';return json({run})}
  if(/^\/studio\/assets\/[^/]+\/file$/.test(p))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#223b59"/></svg>'});
  unexpected.push(method+' '+p);return route.abort();
 });await page.goto(base);return {page,context,f};
};
const progress=async(page,selector)=>{await page.waitForFunction(({key,selector})=>{const b=JSON.parse(localStorage.getItem(key)||'null');return b&&Function('b','return '+selector)(b)},{key,selector})};
const oneClick=async page=>{await page.getByRole('button',{name:'一键配图',exact:true}).click();await page.getByRole('button',{name:'按当前文案生成 4 张图片',exact:true}).click()};
const scrollPair=async(page,first,second)=>{
 const sync=async(source,target,ratio)=>{await page.locator(source).evaluate((el,r)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*r},ratio);await page.waitForTimeout(100);const values=await page.evaluate(({a,b})=>{const x=document.querySelector(a),y=document.querySelector(b);return [x.scrollTop/(x.scrollHeight-x.clientHeight),y.scrollTop/(y.scrollHeight-y.clientHeight)]},{a:source,b:target});assert(Math.abs(values[0]-values[1])<.02,JSON.stringify(values));};await sync(first,second,.58);await sync(second,first,.85);
};
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const format of ['公众号文章','小红书文案','朋友圈文案','短视频脚本'])await test(format+' 默认双栏与双向滚动',async()=>{const {page,context}=await open({format});assert.equal(await page.getByRole('tab',{name:'双栏',exact:true}).getAttribute('aria-selected'),'true');await scrollPair(page,'.md-body textarea','.md-rendered');await context.close()});
 await test('公众号发布编辑器与实际 iframe 预览双向同步，修改后保持中段位置',async()=>{
  const {page,context}=await open({form:true});await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.body?.textContent.includes('第 60'));
  const source=page.locator('.article-rich-editor');await source.evaluate(el=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*.55});await page.waitForTimeout(150);
  const ratio=()=>page.evaluate(()=>{const x=document.querySelector('.article-rich-editor'),y=document.querySelector('iframe').contentDocument.scrollingElement;return [x.scrollTop/(x.scrollHeight-x.clientHeight),y.scrollTop/(y.scrollHeight-y.clientHeight)]});let r=await ratio();assert(Math.abs(r[0]-r[1])<.02,JSON.stringify(r));
  await page.evaluate(()=>{const el=document.querySelector('iframe').contentDocument.scrollingElement;el.scrollTop=(el.scrollHeight-el.clientHeight)*.75});await page.waitForTimeout(150);r=await ratio();assert(Math.abs(r[0]-r[1])<.02,JSON.stringify(r));
  await page.evaluate(()=>window.setRow(r=>({...r,body:r.body+'\n\n新内容'})));await page.waitForTimeout(850);r=await ratio();assert(r[0]>.7&&Math.abs(r[0]-r[1])<.02,JSON.stringify(r));await context.close();return {ratios:r};
 });
 await test('自定义配图入口清楚标明独立保存，支持手输画面与模型参数',async()=>{const {page,context}=await open();await page.getByRole('button',{name:'生成配图',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'制作独立配图'}).count(),1);assert.equal(await page.getByLabel('配图插入位置').count(),0);assert((await page.locator('.ap-context').textContent()).includes('第 1 个行业知识点'));await page.getByLabel('配图提示词').fill('画一张电梯工人检查设备的知识配图');await page.getByLabel('配图画面想法').fill('工人在检查电梯');await page.getByLabel('画面比例',{exact:true}).selectOption('3:4');await context.close()});
 await test('一键默认参数、4 次真实协议、独立保存、图片放大及滚轮缩放',async()=>{
  const {page,context,f}=await open();await page.getByRole('button',{name:'一键配图',exact:true}).click();assert.equal(await page.getByLabel('一键配图尺寸').inputValue(),'3:4');assert.equal(await page.getByLabel('一键配图数量').inputValue(),'4');assert.equal(await page.getByLabel('一键配图风格').inputValue(),'cards');await page.getByRole('button',{name:'按当前文案生成 4 张图片'}).click();await progress(page,'b.attached.length===4');assert.equal(f.runs.length,4);assert(f.drafts.every(d=>d.options.size==='768x1024'&&Array.from(d.input.prompt).length<=1200));assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),body);assert(f.requests.filter(r=>r.p==='/studio/text/article-illustration-prompt').every(r=>r.data.body===body));
  const image=page.locator('.picture-batch-preview img').first();await image.waitFor();await image.click();await page.locator('.image-lightbox[open]').waitFor();const stage=page.locator('.image-lightbox-stage');await stage.hover();await page.mouse.wheel(0,-100);await page.waitForTimeout(100);assert.notEqual(await page.locator('.image-lightbox output').textContent(),'100%');await page.locator('.image-lightbox header button').last().click();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();assert.equal(await page.locator('.spp-grid>li').count(),4);await context.close();return {requests:4,independent:true,zoom:true};
 });
 await test('丢失草稿与生成响应后恢复原任务，重启不重复生成',async()=>{const {page,context,f}=await open({loseDraftOnce:true,loseGenerateOnce:true});await oneClick(page);await progress(page,'b.attached.length===4');assert.equal(f.drafts.length,4);assert.equal(f.runs.length,4);await page.reload();await page.waitForTimeout(2300);assert.equal(f.drafts.length,4);assert.equal(f.runs.length,4);await context.close()});
 for(const runStatus of ['cancelled','expired'])await test(runStatus+' 为失败终态，不自动重试且可重新配置',async()=>{const {page,context,f}=await open({runStatus});await oneClick(page);await progress(page,"b.slots.every(s=>s.status==='failed')");assert.equal(f.runs.length,4);await page.getByRole('button',{name:'再制作一组'}).click();await page.getByLabel('一键配图数量').waitFor();assert.equal(f.runs.length,4);await context.close()});

 await test('不支持所选3:4时显示实际1:1、1024尺寸与调整说明',async()=>{const {page,context,f}=await open({sizes:['1024x1024']});await oneClick(page);await progress(page,'b.attached.length===4');assert((await page.locator('.picture-batch-body').textContent()).includes('提交比例 1:1 · 1024 × 1024'));assert((await page.locator('.parameter-adjustment').textContent()).includes('比例 3:4 → 1:1'));assert(f.drafts.every(d=>d.options.size==='1024x1024'));await context.close()});
 for(const article of [false,true])await test((article?'公众号三图':'社交配图')+'手动刷新忙与查询失败不显示刷新成功',async()=>{
  const {page,context,f}=await open({format:article?'公众号文章':'小红书文案',running:true});
  if(article){await page.getByRole('button',{name:'一键配图 · 3张',exact:true}).click();await page.getByRole('button',{name:'使用所选风格，生成 3 张配图',exact:true}).click();await page.waitForFunction(key=>{const b=JSON.parse(localStorage.getItem(key)||'null');return b?.slots.length===3&&b.slots.every(s=>s.status==='running')},'article-picture-batch:'+owner+':'+id)}else{await oneClick(page);await progress(page,"b.slots.every(s=>s.status==='running')")}
  f.holdRefresh=true;const end=Date.now()+6000;while(!f.refreshHeld&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert(f.refreshHeld);
  await page.getByRole('button',{name:'刷新生成进度',exact:true}).click();assert((await page.locator('.picture-batch-body [role=status]').allTextContents()).some(t=>t.includes('正在更新生成进度')));assert(!(await page.locator('.picture-batch-body').textContent()).includes('已刷新'));
  f.failRefresh=true;f.holdRefresh=false;f.releaseRefresh();await page.locator('.picture-batch-body [role=alert]').filter({hasText:'模拟进度查询失败'}).waitFor();await page.getByRole('button',{name:'刷新生成进度',exact:true}).click();await page.waitForTimeout(150);assert(!(await page.locator('.picture-batch-body').textContent()).includes('已刷新'));assert((await page.locator('.picture-batch-body [role=alert]').allTextContents()).some(t=>t.includes('模拟进度查询失败')));await context.close();
 });
 await test('关闭重开仍使用原请求，仅重试失败图片',async()=>{const {page,context,f}=await open({running:true,failedAt:1});await oneClick(page);await progress(page,"b.slots.every(s=>s.status==='running')");const requests=f.runs.map(r=>r.request_id);await page.reload();f.running=false;await progress(page,'b.attached.length===4');assert.equal(f.runs.length,4);assert.deepEqual(f.runs.map(r=>r.request_id),requests);await context.close();const second=await open({failedAt:1});await oneClick(second.page);await progress(second.page,"b.slots.filter(s=>s.status==='failed').length===1&&b.attached.length===3");await second.page.getByRole('button',{name:'仅重试失败图片 · 按用量计费'}).click();await progress(second.page,'b.attached.length===4');assert.equal(second.f.runs.length,5);assert.equal(second.f.drafts.length,5);await second.context.close()});
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({offline:true,paidCalls:0,results,errors,unexpected},null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,errors,unexpected}));if(results.some(r=>!r.ok)||errors.length||unexpected.length)process.exitCode=1}
