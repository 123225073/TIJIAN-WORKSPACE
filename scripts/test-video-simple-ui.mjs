// Real video workbench components + source CSS; local fixtures only, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const directory=path.resolve('.runtime','video-simple-ui-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const entry=`import {useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import MediaWorkbench from './src/MediaWorkbench';import VideoScenarios from './src/VideoScenarios';import {videoScenarioPatch} from './src/video-inputs';
const options={resolution:['480p','720p','1080p'],ratio:['16:9','9:16','4:3','3:4','1:1','21:9','adaptive'],duration:[-1,...Array.from({length:27},(_,i)=>i+4)],output_format:['mp4','mov']};
const models=[{id:'fixture-25',provider:'ark',title:'测试模型25',family:'seedance-2.5',configured:true,storage_ready:true,modes:['text','reference','first_frame','first_last_frame','edit','extend'],reference_limits:{image:30,video:10,audio:10,duration:30},options},{id:'fixture-fast',provider:'ark',title:'测试模型Fast',family:'seedance-2.0-fast',configured:true,storage_ready:false,modes:['text','reference','first_frame','first_last_frame'],reference_limits:{image:9,video:3,audio:3,duration:15},options:{...options,resolution:['480p','720p'],duration:[-1,...Array.from({length:12},(_,i)=>i+4)]}}];
const assets=[{id:'image-a',asset_type:'image',status:'ready',title:'首帧素材'},{id:'image-b',asset_type:'image',status:'ready',title:'尾帧素材'},{id:'video-a',asset_type:'video',status:'ready',title:'原视频'},{id:'audio-a',asset_type:'audio',status:'ready',title:'参考声音'}];
const initial={id:'isolated-video-draft',tool:'text_video',model_id:'fixture-25',inputs:{prompt:'电梯门打开，镜头进入轿厢。',reference_mode:'text',profile_id:'original-ip'},options:{},version:1};
function Fixture(){const [draft,setDraft]=useState(()=>JSON.parse(localStorage.getItem('fixture-video')||'null')||initial),[configured,setConfigured]=useState(true);
useEffect(()=>{window.videoDraft=draft;localStorage.setItem('fixture-video',JSON.stringify(draft))},[draft]);
window.patchVideo=(input={},options={})=>setDraft(d=>({...d,inputs:{...d.inputs,...input},options:{...d.options,...options}}));window.setVideoConfigured=setConfigured;
const update=input=>setDraft(d=>({...d,inputs:{...d.inputs,...input},version:d.version+1,request_id:undefined}));
const model=models.find(m=>m.id===draft.model_id);const changeOptions=(key,value)=>setDraft(d=>({...d,options:{...d.options,[key]:value},version:d.version+1}));
const changeModel=id=>setDraft(d=>({...d,model_id:id,options:{},inputs:{...d.inputs,reference_mode:models.find(m=>m.id===id).modes.includes(d.inputs.reference_mode)?d.inputs.reference_mode:'reference'}}));
return <MediaWorkbench draft={draft} cap={{models,options:model.options}} baseCap={{binding:'fixture-25'}} assets={assets} runs={[]} update={update} changeOptions={changeOptions} changeModel={changeModel} canGenerate={configured} configured={configured} generate={()=>{window.generateSnapshots.push(structuredClone(draft))}} busy={false} running={false} saveState="隔离测试草稿" context={<p>原 IP 已保留</p>} outputUI={()=>null} outputs={()=>[]} reloadAssets={async()=>{}} owner="video-test" scenario={<VideoScenarios compact assets={assets} onApply={async(prompt,image,scenario,video)=>{window.scenarioCalls.push({prompt,image,scenario,video});setDraft(d=>({...d,inputs:{...d.inputs,...videoScenarioPatch(d.inputs,prompt,image,scenario,video)},version:d.version+1}))}}/>}/>}
window.generateSnapshots=[];window.scenarioCalls=[];createRoot(document.getElementById('root')).render(<Fixture/>);`;
const cssBundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'all.js'),external:['/visuals/*']});
const css=cssBundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js')});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
let apiRequests=0;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}else{if(url.pathname.startsWith('/api/'))apiRequests++;res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
let browser;const results=[];
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==base)throw Error('Unexpected external request');await route.continue()});await page.goto(base);
 const check=async(name,test)=>{await test();results.push({name,passed:true})};const state=()=>page.evaluate(()=>window.videoDraft);const gen=page.locator('.mw-generate');const patch=async(input={},options={})=>{await page.evaluate(({input,options})=>window.patchVideo(input,options),{input,options});await page.waitForFunction(({input,options})=>Object.entries(input).every(([k,v])=>JSON.stringify(window.videoDraft.inputs[k])===JSON.stringify(v))&&Object.entries(options).every(([k,v])=>JSON.stringify(window.videoDraft.options[k])===JSON.stringify(v)),{input,options})};
 await check('default: only essential choices visible, text mode has no media form',async()=>{await page.getByRole('button',{name:'文字生视频',exact:true}).waitFor();assert(!(await page.getByLabel('生成模型').isVisible()));assert(!(await page.getByLabel('视频分辨率').isVisible()));assert(await page.getByLabel('视频画面比例').isVisible());assert.equal(await page.locator('.media-refs').count(),0);assert.equal(await page.locator('.mw-heading nav').count(),0)});
 await check('first frame requires one image and exposes no video/audio slots',async()=>{await page.getByRole('button',{name:'首帧生视频',exact:true}).click();assert(await gen.isDisabled());assert.equal(await page.getByRole('button',{name:'上传或拖入参考视频',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'上传或拖入参考音频',exact:true}).count(),0);await patch({image_id:'image-a',image_ids:['image-a']});assert(!(await gen.isDisabled()));await gen.click();assert.equal(await page.evaluate(()=>window.generateSnapshots.at(-1).inputs.reference_mode),'first_frame')});
 await check('first/last frame has independent slots, role-safe deletion and persisted assignments',async()=>{
  await page.getByRole('button',{name:'首尾帧',exact:true}).click();assert(await gen.isDisabled());
  assert(await page.getByRole('button',{name:'替换首帧',exact:true}).isVisible());assert(await page.getByRole('button',{name:'上传尾帧',exact:true}).isVisible());
  await page.getByLabel('选择尾帧素材').selectOption('image-b');assert(!(await gen.isDisabled()));
  assert(await page.getByText('首帧 · 首帧素材',{exact:true}).isVisible());assert(await page.getByText('尾帧 · 尾帧素材',{exact:true}).isVisible());
  await page.getByRole('button',{name:'移除首帧图片',exact:true}).click();assert(await gen.isDisabled());assert.equal((await state()).inputs.frame_slots.first_frame,'');assert.equal((await state()).inputs.frame_slots.last_frame,'id:image-b');assert.deepEqual((await state()).inputs.image_ids,['image-b']);
  await page.reload();await page.getByLabel('选择首帧素材').waitFor();assert(await gen.isDisabled());assert.equal(await page.getByLabel('选择尾帧素材').inputValue(),'image-b');
  await page.getByLabel('选择首帧素材').selectOption('image-a');assert(!(await gen.isDisabled()));
  await page.getByRole('button',{name:'交换首帧与尾帧',exact:true}).click();assert.equal((await state()).inputs.frame_slots.first_frame,'id:image-b');assert.equal((await state()).inputs.frame_slots.last_frame,'id:image-a');
  await gen.click();assert.equal(await page.evaluate(()=>window.generateSnapshots.at(-1).inputs.frame_slots.first_frame),'id:image-b');
  await page.locator('.mw-panel-scroll').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(directory,'first-last-frame.png'),fullPage:true});
  // The compact image list is only an asset list; persisted roles govern request order.
  assert.deepEqual((await state()).inputs.image_ids,['image-a','image-b']);
 });
 await check('each upload targets its named role and drag/drop replaces only that role',async()=>{
  await page.route('**/api/studio/upload',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({asset:{id:'uploaded-first',asset_type:'image',status:'ready',title:'上传的首帧'}})}));
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'替换首帧',exact:true}).click();await(await chooser).setFiles({name:'first.png',mimeType:'image/png',buffer:fs.readFileSync('build/tijian.png')});
  await page.waitForFunction(()=>window.videoDraft.inputs.frame_slots?.first_frame==='id:uploaded-first');assert.equal((await state()).inputs.frame_slots.last_frame,'id:image-a');
  await page.getByRole('article',{name:'尾帧图片',exact:true}).evaluate(element=>{const data=new DataTransfer();data.setData('application/x-tijian-asset','image-b');element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}))});
  assert.equal((await state()).inputs.frame_slots.first_frame,'id:uploaded-first');assert.equal((await state()).inputs.frame_slots.last_frame,'id:image-b');
  await patch({image_ids:['image-a','image-b'],image_id:'image-a',frame_slots:{first_frame:'id:image-b',last_frame:'id:image-a'}});
 });
 await check('switching to first-frame keeps the former tail visible and removable without stale roles',async()=>{
  await page.getByRole('button',{name:'首帧生视频',exact:true}).click();assert(await gen.isDisabled());
  await page.getByRole('button',{name:'移除首帧素材',exact:true}).click();assert(!(await gen.isDisabled()));assert.equal((await state()).inputs.frame_slots.last_frame,'');
  await page.getByRole('button',{name:'首尾帧',exact:true}).click();await page.getByLabel('选择尾帧素材').selectOption('image-a');assert(!(await gen.isDisabled()));
  await patch({image_ids:['image-a','image-b'],image_id:'image-a'});
 });
 await check('legacy locked ratio mismatch is detected rather than silently displayed as valid',async()=>{await patch({}, {ratio:'9:16'});assert(await gen.isDisabled());await page.getByRole('button',{name:'首尾帧',exact:true}).click();assert.equal((await state()).options.ratio,'adaptive');assert(!(await gen.isDisabled()))});
 await check('switching to text preserves files but prevents invalid submission and Enter',async()=>{await page.getByRole('button',{name:'文字生视频',exact:true}).click();assert(await gen.isDisabled());assert.deepEqual((await state()).inputs.image_ids,['image-a','image-b']);const before=await page.evaluate(()=>window.generateSnapshots.length);await page.getByLabel('输入你的要求',{exact:true}).press('Enter');assert.equal(await page.evaluate(()=>window.generateSnapshots.length),before);await page.getByRole('button',{name:'移除尾帧素材',exact:true}).click();await page.getByRole('button',{name:'移除首帧素材',exact:true}).click();assert.equal((await state()).inputs.image_id,'');assert.deepEqual((await state()).inputs.image_ids,[]);assert(!(await gen.isDisabled()))});
 await check('multi-reference exposes actual image/video/audio inputs and retains draft',async()=>{await page.getByRole('button',{name:'多素材参考',exact:true}).click();for(const name of ['参考图片','参考视频','参考音频'])assert(await page.getByRole('button',{name:'上传或拖入'+name,exact:true}).isVisible());await patch({image_ids:['image-a'],image_id:'image-a',video_ids:['video-a'],audio_ids:['audio-a']});assert(!(await gen.isDisabled()));await gen.click();assert.deepEqual(await page.evaluate(()=>window.generateSnapshots.at(-1).inputs.video_ids),['video-a']);assert.equal((await state()).id,'isolated-video-draft')});
 await check('first frame preserves incompatible references until user removes them',async()=>{await page.getByRole('button',{name:'首帧生视频',exact:true}).click();assert(await gen.isDisabled());assert(await page.getByRole('button',{name:'移除原视频',exact:true}).isVisible());assert(await page.getByRole('button',{name:'移除参考声音',exact:true}).isVisible());await page.getByRole('button',{name:'移除原视频',exact:true}).click();await page.getByRole('button',{name:'移除参考声音',exact:true}).click();assert(!(await gen.isDisabled()))});
 await check('settings bind resolution/audio to options without touching prompt or materials',async()=>{await page.locator('.video-model-settings>summary').click();await page.getByLabel('视频分辨率').selectOption('1080p');await page.getByLabel('视频生成声音').selectOption('false');assert.equal((await state()).options.resolution,'1080p');assert.equal((await state()).options.generate_audio,false);assert.equal((await state()).inputs.profile_id,'original-ip');assert.deepEqual((await state()).inputs.image_ids,['image-a']);await page.locator('.video-model-settings>summary').click();await page.reload();await page.getByRole('button',{name:'首帧生视频',exact:true}).waitFor();assert.equal((await state()).options.resolution,'1080p');assert(!(await page.getByLabel('视频分辨率').isVisible()))});
 await check('edit/extend mode respects locked ratio/duration',async()=>{await page.locator('.video-existing-modes>summary').click();await page.getByRole('button',{name:'编辑视频',exact:true}).click();assert(await gen.isDisabled());assert.equal((await state()).options.duration,-1);assert.equal((await state()).options.ratio,'adaptive');assert(await page.getByLabel('视频时长',{exact:true}).isDisabled());await patch({video_ids:['video-a']});assert(!(await gen.isDisabled()));await page.getByRole('button',{name:'延长视频',exact:true}).click();assert(!(await page.getByLabel('视频时长',{exact:true}).isDisabled()));assert(await page.getByLabel('视频画面比例').isDisabled())});
 await check('fast model uses actual supported durations/resolutions and flags missing storage',async()=>{await page.locator('.video-model-settings>summary').click();await page.getByLabel('生成模型').selectOption('fixture-fast');assert.deepEqual(await page.getByLabel('视频分辨率').locator('option').allTextContents(),['480p','720p']);assert.equal(await page.getByLabel('视频时长',{exact:true}).locator('option').last().getAttribute('value'),'15');assert.equal((await state()).inputs.reference_mode,'reference');assert(await gen.isDisabled());assert(await page.getByText(/本地视频参考需要管理员配置/).isVisible());await page.getByRole('button',{name:'移除原视频',exact:true}).click();await page.getByLabel('生成模型').selectOption('fixture-25');await page.locator('.video-model-settings>summary').click()});
 await check('missing provider configuration never implies available generation',async()=>{await page.evaluate(()=>window.setVideoConfigured(false));await page.getByText(/当前视频模型尚未配置可用服务/).waitFor();assert(await gen.isDisabled());await page.evaluate(()=>window.setVideoConfigured(true))});
 await check('scenario modes produce distinct prompts; non-remix never forwards stale video',async()=>{await page.locator('.ark-scenario>summary').click();await page.getByRole('button',{name:'爆款复刻',exact:true}).click();await page.getByLabel('商品或服务名称').fill('家用电梯');await page.getByLabel('自己的产品与已确认卖点').fill('方便上下楼');await page.getByLabel('参考视频的结构与节奏').fill('先全景，再细节');await page.getByLabel('场景参考视频',{exact:true}).selectOption('video-a');await page.getByRole('button',{name:/填入创作要求/}).click();assert.equal(await page.evaluate(()=>window.scenarioCalls.at(-1).video),'video-a');await page.getByRole('button',{name:'商品展示',exact:true}).click();await page.getByRole('button',{name:/填入创作要求/}).click();assert.equal(await page.evaluate(()=>window.scenarioCalls.at(-1).video),'');assert.match((await state()).inputs.prompt,/从产品整体到关键细节/);assert.doesNotMatch((await state()).inputs.prompt,/适合短视频竖屏/);assert.equal((await state()).id,'isolated-video-draft');assert.deepEqual((await state()).inputs.image_ids,['image-a']);assert.deepEqual((await state()).inputs.video_ids,['video-a']);assert.equal((await state()).inputs.reference_mode,'reference')});
 await check('all four scenario templates produce their own instructions without resetting output choices',async()=>{await patch({}, {ratio:'16:9',duration:8,resolution:'1080p'});for(const [name,expected] of [['商品口播','出镜人物自然介绍商品'],['门店引流','从门头与周边进入']]){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('button',{name:/填入创作要求/}).click();assert((await state()).inputs.prompt.includes(expected));assert.equal((await state()).options.ratio,'16:9');assert.equal((await state()).options.duration,8);assert.equal((await state()).options.resolution,'1080p');assert.equal((await state()).inputs.profile_id,'original-ip')}});
 for(const mode of ['first_frame','first_last_frame','edit','extend']){
  await check(`prompt-only template preserves ${mode} and its generation inputs`,async()=>{
   const image_ids=mode==='first_frame'?['image-a']:mode==='first_last_frame'?['image-b','image-a']:[];
   await patch({reference_mode:mode,image_ids,image_id:image_ids[0]||'',video_ids:['edit','extend'].includes(mode)?['video-a']:[],audio_ids:[],remote_references:[]},{ratio:'adaptive',duration:mode==='edit'?-1:8,resolution:'1080p',generate_audio:false});
   const before=await state();
   await page.getByRole('button',{name:'商品展示',exact:true}).click();
   await page.getByRole('button',{name:/填入创作要求/}).click();
   const after=await state();
   assert.equal(after.inputs.reference_mode,mode);
   assert.deepEqual({...after.inputs,prompt:before.inputs.prompt},before.inputs);
   assert.deepEqual(after.options,before.options);
   assert.equal(after.id,before.id);assert.equal(after.model_id,before.model_id);
   assert.match(after.inputs.prompt,/从产品整体到关键细节/);
   assert(!(await gen.isDisabled()));
   const count=await page.evaluate(()=>window.generateSnapshots.length);
   await gen.click();
   assert.equal(await page.evaluate(()=>window.generateSnapshots.length),count+1);
   const submitted=await page.evaluate(()=>window.generateSnapshots.at(-1));
   assert.deepEqual(submitted.inputs,after.inputs);assert.deepEqual(submitted.options,after.options);
  });
 }
 await patch({reference_mode:'reference'});
 await check('technical material entry is folded but selected remote refs remain removable',async()=>{assert(!(await page.getByLabel('方舟素材地址').isVisible()));await patch({remote_references:[{kind:'image',url:'https://example.test/ref.png',title:'外部保留图'}]});assert(await page.getByRole('button',{name:'移除外部素材1',exact:true}).isVisible());await page.getByRole('button',{name:'使用素材链接或查看说明'}).click();assert(await page.getByLabel('方舟素材地址').isVisible())});
 await page.locator('.ark-scenario>summary').click();await page.locator('.mw-panel-scroll').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(directory,'video-simple.png'),fullPage:true});
 await check('no paid or backend calls, no runtime errors',async()=>{assert.equal(apiRequests,0);assert.deepEqual(errors,[])});
 console.log(JSON.stringify({passed:results.length,directory,paid_requests:0}));
} catch(error){results.push({passed:false,error:String(error)});throw error}
finally{fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,apiRequests},null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}
