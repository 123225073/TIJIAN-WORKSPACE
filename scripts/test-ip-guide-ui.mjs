// Complete App + real disposable SQLite/API/jobs. Model responses below are explicit
// test fixtures, never live-model evidence. No existing fixture or user data is used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const integrated=process.argv.includes('--dist');
const directory=path.resolve('.runtime','ip-guide-ui-'+Date.now()+'-'+randomUUID().slice(0,8));
fs.mkdirSync(directory,{recursive:true});
const python=path.resolve('.runtime/venv/Scripts/python.exe');
const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p};
const apiPort=await freePort(),apiBase='http://127.0.0.1:'+apiPort;
const fixtureSource=String.raw`
import os,json,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()))
from backend import store as s,gateway as g,ip_questionnaire as ipq
assert s.DATA.is_relative_to(Path('.runtime').resolve()) and s.DATA.name.startswith('ip-guide-ui-')
s.init()
mid='isolated-ip-guide-fixture'
s.set_config('providers',[{'id':'ip-guide-fixture','title':'离线 IP 测试模型（fixture）','base_url':'https://fixture.invalid','protocol':'chat','published':True}])
s.set_config('models',[{'id':mid,'provider':'ip-guide-fixture','model':'offline-fixture','title':'IP 引导离线测试 fixture','capability':'text','published':True,'verified':True}])
s.set_config('bindings',{k:mid for k in ['profile','writing','daily','agent','qa','knowledge','summary']})
def generate(model,messages,*a,**kw):
    assert model==mid, 'Only the explicit offline fixture model may be called'
    system='\n'.join(m.get('content','') for m in messages if m.get('role')=='system')
    if 'topic_candidates' in system:
        kind='eight-section-report'
        value={'title':'隔离测试 IP 定位报告','position':'面向物业负责人的电梯服务顾问','audience':'物业公司负责人','style':'清晰、专业、依据真实资料','restrictions':'禁止公开客户地址','body':'\n\n'.join('## '+h+'\n\n离线测试报告内容；【待确认】事项须核实。\n\n- 核对真实业务范围\n- 保留事实与建议边界' for h in ipq.REPORT_SECTIONS),'topic_candidates':[{'title':'隔离测试建议选题','angle':'仅为 fixture 建议，场地与资质待确认'}]}
    elif 'platforms' in system and ('需求识别器' in system or 'chat|profile' in system):
        kind='agent-profile-intent'
        value={'action':'profile','platforms':[],'brief':'帮我新建个人 IP 定位，按十二题引导完成'}
    else:
        kind='agent-profile-plan'
        value={'reply':'隔离测试：请进入统一 IP 定位引导，逐题确认真实情况。','action':'profile','ready':True,'fields':{'title':'隔离对话定位建议','position':'电梯服务顾问','audience':'物业负责人','style':'依据真实材料','views':'不编造业绩','body':'这是离线测试的待核对定位建议，需先完成统一十二题。'},'notes':['仅测试候选，不代表真实用户资料']}
    with (s.DATA/'fixture-model-calls.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'fixture':True,'model':model,'kind':kind})+'\n')
    return json.dumps(value,ensure_ascii=False)
g.generate=generate
import httpx
def blocked(*a,**kw):
    with (s.DATA/'forbidden-network.jsonl').open('a',encoding='utf-8') as f:f.write('{"blocked":true}\n')
    raise RuntimeError('External HTTP is disabled in IP guide UI fixture')
httpx.Client.request=blocked
httpx.AsyncClient.request=blocked
from backend.app import app
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['IP_GUIDE_PORT']),log_level='error',access_log=False)
`;
const fixturePath=path.join(directory,'offline-fixture.py');fs.writeFileSync(fixturePath,fixtureSource);
const assets=new Map();
if(integrated){assert(fs.existsSync('dist/index.html'),'Build integrated dist first');}
else{const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),jsx:'automatic',external:['/visuals/*']});for(const f of bundle.outputFiles){fs.writeFileSync(f.path,f.contents);assets.set('/'+path.basename(f.path),f.contents)}}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname.startsWith('/api/')){const request=http.request(apiBase+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(request);return}
 if(!integrated&&assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(assets.get(url.pathname));return}
 const root=path.resolve(integrated?'dist':'public'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.html':'text/html;charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));return}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(integrated?fs.readFileSync('dist/index.html'):'<!doctype html><html class="ts-theme"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const service=spawn(python,['-B','-X','utf8',fixturePath],{windowsHide:true,env:{...process.env,TIJIAN_DATA:directory,IP_GUIDE_PORT:String(apiPort),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','ignore','pipe']});
