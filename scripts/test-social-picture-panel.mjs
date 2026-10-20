// Real panel, picker portal, thumbnails and download helper; isolated HTTP fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const directory=path.resolve('.runtime','social-picture-panel-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import SocialPicturePanel from './src/SocialPicturePanel';
const content={id:'social-draft',title:'社交配图测试',body:'必须完整保留的原正文。',format:'小红书文案'};
function Fixture(){const [ids,setIds]=useState(['b','missing','a']),[disabled,setDisabled]=useState(false),[owner,setOwner]=useState('owner-a');window.ids=ids;window.content=content;window.setDisabled=setDisabled;window.setOwner=setOwner;window.setIds=setIds;
return <form onSubmit={e=>{e.preventDefault();window.formSubmits++}}><SocialPicturePanel content={content} owner={owner} ids={ids} disabled={disabled} onChange={async next=>{if(window.rejectSave)throw Error('测试保存失败');window.changes.push(next);setIds(next)}}/></form>}
window.changes=[];window.formSubmits=0;createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundled=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js')});
const baseCSS=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'all.js'),external:['/visuals/*']});
const js=bundled.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=baseCSS.outputFiles.find(f=>f.path.endsWith('.css')).text+'\n'+bundled.outputFiles.find(f=>f.path.endsWith('.css')).text;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="#263b59"/><rect x="65" y="50" width="110" height="220" fill="#9abbff"/></svg>';
const asset=id=>({id,title:'测试图片'+id,asset_type:'image',status:'ready',mime_type:'image/svg+xml',width:240,height:320,file_url:'/api/studio/assets/'+id+'/file'});
let assets=['a','b','c'].map(asset),failLibrary=false;const requests=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8'});res.end(JSON.stringify(body))};
 if(url.pathname.startsWith('/api/')){let raw='';for await(const chunk of req)raw+=chunk;requests.push({path:url.pathname,method:req.method,body:raw?JSON.parse(raw):null});
  if(url.pathname==='/api/studio/assets')return json(failLibrary?{detail:'测试图片库读取失败'}:{items:[...assets,{id:'video-x',asset_type:'video',status:'ready'}]},failLibrary?503:200);
  if(url.pathname.endsWith('/file')){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end(svg)}
  if(url.pathname==='/api/studio/catalog')return json({tools:[{id:'text_image',binding:'fixture-image',models:[{id:'fixture-image',title:'隔离测试模型',configured:true,options:{}}]}]});
  if(url.pathname==='/api/studio/drafts')return json({id:'fixture-generation-draft',version:1});
  if(url.pathname==='/api/studio/generate')return json({id:'fixture-run',status:'running'});
  if(url.pathname==='/api/studio/runs/fixture-run/refresh'){assets=[...assets.filter(a=>a.id!=='generated'),asset('generated')];return json({id:'fixture-run',status:'succeeded',asset_ids:['generated']})}
  return json({detail:'Unexpected fixture request'},500);
 }
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(js)}
 if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');return res.end(css)}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:900px;margin:30px auto"><div id="root"></div></main><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
