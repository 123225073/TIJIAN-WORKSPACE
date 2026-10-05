import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

// Fresh local data and a synthetic running task. No generation endpoint is called.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tijian-media-async-'));
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
 windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let errors='',browser;
service.stderr.on('data',chunk=>errors+=chunk);
try{
 let ready=false;
 for(let i=0;i<150;i++){
  try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 if(!ready)throw Error(errors||'Fixture not ready');
 const login=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'media-async@example.test',password:'isolated-test-only',name:'异步媒体验证'})});
 assert.equal(login.status,200);
 const auth=await login.json(),headers={Authorization:'Bearer '+auth.token};
 const created=await fetch(base+'/api/studio/drafts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({tool:'text_image',title:'异步界面验证',input:{prompt:'原始画面要求'},options:{}})});
 assert.equal(created.status,200);
 const draft=await created.json();
 browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1480,height:960}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 let generationRequests=0,refreshRequests=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/studio/generate')generationRequests++});
 const run={id:'synthetic-running-task',draft_id:draft.id,tool:'text_image',title:'异步界面验证',status:'running',asset_ids:[],batch_total:3,result_count:0,
  billing_progress:{task_ids:1,uncertain_submissions:0,not_submitted:2},output_items:[{index:1,status:'running',task_id:'synthetic-id'},{index:2,status:'queued'},{index:3,status:'queued'}],
  created:new Date().toISOString(),generation:{input:{prompt:'原始画面要求'},options:{n:3}}};
 await page.route('**/api/studio/runs',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[run]})}));
 await page.route('**/api/studio/runs/*/refresh',route=>{refreshRequests++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(run)})});
 await page.goto(base);
 await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/image?mode=text_image&draft='+draft.id);
 await page.getByText('已取得 1 / 3 个供应商任务编号').waitFor({timeout:30000});
 assert.deepEqual(await page.getByRole('list',{name:'逐张生成状态'}).getByRole('listitem').allInnerTexts(),['第1张：生成中 · 任务 ID synthetic-id','第2张：待提交','第3张：待提交']);
 for(let i=0;i<40&&refreshRequests===0;i++)await new Promise(resolve=>setTimeout(resolve,150));
 assert(refreshRequests>0,'活动中的原任务应由页面自动查询');
 await page.waitForFunction(()=>document.querySelectorAll('.mw-model select option').length>1,undefined,{timeout:30000});
 assert(await page.locator('.mw-generate').isDisabled(),'任务仍在运行时不应重复提交当前草稿');
 assert(await page.locator('.media-refs-drop').isEnabled(),'后台生成不应锁住参考素材');
 await page.getByLabel('生成模型').selectOption('service:aliyun');
 await page.locator('.mw-parameter-button').click();
 assert(await page.locator('.mw-parameters').getByText('生成张数').count(),'阿里云图片模型应提供生成张数');
 await page.locator('.mw-parameters fieldset').filter({hasText:'生成张数'}).getByRole('button',{name:'3'}).click();
 await page.getByRole('button',{name:'完成设置'}).click();
 await page.getByText('本次请求 3 张；实际费用以供应商账单为准').waitFor();
 await page.getByLabel('生成模型').selectOption('media:wavespeed-gpt-image-25-flare-text');
 await page.locator('.mw-parameter-button').click();
 const waveCount=page.locator('.mw-parameters fieldset').filter({hasText:'生成张数'});
 assert.equal(await waveCount.locator('button').count(),5,'WaveSpeed 应提供默认和 1–4 张');
 await waveCount.getByRole('button',{name:'3'}).click();
 await page.getByText('选择多张时，后台将逐张独立提交').waitFor();
 await page.getByRole('button',{name:'完成设置'}).click();
 await page.getByText('本次最多请求 3 张；多次服务调用，实际费用以供应商账单为准').waitFor();
 await page.getByLabel('输入你的要求').fill('生成期间继续编辑的新要求');
 const upload=fs.readFileSync('build/tijian.png');
 await page.locator('.media-refs input[type=file]').setInputFiles({name:'new-reference.png',mimeType:'image/png',buffer:upload});
 await page.waitForFunction(()=>document.querySelector('.media-refs-label')?.textContent?.includes('1 / 16'),undefined,{timeout:30000});
 assert(await page.getByLabel('输入你的要求').inputValue()==='生成期间继续编辑的新要求');
 const assets=(await(await fetch(base+'/api/studio/assets',{headers})).json()).items;
 const savedImage=assets.find(asset=>asset.asset_type==='image'&&asset.status==='ready');
 assert(savedImage,'隔离上传的图片应可用于部分成功展示');
 Object.assign(run,{status:'partial',asset_ids:[savedImage.id],result_count:1,
  billing_progress:{task_ids:2,uncertain_submissions:0,not_submitted:1},
  output_items:[{index:1,status:'succeeded',task_id:'synthetic-id',asset_ids:[savedImage.id]},
   {index:2,status:'failed',task_id:'synthetic-failed',error:'供应商任务失败；费用以供应商账单为准'},
   {index:3,status:'not_submitted',error:'前一张提交未完成，本张未提交，不会计费'}]});
 await page.reload();
 await page.locator('.mw-result-card .st-status').getByText('部分完成').waitFor();
 await page.locator('.mw-result-card .mw-edit-result').waitFor({timeout:15000});
 assert.equal(await page.locator('.mw-result-card .mw-edit-result').count(),1,'已保存图片应可查看');
 const rows=await page.getByRole('list',{name:'逐张生成状态'}).getByRole('listitem').allInnerTexts();
 assert(rows[0].includes('第1张：已保存')&&rows[1].includes('第2张：生成失败')&&rows[1].includes('synthetic-failed')&&rows[1].includes('费用以供应商账单为准')&&rows[2].includes('第3张：未提交（未发起生成）'));
 assert.equal(generationRequests,0);
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({passed:true,checks:['active task polls known provider IDs through refresh','running task keeps editor and reference upload usable','accurate Aliyun and WaveSpeed billing text','partial result shows saved image and failed slot separately','duplicate submit stays disabled','no paid generation request']}));
}finally{
 if(browser)await browser.close();
 service.kill();
 if(service.exitCode===null)await new Promise(resolve=>service.once('exit',resolve));
}
