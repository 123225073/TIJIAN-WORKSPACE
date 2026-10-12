// Read-only acceptance of the packaged app and existing account. Never confirms an IP or generates paid media.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {measureContrast} from './test-studio-color-states.mjs';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const directory=path.resolve('.runtime','installed-demo-'+version);fs.mkdirSync(directory,{recursive:true});
const exe=path.join(process.env.LOCALAPPDATA,'Programs','elevator-workbench','梯世界工作台.exe');
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn(exe,['--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore'});
let browser;
try{
 let ws;for(let i=0;i<150;i++){try{ws=(await(await fetch('http://127.0.0.1:'+port+'/json/version')).json()).webSocketDebuggerUrl;if(ws)break}catch{}await new Promise(r=>setTimeout(r,200))}
 assert(ws,'Packaged application did not start');browser=await chromium.connectOverCDP(ws);
 let page;for(let i=0;i<150;i++){page=browser.contexts()[0]?.pages()[0];if(page)break;await new Promise(r=>setTimeout(r,200))}
 assert(page,'Packaged workbench window did not open');await page.waitForLoadState('domcontentloaded');
 await page.waitForFunction(()=>Boolean(sessionStorage.getItem('tijian-session')),{},{timeout:30000});
 const health=await page.evaluate(()=>fetch('/api/health').then(r=>r.json()));assert.equal(health.version,version);
 assert.equal(await page.evaluate(()=>fetch('/').then(r=>r.text())),fs.readFileSync('dist/index.html','utf8'));
 const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const installed=path.join(path.dirname(exe),'resources','backend','tijian-service');
 assert.equal(hash(path.join(installed,'_internal','desktop-frontend.zip')),hash('.runtime/desktop-frontend.zip'));
 assert.equal(hash(path.join(installed,'tijian-service.exe')),hash('.runtime/backend-dist/tijian-service/tijian-service.exe'));
 const state=await page.evaluate(()=>fetch('/api/state',{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}}).then(r=>r.json()));
 const task=state.objects.find(x=>x.kind==='task'&&x.agent_proposal?.kind==='profile'&&!x.archived);assert(task,'An existing IP candidate is needed for this acceptance');
 const base=new URL(page.url()).origin;
 await page.goto(base+'/?ui=1#task/'+task.id);await page.locator('.agent-result').waitFor();
 const contrast=await page.evaluate(measureContrast,{scope:'.agent-fields'});assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations));
 await page.getByRole('button',{name:'重新整理为新增 IP',exact:true}).waitFor();
 await page.screenshot({path:path.join(directory,'existing-ip-candidate.png')});
 await page.locator('.sidebar').getByRole('button',{name:'我的 IP',exact:true}).click();
 await page.getByRole('button',{name:'继续当前任务',exact:true}).click();await page.locator('.aw-workspace').waitFor();
 assert.equal(new URL(page.url()).hash,'#task/'+task.id);
 const articleTask=state.objects.find(x=>x.kind==='task'&&x.platform_outcomes?.wechat&&(!x.active_outcome||x.active_outcome==='wechat')&&!x.archived);
 if(articleTask){await page.goto(base+'/?ui=1#task/'+articleTask.id);await page.getByRole('button',{name:/^(?:AI )?生成新配图$/,exact:true}).waitFor();await page.screenshot({path:path.join(directory,'existing-article.png')});}
 const report={passed:true,version,actual_installed_app:true,final_build_matches:true,existing_candidate_readable:true,contrast_samples:contrast.entries.length,current_task_return:true,existing_article_controls:!!articleTask,paid_generation:false,confirmation_or_paid_generation:false,read_only_requests:true};
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();child.kill();}
