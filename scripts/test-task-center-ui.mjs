// Real Chromium and isolated API/storage. Seeded fixture states never call a model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('task-center-ui'),checks=[];let browser;
const python=(code,data={})=>new Promise((resolve,reject)=>{const p=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',code],{env:{...fixture.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.once('exit',s=>s===0?resolve(JSON.parse(out||'{}')):reject(Error(err)));p.stdin.end(JSON.stringify({owner:fixture.auth.user.id,...data}))});
try{
 const ids=await python(String.raw`
import json,sys
from datetime import datetime,timedelta,timezone
from backend import store as s
d=json.load(sys.stdin);s.init();owner=d['owner'];now=datetime.now(timezone.utc);created=(now-timedelta(seconds=15)).isoformat();start=(now-timedelta(seconds=12)).isoformat()
def put(kind,title,**kw):return s.put(owner,kind,dict(title=title,created=created,started_at=start,**kw))
writing=put('job','隔离写作进度',status='running',input={'action':'studio_text'},progress='正在生成 · 已收到 120 字符')
new=put('job','隔离新主动写作',status='running',input={'action':'studio_text'},progress='正在生成新文章')
prompts=[put('job','隔离配图构思',status='done',finished_at=now.isoformat(),input={'action':'article_illustration_prompt'}) for _ in range(3)]
images=[put('studio_run','独立配图 12345678-1234-1234-1234-123456789012 2 1',tool='text_image',status='running',progress='等待图片结果') for _ in range(3)]
for i in range(68):put('job','历史任务不应出现 '+str(i),status='done',finished_at=now.isoformat())
print(json.dumps(dict(writing=writing,new=new,prompts=prompts,images=images)))
`);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1450,height:950}}),errors=[],mutations=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&/\/api\/(?:jobs|studio\/runs)/.test(new URL(r.url()).pathname))mutations.push(r.url())});
 const center=page.locator('.task-center[data-open="true"]'),list=center.locator('.task-center-list');
 const dismiss=async()=>{const b=page.getByRole('button',{name:'稍后再做',exact:true});await b.waitFor({state:'visible',timeout:1200}).catch(()=>{});if(await b.isVisible())await b.click()};
 const open=async()=>{await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor()};
 const close=async()=>{await page.getByRole('button',{name:'关闭任务进度',exact:true}).click();await center.waitFor({state:'detached'})};
 const event=async(job,id,group)=>page.evaluate(({job,id,group})=>{for(const pending of [true,false])window.dispatchEvent(new CustomEvent('operation',{detail:{id,group_id:group,group_title:group,route:'studio/text',label:'撰写文章',path:'/studio/text/generate',pending,at:Date.now(),...(!pending?{job}:{})}}))},{job,id,group});
 await fixture.attach(page);await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();
 assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);assert(!/历史任务不应出现/.test(await center.innerText()));checks.push('startup-recovers-one-active-operation-without-68-historical-tasks');await close();
 await event(ids.writing,'write-request','本次写作');assert.equal(await center.count(),0);await page.getByRole('button',{name:'查看本次任务进度',exact:true}).waitFor();await open();assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);assert.match(await center.innerText(),/本次写作/);
 await list.locator(':scope > .task-center-row > button').first().click();const elapsed=page.locator('[data-task-elapsed="'+ids.writing.id+'"]');const before=await elapsed.innerText();assert.notEqual(before,'未记录');await page.waitForTimeout(1200);assert.notEqual(await elapsed.innerText(),before);assert.equal(await center.locator('.stream-preview').count(),0);
 await close();await page.waitForTimeout(1100);await open();assert.match(await center.innerText(),/本次写作/);assert.notEqual(await elapsed.innerText(),before);assert.equal(mutations.length,0);checks.push('same-current-operation-close-reopen-keeps-execution-and-live-clock');
 await close();
 await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('operation',{detail:{id:'ordinary-save',label:'保存操作',path:'/studio/content/save',pending:false,error:'隔离保存失败',at:Date.now()}}))});assert.equal(await center.count(),0);checks.push('ordinary-save-failure-does-not-open-or-replace-task-progress');
 const batch={id:'isolated-batch',owner:fixture.auth.user.id,content_id:'fixture-content',purpose:'article',slots:ids.images.map((run,index)=>({index,status:'running',job_id:ids.prompts[index].id,run_id:run.id})),attached:[]};
 await page.evaluate(batch=>{const key='social-picture-batch:'+batch.owner+':'+batch.content_id;localStorage.setItem(key,JSON.stringify(batch));window.dispatchEvent(new CustomEvent('social-picture-batch',{detail:key}))},batch);
 await open();await list.locator(':scope > .task-center-row > button').filter({hasText:'配图 1'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.task-center[data-open="true"] .task-center-list > .task-center-row > button').length===3);assert.equal(await list.locator(':scope > .task-center-row > button').filter({hasText:'撰写文章'}).count(),0);await list.locator(':scope > .task-center-row > button').filter({hasText:'配图 2'}).click();assert(!/独立配图|12345678-/.test(await center.innerText()));checks.push('three-images-render-exactly-three-tasks-with-planning-inside-each-task');
 await close();await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();await list.locator(':scope > .task-center-row > button').filter({hasText:'配图 1'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.task-center[data-open="true"] .task-center-list > .task-center-row > button').length===3);checks.push('reload-restores-three-current-image-tasks');
 await center.getByLabel('切换未完成操作').selectOption('本次写作');assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);assert.match(await center.innerText(),/本次写作/);await close();
 await event(ids.new,'next-request','本次新写作');await open();assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);assert.match(await center.innerText(),/本次新写作/);
 await page.evaluate(batch=>{const key='social-picture-batch:'+batch.owner+':'+batch.content_id;window.dispatchEvent(new CustomEvent('social-picture-batch',{detail:key}))},batch);assert.match(await center.locator('.task-center-scope').innerText(),/本次新写作/);assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);checks.push('new-user-action-replaces-view-without-discarding-or-stealing-other-running-groups');await list.locator(':scope > .task-center-row > button').first().click();
 await python(String.raw`
import json,sys
from backend import store as s
d=json.load(sys.stdin);s.init();j=s.get(d['owner'],d['id']);s.put(d['owner'],'job',{**j,'status':'done','progress':'已完成','finished_at':s.now()},j['id']);print('{}')
`,{id:ids.new.id});
 await page.waitForFunction(id=>document.querySelector('[data-task-elapsed="'+id+'"]')?.closest('section')?.textContent.includes('执行耗时'),ids.new.id);
 const finish=await page.locator('[data-task-elapsed="'+ids.new.id+'"]').innerText();await page.waitForTimeout(1300);assert.equal(await page.locator('[data-task-elapsed="'+ids.new.id+'"]').innerText(),finish);
 await center.waitFor({state:'detached'});await open();await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();await list.locator(':scope > .task-center-row > button').first().click();assert.equal(await page.locator('[data-task-elapsed="'+ids.new.id+'"]').innerText(),finish);checks.push('finished-duration-freezes-and-reload-keeps-current-completed-operation');

 const unresolved=await python(String.raw`
import json,sys
from backend import store as s
d=json.load(sys.stdin);s.init();items=[]
for status in ['unknown','archive_failed']:
 j=s.put(d['owner'],'studio_run',{'title':'隔离未决图片','tool':'text_image','status':status,'created':'2020-01-01T00:00:00+00:00','progress':'结果需核查'});items.append(j)
 with s.conn() as c:c.execute('UPDATE objects SET updated=? WHERE id=?',('2020-01-01T00:00:00+00:00',j['id']))
print(json.dumps(items))
`);
 for(const [index,job] of unresolved.entries())await event(job,'unresolved-request-'+index,'需核查操作 '+index);
 await page.waitForFunction(owner=>JSON.parse(localStorage.getItem('task-center-scopes:'+owner)).groups.filter(g=>g.id.startsWith('需核查操作')).every(g=>g.unresolved),fixture.auth.user.id);
 await event(ids.writing,'final-request','最终当前操作');await close();await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();
 for(let index=0;index<2;index++){await center.getByLabel('切换未完成操作').getByRole('option',{name:'需核查操作 '+index,exact:true}).waitFor({state:'attached'});await center.getByLabel('切换未完成操作').selectOption('需核查操作 '+index);assert.equal(await list.locator(':scope > .task-center-row > button').count(),1);assert.match(await center.innerText(),/结果需核查/)}
 await center.getByLabel('切换未完成操作').selectOption('最终当前操作');checks.push('unknown-and-archive-failed-groups-survive-new-operation-and-reload-beyond-60-row-history');
 for(const viewport of [{width:1450,height:950},{width:390,height:720}]){await page.setViewportSize(viewport);assert.equal(await center.getAttribute('aria-modal'),'false');const box=await center.boundingBox();assert(box.width<=viewport.width&&box.height<=viewport.height);assert(await center.locator('.task-center-close').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}));await settleUI(page);const contrast=await page.evaluate(measureContrast,{scope:'.task-center'});assert.deepEqual(contrast.violations,[]);await page.screenshot({path:path.join(fixture.directory,'task-center-'+viewport.width+'.png')})}checks.push('desktop-mobile-close-button-and-contrast');
 const second=await(await fetch(fixture.apiBase+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'separate@example.test',name:'隔离第二账号',password:'isolated-test-only'})})).json();assert(second.token);
 await close();await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),second.token);await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();assert.equal(await list.locator(':scope > .task-center-row > button').count(),0);assert(!/最终当前操作|本次新写作|配图 1|本次写作/.test(await center.innerText()));
 await close();await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),fixture.auth.token);await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismiss();await open();assert.match(await center.locator('.task-center-scope').innerText(),/最终当前操作/);checks.push('account-isolation-and-return-to-original-current-operation');
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.deepEqual(fixture.guard.external,[]);assert.deepEqual(fixture.guard.forbidden,[]);
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,fixture_only:true,checks,integration:fixture.integration,errors,mutations},null,2));console.log(JSON.stringify({passed:true,checks,directory:fixture.directory}));
}finally{await browser?.close();fixture.close()}
