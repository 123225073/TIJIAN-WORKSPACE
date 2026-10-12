// Real source React pages + disposable SQLite. No installed app, model or media calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {chromium} from 'playwright-core';

const directory=path.resolve('.runtime','speech-ui-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const bundleArg=process.argv.find(x=>x.startsWith('--bundle='));
const bundle=bundleArg?path.resolve(bundleArg.slice(9)):path.join(directory,'frontend');
if(!bundleArg)await build({build:{outDir:bundle,emptyOutDir:false},logLevel:'error'});
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const backendURL='http://127.0.0.1:'+port;
const backend=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/speech-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:directory,TIJIAN_SPEECH_UI_BUNDLE:bundle,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'}});
let logs='',browser,page;backend.stderr.on('data',x=>logs+=x);
const forbidden=[],external=[],errors=[],cases=[];
const chain=[];
const article='# 正文中的真正文章标题\n\n## 先核对记录\n物业核对**检验记录**。\n\n![图](/api/image/file)\n【画面：电梯门】\n\n他说：“【字幕：引用的原话】”，需要读出来。\n\n保留最后完整结论。';
const reading='物业核对检验记录。\n\n他说：“【字幕：引用的原话】”，需要读出来。\n\n保留最后完整结论。';
try{
 let ready=false;for(let i=0;i<200;i++){try{ready=(await(await fetch(backendURL+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,logs);
 const auth=await(await fetch(backendURL+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'speech@example.test',password:'isolated-test-only',name:'口播隔离验收'})})).json();assert(auth.token);
 const api=async(url,data,method=data===undefined?'GET':'POST')=>{const response=await fetch(backendURL+'/api'+url,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:data===undefined?undefined:JSON.stringify(data)});assert.equal(response.status,200,url+' '+await response.clone().text());return response.json()};
 await api('/workspace',{});
 const topic=await api('/studio/topics',{title:'历史文章选题',source_ids:[]});
 const makeFlow=async(fields={})=>{
  const source=await api('/objects/content',{title:'历史创作要求标题',body:article,brief:'用户自定义提示词：不虚构人物经历。',...fields});
  const flow=await api('/studio/flow',{new:true,version:0,brief:topic.title,topic_id:topic.id,stage:2,profile_id:''});
  const imported=await api('/studio/flows/'+flow.id+'/imports',{field:'content_id',source_id:source.id,version:flow.version});
  return {flow:imported.flow,source,content:imported.content};
 };
 const explicitCase=JSON.parse(fs.readFileSync('tests/speech-cases.json','utf8')).find(x=>x.name==='explicit script H2 headings');
 const historical=await makeFlow(),explicit=await makeFlow(explicitCase.source);
 const base=backendURL;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 page=await browser.newPage({viewport:{width:1450,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/speech')||request.method()==='POST'&&/\/flows\/[^/]+\/drafts$/.test(url.pathname))chain.push({method:request.method(),path:url.pathname,query:url.search,body:request.postDataJSON()})});
 await page.addInitScript(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['data:','blob:'].includes(url.protocol)&&![base,backendURL].includes(url.origin)){external.push(url.href);return route.abort()}
  if(url.pathname.startsWith('/api/')&&request.method()==='POST'&&/generate|optimize|suggestion|publish|\/send$|upload|\/refresh$/.test(url.pathname)){forbidden.push(url.href);return route.abort()}
  // Node reads the verified source bundle. Some Windows encryption policies
  // expose encrypted bytes when Python serves newly created UI fixture files.
  if(url.origin===base&&!url.pathname.startsWith('/api/')){
   const file=path.resolve(bundle,url.pathname.startsWith('/assets/')?'.'+url.pathname:'index.html');
   assert(file.startsWith(bundle+path.sep));
   if(fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  }
  return route.continue();
 });
 const navigate=async route=>page.goto(base+'/?ui=1#'+route,{waitUntil:'domcontentloaded'});
 const flowRoute=(row,step)=>'studio/flow?work='+row.flow.id+'&step='+step;
 const deliveryRoute=(row,platform)=>'studio/topics?topic='+topic.id+'&platform='+platform+'&return='+encodeURIComponent(flowRoute(row,4));
 console.log('UI: actual CreationFlow to avatar draft');await navigate(flowRoute(historical,2));await page.getByRole('button',{name:'数字人口播',exact:true}).click();
 await page.getByText('想让表达更适合口播，可先改写为口播稿。', {exact:false}).waitFor();
 await page.getByRole('button',{name:'进入数字人口播'}).click();
 await page.getByRole('textbox',{name:'口播文稿',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'口播文稿',exact:true}).inputValue(),reading);cases.push('historical article to actual avatar text field');
 await page.getByRole('textbox',{name:'口播文稿',exact:true}).fill('人工数字人草稿 # 保留原话');
 await page.locator('.st-flow-context').getByRole('button',{name:/返回一站式创作/}).click();await page.getByRole('button',{name:'继续上次草稿 →'}).click();
 await page.getByRole('textbox',{name:'口播文稿',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'口播文稿',exact:true}).inputValue(),'人工数字人草稿 # 保留原话');cases.push('existing avatar draft edit restored');
 await navigate(flowRoute(historical,2));await page.getByRole('button',{name:'数字人口播',exact:true}).click();
 await page.locator('.cf-actions button.primary:not(:disabled)').waitFor();
 await page.getByRole('button',{name:'去文案创作改写口播'}).click();await page.getByRole('textbox',{name:'创作要求',exact:true}).waitFor();
 assert.equal(await page.getByLabel('内容形式',{exact:true}).inputValue(),'口播脚本');const conversion=await page.getByRole('textbox',{name:'创作要求',exact:true}).inputValue();assert(conversion.includes(article)&&conversion.includes(historical.content.brief));cases.push('existing writer conversion path without generation');
 for(const platform of ['channels','douyin']){
  console.log('UI: '+platform+' starter and draft preservation');
  await navigate(deliveryRoute(historical,platform));await page.locator('.td-publish-card textarea[rows="8"]').waitFor();
  await page.waitForFunction(expected=>document.querySelector('.td-publish-card textarea[rows="8"]')?.value===expected,reading);
  assert.equal(await page.locator('.td-publish-card textarea[rows="8"]').inputValue(),reading);cases.push(platform+' article script preserves full body');
  const customized='用户本地缓存脚本 # 不清理，不覆盖';await page.locator('.td-publish-card textarea[rows="8"]').fill(customized);await page.reload();await page.locator('.td-publish-card textarea[rows="8"]').waitFor();
  assert.equal(await page.locator('.td-publish-card textarea[rows="8"]').inputValue(),customized);cases.push(platform+' cached starter script preserved');
  const sourceScript=explicitCase.text;await navigate(deliveryRoute(explicit,platform));await page.locator('.td-publish-card textarea[rows="8"]').waitFor();
  await page.waitForFunction(expected=>document.querySelector('.td-publish-card textarea[rows="8"]')?.value===expected,sourceScript);cases.push(platform+' explicit script preferred');
  const saved=await api('/studio/deliveries',{platform,topic_id:topic.id,flow_id:explicit.flow.id,title:'已有发布稿',script:'服务器已保存脚本 **保持格式**'});
  await page.reload();await page.locator('.td-publish-card textarea[rows="8"]').waitFor();await page.waitForFunction(()=>document.querySelector('.td-publish-card textarea[rows="8"]')?.value==='服务器已保存脚本 **保持格式**');cases.push(platform+' existing server script preserved');
  await page.locator('.td-publish-card textarea[rows="8"]').fill('服务器稿件的本地编辑');await page.reload();await page.locator('.td-publish-card textarea[rows="8"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('.td-publish-card textarea[rows="8"]')?.value==='服务器稿件的本地编辑');
  assert.equal((await api('/studio/deliveries?flow_id='+explicit.flow.id)).items.find(x=>x.id===saved.id).script,saved.script);cases.push(platform+' local edit over server draft preserved');
 }
 assert.equal((await api('/state')).objects.find(x=>x.id===historical.content.id).body,article);
 assert.equal((await api('/state')).objects.filter(x=>x.kind==='job').length,0);
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);assert.deepEqual(external,[]);
 await page.screenshot({path:path.join(directory,'speech-delivery.png'),fullPage:true});
 assert(chain.some(x=>x.method==='GET'&&x.path.endsWith('/speech')&&x.query.includes(historical.content.id)));
 assert(chain.some(x=>x.method==='POST'&&x.body?.tool==='text_avatar'&&x.body?.input?.text===reading));
 const indexHash=createHash('sha256').update(fs.readFileSync(path.join(bundle,'index.html'))).digest('hex');
 const result={passed:true,cases,errors,forbidden,external,chain,fixture_only:true,real_model_called:false,bundle,indexHash,directory};fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,chain:chain.map(x=>({method:x.method,path:x.path,query:x.query,tool:x.body?.tool}))}));
}catch(e){if(page){await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error(JSON.stringify({directory,hash:new URL(page.url()).hash,alerts:await page.getByRole('alert').allInnerTexts(),errors,forbidden}))}throw e}
finally{backend.kill();await Promise.race([browser?.close(),new Promise(r=>setTimeout(r,3000))])}
