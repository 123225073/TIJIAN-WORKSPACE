// Dedicated flow/tool recovery regression against the UI artifact prepared by the main agent.
// This script never builds, uses the installed app, touches live data or calls a model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';

const root=path.resolve('.'),fixture=path.join(root,'.runtime','creation-isolation-'+Date.now());
fs.mkdirSync(fixture,{recursive:true});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const backendPort=socket.address().port;await new Promise(r=>socket.close(r));
const backend=spawn(path.join(root,'.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:fixture,TIJIAN_PORT:String(backendPort),TIJIAN_ALLOW_SELF_REGISTRATION:'1'}});
let logs='',browser;backend.stderr.on('data',c=>logs+=c);
const backendURL='http://127.0.0.1:'+backendPort;
try{
 let healthy=false;for(let i=0;i<140;i++){try{healthy=(await(await fetch(backendURL+'/api/health')).json()).ok;if(healthy)break}catch{}await new Promise(r=>setTimeout(r,150))}
 assert(healthy,logs||'Isolated fixture did not start');
 const auth=await(await fetch(backendURL+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'creation-isolation@example.test',password:'isolated-test-only',name:'隔离验收'})})).json();
 assert(auth.token,'Fixture login failed');
 const api=async(p,body,method)=>{const r=await fetch(backendURL+'/api'+p,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,await r.clone().text());return r.json()};
 await api('/workspace',{});
 const topic=await api('/studio/topics',{title:'隔离主题',source_ids:[]});
 const first=await api('/studio/flow',{new:true,version:0,brief:'流程一',stage:2,topic_id:topic.id});
 const second=await api('/studio/flow',{new:true,version:0,brief:'流程二',stage:2,topic_id:topic.id});
 const firstDraft=await api('/studio/flows/'+first.id+'/drafts',{tool:'text',title:'一号稿',input:{brief:'ONLY FLOW ONE',format:'通用文案'}});
 const secondDraft=await api('/studio/flows/'+second.id+'/drafts',{tool:'text',title:'二号稿',input:{brief:'ONLY FLOW TWO',format:'通用文案'}});
 const task=await api('/tasks/open',{title:'独立 AI 媒体任务',source_ids:[],mode:'daily'});
 const aiDraft=await api('/studio/tasks/'+task.id+'/drafts',{tool:'text_image',title:'AI TASK ONLY',input:{prompt:'ONLY AI TASK'},options:{}});
 const base=backendURL+'/?ui=1';
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1360,height:1050}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('UI error:',e.message)});page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(90000);
 await page.addInitScript(token=>{if(window===window.top)sessionStorage.setItem('tijian-session',token)},auth.token);
 const navigate=async(route)=>{console.log('case:',route.split('?')[0]);await page.goto(base+'#'+route,{waitUntil:'domcontentloaded'})};
 const flowRoute=(id)=>'studio/flow?work='+id+'&step=2';
 const editorRoute=(id,draft)=>'studio/text?draft='+draft+'&return='+encodeURIComponent(flowRoute(id));
 await navigate(editorRoute(first.id,firstDraft.id));await page.getByLabel('创作要求').waitFor();assert.equal(await page.getByLabel('创作要求').inputValue(),'ONLY FLOW ONE');
 await page.getByLabel('创作要求').fill('FLOW ONE EDITED');
 await page.locator('.st-flow-context').getByRole('button',{name:'返回一站式创作 · 第 3 步'}).click();await page.locator('.cf-timeline').waitFor();
 assert.equal(await page.locator('.cf-node').count(),5);assert.equal(await page.getByRole('group',{name:'选择本次创作工具'}).locator('button').count(),6);
 assert.equal(await page.locator('.cf-platform-branches button').count(),3);
 const nodes=await page.locator('.cf-node').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert(nodes.every((n,i)=>i===0||n>nodes[i-1]),'Flow nodes must run from top to bottom');
 await page.screenshot({path:path.join(fixture,'vertical-flow.png'),fullPage:true});
 await navigate(editorRoute(second.id,secondDraft.id));await page.getByLabel('创作要求').waitFor();assert.equal(await page.getByLabel('创作要求').inputValue(),'ONLY FLOW TWO');
 await navigate(editorRoute(first.id,firstDraft.id));await page.getByLabel('创作要求').waitFor();assert.equal(await page.getByLabel('创作要求').inputValue(),'FLOW ONE EDITED');
 await page.reload();await page.getByLabel('创作要求').waitFor();assert.equal(await page.getByLabel('创作要求').inputValue(),'FLOW ONE EDITED');
 await navigate('studio/image?draft='+aiDraft.id+'&return='+encodeURIComponent('task/'+task.id));await page.getByLabel('输入你的要求').waitFor();assert.equal(await page.getByLabel('输入你的要求').inputValue(),'ONLY AI TASK');
 await page.getByLabel('输入你的要求').fill('AI TASK EDITED');await page.getByRole('button',{name:'返回原 AI 对话'}).click();await page.waitForFunction(id=>location.hash==='\x23task/'+id,task.id);assert.equal(new URL(page.url()).hash,'#task/'+task.id);
 await navigate('studio/image');await page.getByLabel('输入你的要求').waitFor();assert.equal(await page.getByLabel('输入你的要求').inputValue(),'','Fresh tool must not recover task media');
 await navigate('studio/text');await page.getByLabel('创作要求').waitFor();assert.equal(await page.getByLabel('创作要求').inputValue(),'','Fresh tool must not recover either flow');
 await navigate(editorRoute(first.id,secondDraft.id));await page.getByRole('alert').filter({hasText:'不属于当前创作范围'}).waitFor();
 const unchanged=(await api('/studio/flows/'+second.id+'/drafts')).items.find(d=>d.id===secondDraft.id);assert.equal(unchanged.input.brief,'ONLY FLOW TWO');
 const oneDelivery=await api('/studio/deliveries',{topic_id:topic.id,flow_id:first.id,platform:'wechat',title:'FLOW ONE DELIVERY',body:'ONLY ONE PLATFORM BODY'});
 const twoDelivery=await api('/studio/deliveries',{topic_id:topic.id,flow_id:second.id,platform:'wechat',title:'FLOW TWO DELIVERY',body:'ONLY TWO PLATFORM BODY'});
 const deliveryRoute=id=>'studio/topics?topic='+topic.id+'&platform=wechat&return='+encodeURIComponent('studio/flow?work='+id+'&step=4');
 await navigate(deliveryRoute(first.id));await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'公众号文章正文'}).innerText(),'ONLY ONE PLATFORM BODY');
 await page.reload();await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'公众号文章正文'}).innerText(),'ONLY ONE PLATFORM BODY');
 await navigate(deliveryRoute(second.id));await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'公众号文章正文'}).innerText(),'ONLY TWO PLATFORM BODY');
 await navigate('studio/topics?topic='+topic.id);await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'公众号文章正文'}).innerText(),'','Standalone delivery must not select either flow');
 assert.equal((await api('/studio/deliveries?flow_id='+first.id)).items[0].id,oneDelivery.id);
 assert.equal((await api('/studio/deliveries?flow_id='+second.id)).items[0].id,twoDelivery.id);
 assert.deepEqual(errors,[],'Frontend must not throw');
 console.log(JSON.stringify({passed:true,cases:['vertical graph and branches','return preserves edits','two flows remain independent','refresh recovery','AI media draft returns only to task','fresh media and text do not auto-pick scoped drafts','foreign explicit draft rejected','platform drafts reload only within their flow'],fixture}));
}catch(e){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){console.error('Isolated page diagnostics:',JSON.stringify({hash:new URL(page.url()).hash,alerts:await page.getByRole('alert').allInnerTexts()}));await page.screenshot({path:path.join(fixture,'failure.png')})}}console.error('Isolation UI failure:',e.message);throw e}finally{backend.kill();if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,3000))])}
