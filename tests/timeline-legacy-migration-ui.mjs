// Real local video and save/render API with isolated SQLite; never uses paid services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright-core';

const root=process.cwd(),dist=path.resolve('dist'),python=path.resolve('.runtime/venv/Scripts/python.exe');
const directory=path.resolve('.runtime','article-editing-ui-timeline-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
const service=spawn(python,['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';service.stderr.on('data',x=>logs+=x);service.stdout.on('data',x=>logs+=x);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.statusCode=502;res.end()});req.pipe(upstream);return}try{const name=u.pathname.startsWith('/assets/')||u.pathname.startsWith('/visuals/')?decodeURIComponent(u.pathname.slice(1)):'index.html';const file=path.resolve(dist,name);assert(file.startsWith(dist+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ui.address().port,backend='http://127.0.0.1:'+port;
let token='',browser,page;const outside=[],errors=[],result={directory,paidCalls:0,productionDataTouched:false};
const api=async(url,data)=>{const r=await fetch(backend+'/api'+url,{method:data?'POST':'GET',headers:{'Connection':'close','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});assert(r.ok,url+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
try{
 for(let i=0;i<180;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}if(i===179)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
 const auth=await api('/auth/register',{email:'compose-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'隔离成片验收'});token=auth.token;
 const draft=await api('/studio/drafts',{tool:'compose',title:'隔离本地成片',input:{scenes:[]},options:{}});
 const seed=spawnSync(python,['-B','-X','utf8','tests/video_composition_ui_seed.py',auth.user.id,draft.id],{cwd:root,env,encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);const seeded=JSON.parse(seed.stdout.trim()),originalHash=createHash('sha256').update(fs.readFileSync(seeded.file)).digest('hex');

 await api('/studio/local-compose/projects',{draft_id:draft.id,title:'旧字幕项目',project:{scenes:[{asset_id:seeded.asset_id,trim:0,length:6,fit:'cover',volume:1}],b_roll:[],music:null,srt:'1\n00:00:00,000 --> 00:00:05,000\n原始字幕保留',aspect_ratio:'9:16',resolution:'720p',subtitle_style:{font:'Microsoft YaHei',size:'medium',color:'#ffffff',stroke_color:'#000000',stroke:2,position:'bottom',start_time:0,hide_during_intro:true},intro:{overlay_asset_id:'',overlay_duration:3},cover:{title:'旧片头'}}});
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 let firstRedFailure=false;await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base){outside.push(u.origin);return route.abort()}if(route.request().method()==='POST'&&/\/(generate|optimize|send|publish|sync)(\/|$)/.test(u.pathname)){result.paidCalls++;return route.abort()}return route.continue()});
 await page.addInitScript(t=>{sessionStorage.setItem('tijian-session',t);window.__gains=[];const original=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const gain=original.call(this);window.__gains.push(gain);return gain}},token);
 await page.goto(base+'/#studio/compose?draft='+draft.id);const remind=page.getByRole('button',{name:'稍后再做'});if(await remind.isVisible().catch(()=>false))await remind.click();await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();
 const startField=page.getByLabel('字幕开始时间（秒）');await startField.waitFor();assert.equal(Number(await startField.inputValue()),3,'旧项目转换后先保留原有可见效果');await page.getByRole('button',{name:'封面与片头',exact:true}).click();await page.getByLabel('片头显示时长').fill('1');assert.equal(Number(await startField.inputValue()),3,'修改片头不能改变已转换字幕起点');await page.getByRole('button',{name:'字幕',exact:true}).click();await startField.fill('0');assert.equal(Number(await startField.inputValue()),0);await page.waitForTimeout(1600);await page.reload();await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();await page.getByRole('button',{name:'字幕',exact:true}).click();assert.equal(Number(await page.getByLabel('字幕开始时间（秒）').inputValue()),0,'重新打开后字幕仍独立');result.migration=true;result.persisted=true;

 assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);assert.equal(result.paidCalls,0);Object.assign(result,{ok:true});
}catch(e){result.error=e.stack;await page?.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});result.body=await page?.locator('body').innerText().catch(()=>'');process.exitCode=1}
finally{result.outside=outside;result.errors=errors;fs.writeFileSync(path.join(directory,'subtitle-results.json'),JSON.stringify(result,null,2));await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();console.log(JSON.stringify(result))}
