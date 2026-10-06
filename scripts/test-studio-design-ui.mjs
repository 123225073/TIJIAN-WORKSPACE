// Real local API and isolated storage only. No paid media or publishing call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,testWorkflow,settleUI,seedFilledFlow} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('studio-design'),{directory,base,apiBase,auth,headers,call}=fixture;
let browser;const report=[],failures=[];
try {
 const content=await call('/objects/content',{title:'电梯更新如何提前准备',body:'先核对维保记录、现场条件和设备状态。\n\n准备预算与现场沟通时，把已知情况讲清楚，不编造价格。',platform:'wechat',outcome_type:'writing',summary:'从真实信息出发，让更新决策更清楚。'});
 const task=await call('/objects/task',{title:'AI 对话 · 电梯更新',mode:'qa',messages:[{role:'user',text:'帮我写一篇公众号文章',at:new Date().toISOString()}],platform_outcomes:{wechat:content.id},profile_id:''});
 await call('/objects/profile',{title:'电梯服务顾问',position:'用行业经验解决物业客户的实际问题',audience:'物业经理',style:'清晰务实'});
 await call('/import/text',{title:'电梯更新核对资料',body:'更新电梯前需要核对设备资料、维保记录、现场条件和资金安排。'});
 await call('/studio/topics',{title:'电梯报价为什么差这么多',angle:'把现场条件和服务范围讲清楚',source_ids:[],status:'selected'});
 const form=new FormData();form.append('file',new Blob([fs.readFileSync('build/tijian.png')],{type:'image/png'}),'电梯品牌参考图.png');
 const upload=await fetch(apiBase+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+auth.token},body:form});assert(upload.ok);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 let forbiddenRequests=0;page.on('request',request=>{const url=new URL(request.url());if(['/api/studio/generate','/api/wechat-publish/publish'].includes(url.pathname))forbiddenRequests++});
 await fixture.attach(page);
 const screens=[['home','studio/home','.tw-home'],['flow','studio/flow','.cf-page'],['image','studio/image','.media-workbench'],['video','studio/video','.media-workbench'],['text','studio/text','.studio-v2'],['assets','studio/assets','.st-library-tabs'],['works','studio/works','.st-library-tabs'],['knowledge','knowledge','.knowledge-page'],['inspiration','benchmark','.benchmark-studio-v2'],['profile','studio/brand','.ip-dashboard'],['conversation','task/'+task.id,'.aw-workspace'],['topics','studio/topics','.tlc'],['avatar','studio/avatar/text','.studio-v2'],['voice','studio/audio/tts','.studio-v2'],['settings','studio/memory-settings','.surface']];
 for(const [name,route,selector] of screens){
  const start=Date.now();await page.goto(base+'/?ui=1#'+route);await page.locator(selector).waitFor({timeout:30000});
  await page.locator('.boot').waitFor({state:'hidden'});await settleUI(page);
  const contrast=await page.evaluate(measureContrast,{scope:'.page-area',excludeUserPaper:true});
  const metrics=await page.evaluate(()=>{
   const panel=document.querySelector('.mw-panel,.aw-results,.knowledge-reader,.st-asset-card'),root=getComputedStyle(document.documentElement);
   return {background:getComputedStyle(document.body).backgroundColor,panel:panel?getComputedStyle(panel).backgroundColor:null,overflow:document.documentElement.scrollWidth>innerWidth+2,tokens:Object.fromEntries(['bg','panel','text','muted','accent','gold'].map(key=>[key,root.getPropertyValue('--ts-'+key).trim()]))};
  });
  metrics.contrast=contrast;
  const expected={bg:'#f3f5f8',panel:'#ffffff',text:'#18263a',muted:'#536278',accent:'#245bcc',gold:'#82622c'};
  for(const [key,value] of Object.entries(expected))if(metrics.tokens[key].toLowerCase().replace(/^#fff$/,'#ffffff')!==value)failures.push(name+' token '+key+' '+metrics.tokens[key]+' expected '+value);
  if(metrics.background!=='rgb(243, 245, 248)')failures.push(name+' body '+metrics.background);
  if(metrics.overflow)failures.push(name+' horizontal overflow');
  failures.push(...contrast.violations.map(entry=>name+' '+entry.selector+' '+entry.text+': '+entry.contrast+' < '+entry.minimum));
  await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});report.push({page:name,ready_ms:Date.now()-start,...metrics});fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:false,pages:report,failures},null,2));
  if(name==='home'){await page.locator('.page-area').evaluate(node=>node.scrollTo(0,800));await page.screenshot({path:path.join(directory,'home-materials.png')})}
  if(name==='image'){
   await page.getByRole('button',{name:'模型与参数'}).click();
   const options=await page.getByLabel('生成模型').locator('option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,label:node.textContent})));
   const model=options.find(option=>option.value==='fixture-image2')||options.find(option=>option.value&&/参考|GPT Image/.test(option.label));
   if(model)await page.getByLabel('生成模型').selectOption(model.value);
   await page.getByRole('button',{name:'完成设置'}).click();
   await page.locator('.media-refs-drop').waitFor();await page.screenshot({path:path.join(directory,'image-reference-controls.png')});
   await page.getByRole('link',{name:'图片编辑',exact:true}).click();await page.locator('.ie-workspace').waitFor();await page.screenshot({path:path.join(directory,'image-edit.png')});
  }
 }
 await page.setViewportSize({width:1000,height:700});
 for(const [name,route,selector] of screens.filter(([name])=>['home','flow','image','conversation','knowledge'].includes(name))){await page.goto(base+'/?ui=1#'+route);await page.locator(selector).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),name+' small window overflow');await page.screenshot({path:path.join(directory,name+'-small.png'),fullPage:true})}
 await testWorkflow(page,{base,directory,record:entry=>{report.push(entry);failures.push(...entry.failures);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:false,pages:report,failures},null,2))}});
 const filled=await seedFilledFlow(fixture);await testWorkflow(page,{base,directory,flowId:filled.flow_id,filled:true,record:entry=>{report.push(entry);failures.push(...entry.failures);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:false,pages:report,failures},null,2))}});
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/?ui=1#studio/home');await page.locator('.tw-home').waitFor();
 await page.locator('.tw-tools>a').first().focus();await page.keyboard.press('Tab');
 assert.equal(await page.locator('.tw-tools>a').nth(1).evaluate(node=>document.activeElement===node&&getComputedStyle(node).outlineStyle==='solid'),true,'工具卡片必须支持可见键盘焦点');
 assert.equal(await page.locator('.tw-chat').evaluate(node=>getComputedStyle(node).animationName),'none');
 assert.equal(requests.some(url=>/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)),false,'The desktop UI must not block on external fonts');
 assert.equal(forbiddenRequests,0);assert.deepEqual(errors,[]);
 const adminAuth=await(await fetch(apiBase+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();assert(adminAuth.token);
 await page.goto(base+'/admin.html');await page.evaluate(token=>sessionStorage.setItem('tijian-admin-session',token),adminAuth.token);await page.reload();await page.locator('.admin-shell').waitFor();await page.screenshot({path:path.join(directory,'admin.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(243, 245, 248)');assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:!failures.length,real_paid_model:false,integration:fixture.integration,forbiddenRequests,errors,pages:report,failures},null,2));console.log(JSON.stringify({passed:!failures.length,pages:report.length,failures:failures.length,directory}));assert.equal(failures.length,0,'Visual failures; see computed matrix in result.json');
} catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true})}fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:false,integration:fixture.integration,guard:fixture.guard,error:error.message,failures,pages:report},null,2));console.error('Evidence: '+directory);throw error}
finally{if(browser){for(const context of browser.contexts())for(const tab of context.pages())await tab.unrouteAll({behavior:'ignoreErrors'});await browser.close()}fixture.close()}
