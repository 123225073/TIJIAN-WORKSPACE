// Real components, isolated SQLite backend and uploaded PNGs. No API/image mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const root=process.cwd(),directory=path.resolve('.runtime','article-editing-ui-metadata-'+Date.now());
fs.mkdirSync(directory,{recursive:true});
const results=[],errors=[],network=[],blocked=[];
const files=['src/ArticleEditor.tsx','src/article-draft.tsx','src/SocialPicturePanel.tsx','backend/app.py'];
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const python=path.resolve('.runtime/venv/Scripts/python.exe');
const free=net.createServer();await new Promise(r=>free.listen(0,'127.0.0.1',r));const port=free.address().port;await new Promise(r=>free.close(r));
const backend='http://127.0.0.1:'+port;
let service,server,browser,token='',log='',ui='';
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';
import ArticleEditor from './src/ArticleEditor';import {api} from './src/api';
import './src/style.css';import './src/studio-theme.css';import './src/work-pages.css';
const id=new URLSearchParams(location.search).get('id');
function Harness({initial}){const [state,setState]=useState(initial);const refresh=async()=>setState(await api('/state'));
const asset=state.objects.find(x=>x.id===id);return <ArticleEditor asset={asset} t={{state,refresh}}/>;}
api('/state').then(state=>createRoot(document.getElementById('root')).render(<Harness initial={state}/>)).catch(e=>{document.body.textContent=e.message;throw e});`;
const api=async(p,data,method=data===undefined?'GET':'POST')=>{
 const r=await fetch(backend+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 assert(r.ok,p+' '+r.status+' '+(r.ok?'':await r.text()));return r.json();
};
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(e){results.push({name,ok:false,error:e.stack});process.exitCode=1}console.log(JSON.stringify(results.at(-1)))};
let owner;
const cacheKey=id=>'studio-content-edit:'+owner+':'+id;
const persisted=async id=>(await api('/state/updates?ids='+id)).items[0];
const open=async(row,cache)=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ui});
 await context.addInitScript(({token,key,cache})=>{
  if(window!==window.top)return;
  sessionStorage.setItem('tijian-session',token);
  // Old cache is seeded once; full reload must exercise the real persisted draft.
  if(cache&&!sessionStorage.getItem('metadata-cache-seeded')){localStorage.setItem(key,JSON.stringify(cache));sessionStorage.setItem('metadata-cache-seeded','1')}
 },{token,key:cacheKey(row.id),cache});
 await context.route('**/*',route=>{
  const q=route.request(),u=new URL(q.url());
  if(u.origin!==ui||(q.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(u.pathname))){blocked.push({method:q.method(),path:u.pathname});return route.abort()}
  return route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))network.push({method:r.request().method(),path:u.pathname+u.search,status:r.status(),type:r.headers()['content-type']||''})});
 await page.goto(ui+'/?id='+row.id);await page.getByLabel('文稿标题',{exact:true}).waitFor();
 return {page,context};
};
const edit=async page=>{await page.getByRole('tab',{name:'编辑',exact:true}).click();return page.getByLabel('编辑生成文稿')};
const save=async(page,id)=>{
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/objects/'+id&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'保存修改',exact:true}).click();const r=await response;assert(r.ok(),await r.text());
 await page.waitForFunction(()=>document.querySelector('.md-toolbar small')?.textContent.includes('已保存稿件 v'));
 return persisted(id);
};
const reloadClean=async(page,id)=>{await page.evaluate(key=>localStorage.removeItem(key),cacheKey(id));await page.reload();await page.getByLabel('文稿标题',{exact:true}).waitFor()};

try{
 const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},jsx:'automatic',bundle:true,write:false,outfile:path.join(directory,'fixture.js')});
 for(const f of bundle.outputFiles)fs.writeFileSync(f.path,f.contents);
 service=spawn(python,['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 service.stdout.on('data',c=>log+=c);service.stderr.on('data',c=>log+=c);
 server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://local');
  if(u.pathname.startsWith('/api/')){const p=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(p);return}
  if(['/fixture.js','/fixture.css'].includes(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(directory,u.pathname.slice(1))));return}
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh" class="ts-theme"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));ui='http://127.0.0.1:'+server.address().port;
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(backend+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,log);
 const auth=await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'文章元数据隔离测试'});token=auth.token;owner=auth.user.id;
 await api('/workspace',{path:path.join(directory,'workspace')});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});

 for(const legacy of ['values','body'])await test('旧 '+legacy+'-only cache 补齐服务器标题作者并保留本地正文',async()=>{
  const row=await api('/objects/content',{title:'服务器元数据标题',author:'服务器原作者',format:'公众号文章',body:'服务器正文'});
  const cache=legacy==='values'?{values:{body:'旧缓存的未保存正文'},baseline:{body:row.body},version:row.version}:{body:'旧缓存的未保存正文',baseline:row.body,version:row.version};
  const {page,context}=await open(row,cache);
  try{
   assert.equal(await page.getByLabel('文稿标题',{exact:true}).inputValue(),row.title);
   assert.equal(await page.getByLabel('文稿作者',{exact:true}).inputValue(),row.author);
   assert.equal(await (await edit(page)).inputValue(),'旧缓存的未保存正文');
   const saved=await save(page,row.id);assert.equal(saved.author,row.author);assert.equal(saved.title,row.title);assert.equal(saved.body,'旧缓存的未保存正文');
   await reloadClean(page,row.id);assert.equal(await page.getByLabel('文稿作者',{exact:true}).inputValue(),row.author);
   assert.equal(await (await edit(page)).inputValue(),saved.body);
   return {id:row.id,version:saved.version,author:saved.author,body:saved.body};
  }finally{await context.close()}
 });

 await test('作者显式清空：本地重载不回填，保存后移除缓存仍为空',async()=>{
  const row=await api('/objects/content',{title:'清空作者测试',author:'原有作者',format:'公众号文章',body:'正文保持不变'});
  const {page,context}=await open(row);
  try{
   await page.getByLabel('文稿作者',{exact:true}).fill('');await page.reload();await page.getByLabel('文稿作者',{exact:true}).waitFor();
   assert.equal(await page.getByLabel('文稿作者',{exact:true}).inputValue(),'');assert.equal((await persisted(row.id)).author,'原有作者');
   const saved=await save(page,row.id);assert.equal(saved.author,'');assert.equal(saved.body,row.body);
   await reloadClean(page,row.id);assert.equal(await page.getByLabel('文稿作者',{exact:true}).inputValue(),'');
   return {id:row.id,version:saved.version,author:saved.author,bodyUnchanged:true};
  }finally{await context.close()}
 });

 await test('未保存标题作者进入真实下载，复制仅最新正文且无元数据',async()=>{
  const row=await api('/objects/content',{title:'旧标题',author:'旧作者',format:'公众号文章',body:'正文初稿'});
  const {page,context}=await open(row);
  try{
   const title='独立标题META-731',author='独立作者META-842',body='下载使用这段最新正文。';
   await page.getByLabel('文稿标题',{exact:true}).fill(title);await page.getByLabel('文稿作者',{exact:true}).fill(author);await (await edit(page)).fill(body);
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出图文 HTML',exact:true}).click();
   const download=await pending;assert.equal(download.suggestedFilename(),title+'.html');const file=path.join(directory,'metadata-export.html');await download.saveAs(file);
   const html=fs.readFileSync(file,'utf8');assert(html.includes('<h1>'+title+'</h1>')&&html.includes(author)&&html.includes(body));
   assert.equal((html.match(new RegExp(title,'g'))||[]).length,1);
   const saved=await persisted(row.id);assert.equal(saved.title,title);assert.equal(saved.author,author);assert.equal(saved.body,body);
   const latest='复制使用此刻未保存的正文，不能复制旧版本。';await (await edit(page)).fill(latest);
   await page.getByRole('button',{name:'复制公众号图文',exact:true}).click();await page.getByRole('status').filter({hasText:'已复制图文'}).waitFor();
   const clipboard=await page.evaluate(async()=>{const entries=await navigator.clipboard.read();const result={};for(const item of entries)for(const type of item.types)result[type]=await (await item.getType(type)).text();return result});
   assert(clipboard['text/html'].includes(latest));assert.equal(clipboard['text/plain'],latest);
   for(const value of Object.values(clipboard)){assert(!value.includes(title));assert(!value.includes(author))}
   assert.equal((await persisted(row.id)).body,latest);
   const exports=network.filter(x=>x.path.startsWith('/api/content/'+row.id+'/export'));
   assert(exports.some(x=>x.path.includes('include_metadata=true')&&x.status===200));
   assert(exports.some(x=>!x.path.includes('include_metadata')&&x.status===200));
   fs.writeFileSync(path.join(directory,'clipboard.json'),JSON.stringify(clipboard,null,2));
   return {id:row.id,download:download.suggestedFilename(),exportRequests:exports,clipboardTypes:Object.keys(clipboard),latestBodySaved:true};
  }finally{await context.close()}
 });

 const assets=[];
 for(const [index,color] of ['red','green','blue'].entries()){
  const file=path.join(directory,'real-image-'+index+'.png');
  const made=spawnSync(python,['-B','-c',"from PIL import Image; import sys; Image.new('RGB',(96,64),sys.argv[2]).save(sys.argv[1])",file,color],{windowsHide:true});assert.equal(made.status,0,String(made.stderr));
  const bytes=fs.readFileSync(file),form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'真实配图-'+index+'.png');
  const response=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(response.ok,await response.clone().text());
  const upload=await response.json(),asset=upload.asset||upload;assert(asset.id);
  const returned=await fetch(backend+'/api/studio/assets/'+asset.id+'/file',{headers:{Authorization:'Bearer '+token}});assert(returned.ok);
  assert.deepEqual(Buffer.from(await returned.arrayBuffer()),bytes);assets.push(asset);
 }
 for(const format of ['小红书文案','朋友圈文案'])await test(format+' 配图排序保存恢复，正文不变且真实图片加载',async()=>{
  const ids=assets.map(a=>a.id),body='这段社交正文没有图片标记，也不能因排序改变。\n\n#电梯知识';
  const row=await api('/objects/content',{title:'独立社交标题',format,body,image_asset_ids:ids});
  const networkStart=network.length;
  const {page,context}=await open(row);
  const order=()=>page.locator('.spp-grid>li').evaluateAll(rows=>rows.map(row=>row.dataset.assetId));
  const loaded=()=>page.waitForFunction(()=>{const images=[...document.querySelectorAll('.spp-grid img')];return images.length===3&&images.every(img=>img.complete&&img.naturalWidth===96&&img.naturalHeight===64)});
  try{
   await loaded();assert.deepEqual(await order(),ids);
   await page.getByRole('button',{name:'图片 3 移前',exact:true}).click();await page.getByRole('button',{name:'图片 1 移后',exact:true}).click();
   const expected=[ids[2],ids[0],ids[1]];assert.deepEqual(await order(),expected);
   assert.equal(await (await edit(page)).inputValue(),body);
   const saved=await save(page,row.id);assert.deepEqual(saved.image_asset_ids,expected);assert.equal(saved.body,body);
   await reloadClean(page,row.id);await loaded();assert.deepEqual(await order(),expected);assert.equal(await (await edit(page)).inputValue(),body);
   const images=await page.locator('.spp-grid img').evaluateAll(rows=>rows.map(img=>({width:img.naturalWidth,height:img.naturalHeight})));
   const fileRequests=network.slice(networkStart).filter(x=>ids.some(id=>x.path==='/api/studio/assets/'+id+'/thumbnail')&&x.status===200&&x.type.startsWith('image/'));
   assert(ids.every(id=>fileRequests.some(x=>x.path.includes(id))));
   await page.screenshot({path:path.join(directory,format==='小红书文案'?'social-xhs.png':'social-moments.png'),fullPage:true});
   return {id:row.id,version:saved.version,before:ids,after:saved.image_asset_ids,bodyUnchanged:true,images,realImageRequests:fileRequests.length};
  }finally{await context.close()}
 });
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(blocked.length,0,JSON.stringify(blocked));
}catch(e){process.exitCode=1;errors.push(e.stack);console.error(e.message)}
finally{
 await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}service?.kill();
 fs.writeFileSync(path.join(directory,'backend.log'),log);
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,errors,blocked,network,hashes,realBackend:true,apiMocks:0,imageMocks:0,paidCalls:0,productionBuild:false},null,2));
 console.log(JSON.stringify({directory,passed:results.filter(x=>x.ok).length,total:results.length,errors:errors.length}));
}
