// Full App + real local backend and PNG uploads. Never submits generation.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const baseline=process.argv.includes('--baseline');
const directory=path.resolve('.runtime','video-frame-persistence-'+(baseline?'baseline-':'')+Date.now());fs.mkdirSync(directory,{recursive:true});
const plugins=baseline?[{name:'reproduce-dropped-frame-slots',setup(b){b.onLoad({filter:/[\\/]src[\\/]Studio\.tsx$/},a=>({contents:fs.readFileSync(a.path,'utf8').replace("'remote_references','draft_run','frame_slots'","'remote_references','draft_run'"),loader:'tsx',resolveDir:path.dirname(a.path)}))}}]:[];
const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),jsx:'automatic',external:['/visuals/*'],plugins});
for(const file of bundle.outputFiles)fs.writeFileSync(file.path,file.contents);
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const backend='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-B','-X','utf8','scripts/studio-ui-fixture.py'],{windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','ignore','pipe']});
let log='',token='',browser;service.stderr.on('data',chunk=>log+=chunk);
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname.startsWith('/api/')){const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(upstream);return}if(['/app.js','/app.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(directory,url.pathname.slice(1))));return}res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const api=async(p,data)=>{const r=await fetch(backend+'/api'+p,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(data?{body:JSON.stringify(data)}:{})});if(!r.ok)throw Error(p+' '+await r.text());return r.json()};
const results=[],network=[],errors=[],blocked=[];
try{
 for(let i=0;i<150;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 token=(await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'首尾角色持久化验收'})).token;
 await api('/workspace',{path:path.join(directory,'workspace')});
 await api('/objects/profile',{title:'持久化验收 IP',position:'隔离验收',status:'accepted'});
 const images=[];for(const name of ['首帧.png','尾帧.png']){const form=new FormData();form.append('file',new Blob([fs.readFileSync('public/visuals/elevator-atrium-v1.png')],{type:'image/png'}),name);const r=await fetch(backend+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});assert(r.ok);const value=await r.json();images.push(value.asset||value)}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(12000);
 await page.addInitScript(value=>sessionStorage.setItem('tijian-session',value),token);
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base||req.method()==='POST'&&/\/(generate|optimize|publish|sync|jobs)(\/|$)/.test(url.pathname)){blocked.push(url.pathname);return route.abort()}return route.continue()});
 page.on('request',req=>{if(/\/api\/studio\/drafts(?:\/|$)/.test(new URL(req.url()).pathname)&&req.method()!=='GET')network.push({method:req.method(),path:new URL(req.url()).pathname,body:req.postDataJSON()})});
 const frames=async(first,last)=>{await page.getByLabel('选择首帧素材',{exact:true}).waitFor();assert.equal(await page.getByLabel('选择首帧素材',{exact:true}).inputValue(),first);assert.equal(await page.getByLabel('选择尾帧素材',{exact:true}).inputValue(),last)};
 const saved=async(first,last)=>{let latest;for(let i=0;i<120;i++){latest=(await api('/studio/drafts')).items.find(d=>d.tool==='text_video');if(latest?.input?.frame_slots?.first_frame===first&&latest?.input?.frame_slots?.last_frame===last)return latest;await new Promise(r=>setTimeout(r,100))}throw Error('Server lost frame roles: '+JSON.stringify(latest?.input))};
 const clearAndReload=async()=>{await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('tijian-studio-v2:')&&key.includes(':video:'))localStorage.removeItem(key)});await page.reload()};
 await page.goto(base+'/#studio/video');await page.getByRole('button',{name:'首尾帧',exact:true}).click();await page.getByLabel('选择首帧素材',{exact:true}).selectOption(images[0].id);await page.getByLabel('选择尾帧素材',{exact:true}).selectOption(images[1].id);
 await saved('id:'+images[0].id,'id:'+images[1].id);assert(network.at(-1).body.input.frame_slots);results.push('actual save request and backend roundtrip retain frame_slots');
 await clearAndReload();await frames(images[0].id,images[1].id);results.push('roles restore from backend with local video caches removed');
 await page.getByRole('button',{name:'移除首帧图片',exact:true}).click();await frames('',images[1].id);await page.reload();await frames('',images[1].id);results.push('immediate reload before autosave retains empty first frame locally');
 await saved('','id:'+images[1].id);await clearAndReload();await frames('',images[1].id);results.push('empty first frame roundtrips and restores from backend');
 await page.getByLabel('选择首帧素材',{exact:true}).selectOption(images[0].id);await saved('id:'+images[0].id,'id:'+images[1].id);await page.getByRole('button',{name:'交换首帧与尾帧',exact:true}).click();await saved('id:'+images[1].id,'id:'+images[0].id);await clearAndReload();await frames(images[1].id,images[0].id);results.push('swapped roles restore independently of compact asset array order');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await page.screenshot({path:path.join(directory,'server-restored-frames.png')});
 console.log(JSON.stringify({directory,passed:results.length,paidCalls:0,apiMocks:0}));
}catch(error){process.exitCode=1;results.push({failed:String(error)});console.log(String(error))}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));service.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({baseline,results,network,errors,blocked,paidCalls:0,apiMocks:0},null,2));fs.writeFileSync(path.join(directory,'backend.log'),log)}
