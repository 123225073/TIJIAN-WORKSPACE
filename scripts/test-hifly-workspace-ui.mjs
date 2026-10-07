// Integrated dist + real isolated API. Provider calls forbidden; only draft saves.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';
const f=await startIsolatedUI('hifly-ui');let browser;
const checks=[],colors=[];
try{
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/seed-hifly-ui.py'],{env:f.env,windowsHide:true,stdio:['pipe','ignore','pipe']});let err='';seed.stderr.on('data',c=>err+=c);seed.stdin.end(JSON.stringify({owner:f.auth.user.id}));assert.equal(await new Promise(r=>seed.once('exit',r)),0,err);
 await f.call('/workspace',{});
 const old=await f.call('/objects/profile',{title:'旧身份',position:'只读测试'});
 await new Promise(r=>setTimeout(r,1100));
 const latest=await f.call('/objects/profile',{title:'最新用户IP',position:'隔离测试'});
 const catalog=(await f.call('/studio/catalog')).tools;
 for(const tool of ['text_avatar','audio_avatar','photo_talk','avatar_create','voice_create','tts']){const cap=catalog.find(c=>c.id===tool);assert(cap.models.some(m=>m.id==='service:hifly'));assert.equal(cap.binding,'service:hifly');}
 const assets=(await f.call('/studio/assets')).items,asset=k=>assets.find(a=>a.asset_type===k).id;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[];await f.attach(page);page.on('pageerror',e=>errors.push(e.message));
 const open=async route=>{await page.goto(f.base+'/?ui=1#'+route);await page.locator('.st-editor').waitFor();await page.locator('.st-context select').waitFor()};
 const identity=()=>page.locator('.st-context select');
 const value=async v=>{await page.waitForFunction(v=>document.querySelector('.st-context select')?.value===v,v);assert.equal(await identity().inputValue(),v)};
 const save=async(tool,required)=>{await page.waitForFunction(()=>document.querySelector('.st-save-state')?.textContent?.includes('已保存')||document.body.innerText.includes('草稿已保存'),{},{timeout:1500}).catch(()=>{});for(let i=0;i<50;i++){const items=(await f.call('/studio/drafts')).items;const d=items.find(d=>d.tool===tool&&required.every(k=>d.input[k]));if(d){checks.push(tool+':'+required.join(','));return d}await new Promise(r=>setTimeout(r,150))}throw Error('Draft input missing: '+tool+' '+required.join(','))};
 await open('studio/avatar/audio');await value(latest.id);
 assert.equal(await page.getByLabel('人物照片',{exact:false}).count(),0);
 await page.getByLabel('驱动音频',{exact:false}).selectOption(asset('audio'));await page.getByLabel('飞影数字人形象',{exact:false}).selectOption(asset('avatar'));
 const audio=await save('audio_avatar',['audio_id','avatar_id']);assert.equal(audio.model_id,'service:hifly');assert(!audio.input.image_id);
 await page.getByRole('button',{name:'使用人物视频',exact:true}).click();await page.getByLabel('人物视频',{exact:false}).selectOption(asset('video'));
 const raw=await save('audio_avatar',['audio_id','video_id']);assert(!raw.input.avatar_id&&!raw.input.image_id);
 await open('studio/avatar/text');await value(latest.id);await page.getByLabel('口播文稿',{exact:false}).fill('只保存文稿，不调用飞影');
 await page.getByLabel('飞影数字人形象',{exact:false}).selectOption(asset('avatar'));await page.getByLabel('飞影声音',{exact:false}).selectOption(asset('voice'));await save('text_avatar',['text','avatar_id','voice_id']);
 await page.getByRole('button',{name:'使用人物视频',exact:true}).click();await page.getByLabel('人物视频',{exact:false}).selectOption(asset('video'));const text=await save('text_avatar',['text','video_id']);assert(!text.input.voice_id&&!text.input.avatar_id);
 await open('studio/avatar/photo');await value(latest.id);await page.getByLabel('人物照片',{exact:false}).selectOption(asset('image'));await page.getByLabel('口播文稿',{exact:false}).fill('图片驱动文稿');await page.getByLabel('飞影声音',{exact:false}).selectOption(asset('voice'));await save('photo_talk',['image_id','text','voice_id']);assert.equal(await page.getByLabel('驱动音频',{exact:false}).count(),0);
 await identity().selectOption('');await value('');await new Promise(r=>setTimeout(r,1400));await page.reload();await page.locator('.st-editor').waitFor();await value('');checks.push('explicit-generic-reload');
 await open('studio/avatar/create');await page.getByLabel('人物视频',{exact:false}).selectOption(asset('video'));const clone=await save('avatar_create',['video_id']);assert(!clone.input.image_id);await page.getByRole('button',{name:'人物照片创建',exact:true}).click();await page.getByLabel('人物照片',{exact:false}).selectOption(asset('image'));const photo=await save('avatar_create',['image_id']);assert(!photo.input.video_id);
 await open('studio/audio/create');await value(latest.id);await page.getByLabel('声音克隆录音',{exact:false}).selectOption(asset('audio'));await save('voice_create',['audio_id']);
 await open('studio/audio/tts');await value(latest.id);await page.getByLabel('口播文稿',{exact:false}).fill('仅保存文本配音输入');await page.getByLabel('飞影声音',{exact:false}).selectOption(asset('voice'));await save('tts',['text','voice_id']);
 // Browser-side library queue contract, with provider traffic intercepted before API.
 let refreshRequests=0,libraryPolls=0;
 await page.route('**/api/studio/assets?*',async route=>{const u=new URL(route.request().url());if(u.searchParams.get('asset_type')!=='avatar')return route.fallback();const refresh=u.searchParams.get('refresh')==='true';if(refresh)refreshRequests++;else if(refreshRequests)libraryPolls++;await route.fulfill({contentType:'application/json',body:JSON.stringify({items:assets.filter(a=>a.asset_type==='avatar'),public_library_status:refresh?'queued':refreshRequests?'ready':'idle'})});});
 await page.goto(f.base+'/?ui=1#studio/avatar/library');await page.getByRole('button',{name:'同步飞影公共资源',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('飞影公共资源同步完成')).catch(async e=>{console.log(JSON.stringify({refreshRequests,libraryPolls,alerts:await page.locator('.st-alert,.st-notice').allTextContents(),buttons:await page.locator('.st-section-head button').allTextContents(),errors}));throw e});assert.equal(refreshRequests,1);assert(libraryPolls>0);checks.push('library-queued-poll-ready-without-resubmit');
 const blank=await f.call('/studio/flow',{new:true,version:0,brief:'旧未选择身份',stage:4,profile_id:''});
 const scoped=await f.call('/studio/flows/'+blank.id+'/drafts',{tool:'audio_avatar',title:'旧空工具草稿',input:{},profile_id:''});
 await open('studio/avatar/audio?draft='+scoped.id+'&return='+encodeURIComponent('studio/flow?work='+blank.id+'&step=2'));await value(latest.id);checks.push('legacy-scoped-empty-default');
 await page.goto(f.base+'/?ui=1#studio/flow?work='+blank.id);await page.locator('.cf-platform-grid').waitFor();assert.equal(await page.locator('.cf-platform-grid svg').count(),3);await page.locator('.cf-platform-grid button').nth(2).hover();await settleUI(page);colors.push(await page.evaluate(measureContrast,{scope:'.cf-platform-grid'}));checks.push('platform-icons');
 const skip=await f.call('/studio/flow',{new:true,version:0,brief:'明确无身份',stage:0,profile_id:''});
 await page.goto(f.base+'/?ui=1#studio/flow?work='+skip.id);await page.getByLabel('以谁的身份表达？').selectOption('');
 const child=await f.call('/studio/flows/'+skip.id+'/drafts',{tool:'text_avatar',title:'明确无身份工具',input:{},profile_id:''});await open('studio/avatar/text?draft='+child.id+'&return='+encodeURIComponent('studio/flow?work='+skip.id+'&step=2'));await value('');checks.push('explicit-origin-generic-inherited');
 await page.goto(f.base+'/?ui=1#radar');await page.locator('.news-row').waitFor();for(const state of ['normal','hover','focus']){if(state==='hover')await page.locator('.news-row').first().hover();if(state==='focus')await page.locator('.news-row').first().focus();await settleUI(page);colors.push(await page.evaluate(measureContrast,{scope:'.radar-page'}));}checks.push('populated-radar-three-states');
 const admin=await f.call('/auth/login',{email:'admin',password:'admin'});await page.goto(f.base+'/admin.html');await page.evaluate(token=>sessionStorage.setItem('tijian-admin-session',token),admin.token);await page.reload();
 for(const route of ['models','bindings','benchmark','knowledge','skills','users','audit']){await page.goto(f.base+'/admin.html#'+route);await page.locator('.admin-shell').waitFor();await new Promise(r=>setTimeout(r,700));const normal=await page.evaluate(measureContrast,{scope:'.admin-shell',excludeUserPaper:true});assert(normal.checked>12,route+' did not render');colors.push(normal);if(route==='skills'){await page.locator('.capability-list button').first().click();await page.locator('.capability-editor').waitFor();await page.locator('.capability-list button').first().hover();await settleUI(page);colors.push(await page.evaluate(measureContrast,{scope:'.admin-shell',excludeUserPaper:true}));}}
 assert.deepEqual(errors,[]);assert.deepEqual(f.guard,{external:[],forbidden:[]});assert.equal(colors.flatMap(c=>c.violations).length,0,JSON.stringify(colors.flatMap(c=>c.violations).slice(0,6)));
 await page.screenshot({path:path.join(f.directory,'admin.png')});fs.writeFileSync(path.join(f.directory,'result.json'),JSON.stringify({passed:true,checks,colors,integration:f.integration,paid_generation:false},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,colorStates:colors.length,directory:f.directory}));
}finally{await browser?.close();f.close()}
