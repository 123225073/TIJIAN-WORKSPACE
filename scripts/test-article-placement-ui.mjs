// Isolated DOM acceptance: no external service calls or real account data.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {build} from 'esbuild';import {chromium} from 'playwright-core';
const dir=path.resolve('.runtime/article-placement-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const id='a'.repeat(32),source='开篇段落。\n\n中间段落。\n\n结尾段落。';
const entry=`import {useState} from 'react';import {createRoot} from 'react-dom/client';import Editor from './src/ArticleRichEditor';import {defaultImagePlacements,applyImagePlacements,articleImageAnchors} from './src/article-image-placement';import {setToken} from './src/api';setToken('fixture');window.applyImagePlacements=applyImagePlacements;window.articleImageAnchors=articleImageAnchors;const source=${JSON.stringify(source)};function App(){const [body,setBody]=useState(applyImagePlacements(source,['${id}'],defaultImagePlacements(source,['${id}']))),[read,setRead]=useState(false);window.body=body;return <><button onClick={()=>setRead(!read)}>切换预览</button><Editor value={body} onChange={setBody} readOnly={read} onDropAsset={()=>{}} onDropFiles={()=>{}} fontSize='16' lineHeight='1.8' paragraphGap='18' accent='forest'/></>}createRoot(document.getElementById('root')).render(<App/>);`;
const out=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:'fixture.js'});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV7sAAAAASUVORK5CYII=','base64');
const server=http.createServer((req,res)=>{if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(out.outputFiles.find(f=>f.path.endsWith('.js')).contents)}else if(req.url.endsWith('.css')){res.setHeader('Content-Type','text/css');res.end(out.outputFiles.find(f=>f.path.endsWith('.css')).contents)}else if(req.url.startsWith('/api/studio/assets/')){res.setHeader('Content-Type','image/png');res.end(png)}else res.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());await page.goto(base);
 await page.locator('.wa-image-chip img').waitFor();const chip=page.locator('.wa-image-chip');
 assert(!(await chip.textContent()).includes(id));await chip.hover();
 await chip.getByRole('button',{name:'上移一段',exact:true}).click();assert((await page.evaluate(()=>window.body)).indexOf('![')<(await page.evaluate(()=>window.body)).indexOf('中间段落'));
 assert(!(await page.evaluate(()=>window.body)).includes('上移一段'));
 await chip.hover();await chip.getByRole('button',{name:'下移一段',exact:true}).click();
 assert((await page.evaluate(()=>window.body)).includes(source.split('\n\n')[1]));
 await page.getByRole('button',{name:'切换预览'}).click();assert.equal(await chip.getByRole('button',{name:'移除图片',exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'切换预览'}).click();await chip.hover();await chip.getByRole('button',{name:'移除图片',exact:true}).click();assert(!(await page.evaluate(()=>window.body)).includes('!['));
 const checks=await page.evaluate(()=>{const body='## 标题\n\n📌真实段落\n\n```\n不能插在代码里\n```\n\n<!--内部数据-->\n\n结尾';const anchors=window.articleImageAnchors(body);return anchors});assert.equal(checks.length,2);assert(checks.every(a=>!a.text.includes('代码')&&!a.text.includes('内部数据')));
 await assert.rejects(()=>page.evaluate(()=>window.applyImagePlacements('正文',['a'.repeat(32)],[{asset_id:'a'.repeat(32),after:'p999'}])));
 const crlf=await page.evaluate(()=>{const original='第一段。\r\n\r\n中间段。\r\n\r\n结尾段。';const anchors=window.articleImageAnchors(original);const result=window.applyImagePlacements(original,['a'.repeat(32)],[{asset_id:'a'.repeat(32),after:anchors[1].id}]);return {result,original}});assert(crlf.result.includes('第一段。\r\n\r\n中间段。'));assert(crlf.result.includes('结尾段。'));
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(dir,'editor.png')});fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,privateImage:true,noCaption:true,moveAndRemove:true,readOnlyControlsHidden:true,codeExcluded:true,invalidPlanRejected:true}));console.log(JSON.stringify({passed:true,dir}));
}finally{await browser?.close();server.close()}
