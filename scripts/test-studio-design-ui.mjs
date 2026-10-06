// Real local API and isolated storage only. No paid media or publishing call.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const directory=path.resolve('.runtime','studio-design-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'}});
let output='',browser;service.stderr.on('data',chunk=>output+=chunk);
try {
 let ready=false;for(let i=0;i<150;i++){try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,150))}assert(ready,output);
 const auth=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'design@example.test',name:'设计验收',password:'isolated-test-only'})})).json();assert(auth.token);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 const call=async(url,data)=>{const response=await fetch(base+'/api'+url,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)});assert(response.ok,url+' '+response.status);return response.json()};
 const content=await call('/objects/content',{title:'电梯更新如何提前准备',body:'先核对维保记录、现场条件和设备状态。\n\n准备预算与现场沟通时，把已知情况讲清楚，不编造价格。',platform:'wechat',outcome_type:'writing',summary:'从真实信息出发，让更新决策更清楚。'});
 const task=await call('/objects/task',{title:'AI 对话 · 电梯更新',mode:'qa',messages:[{role:'user',text:'帮我写一篇公众号文章',at:new Date().toISOString()}],platform_outcomes:{wechat:content.id},profile_id:''});
 await call('/objects/profile',{title:'电梯服务顾问',position:'用行业经验解决物业客户的实际问题',audience:'物业经理',style:'清晰务实'});
 await call('/import/text',{title:'电梯更新核对资料',body:'更新电梯前需要核对设备资料、维保记录、现场条件和资金安排。'});
 await call('/studio/topics',{title:'电梯报价为什么差这么多',angle:'把现场条件和服务范围讲清楚',source_ids:[],status:'selected'});
 const form=new FormData();form.append('file',new Blob([fs.readFileSync('build/tijian.png')],{type:'image/png'}),'电梯品牌参考图.png');
 const upload=await fetch(base+'/api/studio/upload',{method:'POST',headers:{Authorization:'Bearer '+auth.token},body:form});assert(upload.ok);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 let forbiddenRequests=0;page.on('request',request=>{const url=new URL(request.url());if(['/api/studio/generate','/api/wechat-publish/publish'].includes(url.pathname))forbiddenRequests++});
 await page.goto(base);await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 const report=[];
 const screens=[['home','studio/home','.tw-home'],['flow','studio/flow','.cf-page'],['image','studio/image','.media-workbench'],['video','studio/video','.media-workbench'],['text','studio/text','.studio-v2'],['assets','studio/assets','.st-library-tabs'],['works','studio/works','.st-library-tabs'],['knowledge','knowledge','.knowledge-page'],['inspiration','benchmark','.benchmark-studio-v2'],['profile','studio/brand','.ip-dashboard'],['conversation','task/'+task.id,'.aw-workspace'],['topics','studio/topics','.tlc'],['avatar','studio/avatar/text','.studio-v2'],['voice','studio/audio/tts','.studio-v2'],['settings','studio/memory-settings','.surface']];
 for(const [name,route,selector] of screens){
  const start=Date.now();await page.goto(base+'/?ui=1#'+route);await page.locator(selector).waitFor({timeout:30000});
  await page.locator('.boot').waitFor({state:'hidden'});await page.waitForTimeout(250);
  const metrics=await page.evaluate(()=>{
   const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
   const blend=(a,b)=>{const alpha=a.length>3?a[3]:1;return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha))};
   const background=node=>{const stack=[];for(let current=node;current;current=current.parentElement){const style=getComputedStyle(current);const gradient=style.backgroundImage.match(/rgba?\([^)]+\)/);stack.unshift(rgb(gradient?gradient[0]:style.backgroundColor))}return stack.reduce((value,color)=>blend(color,value),[8,15,27])};
   const luminance=value=>value.map(v=>{const c=v/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4)}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   const violations=[];
   for(const element of document.querySelectorAll('.st-header h1,.mw-panel-title h1,.knowledge-heading h1,.bv-header h1,.media-refs-label b,.media-refs-drop,.media-refs-paste,.aw-section h3,.aw-composer textarea,.cf-head h2,.cf-head p,.knowledge-body .markdown p,.knowledge-reader-actions button:not(:disabled),.bv-options summary,.tlc-title,.st-work-record-main strong')){
    const rectangle=element.getBoundingClientRect();if(!rectangle.width||!rectangle.height||rectangle.bottom<0||rectangle.top>innerHeight)continue;
    const style=getComputedStyle(element),text=rgb(style.color),base=background(element),a=luminance(text),b=luminance(base),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font=parseFloat(style.fontSize),minimum=font>=24||font>=18.66&&Number(style.fontWeight)>=700?3:4.5;
    if(contrast<minimum)violations.push({selector:element.className||element.tagName,text:element.textContent.trim().slice(0,24),contrast:Number(contrast.toFixed(2)),font});
   }
   const panel=document.querySelector('.mw-panel,.aw-results,.knowledge-reader,.st-asset-card');
   return {background:getComputedStyle(document.body).backgroundColor,panel:panel?getComputedStyle(panel).backgroundColor:null,overflow:document.documentElement.scrollWidth>innerWidth+2,contrastViolations:violations};
  });
  assert.equal(metrics.background,'rgb(8, 15, 27)',name+' must use the unified theme');assert.equal(metrics.overflow,false,name+' horizontal overflow');assert.deepEqual(metrics.contrastViolations,[],name+' readability');
  await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});report.push({page:name,ready_ms:Date.now()-start,...metrics});
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
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/?ui=1#studio/home');await page.locator('.tw-home').waitFor();
 await page.locator('.tw-tools>a').first().focus();await page.keyboard.press('Tab');
 assert.equal(await page.locator('.tw-tools>a').nth(1).evaluate(node=>document.activeElement===node&&getComputedStyle(node).outlineStyle==='solid'),true,'工具卡片必须支持可见键盘焦点');
 assert.equal(await page.locator('.tw-chat').evaluate(node=>getComputedStyle(node).animationName),'none');
 assert.equal(requests.some(url=>/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)),false,'The desktop UI must not block on external fonts');
 assert.equal(forbiddenRequests,0);assert.deepEqual(errors,[]);
 const adminAuth=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();assert(adminAuth.token);
 await page.goto(base+'/admin.html');await page.evaluate(token=>sessionStorage.setItem('tijian-admin-session',token),adminAuth.token);await page.reload();await page.locator('.admin-shell').waitFor();await page.screenshot({path:path.join(directory,'admin.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(8, 15, 27)');assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:true,real_paid_model:false,forbiddenRequests,errors,pages:report},null,2));console.log(JSON.stringify({passed:true,pages:report,directory}));
} catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true})}throw error}
finally{if(browser)await browser.close();service.kill()}
