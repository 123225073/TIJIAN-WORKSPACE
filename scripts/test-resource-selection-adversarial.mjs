// Independent resource-selection counterexamples. Only disposable local fixtures.
// Run: node scripts/test-resource-selection-adversarial.mjs
// Requires the main thread's fresh dist; never builds/edits dist or calls paid APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {startIsolatedUI} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('resource-selection-adversarial');
const checks=[],external=[],forbidden=[],pageErrors=[];
let browser,page;
const sources=['src/Studio.tsx','src/ResourceLibrary.tsx','src/ResourcePreview.tsx','src/HumanResourcePicker.tsx','src/DigitalHumanGuide.tsx','src/digitalHumanFields.ts','src/digital-human-layout.css','backend/media_studio.py'];
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes=Object.fromEntries(sources.map(file=>[file,hash(file)]));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const within=(promise,ms=12000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Counterexample timed out')),ms))]).finally(()=>clearTimeout(timer))};
const run=async(name,fn)=>{try{const evidence=await fn();checks.push({name,passed:true,evidence});console.log(JSON.stringify(checks.at(-1)))}catch(error){checks.push({name,passed:false,error:error.message});console.log(JSON.stringify(checks.at(-1)));await page?.screenshot({path:path.join(fixture.directory,name+'.png')}).catch(()=>{})}};
const seed=async()=>{
 const child=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import json,sys
from pathlib import Path
from backend import store as s,gateway as g,media_studio as m
assert s.DATA.is_relative_to(Path('.runtime').resolve()) and s.DATA.name.startswith('resource-selection-adversarial-')
s.init();owner=json.load(sys.stdin)['owner']
s.set_config(m.CONFIG,{'hifly':{'base_url':m.PROVIDERS['hifly']['base_url'],'enabled':True,'secret':g.cipher().encrypt(b'isolated-adversarial-fixture-only').decode()}})
scope=m._scope('hifly',m._service('hifly'));ids={}
for name,extra in [('usable',{}),('public',{'visibility':'public'}),('archived',{'archived':True}),('deleted',{'deleted':True}),('wrong-service',{'service_scope':'foreign-service'})]:
 a=s.put(owner,'studio_asset',{'title':'review-'+name,'asset_type':'avatar','status':'ready','provider':'hifly','provider_resource_id':'fixture-'+name,'service_scope':scope,'compat':m.COMPAT['avatar'],**extra});ids[name]=a['id']
a=s.put(owner,'studio_asset',{'title':'review-public-voice','asset_type':'voice','status':'ready','provider':'hifly','provider_resource_id':'fixture-public-voice','service_scope':scope,'visibility':'public','compat':m.COMPAT['voice']});ids['public-voice']=a['id']
print(json.dumps(ids))
`],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);child.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await within(new Promise(r=>child.once('exit',r))),0,error);return JSON.parse(output);
};

try{
 const ids=await seed();
 const profileA=await fixture.call('/objects/profile',{title:'Original IP',position:'Isolated resource-selection review'});
 const profileB=await fixture.call('/objects/profile',{title:'Concurrent IP',position:'Isolated second-window profile'});
 await fixture.call('/workspace',{});
 const distTime=fs.statSync('dist/index.html').mtimeMs;
 assert(sources.filter(file=>file.startsWith('src/')).every(file=>fs.statSync(file).mtimeMs<=distTime),'Main thread must rebuild dist after the frontend fixes');
 const base=fixture.base;
 browser=await chromium.launch({headless:true,executablePath:process.env.RESOURCE_REVIEW_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(12000);
 await page.addInitScript(token=>sessionStorage.setItem('tijian-session',token),fixture.auth.token);
 await page.route('**/*',async route=>{const r=route.request(),url=new URL(r.url());
  if(!['data:','blob:'].includes(url.protocol)&&url.origin!==base&&url.origin!==fixture.apiBase){external.push(r.url());return route.abort()}
  if(url.pathname.startsWith('/api/')&&r.method()==='POST'&&/generate|publish|\/jobs(?:\/|$)|optimize|suggestion|\/refresh$|refresh=true/.test(url.pathname+url.search)){forbidden.push(r.url());return route.abort()}
  return route.continue();
 });
 page.on('pageerror',e=>pageErrors.push(e.message));
 const workspace=()=>page.locator('.st-human-workspace:visible');
 const editor=()=>workspace().getByLabel('口播文稿',{exact:true});
 const avatarField=()=>workspace().locator('[data-field="avatar_id"]');
 const card=()=>page.locator('.st-resource-card').filter({hasText:'review-usable'});
 const open=async route=>{await page.goto(base+'/#'+route,{waitUntil:'domcontentloaded'})};
 const ready=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('.st-human-workspace .st-field textarea')].some(e=>e.offsetParent&&e.value===text)&&[...document.querySelectorAll('.st-human-workspace [data-field="avatar_id"] button')].some(b=>b.textContent==='选择与预览'&&!b.disabled),text)};
 const openAvatarPicker=async()=>{
  const originalRoute=page.url();
  await avatarField().getByRole('button',{name:'选择与预览',exact:true}).click();
  const picker=page.locator('.studio-modal[open]').filter({has:page.getByRole('heading',{name:'选择形象',exact:true})});
  await picker.waitFor();assert.equal(page.url(),originalRoute,'Opening the picker must not route away from the draft');
  return picker;
 };
 const manageAvatar=async()=>{const picker=await openAvatarPicker();await picker.getByRole('button',{name:'管理形象',exact:true}).click()};
 const draft=async id=>(await fixture.call('/studio/drafts')).items.find(d=>d.id===id);
 const makeDraft=async(title,text)=>fixture.call('/studio/drafts',{tool:'text_avatar',title,model_id:'service:hifly',profile_id:profileA.id,input:{text},options:{}});
 const cache=async id=>page.evaluate(id=>Object.entries(localStorage).filter(([key,value])=>{try{return !key.endsWith(':unsynced')&&key.includes(':avatar/text:text_avatar:')&&JSON.parse(value)?.server_id===id}catch{return false}}).map(([key,value])=>({key,...JSON.parse(value)})),id);
 const raw=async(url,data,method='POST')=>fetch(fixture.apiBase+'/api'+url,{method,headers:fixture.headers,body:JSON.stringify(data)});
 let returnedRoute='';

 await run('concurrent-server-update-keeps-IP-and-local-copy',async()=>{
  const original=await makeDraft('Concurrent cache restore','original text');
  await open('studio/avatar/text?draft='+original.id+'&mode=text_avatar');await ready('original text');
  await manageAvatar();await card().waitFor();
  await card().getByRole('button',{name:'使用并返回原稿',exact:true}).click();await ready('original text');await page.waitForTimeout(1000);
  const saved=await draft(original.id),cached=await cache(original.id);assert(cached.length);
  assert(cached.every(c=>c.server_version===saved.version),'Normal persist must keep cache versions current');
  const remote=await fixture.call('/studio/drafts/'+original.id,{version:saved.version,profile_id:profileB.id,input:{...saved.input,text:'saved by window B'}},'PATCH');
  await page.evaluate(id=>{for(const [key,value]of Object.entries(localStorage)){try{const d=JSON.parse(value);if(!key.endsWith(':unsynced')&&key.includes(':avatar/text:text_avatar:')&&d?.server_id===id){d.inputs.text='unsynced window A text';d.version++;d.updated_at=new Date().toISOString();localStorage.setItem(key,JSON.stringify(d))}}catch{}}},original.id);
  await page.reload();await ready('saved by window B');
  await page.locator('.st-unsynced-copy summary').click();assert.equal(await page.getByLabel('本机未同步内容', {exact:true}).inputValue(),'unsynced window A text');
  assert.equal(await page.locator('.st-human-workspace:visible .st-context select').inputValue(),profileB.id);
  await page.waitForTimeout(1100);const after=await draft(original.id);assert.equal(after.profile_id,profileB.id);assert.equal(after.input.text,remote.input.text);
  assert(await page.evaluate(id=>Object.entries(localStorage).some(([key,value])=>{try{return key.endsWith(':unsynced')&&JSON.parse(value)?.server_id===id&&JSON.parse(value)?.inputs?.text==='unsynced window A text'}catch{return false}}),original.id));
  await page.reload();await ready('saved by window B');await page.locator('.st-unsynced-copy summary').click();assert.equal(await page.getByLabel('本机未同步内容',{exact:true}).inputValue(),'unsynced window A text');
  return {oldVersion:saved.version,concurrentVersion:remote.version,afterVersion:after.version,serverIPPreserved:true,localCopyPreservedAfterReload:true};
 });

 await run('typing-and-IP-change-during-chooseResource-save',async()=>{
  const original=await makeDraft('Typing while saving','before save');await open('studio/avatar/text?draft='+original.id+'&mode=text_avatar');await ready('before save');
  const gate=deferred(),held=deferred();let once=true;const endpoint='**/api/studio/drafts/'+original.id;
  const handler=async route=>{if(route.request().method()==='PATCH'&&once){once=false;held.resolve(route.request().postDataJSON());await gate.promise}return route.continue()};
  await page.route(endpoint,handler);
  try{
   const picker=await openAvatarPicker();
   const clicking=picker.getByRole('button',{name:'管理形象',exact:true}).click();const snapshot=await within(held.promise);
   assert.equal(snapshot.input.text,'before save');assert(await editor().isEditable());await editor().fill('added while save was pending');await page.locator('.st-human-workspace:visible .st-context select').selectOption(profileB.id);
   await page.waitForFunction(id=>Object.entries(localStorage).some(([key,value])=>{try{const d=JSON.parse(value);return !key.endsWith(':unsynced')&&d?.server_id===id&&d.inputs?.text==='added while save was pending'}catch{return false}}),original.id);
   gate.resolve();await clicking;await card().waitFor();await card().getByRole('button',{name:'使用并返回原稿',exact:true}).click();await ready('added while save was pending');
   assert.equal(await page.locator('.st-human-workspace:visible .st-context select').inputValue(),profileB.id);const after=await draft(original.id);assert.equal(after.input.text,'added while save was pending');assert.equal(after.profile_id,profileB.id);
   returnedRoute=new URL(page.url()).hash.slice(1);return {pendingInputPreserved:true,pendingIPPreserved:true,returnedAvatar:after.input.avatar_id===ids.usable};
  }finally{gate.resolve();await page.unroute(endpoint,handler)}
 });

 await run('saved-explicit-empty-IP-with-cleared-cache',async()=>{
  const original=await makeDraft('Explicit generic expression','explicit generic expression saved');await open('studio/avatar/text?draft='+original.id+'&mode=text_avatar');await ready('explicit generic expression saved');
  await page.locator('.st-human-workspace:visible .st-context select').selectOption('');await page.waitForTimeout(1100);const saved=await draft(original.id);assert.equal(saved.profile_id,'','The user must have really saved the empty IP first');
  await page.evaluate(()=>localStorage.clear());await page.reload();await ready(saved.input.text);await page.waitForTimeout(1100);
  const ui=await page.locator('.st-human-workspace:visible .st-context select').inputValue(),after=await draft(original.id);
  assert(ui===''&&after.profile_id==='','Saved empty IP re-filled after cache clear: UI='+ui+', server='+after.profile_id);
  return {explicitGenericExpressionPreserved:true,serverVersion:after.version};
 });

 await run('late-default-GET-does-not-revert-new-POST',async()=>{
  await fixture.call('/studio/resource-defaults',{avatar_id:null});const gate=deferred(),held=deferred();let once=true;const endpoint='**/api/studio/resource-defaults';
  const handler=async route=>{if(route.request().method()==='GET'&&once){once=false;const response=await route.fetch();held.resolve();await gate.promise;return route.fulfill({response})}return route.continue()};
  await page.route(endpoint,handler);
  try{
   await open('studio/avatar/library');await card().waitFor();await within(held.promise);await card().getByRole('button',{name:'设为默认',exact:true}).click();await card().locator('.st-default-badge').waitFor();
   gate.resolve();await page.waitForTimeout(300);assert.equal(await card().locator('.st-default-badge').count(),1);assert.equal((await fixture.call('/studio/resource-defaults')).avatar_id,ids.usable);
   await card().getByRole('button',{name:'取消默认',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.st-default-badge'));assert.equal((await fixture.call('/studio/resource-defaults')).avatar_id,null);
   return {lateReadIgnored:true,cancelDefaultStillWorks:true};
  }finally{gate.resolve();await page.unroute(endpoint,handler)}
 });

 await run('archived-hidden-and-other-service-controls-disabled',async()=>{
  await open('studio/avatar/library?return='+encodeURIComponent(returnedRoute));await card().waitFor();
  assert.equal(await page.locator('.st-resource-card').filter({hasText:'review-archived'}).count(),0);assert.equal(await page.locator('.st-resource-card').filter({hasText:'review-deleted'}).count(),0);
  const wrong=page.locator('.st-resource-card').filter({hasText:'review-wrong-service'});assert.match(await wrong.innerText(),/当前不可用/);assert(await wrong.getByRole('button',{name:'设为默认',exact:true}).isDisabled());assert(await wrong.getByRole('button',{name:'使用并返回原稿',exact:true}).isDisabled());
  const apiAssets=(await fixture.call('/studio/assets')).items;assert.equal(apiAssets.find(a=>a.id===ids['wrong-service']).resource_selectable,false);assert.equal(apiAssets.find(a=>a.id===ids.deleted).resource_selectable,false);
  assert.equal(await page.locator('.st-resource-card').filter({hasText:'review-public'}).count(),0);assert.equal(await page.locator('.st-resource-folders').getByRole('button',{name:/公共形象/}).count(),0);
  assert.equal(apiAssets.some(a=>a.id===ids.public),false);assert.equal(apiAssets.find(a=>a.id===ids['public-voice']).resource_selectable,true);
  assert.equal((await raw('/studio/resource-defaults',{avatar_id:ids.public})).status,400);
  assert.equal((await raw('/studio/resource-defaults',{avatar_id:ids['wrong-service']})).status,400);assert.equal((await raw('/studio/resource-defaults',{avatar_id:ids.archived})).status,400);
  await card().getByRole('button',{name:'使用并返回原稿',exact:true}).click();await ready('added while save was pending');
  assert.equal(await page.locator('.st-human-workspace:visible option[value="'+ids['wrong-service']+'"]').count(),0);assert.equal(await page.locator('.st-human-workspace:visible option[value="'+ids.archived+'"]').count(),0);
  assert.equal(await avatarField().locator('option[value="'+ids.public+'"]').count(),0);
  const picker=await openAvatarPicker();
  assert.equal(await picker.locator('article').filter({hasText:'review-public'}).count(),0);assert.equal(await picker.locator('article').filter({hasText:'review-wrong-service'}).count(),0);assert.equal(await picker.locator('article').filter({hasText:'review-archived'}).count(),0);assert.equal(await picker.locator('article').filter({hasText:'review-deleted'}).count(),0);
  await picker.getByRole('button',{name:'关闭弹窗',exact:true}).click();await picker.waitFor({state:'detached'});
  assert.equal(await workspace().getByLabel('口播声音',{exact:true}).locator('optgroup[label="公共声音"] option[value="'+ids['public-voice']+'"]').count(),1);
  return {archivedHidden:true,deletedHidden:true,wrongServiceDisabled:true,invalidDefaultsRejected:true,publicAvatarsHiddenAndRejected:true,publicVoicesRetained:true,pickerExcludesUnavailableResources:true};
 });

 await run('deleted-default-API-agrees-with-resource-selectable',async()=>{
  const response=await raw('/studio/resource-defaults',{avatar_id:ids.deleted});const selected=(await fixture.call('/studio/resource-defaults')).avatar_id;
  assert([400,404].includes(response.status),'Deleted resource is non-selectable but default POST returned '+response.status+' and default GET '+(selected===ids.deleted?'returned the deleted ID':'did not return the deleted ID'));
  return {status:response.status,deletedDefaultRejected:true};
 });
 assert.deepEqual(external,[]);assert.deepEqual(forbidden,[]);assert.deepEqual(pageErrors,[]);
 const report={passed:checks.every(c=>c.passed),checks,paid_generation:false,isolated_directory:fixture.directory,frontend:fixture.integration,sourceHashes,sourceHashesAfter:Object.fromEntries(sources.map(file=>[file,hash(file)])),external,forbidden,pageErrors};
 assert.deepEqual(report.sourceHashesAfter,sourceHashes,'Implementation changed during the review; rerun against a stable build');
 fs.writeFileSync(path.join(fixture.directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:checks.length,report:path.join(fixture.directory,'report.json')}));
 if(!report.passed)process.exitCode=1;
}finally{await browser?.close();fixture.close()}
