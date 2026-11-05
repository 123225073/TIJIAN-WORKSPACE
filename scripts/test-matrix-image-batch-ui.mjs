// Isolated actual Chromium + local API; publishing and paid generation are blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('matrix-image-batch-ui');let browser;
const python=code=>new Promise((resolve,reject)=>{const process=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',code],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='',error='';process.stdout.on('data',chunk=>text+=chunk);process.stderr.on('data',chunk=>error+=chunk);process.once('exit',status=>status===0?resolve(JSON.parse(text)):reject(Error(error)));process.stdin.end(JSON.stringify({owner:fixture.auth.user.id}))});
try{
 const records=await python(String.raw`
import json,sys
from backend import store as s
owner=json.load(sys.stdin)['owner'];s.init()
topic=s.put(owner,'studio_topic',{'title':'隔离批量配图选题','status':'ready'})
flow=s.put(owner,'studio_flow',{'title':topic['title'],'brief':topic['title'],'topic_id':topic['id'],'stage':3})
contents=[s.put(owner,'content',{'title':'隔离 '+platform+' 文稿','body':'已保存的电梯行业正文。先核对现场资料，再组织服务沟通。','flow_id':flow['id'],'format':'小红书文案' if platform=='xiaohongshu' else '公众号文章'}) for platform in ['wechat','xiaohongshu','website']]
print(json.dumps(dict(topic=topic,flow=flow,contents=contents)))
`);
 const platforms=['wechat','xiaohongshu','website'],matrix={master:{id:'fixture-master',flow_id:records.flow.id,topic_id:records.topic.id,body:'隔离母版正文。',platforms,version:1},runs:records.contents.map((content,index)=>({id:'fixture-run-'+index,draft_id:'fixture-draft-'+index,status:'done',platform:platforms[index],content_id:content.id,content_version:content.version,content}))};
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1450,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await fixture.attach(page);
 await page.route('**/api/studio/flows/'+records.flow.id+'/matrix',route=>route.request().method()==='GET'?route.fulfill({json:matrix}):route.continue());
 await page.goto(fixture.base+'/#studio/flow?work='+records.flow.id+'&step=4');await page.reload();
 const reminder=page.getByRole('button',{name:'稍后再做'});await reminder.waitFor({timeout:1200}).catch(()=>{});if(await reminder.isVisible())await reminder.click();
 const panel=page.getByRole('region',{name:'所有平台批量配图'});await panel.waitFor();
 await panel.getByRole('button',{name:'为所有平台配图',exact:true}).click();await panel.getByRole('button',{name:'确认并开始配图'}).waitFor();
 assert.match(await panel.innerText(),/新生成 9 张/);assert.equal(await panel.locator('.mib-confirm li').count(),3);assert.match(await panel.innerText(),/已保存|文稿 v1/);
 await panel.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await panel.locator('.mib-confirm').count(),0);assert.equal(fixture.guard.forbidden.length,0);
 const legacyKey='article-picture:'+fixture.auth.user.id+':'+records.contents[0].id;
 await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({pending:true})),legacyKey);await panel.getByRole('button',{name:'为所有平台配图',exact:true}).click();await panel.getByRole('alert').filter({hasText:'原配图任务仍在运行'}).waitFor();assert.equal(await panel.locator('.mib-confirm').count(),0);await page.evaluate(key=>localStorage.removeItem(key),legacyKey);
 const oldKey='social-picture-batch:'+fixture.auth.user.id+':'+records.contents[0].id;
 await page.evaluate(({key,owner,id})=>localStorage.setItem(key,JSON.stringify({id:'other-old-batch',owner,content_id:id,body:'另一版正文',slots:[{status:'running'}]})),{key:oldKey,owner:fixture.auth.user.id,id:records.contents[0].id});await panel.getByRole('button',{name:'为所有平台配图',exact:true}).click();await panel.getByRole('alert').filter({hasText:'另一版正文'}).waitFor();assert.equal(await panel.locator('.mib-confirm').count(),0);await page.evaluate(key=>localStorage.removeItem(key),oldKey);
 // A completed manifest reopens without creating or changing a generation batch.
 const manifest={id:'fixture-matrix-batch',owner:fixture.auth.user.id,flow_id:records.flow.id,topic_id:records.topic.id,created:new Date().toISOString(),items:records.contents.map((content,index)=>({platform:platforms[index],label:['微信公众号','小红书','官网 / 品牌博客'][index],content_id:content.id,content_version:1,snapshot:content,batch_id:'fixture-batch-'+index,status:'done',done:3,total:3,existing:0}))};
 await page.evaluate(value=>localStorage.setItem(`matrix-image-batch:${value.owner}:${value.flow_id}:${value.topic_id}`,JSON.stringify(value)),manifest);
 await page.reload();await reminder.waitFor({timeout:1500}).catch(()=>{});if(await reminder.isVisible())await reminder.click();await panel.waitFor();await panel.locator('.mib-progress').waitFor();assert.match(await panel.innerText(),/3 \/ 3 个平台完成/);assert.equal(await panel.locator('.mib-progress li').count(),3);
 await settleUI(page);const contrast=await page.evaluate(measureContrast,{scope:'.matrix-image-batch'});assert.deepEqual(contrast.violations,[]);await page.screenshot({path:path.join(fixture.directory,'matrix-batch-restored.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard.forbidden,[]);assert.deepEqual(fixture.guard.external,[]);
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,fixture_only:true,checks:['three-platform-saved-content-preflight','explicit-nine-image-charge-confirmation','cancel-never-submits-generation','legacy-active-generation-blocks-new-charge','old-body-active-batch-cannot-be-mislabeled-new-version','restored-manifest-does-not-recreate-completed-batches','contrast-and-no-page-errors'],integration:fixture.integration},null,2));console.log(JSON.stringify({passed:true,directory:fixture.directory}));
}catch(error){if(browser){for(const context of browser.contexts())for(const page of context.pages()){await page.screenshot({path:path.join(fixture.directory,'failed.png')});fs.writeFileSync(path.join(fixture.directory,'failed.txt'),await page.locator('body').innerText())}}console.error(fixture.directory);throw error}finally{await browser?.close();fixture.close()}
