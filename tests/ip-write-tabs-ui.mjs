import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from '../scripts/test-studio-color-states.mjs';

const symptomsOnly=process.argv.includes('--symptoms-only');
const freePort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port};
const directory=path.resolve('.runtime','ip-ui-tabs-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const apiPort=await freePort(),uiPort=await freePort(),apiBase='http://127.0.0.1:'+apiPort,base='http://127.0.0.1:'+uiPort;
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_ALLOW_SELF_REGISTRATION:'1',IP_TEST_PORT:String(apiPort),PYTHONIOENCODING:'utf-8'};
const compiled=await build({entryPoints:['tests/ip-ui-harness.tsx'],bundle:true,format:'esm',write:false,outdir:path.join(directory,'ui'),define:{'process.env.NODE_ENV':'"development"'}});
const assets=new Map(compiled.outputFiles.map(file=>['/'+path.basename(file.path),file.contents]));
const ui=http.createServer((request,response)=>{
 if(request.url.startsWith('/api/')){const upstream=http.request(apiBase+request.url,{method:request.method,headers:request.headers},r=>{if(response.destroyed){r.destroy();return}response.writeHead(r.statusCode,r.headers);r.pipe(response)});upstream.on('error',()=>{if(response.destroyed||response.writableEnded)return;if(response.headersSent){response.destroy();return}response.writeHead(502);response.end('Isolated API unavailable')});request.pipe(upstream);return}
 const content=assets.get(request.url.split('?')[0]);if(content){response.writeHead(200,{'Content-Type':request.url.includes('.css')?'text/css':'application/javascript'});response.end(content);return}
 response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(fs.readFileSync('tests/ip-ui-harness.html'));
});
await new Promise(resolve=>ui.listen(uiPort,'127.0.0.1',resolve));
const python=path.resolve('.runtime/venv/Scripts/python.exe'),service=spawn(python,['tests/ip-write-tabs-fixture.py'],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
let output='',browser;service.stderr.on('data',x=>output+=x);
const checks=[],symptoms=[],states=[],requests=[],external=[],errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report=passed=>{const result={passed,symptomsOnly,checks,symptoms,states,requests,external,errors,isolated_database:true,production_data_access:false,paid_model_calls:false,model_output:'fixed test fixture',directory};fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed,checks,symptoms,directory}));return result};
try{
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(apiBase+'/api/health')).ok;if(ready)break}catch{}await pause(150)}assert(ready,output);
 const auth=await(await fetch(apiBase+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'ip-tabs@example.test',password:'isolated-test-password',name:'隔离测试'})})).json();assert(auth.token);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 const call=async(url,data,method=data===undefined?'GET':'POST',status=200)=>{const response=await fetch(apiBase+'/api'+url,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});assert.equal(response.status,status,url+' '+await response.clone().text());return response.json()};
 const seeded=spawn(python,['tests/ip-write-tabs-fixture.py','--seed'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let seedText='',seedError='';seeded.stdout.on('data',x=>seedText+=x);seeded.stderr.on('data',x=>seedError+=x);seeded.stdin.end(JSON.stringify({owner:auth.user.id}));assert.equal(await new Promise(r=>seeded.on('exit',r)),0,seedError);const seed=JSON.parse(seedText);
 const objects=async()=> (await call('/state')).objects;
 const task=async()=> (await objects()).find(x=>x.id===seed.task_id);
 const profiles=async()=> (await objects()).filter(x=>x.kind==='profile');
 const original=(await profiles()).find(x=>x.id===seed.profile_id),alternate=(await profiles()).find(x=>x.id===seed.alternate_id);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()!=='GET')requests.push({url:new URL(r.url()).pathname,method:r.method(),body:r.postDataJSON()})});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort()}return route.continue()});
 await page.addInitScript(({seed,token})=>{window.ipFixture=seed;sessionStorage.setItem('tijian-session',token)}, {seed,token:auth.token});
 await page.goto(base+'/#task/'+seed.task_id);await page.locator('.profile-recovery').waitFor();
 const applyButton=page.locator('.agent-result .button-row>button.primary'),editButton=page.getByRole('button',{name:'微调内容',exact:true});
 assert(await applyButton.isDisabled());assert(await editButton.isDisabled());checks.push('historical-candidate-blocks-apply-and-edit');
 const hasTabs=await page.getByRole('tab',{name:'新增 IP',exact:true}).count()===1&&await page.getByRole('tab',{name:'更新已有 IP',exact:true}).count()===1;
 symptoms.push({name:'parallel-create-update-tabs',passed:hasTabs});
 await page.goto(base+'/#studio/brand');await page.locator('.ip-profile-card').first().waitFor();
 const inspect=async(locator,name,{disabled=false}={})=>{
  if(disabled)await locator.evaluate(el=>el.disabled=true);
  await page.mouse.move(0,0);await locator.evaluate(el=>el.blur());await settleUI(page);
  for(const state of disabled?['disabled','disabled-hover']:['normal','hover','focus']){
   if(state.includes('hover'))await locator.hover();
   if(state==='focus'){await page.mouse.move(0,0);await locator.focus()}
   await settleUI(page);
   const selector=await locator.evaluate(el=>{el.dataset.ipContrast='current';return '[data-ip-contrast="current"]'});
   const result=await page.evaluate(measureContrast,{scope:selector});
   const style=await locator.evaluate(el=>{const c=getComputedStyle(el);return {background:c.backgroundColor,color:c.color,outlineStyle:c.outlineStyle,outlineWidth:c.outlineWidth,focusVisible:el.matches(':focus-visible')}});
   const passed=result.checked>0&&result.violations.length===0&&result.unmeasured.length===0;
   states.push({name,state,passed,style,contrast:result});
   await locator.evaluate(el=>delete el.dataset.ipContrast);
  }
  if(disabled)await locator.evaluate(el=>el.disabled=false);
 };
 const card=page.locator('.ip-profile-card[data-profile-id="'+seed.profile_id+'"]');
 for(const name of ['AI 访谈补全','编辑档案']){const button=card.getByRole('button',{name,exact:false});await inspect(button,name);await inspect(button,name,{disabled:true})}
 symptoms.push({name:'actual-profile-card-action-contrast',passed:states.every(x=>x.passed)});
 await page.screenshot({path:path.join(directory,'profile-card.png'),fullPage:true});
 if(symptomsOnly){report(symptoms.every(x=>x.passed));assert(symptoms.every(x=>x.passed),'Actual symptoms reproduced: '+JSON.stringify(symptoms));}
 else{
  assert(symptoms.every(x=>x.passed),'UI symptom checks failed');
  assert(states.filter(x=>x.state==='focus').every(x=>x.style.focusVisible&&x.style.outlineStyle!=='none'&&parseFloat(x.style.outlineWidth)>=2));
  checks.push('actual-profile-card-actions-normal-hover-focus-disabled-readable');
  await card.getByRole('button',{name:'编辑档案',exact:false}).click();await page.getByRole('dialog',{name:'编辑档案',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'代理品牌与业务范围',exact:true}).inputValue(),original.agency_brands);await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  await card.getByRole('button',{name:'AI 访谈补全',exact:true}).click();await page.getByRole('dialog',{name:'AI 访谈建档'}).waitFor();assert(await page.getByRole('heading',{name:'补充现有档案'}).isVisible());await page.getByRole('button',{name:'关闭',exact:true}).click();checks.push('profile-card-buttons-open-existing-editor-and-targeted-interview');
  await page.goto(base+'/#task/'+seed.task_id);await page.locator('.profile-recovery').waitFor();
  const createTab=page.getByRole('tab',{name:'新增 IP',exact:true}),updateTab=page.getByRole('tab',{name:'更新已有 IP',exact:true});
  const createButton=page.getByRole('button',{name:'重新整理为新增 IP',exact:true}),updateButton=page.getByRole('button',{name:'重新整理为更新此 IP',exact:true}),select=page.getByRole('combobox',{name:'IP 更新目标',exact:true});
  assert.equal(await createTab.getAttribute('aria-selected'),'true');assert.equal(await select.count(),0);
  await updateTab.click();await select.waitFor();assert(await select.locator('option').filter({hasText:'原有 IP'}).count());assert.equal(await select.locator('option').filter({hasText:'已归档 IP'}).count(),0);
  await select.selectOption('');assert(await updateButton.isDisabled());await select.selectOption(seed.profile_id);
  assert.equal(await updateButton.locator('..').getAttribute('role'),'tabpanel');
  await updateTab.press('ArrowLeft');assert.equal(await createTab.getAttribute('aria-selected'),'true');await createTab.press('ArrowRight');assert.equal(await updateTab.getAttribute('aria-selected'),'true');await updateTab.press('Home');assert.equal(await createTab.getAttribute('aria-selected'),'true');checks.push('parallel-tabs-keyboard-and-update-target-contained-in-update-panel');
  for(const locator of [createTab,updateTab,createButton]){await inspect(locator,await locator.innerText());await inspect(locator,await locator.innerText(),{disabled:true})}
  await updateTab.click();for(const locator of [select,updateButton]){await inspect(locator,await locator.getAttribute('aria-label')||await locator.innerText());await inspect(locator,await locator.getAttribute('aria-label')||await locator.innerText(),{disabled:true})}await createTab.click();
  const handled=await page.evaluate(id=>!window.dispatchEvent(new CustomEvent('operation-recover',{cancelable:true,detail:{path:'/tasks/'+id+'/agent/apply',error:'对话已更新，请重新整理后写入',route:'task/'+id}})),seed.task_id);assert(handled);await page.getByRole('alert').filter({hasText:'对话已更新'}).waitFor();assert(await page.locator('.profile-recovery').evaluate(el=>el.open));checks.push('operation-recover-opens-local-controls-and-error');
  // Hold only this local request to observe busy state; then let the real API handle it.
  const beforeCreate=await profiles();
  let release;const held=new Promise(r=>release=r);await page.route('**/agent/prepare-profile',async route=>{await held;await route.continue()});
  await createButton.click();assert(await createTab.isDisabled());assert(await updateTab.isDisabled());assert(await createButton.isDisabled());assert(await applyButton.isDisabled());release();await page.unroute('**/agent/prepare-profile');
  await page.locator('.profile-write-target').filter({hasText:'新增 测试新增 IP'}).waitFor();await page.waitForFunction(()=>!document.querySelector('.agent-result .primary').disabled);
  let proposal=(await task()).agent_proposal;assert.equal(proposal.operation,'create');assert.equal(proposal.target_id,null);assert.deepEqual(await profiles(),beforeCreate);
  if(!await page.locator('.profile-recovery').evaluate(el=>el.open))await page.locator('.profile-recovery summary').click();
  const createRequest=requests.filter(x=>x.url.endsWith('/agent/prepare-profile')).at(-1);assert.equal(createRequest.body.operation,'create');assert(!('target_id' in createRequest.body));
  await updateTab.click();assert(await applyButton.isDisabled());assert(await editButton.isDisabled());assert.equal((await task()).agent_proposal.id,proposal.id);await createTab.click();assert(await applyButton.isEnabled());
  await applyButton.click();await page.getByRole('link',{name:'查看结果 →',exact:true}).waitFor();let saved=(await profiles()).find(x=>x.id===proposal.new_profile_id);assert(saved);assert.equal(saved.write_operation,'create');assert.equal((await profiles()).length,4);
  const createApply=requests.filter(x=>x.url.endsWith('/agent/apply')).at(-1);assert.deepEqual(createApply.body,{proposal_id:proposal.id,task_version:proposal.task_version});checks.push('busy-blocked-real-create-prepare-and-apply-bound-to-proposal');
  const newTask={id:seed.task_id};
  const firstUpdate=await call('/tasks/'+newTask.id+'/agent/prepare-profile',{operation:'update',target_id:seed.profile_id});
  for(let i=0;i<100;i++){if((await call('/jobs/'+firstUpdate.id)).status==='done')break;await pause(100)}
  await page.locator('.profile-write-target').filter({hasText:'更新 原有 IP'}).waitFor();await page.locator('.profile-recovery summary').click();assert.equal(await updateTab.getAttribute('aria-selected'),'true');assert.equal(await select.inputValue(),seed.profile_id);
  await select.selectOption(seed.alternate_id);assert(await applyButton.isDisabled());await select.selectOption('');assert(await updateButton.isDisabled());assert(await applyButton.isDisabled());await select.selectOption(seed.profile_id);
  await updateButton.click();await page.waitForFunction(()=>!document.querySelector('.agent-result .primary').disabled);
  const updateTask=task;proposal=(await updateTask()).agent_proposal;assert.equal(proposal.operation,'update');assert.equal(proposal.target_id,seed.profile_id);
  const updateRequest=requests.filter(x=>x.url.endsWith('/agent/prepare-profile')).at(-1);assert.deepEqual(updateRequest.body,{operation:'update',target_id:seed.profile_id});
  const beforeUpdate=(await profiles()).find(x=>x.id===seed.profile_id);assert.equal(beforeUpdate.position,original.position);await applyButton.click();await page.getByRole('link',{name:'查看结果 →',exact:true}).waitFor();saved=(await profiles()).find(x=>x.id===seed.profile_id);assert.equal(saved.position,'隔离测试定位');assert.equal(saved.write_operation,'update');assert.equal((await profiles()).length,4);
  for(const key of ['agency_brands','channels','custom_note'])assert.equal(saved[key],original[key]);assert.deepEqual((await profiles()).find(x=>x.id===seed.alternate_id),alternate);
  const updateApply=requests.filter(x=>x.url.endsWith('/agent/apply')).at(-1);assert.deepEqual(updateApply.body,{proposal_id:proposal.id,task_version:proposal.task_version});checks.push('real-update-prepare-and-apply-only-selected-target-preserve-custom-fields');
  // Version staleness is exercised by a real local task edit, not a mocked UI flag.
  const prepared=await call('/tasks/'+newTask.id+'/agent/prepare-profile',{operation:'update',target_id:seed.profile_id});
  for(let i=0;i<100;i++){if((await call('/jobs/'+prepared.id)).status==='done')break;await pause(100)}
  let latest=await updateTask();proposal=latest.agent_proposal;await call('/objects/'+newTask.id,{version:latest.version,title:'对话版本已变化'},'PATCH');
  await page.getByRole('status').filter({hasText:'对话已更新，请重新整理'}).waitFor();assert(await applyButton.isDisabled());assert(await editButton.isDisabled());
  const beforeStale=await profiles();await call('/tasks/'+newTask.id+'/agent/apply',{proposal_id:proposal.id,task_version:proposal.task_version},'POST',409);assert.deepEqual(await profiles(),beforeStale);checks.push('stale-version-blocks-ui-and-real-api-write-with-409');
  for(const width of [1280,720,390]){await page.setViewportSize({width,height:1000});await settleUI(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:path.join(directory,'tabs-'+width+'.png'),fullPage:true})}
  await page.goto(base+'/#studio/brand');await page.locator('.ip-profile-card').first().waitFor();await page.reload();await page.locator('.ip-profile-card').first().waitFor();assert.equal(await page.locator('.ip-profile-card').count(),3);for(const width of [1280,720,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2))}checks.push('archives-survive-reload-and-existing-layout-fits-desktop-and-mobile');
  assert(states.every(x=>x.passed),'state contrast failures: '+JSON.stringify(states.filter(x=>!x.passed)));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report(true);
 }
}catch(error){if(!symptomsOnly||symptoms.length<2)report(false);if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(0,1500))}}console.error(output);throw error}finally{await browser?.close();service.kill();ui.close()}
