// Real private PNG routes and export; generated output is seeded locally.
// No API interception, provider calls, app lifespan or production database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const red=process.argv.includes('--unauthenticated-baseline');
const directory=path.resolve('.runtime',`article-picture-auth-${red?'red':'green'}-${Date.now()}`);fs.mkdirSync(directory,{recursive:true});
const entry=`import {createRoot} from 'react-dom/client';import Markdown from './src/Markdown';import {setToken,getToken} from './src/api';import {batchResult,planPictures} from './src/article-picture-batch';
const root=createRoot(document.getElementById('root'));window.setFixtureToken=setToken;
window.runFixture=async()=>{const auth=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})}).then(r=>r.json());setToken(auth.token);
const data=await fetch('/fixture-data',{headers:{Authorization:'Bearer '+getToken()}}).then(r=>r.json());const base='Intro\\n\\nMiddle\\n\\nEnd';const batch={base,...planPictures(base,'auth')};batch.slots.forEach((s,i)=>{s.status='succeeded';s.asset_id=data.assets[i]});const text=batchResult(batch)+'\\n\\n![legacy](/api/illustrations/'+data.illustration+'/file)';
await fetch('/fixture-body',{method:'POST',headers:{Authorization:'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({body:text})});root.render(<Markdown text={text}/>);window.fixtureData=data;return data};
window.exportFixture=async()=>{const html=await fetch('/api/content/'+window.fixtureData.content+'/export?format=html',{headers:{Authorization:'Bearer '+getToken()}}).then(r=>r.text());const frame=document.createElement('iframe');frame.id='export';frame.srcdoc=html;document.body.appendChild(frame);return {images:(html.match(/data:image\\/png;base64,/g)||[]).length,privatePaths:html.includes('/api/studio/assets/')};};
window.probeFixture=async()=>{const a='/api/studio/assets/'+window.fixtureData.assets[0]+'/file',b='/api/studio/assets/'+window.fixtureData.assets[1]+'/file';const other=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'other',password:'fixture-other-password'})}).then(r=>r.json());return Promise.all([a,b].map(async url=>({anonymous:(await fetch(url)).status,owner:(await fetch(url,{headers:{Authorization:'Bearer '+getToken()}})).status,other:(await fetch(url,{headers:{Authorization:'Bearer '+other.token}})).status}))) };`;
const plugins=red?[{name:'unauthenticated-baseline',setup(b){b.onLoad({filter:/[\\/]Markdown\.tsx$/},({path:file})=>({contents:fs.readFileSync(file,'utf8').replace('dangerouslySetInnerHTML={{__html:html}}',`dangerouslySetInnerHTML={{__html:html.replaceAll('data-local-image="/api/studio/','src="/api/studio/')}}`),loader:'tsx',resolveDir:path.resolve('src')}))}}]:[];
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js'),plugins});
const javascript=bundle.outputFiles[0].text;
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const python=process.env.PICTURE_TEST_PYTHON||'python';
const child=spawn(python,['tests/article-picture-auth-fixture.py',directory,String(port)],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
// Serve the in-memory fixture just like the portal suite. API bytes are proxied
// unchanged from the real backend, including authentication and image files.
const front=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>');return}
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(javascript);return}
 const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);
});await new Promise(r=>front.listen(0,'127.0.0.1',r));
let browser;const results=[];const base='http://127.0.0.1:'+front.address().port;
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(e){results.push({name,ok:false,error:e.message})}console.log(JSON.stringify(results.at(-1)))};
try{
 let ready=false;for(let n=0;n<120;n++){try{if((await fetch('http://127.0.0.1:'+port)).ok){ready=true;break}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,250))}assert(ready,'isolated fixture failed: '+logs);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage();page.on('pageerror',e=>console.log('fixture page error: '+e.stack));page.on('requestfailed',r=>console.log('fixture request failed: '+r.url()+' '+r.failure()?.errorText));await page.goto(base);await page.waitForFunction(()=>typeof window.runFixture==='function',{},{timeout:5000});await page.evaluate(()=>window.runFixture());
 await test('真实32/64位私有素材：匿名401、拥有者200、其他账号404',async()=>{const proof=await page.evaluate(()=>window.probeFixture());assert.deepEqual(proof,[{anonymous:401,owner:200,other:404},{anonymous:401,owner:200,other:404}]);return proof});
 await test('batchResult→真实Markdown→鉴权PNG，三图及旧插图naturalWidth均大于0',async()=>{await page.waitForFunction(()=>document.querySelectorAll('.markdown img').length===4&&[...document.querySelectorAll('.markdown img')].every(img=>img.naturalWidth>0),{},{timeout:5000});const widths=await page.locator('.markdown img').evaluateAll(imgs=>imgs.map(img=>img.naturalWidth));await page.screenshot({path:path.join(directory,'preview.png')});return {widths}});
 await test('真实HTML导出包含四张PNG并可独立渲染',async()=>{const proof=await page.evaluate(()=>window.exportFixture());assert.equal(proof.images,4);assert.equal(proof.privatePaths,false);await page.waitForFunction(()=>{const doc=document.getElementById('export')?.contentDocument;return doc?.images.length===4&&[...doc.images].every(img=>img.naturalWidth>0)});return proof});
}finally{
 await browser?.close();await new Promise(r=>front.close(r));child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({realBackend:true,red,paidCalls:0,results},null,2));console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));if(results.some(r=>!r.ok))process.exitCode=1;
}
