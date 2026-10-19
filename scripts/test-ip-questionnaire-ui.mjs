// Actual components + disposable real backend/database. All model output is a fixture.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {measureContrast} from './test-studio-color-states.mjs';
const directory=path.resolve('.runtime','ip-questionnaire-ui-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const port=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=server.address().port;await new Promise(r=>server.close(r));return p};
const apiPort=await port(),uiPort=await port(),apiBase='http://127.0.0.1:'+apiPort,base='http://127.0.0.1:'+uiPort;
const entry=`import {useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import PersonalIP from './src/PersonalIP';import {api} from './src/api';import './src/style.css';import './src/studio.css';import './src/studio-theme.css';
function App(){const [state,setState]=useState(null);const refresh=async()=>setState(await api('/state'));useEffect(()=>{void refresh()},[]);if(!state)return <p>加载</p>;const t={state,refresh,list:kind=>state.objects.filter(x=>x.kind===kind)};return <div className="studio-v2" style={{padding:24}}><PersonalIP t={t} assets={[]}/></div>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,write:false,outfile:path.join(directory,'fixture.js'),define:{'process.env.NODE_ENV':'"development"'}});
const assets=new Map(bundle.outputFiles.map(f=>['/'+path.basename(f.path),f.contents]));
const ui=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){const upstream=http.request(apiBase+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);return}
 if(assets.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(assets.get(req.url));return}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<html class="ts-theme"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(r=>ui.listen(uiPort,'127.0.0.1',r));
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['tests/ip-questionnaire-fixture.py'],{env:{...process.env,TIJIAN_DATA:directory,IP_TEST_PORT:String(apiPort),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='',browser;service.stderr.on('data',x=>logs+=x);
const checks=[],errors=[],external=[];
try{
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(apiBase+'/api/health')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,150))}assert(ready,logs);
 const auth=await(await fetch(apiBase+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'ip-questionnaire@example.test',password:'isolated-fixture-strong-password',name:'隔离测试'})})).json();assert(auth.token);
 const read=async p=>(await fetch(apiBase+'/api'+p,{headers:{Authorization:'Bearer '+auth.token}})).json();
 const profiles=async()=>(await read('/state')).objects.filter(x=>x.kind==='profile');
 const initial=(await profiles()).length;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort()}return route.continue()});
 await page.addInitScript(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/#studio/brand?interview=1');const dialog=page.getByRole('dialog',{name:'AI 访谈建档'});await dialog.waitFor();checks.push('deep-link-opens-questionnaire');
 await page.getByRole('button',{name:'开始十二题定位',exact:true}).click();await page.getByText('第 1 / 12 题',{exact:true}).waitFor();assert.equal((await profiles()).length,initial);
 await page.getByLabel('访谈回答',{exact:true}).fill('本地别墅业主');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click();await page.getByText('第 2 / 12 题',{exact:true}).waitFor();
 await page.getByLabel('访谈回答',{exact:true}).fill('未发出的金额回答');await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();
 await page.getByRole('button',{name:/继续上次访谈/}).click();await page.getByText('第 2 / 12 题',{exact:true}).waitFor();assert.equal(await page.getByLabel('访谈回答',{exact:true}).inputValue(),'未发出的金额回答');checks.push('reload-resumes-index-and-unsent-answer');
 const interview=async()=>(await read('/studio/interviews')).items[0];const beforeCorrection=await interview();
 await page.getByLabel('访谈回答',{exact:true}).fill('纠正上一题：主要客户其实是物业公司');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click();
 await page.getByText(/这句话没有存入当前回答/).waitFor();assert.equal((await interview()).version,beforeCorrection.version);assert.equal((await interview()).question_index,1);checks.push('correction-language-guides-without-saving-or-advancing');
 await page.getByLabel('访谈回答',{exact:true}).fill('保留当前第二题未提交回答');
 await page.getByRole('button',{name:'修改第 1 题',exact:true}).click();await page.getByLabel('修正回答',{exact:true}).fill('物业公司负责人');
 await page.getByRole('button',{name:'保存本题修改',exact:true}).click();await page.getByLabel('访谈回答',{exact:true}).waitFor();
 assert.equal((await interview()).answers.customers,'物业公司负责人');assert.equal((await interview()).question_index,1);assert.equal(await page.getByLabel('访谈回答',{exact:true}).inputValue(),'保留当前第二题未提交回答');checks.push('explicit-question-edit-preserves-current-question-and-unsent-answer');
 for(let i=2;i<=12;i++){await page.getByRole('button',{name:'不知道，标为待确认',exact:true}).click();if(i<12)await page.getByText(`第 ${i+1} / 12 题`,{exact:true}).waitFor()}
 await page.getByRole('button',{name:'生成完整定位报告',exact:true}).waitFor();assert.equal((await profiles()).length,initial);assert.equal(await page.getByLabel('访谈回答',{exact:true}).count(),0);checks.push('unknown-advances-once-through-exactly-twelve');
 await page.getByRole('button',{name:'生成完整定位报告',exact:true}).click();await page.getByRole('button',{name:'确认应用并建立 IP',exact:true}).waitFor();
 const report=await page.getByLabel('完整定位策划报告',{exact:true}).inputValue();assert(report.includes('八、30 天冷启动表'));assert.equal((await profiles()).length,initial);checks.push('eight-section-report-not-applied-before-confirm');
 await page.getByRole('button',{name:'修改第 1 题',exact:true}).click();await page.getByLabel('修正回答',{exact:true}).fill('只服务物流园负责人');await page.getByRole('button',{name:'保存本题修改',exact:true}).click();
 await page.getByText('回答已修改，旧定位报告已失效，请重新生成。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'确认应用并建立 IP',exact:true}).count(),0);assert.equal((await interview()).question_index,12);checks.push('report-invalidated-after-correction-cannot-apply-old-report');
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.getByRole('button',{name:/继续上次访谈/}).click();await page.getByText('回答已修改，旧定位报告已失效，请重新生成。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'生成完整定位报告',exact:true}).click();await page.getByRole('button',{name:'确认应用并建立 IP',exact:true}).waitFor();checks.push('corrected-report-resumes-after-reload-and-regenerates');
 await page.getByRole('button',{name:'确认应用并建立 IP',exact:true}).click();await dialog.waitFor({state:'hidden'});const confirmed=(await profiles()).find(x=>x.title==='问卷测试定位');assert.equal(confirmed.status,'accepted');assert.equal(Object.keys(confirmed.questionnaire_answers).length,12);checks.push('confirm-persists-real-profile-and-completion-status');
 assert.equal(confirmed.questionnaire_answers.customers,'只服务物流园负责人');
 const topic=(await read('/state')).objects.find(x=>x.id===confirmed.positioning_topic_ids[0]);assert.equal(topic.profile_id,confirmed.id);assert.equal(topic.status,'idea');assert.equal(topic.title,'隔离测试建议选题');checks.push('confirmed-report-topics-linked-to-exact-profile');
 await page.getByRole('button',{name:'新增 IP',exact:true}).click();const manual=page.getByRole('dialog',{name:'十二题 IP 定位问卷',exact:true});await manual.waitFor();await page.getByLabel('我的 IP 名称',{exact:true}).fill('手工问卷测试');
 const questions=(await read('/studio/ip-questionnaire')).questions;for(let i=0;i<12;i++){assert(await manual.getByText(questions[i].reference,{exact:true}).isVisible());await page.getByLabel(`${i+1}. ${questions[i].label}`,{exact:true}).fill(i===11?'禁止公开客户地址':'不知道')}
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('草稿已保存；完成十二题并确认后，才算建立成功。',{exact:true}).waitFor();const draft=(await profiles()).find(x=>x.title==='手工问卷测试');assert.equal(draft.status,'draft');checks.push('manual-twelve-references-and-draft-not-completed');
 await page.getByRole('button',{name:'确认保存 IP',exact:true}).click();await manual.waitFor({state:'hidden'});assert.equal((await profiles()).filter(x=>x.title==='手工问卷测试').length,1);assert.equal((await profiles()).find(x=>x.id===draft.id).status,'accepted');checks.push('manual-confirm-updates-same-profile');
 await page.getByRole('button',{name:'编辑档案',exact:false}).last().click();await page.getByRole('dialog',{name:'编辑 IP 定位问卷',exact:true}).waitFor();await page.screenshot({path:path.join(directory,'manual-questions.png'),fullPage:true});checks.push('saved-profile-reopens-questionnaire');
 const contrast=await page.evaluate(measureContrast,{scope:'.ip-questionnaire-dialog'});fs.writeFileSync(path.join(directory,'contrast.json'),JSON.stringify(contrast,null,2));assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations));checks.push('questionnaire-text-and-controls-readable');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({passed:true,checks,errors,external,paid_model_calls:false,real_backend:true,database:directory},null,2));console.log(JSON.stringify({passed:true,checks,directory}));
}catch(error){fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({passed:false,checks,error:String(error.stack),errors,external},null,2));console.error(error);process.exitCode=1}
finally{await browser?.close();service.kill();await new Promise(r=>ui.close(r))}