let browser;const results=[];
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1200,height:850},acceptDownloads:true});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,base);return route.continue()});
 await page.goto(base);
 const check=async(name,fn)=>{await fn();results.push({name,passed:true})};
 const ids=()=>page.evaluate(()=>window.ids);
 const select=async id=>{await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.locator('.ap-grid article').filter({has:page.getByText('测试图片'+id,{exact:true})}).getByRole('button',{name:/^(选择这张图片|已选中)$/}).click();await page.getByRole('button',{name:'添加到配图素材',exact:true}).click();await page.locator('.article-picture-workspace').waitFor({state:'detached'})};
 await check('loads image IDs in parent order and preserves missing slots',async()=>{await page.getByText('图片已缺失或暂不可用，引用已保留',{exact:true}).waitFor();assert.deepEqual(await page.locator('.spp-grid>li').evaluateAll(nodes=>nodes.map(n=>n.dataset.assetId)),['b','missing','a']);assert(await page.getByRole('button',{name:'图片 1 移前',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'图片 3 移后',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'下载图片 2',exact:true}).isDisabled());assert.equal(requests.filter(r=>r.method==='POST').length,0)});
 await check('move previous/next and remove retain remaining order',async()=>{await page.getByRole('button',{name:'图片 3 移前',exact:true}).click();assert.deepEqual(await ids(),['b','a','missing']);await page.getByRole('button',{name:'图片 1 移后',exact:true}).click();assert.deepEqual(await ids(),['a','b','missing']);await page.getByRole('button',{name:'移除图片 3',exact:true}).click();assert.deepEqual(await ids(),['a','b'])});
 await check('real picker adds asset ID only and duplicate selection is a no-op',async()=>{await select('c');assert.deepEqual(await ids(),['a','b','c']);const count=await page.evaluate(()=>window.changes.length);await select('c');assert.equal(await page.evaluate(()=>window.changes.length),count);assert.equal(await page.evaluate(()=>window.content.body),'必须完整保留的原正文。')});
 await check('single download uses the existing authenticated download helper',async()=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载图片 2',exact:true}).click();const file=await pending;assert.equal(file.suggestedFilename(),'测试图片b.svg');assert.equal(await file.failure(),null);assert(requests.some(r=>r.path==='/api/studio/assets/b/file'))});
 await check('disabled panel blocks edits and closes an open picker',async()=>{await page.getByRole('button',{name:'选择图片',exact:true}).click();await page.locator('.article-picture-workspace').waitFor();await page.evaluate(()=>window.setDisabled(true));await page.locator('.article-picture-workspace').waitFor({state:'detached'});for(const button of await page.locator('.social-picture-panel button').all())assert(await button.isDisabled());await page.evaluate(()=>window.setDisabled(false))});
 await check('opening generation never submits; explicit generate appends one ID, no body insertion',async()=>{await page.getByRole('button',{name:'生成配图',exact:true}).click();await page.getByLabel('配图提示词',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='POST').length,0);await page.getByLabel('配图提示词',{exact:true}).fill('隔离测试画面，不调用真实服务');await page.getByRole('button',{name:'生成新配图',exact:true}).click();await page.locator('.article-picture-workspace').waitFor({state:'detached'});assert.deepEqual(await ids(),['a','b','c','generated']);assert.equal(requests.filter(r=>r.path==='/api/studio/generate').length,1);assert.equal(await page.evaluate(()=>window.content.body),'必须完整保留的原正文。')});
 await check('failed parent save preserves IDs and reports the failure',async()=>{await page.evaluate(()=>window.rejectSave=true);await page.getByRole('button',{name:'移除图片 1',exact:true}).click();await page.getByText('测试保存失败',{exact:true}).waitFor();assert.deepEqual(await ids(),['a','b','c','generated']);await page.evaluate(()=>window.rejectSave=false)});
 await check('library read failure is retryable without clearing IDs',async()=>{failLibrary=true;await page.evaluate(()=>window.setOwner('owner-b'));await page.getByRole('button',{name:'重新读取图片',exact:true}).waitFor();assert.deepEqual(await ids(),['a','b','c','generated']);failLibrary=false;await page.getByRole('button',{name:'重新读取图片',exact:true}).click();await page.locator('.spp-grid').getByText('测试图片generated',{exact:true}).waitFor()});
 await check('narrow layout fits and buttons do not submit parent forms',async()=>{await page.setViewportSize({width:390,height:850});assert(await page.locator('.social-picture-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.locator('.spp-preview img').first().waitFor();assert(await page.locator('.spp-preview img').first().evaluate(e=>e.getBoundingClientRect().height<=e.parentElement.getBoundingClientRect().height+1));assert.equal(await page.evaluate(()=>window.formSubmits),0);assert.deepEqual(errors,[]);assert(!requests.some(r=>r.path.includes('/content/')));await page.screenshot({path:path.join(directory,'panel-mobile.png'),fullPage:true})});
 console.log(JSON.stringify({passed:results.length,directory,live_provider_calls:0}));
}catch(error){results.push({passed:false,error:String(error)});throw error}
finally{fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,requests},null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}