let backendLog='',token='',browser,page;service.stderr.on('data',x=>backendLog+=x);
const checks=[],states=[],errors=[],external=[],requests=[],responses=[];let initialProfiles=0;
const api=async(p,data)=>{const r=await fetch(apiBase+'/api'+p,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert(r.ok,p+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
const objects=async(kind)=>(await api('/state')).objects.filter(x=>x.kind===kind);
const session=async(id)=>(await api('/studio/interviews')).items.find(s=>s.id===id);
const check=async(name,fn)=>{await fn();checks.push(name)};
const scan=async(name,scope)=>{await settleUI(page);const report=await page.evaluate(measureContrast,{scope,excludeUserPaper:true,viewportOnly:false});assert(report.checked>0,name+' must inspect visible text');states.push({name,...report});await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});assert.equal(report.violations.length,0,name+' contrast: '+JSON.stringify(report.violations))};
const guide=()=>page.getByRole('region',{name:'IP 定位引导',exact:true}).or(page.locator('main[aria-label="IP 定位引导"]')).or(page.locator('.ip-guide-page'));
const guideReady=async()=>{await page.waitForURL(/#studio\/ip-guide(?:\?|$)/);await guide().first().waitFor();await page.getByLabel('访谈回答',{exact:true}).waitFor();await page.waitForFunction(()=>new URLSearchParams(location.hash.split('?')[1]||'').has('session'));return new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('session')};
const go=async hash=>{await page.goto(base+'/#'+hash);await page.locator('.page-area').waitFor()};
const visibleTextareas=()=>guide().first().locator('textarea').filter({visible:true});
try{
 let ready=false;for(let i=0;i<150;i++){try{ready=(await fetch(apiBase+'/api/health')).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,backendLog);
 const auth=await api('/auth/register',{email:randomUUID()+'@example.test',password:randomUUID()+'aA1!',name:'IP 引导离线验收'});token=auth.token;await api('/workspace',{path:path.join(directory,'workspace')});const starterProfiles=await objects('profile');initialProfiles=starterProfiles.length;assert(starterProfiles.every(p=>p.status!=='accepted'),'fixture must start without a completed IP');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(value=>sessionStorage.setItem('tijian-session',value),token);
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['blob:','data:'].includes(u.protocol)&&u.origin!==base){external.push(u.origin+u.pathname);return route.abort()}return route.continue()});
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&r.method()!=='GET')requests.push({path:u.pathname,method:r.method(),data:r.postDataJSON()})});
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&r.status()>=400)responses.push({path:u.pathname,status:r.status()})});
 await check('startup-reminder-readable-hover-keyboard-dismiss',async()=>{
  await go('studio/home');const reminder=page.getByRole('dialog',{name:'先让梯世界认识你',exact:true});await reminder.waitFor();await scan('startup-reminder','.ip-startup-reminder');
  await reminder.getByRole('button',{name:'开始 IP 定位',exact:true}).hover();await scan('startup-reminder-primary-hover','.ip-startup-reminder');await reminder.getByRole('button',{name:'稍后再做',exact:true}).hover();await scan('startup-reminder-secondary-hover','.ip-startup-reminder');
  await page.keyboard.press('Tab');assert(await reminder.evaluate(n=>n.contains(document.activeElement)),'keyboard focus must stay inside reminder');await page.keyboard.press('Escape');await reminder.waitFor({state:'hidden'});assert.equal((await objects('profile')).length,initialProfiles);
 });
 let firstID,guideURL;
 await check('my-ip-new-entry-uses-page-and-auto-starts-one-session',async()=>{
  await page.getByRole('button',{name:'我的 IP',exact:true}).click();await page.getByRole('button',{name:'新增 IP',exact:true}).click();firstID=await guideReady();guideURL=page.url();assert.equal((await api('/studio/interviews')).items.length,1);assert.equal((await session(firstID)).question_index,0);assert.equal(await page.getByRole('dialog',{name:/十二题 IP 定位问卷|AI 访谈建档/}).count(),0);await scan('guide-first-question','.page-area');
 });
 await check('saved-and-unsent-answers-resume-after-refresh-and-back',async()=>{
  await page.getByLabel('访谈回答',{exact:true}).fill('物业公司负责人');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click();await page.getByText('第 2 / 12 题',{exact:true}).waitFor();await page.getByLabel('访谈回答',{exact:true}).fill('未提交的第二题回答');await page.reload();await page.getByLabel('访谈回答',{exact:true}).waitFor();assert.equal(await page.getByLabel('访谈回答',{exact:true}).inputValue(),'未提交的第二题回答');assert.equal((await session(firstID)).answers.customers,'物业公司负责人');
  await page.goBack();await page.waitForURL(/#studio\/brand/);await page.goForward();await page.getByLabel('访谈回答',{exact:true}).waitFor();assert.equal(await page.getByLabel('访谈回答',{exact:true}).inputValue(),'未提交的第二题回答');assert.equal((await api('/studio/interviews')).items.length,1);assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('session'),firstID);await scan('guide-restored-question','.page-area');
 });
 await check('correction-language-does-not-advance-and-explicit-edit-preserves-current-draft',async()=>{
  const before=await session(firstID);await page.getByLabel('访谈回答',{exact:true}).fill('纠正上一题：我的客户其实是物流园物业负责人');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click();await page.getByText(/这句话没有存入当前回答/).waitFor();const after=await session(firstID);assert.equal(after.version,before.version);assert.equal(after.question_index,1);assert.equal(after.answers.customers,'物业公司负责人');await page.getByLabel('访谈回答',{exact:true}).fill('保留当前第二题的未提交回答');
  const record=guide().first().locator('summary').filter({hasText:/回答记录|已回答题目/}).first();if(!await record.evaluate(n=>n.parentElement.open))await record.click();await page.getByRole('button',{name:'修改第 1 题',exact:true}).click();await page.getByLabel('修正回答',{exact:true}).fill('物流园物业负责人');await page.getByRole('button',{name:'保存本题修改',exact:true}).click();await page.getByLabel('访谈回答',{exact:true}).waitFor();assert.equal(await page.getByLabel('访谈回答',{exact:true}).inputValue(),'保留当前第二题的未提交回答');const changed=await session(firstID);assert.equal(changed.answers.customers,'物流园物业负责人');assert.equal(changed.question_index,1);if(await record.evaluate(n=>n.parentElement.open))await record.click();await scan('guide-corrected-answer-retains-draft','.page-area');
 });
 await check('twelve-questions-produce-formatted-report-without-implicit-profile-write',async()=>{
  for(let index=2;index<=12;index++){await page.getByRole('button',{name:'不知道，标为待确认',exact:true}).click();if(index<12)await page.getByText(`第 ${index+1} / 12 题`,{exact:true}).waitFor()}
  assert.equal((await objects('profile')).length,initialProfiles);await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).waitFor({timeout:25000});assert.equal((await session(firstID)).question_index,12);const row=await session(firstID);assert.equal(row.status,'review');assert.equal(Object.keys(row.answers).length,12);assert(Object.entries(row.answers).filter(([key])=>key!=='customers').every(([,answer])=>answer==='不知道【待确认】'),'unknown answers must persist explicitly, never be replaced by fixture guesses');assert.equal((await objects('profile')).length,initialProfiles);
  const preview=page.getByLabel('完整定位策划报告预览',{exact:true}).or(page.locator('.ip-report-preview,.ip-report')).first();await preview.waitFor();const title=preview.locator('.ip-report-heading :is(h1,h2)').first();await title.waitFor();const chapter=preview.locator('.ip-report-body h2').first();assert(await preview.locator('.ip-report-body h2').count()>=8);assert(await title.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>await chapter.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)),'report main title must be visibly larger than section headings');assert.equal(await visibleTextareas().count(),0,'report must default to formatted preview, not raw Markdown/12 answers');assert.equal(await page.getByLabel('访谈回答',{exact:true}).count(),0);
  await scan('guide-eight-section-report','.page-area');const lastSection=preview.locator('.ip-report-body h2').last();await lastSection.scrollIntoViewIfNeeded();const lastBox=await lastSection.boundingBox();assert(lastBox&&lastBox.y>=60&&lastBox.y+lastBox.height<=1000,'last report section must be reachable by real scrolling');await page.screenshot({path:path.join(directory,'guide-report-section-eight.png'),fullPage:true});await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'guide-report-confirm-footer.png'),fullPage:true});await page.setViewportSize({width:800,height:900});await preview.locator('.ip-report-heading').scrollIntoViewIfNeeded();await scan('guide-report-narrow','.page-area');await lastSection.scrollIntoViewIfNeeded();const narrowBox=await lastSection.boundingBox();assert(narrowBox&&narrowBox.y>=60&&narrowBox.y+narrowBox.height<=900,'narrow last section must remain readable');await page.screenshot({path:path.join(directory,'guide-report-narrow-section-eight.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'narrow screen must not overflow horizontally');await page.setViewportSize({width:1600,height:1000});
 });
 await check('changing-answer-invalidates-old-report-until-regenerated',async()=>{
  const record=guide().first().locator('summary').filter({hasText:/回答记录|已回答题目/}).first();if(!await record.evaluate(n=>n.parentElement.open))await record.click();await page.getByRole('button',{name:'修改第 1 题',exact:true}).click();await page.getByLabel('修正回答',{exact:true}).fill('更正后只服务物流园负责人');await page.getByRole('button',{name:'保存本题修改',exact:true}).click();await page.getByText('回答已修改，旧定位报告已失效，请重新生成。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).count(),0);const invalid=await session(firstID);assert.equal(invalid.question_index,12);assert.equal(invalid.status,'ready_report');assert.equal(invalid.fields,undefined);assert.equal(invalid.answers.customers,'更正后只服务物流园负责人');assert.equal((await objects('profile')).length,initialProfiles);await scan('guide-old-report-invalidated','.page-area');
  await page.reload();await page.getByText('回答已修改，旧定位报告已失效，请重新生成。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).count(),0);await page.getByRole('button',{name:'生成完整定位报告',exact:true}).click();await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).waitFor({timeout:25000});assert.equal((await session(firstID)).report_invalidated,false);assert.equal((await session(firstID)).question_index,12);await scan('guide-regenerated-corrected-report','.page-area');
 });
 await check('report-edit-draft-survives-refresh-and-return-navigation',async()=>{
  await page.locator('.ip-report-editor summary').click();const editor=page.getByLabel('完整定位策划报告',{exact:true});const edited=await editor.inputValue()+'\n\n离线测试手工补充，刷新后必须保留';await editor.fill(edited);await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('interview-report:')&&(localStorage.getItem(k)||'').includes('离线测试手工补充，刷新后必须保留')));await page.reload();await guide().first().waitFor();await page.locator('.ip-report-body').waitFor();assert(await page.locator('.ip-report-body').getByText('离线测试手工补充，刷新后必须保留',{exact:true}).isVisible());assert.equal(await visibleTextareas().count(),0);await page.locator('.ip-report-editor summary').click();assert.equal(await page.getByLabel('完整定位策划报告',{exact:true}).inputValue(),edited);await page.locator('.ip-report-editor summary').click();await page.getByRole('button',{name:'返回我的 IP',exact:true}).click();await page.waitForURL(/#studio\/brand/);await page.goBack();await page.locator('.ip-report-body').waitFor();assert(await page.locator('.ip-report-body').getByText('离线测试手工补充，刷新后必须保留',{exact:true}).isVisible());await scan('guide-edited-report-restored','.page-area');
 });
 let created;
 await check('confirm-saves-one-profile-and-my-ip-renders-eight-section-report',async()=>{
  await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).click();await page.waitForURL(/#studio\/brand/);created=(await objects('profile')).find(p=>p.interview_id===firstID);assert(created);assert.equal(created.status,'accepted');assert.equal(Object.keys(created.questionnaire_answers).length,12);assert.equal((await session(firstID)).applied_id,created.id);
  const card=page.locator('[data-profile-id="'+created.id+'"]');await card.waitFor();assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('profile'),created.id);assert(await card.locator('.ip-report').isVisible(),'confirmation must automatically open the exact saved profile report');assert(created.body.includes('离线测试手工补充，刷新后必须保留'));assert.equal(requests.filter(r=>r.path==='/api/studio/interviews/'+firstID+'/turn'&&r.data?.summarize===true).length,2,'refresh and return must not create duplicate report jobs'); assert(await card.locator('.ip-report-body h2').count()>=8);assert.equal(await card.locator('textarea').filter({visible:true}).count(),0);await scan('my-ip-confirmed-report','.ip-dashboard');
 });
 await check('existing-profile-ai-completion-entry-uses-identical-guide-and-target',async()=>{
  const card=page.locator('[data-profile-id="'+created.id+'"]');await card.getByRole('button',{name:/(?:AI|Agent).*(?:补充|补全|完善|生成报告)/}).click();const id=await guideReady();assert.notEqual(id,firstID);assert.equal((await session(id)).target_id,created.id);assert.equal((await objects('profile')).length,initialProfiles+1);assert.equal((await session(id)).question_index,0);await scan('guide-existing-profile','.page-area');
 });
 await check('existing-report-review-clearly-updates-the-same-profile',async()=>{
  const id=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('session'),before=(await objects('profile')).find(p=>p.id===created.id);for(let index=1;index<=12;index++){if(index===1){await page.getByLabel('访谈回答',{exact:true}).fill('已有 IP 更新后的物流园负责人');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click()}else await page.getByRole('button',{name:'不知道，标为待确认',exact:true}).click();if(index<12)await page.getByText(`第 ${index+1} / 12 题`,{exact:true}).waitFor()}
  const update=page.getByRole('button',{name:'确认报告，更新此 IP',exact:true});await update.waitFor({timeout:25000});assert.equal(await page.getByRole('button',{name:'确认报告，建立 IP',exact:true}).count(),0);assert(await page.locator('.ip-guide-confirm').getByText(/确认后更新/).isVisible());assert.equal((await objects('profile')).find(p=>p.id===created.id).version,before.version);assert.equal((await objects('profile')).length,initialProfiles+1);await scan('guide-existing-profile-update-review','.page-area');await update.click();await page.waitForURL(/#studio\/brand/);assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('profile'),created.id);const saved=(await objects('profile')).find(p=>p.id===created.id);assert.equal(saved.interview_id,id);assert.equal(saved.questionnaire_answers.customers,'已有 IP 更新后的物流园负责人');assert.equal((await objects('profile')).length,initialProfiles+1);assert.equal((await session(id)).applied_id,created.id);
 });
 await check('legacy-profile-remains-readable-and-can-enter-unified-guide',async()=>{
  const legacy=await api('/objects/profile',{title:'旧版兼容档案',position:'已有电梯行业定位',audience:'历史受众',style:'历史风格',body:'## 原有定位方案\n\n保留历史报告与资料，不是十二问答。',status:'accepted',legacy_extension:'must-survive'});await go('studio/brand');await page.reload();const card=page.locator('[data-profile-id="'+legacy.id+'"]');await card.waitFor();assert(await card.getByText('已有电梯行业定位',{exact:true}).isVisible());await card.getByRole('button',{name:/(?:AI|Agent).*(?:补充|补全|完善|生成报告)/}).click();const id=await guideReady();assert.equal((await session(id)).target_id,legacy.id);assert.equal((await objects('profile')).find(p=>p.id===legacy.id).legacy_extension,'must-survive');await page.setViewportSize({width:800,height:900});await scan('guide-legacy-narrow','.page-area');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1600,height:1000});
 });
 await check('agent-profile-intent-automatically-opens-same-guide-with-task-binding',async()=>{
  const task=await api('/tasks/open',{title:'帮我新建个人 IP 定位，按十二题引导完成',mode:'auto',profile_id:'',source_ids:[]});await go('task/'+task.id);await page.reload();const send=page.getByRole('button',{name:'发送要求',exact:true});await send.waitFor();await send.click();const id=await guideReady();const current=(await objects('task')).find(t=>t.id===task.id);assert.equal(current.ip_interview_id,id);assert.equal((await session(id)).source_task_id,task.id);assert.equal((await objects('profile')).length,initialProfiles+2,'agent recognition must not save a profile prematurely');await scan('guide-agent-source-task','.page-area');
  for(let index=1;index<=12;index++){if(index===1){await page.getByLabel('访谈回答',{exact:true}).fill('物流园物业负责人');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click()}else await page.getByRole('button',{name:'不知道，标为待确认',exact:true}).click();if(index<12)await page.getByText(`第 ${index+1} / 12 题`,{exact:true}).waitFor()}
  await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).waitFor({timeout:25000});await page.getByRole('button',{name:/确认.*(?:建立|保存|应用).*IP/}).click();await page.waitForFunction(()=>!location.hash.startsWith('#studio/ip-guide'));
  const applied=await session(id),profile=(await objects('profile')).find(p=>p.id===applied.applied_id),after=(await objects('task')).find(t=>t.id===task.id);assert.equal(profile.positioning_task_id,task.id);assert.equal(after.ip_interview_id,id);assert.equal(after.profile_id,profile.id);assert.equal(applied.status,'applied');assert.equal((await objects('profile')).length,initialProfiles+3);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(responses,[]);assert(!fs.existsSync(path.join(directory,'forbidden-network.jsonl')),'offline fixture attempted external HTTP');
 const calls=fs.readFileSync(path.join(directory,'fixture-model-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(calls.some(c=>c.kind==='eight-section-report'));assert(calls.some(c=>c.kind==='agent-profile-intent'));assert(calls.every(c=>c.fixture&&c.model==='isolated-ip-guide-fixture'));
 console.log(JSON.stringify({passed:true,directory,checks:checks.length,visualStates:states.length,fixtureModelCalls:calls.length,realPaidModelCalls:0,realBackend:true,frontend:integrated?'integrated-dist':'full-App-source'}));
}catch(error){errors.push(String(error.stack));process.exitCode=1;console.error(String(error.stack));if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{})}
finally{
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({passed:!process.exitCode,checks,states,errors,external,requests,responses,paidModelCalls:0,modelFixture:true,realBackend:true,realSQLite:true,directory,frontend:integrated?'integrated-dist':'full-App-source',...(integrated?{distIndexSHA256:createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex')}:{})},null,2));fs.writeFileSync(path.join(directory,'backend.log'),backendLog);await browser?.close();service.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
}
