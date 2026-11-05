// Real Chromium + isolated local API/storage. Historical fixtures only; no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('task-center-ui'),checks=[];
let browser;
const python=(code,data={})=>new Promise((resolve,reject)=>{
 const proc=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',code],{env:{...fixture.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',error='';proc.stdout.on('data',c=>out+=c);proc.stderr.on('data',c=>error+=c);proc.once('exit',status=>status===0?resolve(out.trim()?JSON.parse(out):{}):reject(Error(error)));proc.stdin.end(JSON.stringify({owner:fixture.auth.user.id,...data}));
});
try{
 const ids=await python(String.raw`
import sys,json
from datetime import datetime,timedelta,timezone
from backend import store as s
d=json.load(sys.stdin);s.init();owner=d['owner'];now=datetime.now(timezone.utc)
start=(now-timedelta(seconds=12)).isoformat();created=(now-timedelta(seconds=15)).isoformat()
writing=s.put(owner,'job',{'title':'隔离写作进度','status':'running','created':created,'started_at':start,'progress':'正在生成 · 已收到 120 字符','input':{'action':'studio_text'},'stream_text':'不应挤在右上角的输出'*100})
image=s.put(owner,'studio_run',{'title':'隔离图片进度','tool':'text_image','status':'running','created':created,'started_at':start,'progress':'等待模型返回图片'})
legacy=s.put(owner,'job',{'title':'隔离历史缺失时间','status':'done','updated':now.isoformat()})
deleted=s.put(owner,'studio_run',{'title':'隔离待删除失败视频','tool':'text_video','provider':'oairegbox','status':'failed','created':created})
print(json.dumps({'writing':writing,'image':image,'legacy':legacy,'deleted':deleted}))
`);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1450,height:950}}),errors=[],mutations=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()!=='GET'&&/\/api\/(?:jobs|studio\/runs)/.test(new URL(request.url()).pathname))mutations.push(request.url())});
 const dismissStartup=async()=>{const button=page.getByRole('button',{name:'稍后再做',exact:true});if(await button.isVisible())await button.click()};
 await fixture.attach(page);await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismissStartup();
 await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();
 await page.getByRole('button',{name:'当前任务',exact:true}).click();
 const center=page.locator('.task-center[open]'),list=center.locator('.task-center-list');await center.waitFor();
 await list.getByRole('button').filter({hasText:'隔离写作进度'}).click();
 const elapsed=page.locator('[data-task-elapsed="'+ids.writing.id+'"]');
 const before=await elapsed.innerText();assert.notEqual(before,'未记录');await page.waitForTimeout(1200);assert.notEqual(await elapsed.innerText(),before);
 assert.match(await center.innerText(),/正在生成 · 已收到 120 字符/);
 assert.equal(await page.locator('.page-operations').count(),0);
 assert.equal(await center.locator('.stream-preview').count(),0);
 checks.push('writing-real-backend-state-live-elapsed-no-floating-stream');
 await page.getByRole('button',{name:'关闭任务进度',exact:true}).click();await center.waitFor({state:'detached'});
 await page.waitForTimeout(1100);
 await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor();assert.notEqual(await elapsed.innerText(),before);
 assert.equal(mutations.length,0,'closing/reopening must never cancel or resubmit');
 checks.push('close-and-reopen-keeps-execution-and-clock');
 await list.getByRole('button').filter({hasText:'生成图片'}).click();await center.getByRole('heading',{name:'生成图片',exact:true}).waitFor();
 assert.match(await center.innerText(),/隔离图片进度/);assert.notEqual(await page.locator('[data-task-elapsed="'+ids.image.id+'"]').innerText(),'未记录');
 await page.keyboard.press('Escape');await center.waitFor({state:'detached'});
 await page.evaluate(()=>{location.hash='studio/flow'});await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor();
 await list.getByRole('button').filter({hasText:'隔离写作进度'}).click();
 checks.push('image-generation-and-navigation-use-same-center-escape-hides');
 await python(String.raw`
import json,sys
from backend import store as s,media_studio as m
d=json.load(sys.stdin);s.init();owner=d['owner']
j=s.get(owner,d['writing']);s.put(owner,'job',{**j,'status':'done','progress':'已完成','finished_at':s.now()},j['id'])
m._update(owner,d['image'],status='succeeded')
`,{writing:ids.writing.id,image:ids.image.id});
 await page.waitForFunction(id=>document.querySelector('[data-task-elapsed="'+id+'"]')?.closest('section')?.textContent?.includes('执行耗时'),ids.writing.id);
 const finished=await elapsed.innerText();await page.waitForTimeout(1300);assert.equal(await elapsed.innerText(),finished);
 await page.reload();await page.getByRole('button',{name:'当前任务',exact:true}).waitFor();await dismissStartup();await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor();await list.getByRole('button').filter({hasText:'隔离写作进度'}).click();assert.equal(await elapsed.innerText(),finished);
 checks.push('completed-duration-freezes-and-refresh-restores-server-time');
 await list.getByRole('button').filter({hasText:'隔离历史缺失时间'}).click();assert.equal(await page.locator('[data-task-elapsed="'+ids.legacy.id+'"]').innerText(),'未记录');
 checks.push('legacy-missing-times-are-not-guessed-from-updated');
 await page.getByRole('button',{name:'关闭任务进度',exact:true}).click();
 await page.evaluate(job=>{
  const event=detail=>window.dispatchEvent(new CustomEvent('operation',{detail:{id:'isolated-dedup',label:'构思文章配图',path:'/studio/text/article-illustration-prompt',route:location.hash.slice(1),at:Date.now(),...detail}}));
  event({pending:true});event({pending:false,job});
 },{...ids.writing,status:'queued',input:{action:'article_illustration_suggestion'}});
 assert.equal(await center.count(),0,'closing must suppress later batch-stage popups');
 await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor();const dedup=list.getByRole('button').filter({hasText:'构思文章配图'});assert.equal(await dedup.count(),1,'operation and server job must collapse into one row');await dedup.click();assert.match(await dedup.innerText(),/已完成/,'an older queued response must not overwrite the completed server version');assert.equal(await elapsed.innerText(),finished);
 checks.push('article-illustration-human-label-and-job-operation-dedup');
 await page.getByRole('button',{name:'关闭任务进度',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('operation',{detail:{id:'isolated-ordinary-save',label:'保存创作步骤',path:'/studio/flows/isolated/matrix',route:location.hash.slice(1),at:Date.now(),pending:true}})));
 await page.waitForTimeout(150);assert.equal(await center.count(),0,'ordinary matrix saves must not open the task center');
 await page.getByRole('button',{name:'当前任务',exact:true}).click();await center.waitFor();assert.equal(await list.getByRole('button').filter({hasText:'保存创作步骤'}).count(),0);
 await fixture.call('/studio/runs/'+ids.deleted.id,undefined,'DELETE');
 await center.getByRole('button',{name:'刷新记录',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.task-center-list')?.textContent.includes('隔离待删除失败视频'));
 await page.getByRole('button',{name:'关闭任务进度',exact:true}).click();await page.getByRole('button',{name:'当前任务',exact:true}).click();assert.equal(await list.getByRole('button').filter({hasText:'隔离待删除失败视频'}).count(),0);
 checks.push('ordinary-save-is-quiet-and-deleted-failure-stays-removed');
 for(const viewport of [{width:1450,height:950},{width:390,height:720}]){
  await page.setViewportSize(viewport);
  const bounds=await center.boundingBox();assert(bounds.width<=viewport.width&&bounds.height<=viewport.height);
  assert(await center.locator('.task-center-close').evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}));
  const contrast=await page.evaluate(measureContrast,{scope:'.task-center'});assert.equal(contrast.violations.length,0,JSON.stringify(contrast.violations));
  await page.screenshot({path:path.join(fixture.directory,`task-center-${viewport.width}.png`)});
 }
 checks.push('desktop-and-small-screen-visible-close-and-readable-contrast');
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard.external,[]);assert.deepEqual(fixture.guard.forbidden,[]);assert.deepEqual(mutations,[]);
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,fixture_only:true,checks,integration:fixture.integration,errors,mutations},null,2));
 console.log(JSON.stringify({passed:true,checks,directory:fixture.directory}));
}finally{await browser?.close();fixture.close()}
