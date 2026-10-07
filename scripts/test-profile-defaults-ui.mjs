// Existing integrated dist + the project's isolated real API. No Vite/build/live provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('profile-defaults-ui'),cases=[],errors=[];
let browser,page,releaseState;
const record=name=>{cases.push({name,passed:true});console.log('PASS DOM:',name)};
const responseIsFlowSave=(response,id,profile)=>{
 if(new URL(response.url()).pathname!=='/api/studio/flow'||response.request().method()!=='POST')return false;
 const body=response.request().postDataJSON();return body?.id===id&&body.profile_id===profile;
};
try{
 await fixture.call('/workspace',{});
 const old=await fixture.call('/objects/profile',{title:'旧 IP',position:'历史身份'});
 const latest=await fixture.call('/objects/profile',{title:'最新配置 IP',position:'本次默认身份'});
 const existing=await fixture.call('/studio/flow',{new:true,version:0,brief:'已有作品',stage:0,profile_id:old.id});
 const apiEmpty=await fixture.call('/studio/flow',{new:true,version:0,brief:'',stage:0,profile_id:''});
 const asynchronous=await fixture.call('/studio/flow',{new:true,version:0,brief:'异步档案验收',stage:0,profile_id:''});
 let legacy=await fixture.call('/studio/flow',{new:true,version:0,brief:'旧 v5 默认空草稿',stage:0,profile_id:''});
 for(let i=0;i<4;i++)legacy=await fixture.call('/studio/flow',{...legacy,version:legacy.version});
 assert.equal(legacy.version,5);assert.equal(apiEmpty.version,1);
 const historical=await fixture.call('/objects/content',{title:'隔离历史成品',body:'旧成品保持原样。',profile_id:old.id,status:'draft'});
 // identity_skipped is existing task/origin metadata, not a public flow-save field.
 // Seed it only in the disposable fixture database, with the project's store API.
 assert.equal(fixture.env.TIJIAN_DATA,fixture.directory);
 assert(fixture.directory.startsWith(path.resolve('.runtime')+path.sep)&&path.basename(fixture.directory).startsWith('profile-defaults-ui-'));
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import json,sys
from backend import store as s
s.init();d=json.load(sys.stdin)
flow=s.put(d['owner'],'studio_flow',{'brief':'明确跳过身份的 origin','stage':0,'profile_id':'','identity_skipped':True})
print(json.dumps({'id':flow['id']}))
`],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let seeded='',seedError='';seed.stdout.on('data',chunk=>seeded+=chunk);seed.stderr.on('data',chunk=>seedError+=chunk);seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await new Promise(resolve=>seed.on('exit',resolve)),0,seedError);const skipped=JSON.parse(seeded);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 page=await browser.newPage({viewport:{width:1366,height:768}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await fixture.attach(page);
 const identity=()=>page.getByLabel('以谁的身份表达？');
 const expectValue=async(value)=>{await identity().waitFor();await page.waitForFunction(value=>{const label=[...document.querySelectorAll('.cf-page label')].find(node=>node.textContent.includes('以谁的身份表达'));return label?.querySelector('select')?.value===value},value,{timeout:15000});assert.equal(await identity().inputValue(),value)};
 const open=async id=>{await page.goto(fixture.base+'/?ui=1#studio/flow?work='+id,{waitUntil:'domcontentloaded'});await identity().waitFor()};

 await open(existing.id);await expectValue(old.id);
 await identity().selectOption('');await expectValue('');
 const createdResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/flow'&&response.request().method()==='POST'&&response.request().postDataJSON()?.new===true);
 await page.getByRole('button',{name:'新建作品',exact:true}).click();const createdReply=await createdResponse;assert(createdReply.ok());const made=await createdReply.json();
 assert.equal(createdReply.request().postDataJSON().profile_id,latest.id);await page.waitForURL(url=>new URLSearchParams(url.hash.split('?')[1]).get('work')===made.id);await expectValue(latest.id);
 assert.equal((await fixture.call('/studio/flow?work_id='+made.id)).profile_id,latest.id);await page.reload();await expectValue(latest.id);
 record('click new work: latest request, real API state, DOM and reload');

 await open(apiEmpty.id);await expectValue(latest.id);record('API-created id/version1 empty flow defaults to latest');
 await open(legacy.id);await expectValue(latest.id);
 const unchanged=(await fixture.call('/state')).objects.find(item=>item.id===historical.id);assert(unchanged);for(const key of ['id','version','title','body','profile_id','status'])assert.deepEqual(unchanged[key],historical[key],'historical output '+key+' must remain unchanged');
 record('unmarked v5 empty flow defaults to latest; historical output unchanged');

 const savedGeneric=page.waitForResponse(response=>responseIsFlowSave(response,legacy.id,''));
 await identity().selectOption('');await expectValue('');assert((await savedGeneric).ok());
 assert.equal((await fixture.call('/studio/flow?work_id='+legacy.id)).profile_id,'');
 await page.reload();await expectValue('');
 assert(await page.evaluate(id=>Object.keys(localStorage).some(key=>{if(!key.startsWith('tijian-profile-choice:'))return false;try{return JSON.parse(key.slice('tijian-profile-choice:'.length))[1]==='flow:'+id&&JSON.parse(localStorage.getItem(key)).value===''}catch{return false}}),legacy.id));
 record('deliberate generic choice survives API save and full reload');

 await open(skipped.id);await expectValue('');assert.equal((await fixture.call('/studio/flow?work_id='+skipped.id)).identity_skipped,true);
 record('origin identity_skipped stays generic');

 // Hold only the real /state response. Bootstrap and flow APIs remain real,
 // exposing the actual complete:false -> complete:true UI transition.
 const gate=new Promise(resolve=>releaseState=resolve);let stateStarted=false;
 const delayState=async route=>{stateStarted=true;const response=await route.fetch();await gate;await route.fulfill({response})};
 await page.route('**/api/state',delayState);
 // A hash-only goto keeps the already-complete App state. Change the query
 // to force a fresh document before testing the pending /state transition.
 try{await page.goto(fixture.base+'/?ui=1&profile_async=1#studio/flow?work='+asynchronous.id,{waitUntil:'domcontentloaded'});await expectValue('');assert(stateStarted,'the full profile list response must still be pending');releaseState();await expectValue(latest.id)}finally{releaseState();await page.unroute('**/api/state',delayState)}
 record('asynchronous full profile list defaults an unmarked saved flow to latest');

 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 await page.screenshot({path:path.join(fixture.directory,'flow-latest-ip.png'),fullPage:true});
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,cases,integration:fixture.integration,errors,guard:fixture.guard,real_paid_model:false},null,2));
 console.log(JSON.stringify({passed:true,domCases:cases.length,directory:fixture.directory,frontend:'existing integrated dist',api:'isolated real API',build:false,liveProvider:false}));
}catch(error){
 releaseState?.();fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:false,cases,integration:fixture.integration,error:error.message,errors,guard:fixture.guard,real_paid_model:false},null,2));
 if(page)await page.screenshot({path:path.join(fixture.directory,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence: '+fixture.directory);throw error;
}finally{
 releaseState?.();if(browser){for(const context of browser.contexts())for(const tab of context.pages())await tab.unrouteAll({behavior:'ignoreErrors'});await browser.close()}fixture.close();
}
