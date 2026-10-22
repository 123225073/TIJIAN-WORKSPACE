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
 const prep=async options=>{let row=await api('/studio/interviews',{type:'profile',...options});for(let i=0;i<12;i++){await api('/studio/interviews/'+row.id+'/turn',{version:row.version,answer:i?'不知道【待确认】':'物业公司负责人',request_id:randomUUID()});row=await session(row.id)}let job=await api('/studio/interviews/'+row.id+'/turn',{version:row.version,summarize:true,answer:'',request_id:randomUUID()});while(['queued','running'].includes(job.status)){await new Promise(r=>setTimeout(r,80));job=await api('/jobs/'+job.id)}assert.equal(job.status,'done');return session(row.id)};
 const profile=await api('/objects/profile',{title:'必须明确更新的已有IP',position:'旧定位不得误认新增',status:'accepted'});
 const task=await api('/tasks/open',{title:'完善我的IP定位',mode:'profile',profile_id:profile.id,source_ids:[]});
 const row=await prep({source_task_id:task.id,operation:'update',target_id:profile.id});
 await go('studio/ip-guide?task='+task.id+'&session='+row.id);await page.locator('.ip-report').waitFor();
 const intro=await page.locator('.ip-guide-intro h1').innerText(),applyText=await page.locator('.ip-guide-confirm button.st-primary').innerText();
 const headings=await page.locator('.ip-report :is(h1,h2)').allTextContents();assert.equal(headings.length,9);assert.equal(await page.locator('.ip-report-body h1').count(),0);
 console.log(JSON.stringify({case:'restored_update_target_correct',intro,applyText,backendTarget:row.target_id,profileId:profile.id,headings}));await page.screenshot({path:path.join(directory,'review-update-target-label.png'),fullPage:true});
 const before=(await objects('profile')).length;
 await page.locator('.ip-guide-confirm button.st-primary').click();await page.waitForURL(/#studio\/brand/);const applied=await session(row.id);assert.equal(applied.applied_id,profile.id);assert.equal((await objects('profile')).length,before);checks.push('restored update session states actual write target and updates same profile');
 const task2=await api('/tasks/open',{title:'新建个人IP定位',mode:'profile',profile_id:'',source_ids:[]});
 const stale=await prep({source_task_id:task2.id,operation:'create'});await go('studio/ip-guide?task='+task2.id+'&session='+stale.id);await page.locator('.ip-report').waitFor();
 const taskLive=(await objects('task')).find(t=>t.id===task2.id);const change=await fetch(apiBase+'/api/objects/'+task2.id,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:taskLive.version,profile_id:profile.id})});assert(change.ok,await change.text());
 await page.locator('.ip-guide-confirm button.st-primary').click();await page.locator('.st-alert').filter({hasText:'原对话或所选身份已变化'}).waitFor();
 const recoveryBefore={reportVisible:await page.locator('.ip-report').count(),generateButtons:await page.getByRole('button',{name:'生成完整定位报告',exact:true}).count(),error:await page.locator('.st-alert').allTextContents()};await page.reload();await page.locator('.ip-report').waitFor();
 const recoveryAfter={reportVisible:await page.locator('.ip-report').count(),generateButtons:await page.getByRole('button',{name:'生成完整定位报告',exact:true}).count()};await page.locator('.ip-guide-confirm button.st-primary').click();await page.locator('.st-alert').filter({hasText:'原对话或所选身份已变化'}).waitFor();
 console.log(JSON.stringify({case:'stale_report_before_explicit_regeneration',recoveryBefore,recoveryAfter}));await page.screenshot({path:path.join(directory,'review-stale-task-block.png'),fullPage:true});assert.equal(await page.getByRole('button',{name:'重新整理报告',exact:true}).count(),1);await page.getByRole('button',{name:'重新整理报告',exact:true}).click();await page.waitForFunction(()=>{const b=document.querySelector('.ip-guide-confirm button.st-primary');return b&&!b.disabled});await page.locator('.ip-guide-confirm button.st-primary').click();await page.waitForURL(/#studio\/brand/);assert.equal((await session(stale.id)).status,'applied');checks.push('stale source report explicitly regenerates and confirms after409'); const responseLoss=await api('/studio/interviews',{type:'profile',target_id:profile.id});await go('studio/ip-guide?target='+profile.id+'&session='+responseLoss.id);await page.getByLabel('访谈回答',{exact:true}).waitFor();
 const lostRoute='**/api/studio/interviews/'+responseLoss.id+'/turn';await page.route(lostRoute,async route=>{await route.fetch();await route.abort('failed')});
 await page.getByLabel('访谈回答',{exact:true}).fill('这段只属于第一题，不能自动复制到第二题');await page.getByRole('button',{name:'保存回答，下一题',exact:true}).click();await page.locator('.st-alert').waitFor();await page.unroute(lostRoute);assert.equal((await session(responseLoss.id)).question_index,1);
 await page.getByRole('button',{name:'重新读取当前进度',exact:true}).click();await page.getByText('第 2 / 12 题',{exact:true}).waitFor();const recoveredInput=await page.getByLabel('访谈回答',{exact:true}).inputValue();assert.equal(recoveredInput,'');checks.push('lost answer response recovers next question with empty input');console.log(JSON.stringify({case:'lost_response_next_question_empty',questionIndex:1,recoveredInput}));await page.screenshot({path:path.join(directory,'review-ack-loss-answer.png'),fullPage:true}); const task3=await api('/tasks/open',{title:'新建第三份个人IP定位',mode:'profile',profile_id:'',source_ids:[]});const leaving=await prep({source_task_id:task3.id,operation:'create'});await go('studio/ip-guide?task='+task3.id+'&session='+leaving.id);await page.locator('.ip-report').waitFor();
 const applyRoute='**/api/studio/interviews/'+leaving.id+'/apply';await page.route(applyRoute,async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,1000));await route.fulfill({response})});await page.locator('.ip-guide-confirm button.st-primary').click();await page.getByRole('button',{name:'返回 Agent 对话',exact:true}).click();await page.waitForURL(new RegExp('#task/'+task3.id));const returnedRoute=page.url();await page.waitForTimeout(1700);assert.equal(page.url(),returnedRoute);assert.equal((await session(leaving.id)).status,'applied');checks.push('leaving during apply retains destination while server saves profile');console.log(JSON.stringify({case:'late_apply_response_preserves_user_navigation',returnedRoute,afterResponse:page.url(),saved:(await session(leaving.id)).status}));await page.unroute(applyRoute); assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,directory,paidModelCalls:0,fixtureOnly:true}));
}catch(error){errors.push(String(error.stack));process.exitCode=1;console.error(String(error.stack));if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{})}
finally{
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({passed:!process.exitCode,checks,states,errors,external,requests,responses,paidModelCalls:0,modelFixture:true,realBackend:true,realSQLite:true,directory,frontend:integrated?'integrated-dist':'full-App-source',...(integrated?{distIndexSHA256:createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex')}:{})},null,2));fs.writeFileSync(path.join(directory,'backend.log'),backendLog);await browser?.close();service.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
}
