// Real video workbench components + source CSS; local fixtures only, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const directory=path.resolve('.runtime','video-simple-ui-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const entry=`import {useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import MediaWorkbench from './src/MediaWorkbench';
const options={ratio:['16:9','9:16','4:3','3:4','1:1','21:9','adaptive'],duration:Array.from({length:12},(_,i)=>i+4)};
const model={id:'media:minimax-h3-pro-2k',provider:'oairegbox',title:'MiniMax H3 Pro · 2K',family:'minimax-h3-pro-2k',price_per_second:.33,configured:true,modes:['text','reference','first_frame','first_last_frame'],reference_limits:{image:9,video:1,audio:3},options};
const assets=[{id:'image-a',asset_type:'image',status:'ready',title:'首帧素材',file_url:'/picture.png'},{id:'image-b',asset_type:'image',status:'ready',title:'尾帧素材',file_url:'/picture.png'},{id:'video-a',asset_type:'video',status:'ready',title:'原视频'},{id:'audio-a',asset_type:'audio',status:'ready',title:'参考声音'}];
const initial={id:'isolated-video-draft',tool:'text_video',model_id:model.id,inputs:{prompt:'电梯门打开，镜头进入轿厢。',reference_mode:'first_frame',profile_id:'original-ip'},options:{ratio:'9:16'},version:1};
function Fixture(){const [draft,setDraft]=useState(()=>JSON.parse(localStorage.getItem('fixture-video')||'null')||initial),[configured,setConfigured]=useState(true);
useEffect(()=>{window.videoDraft=draft;localStorage.setItem('fixture-video',JSON.stringify(draft))},[draft]);
window.patchVideo=(input={},options={})=>setDraft(d=>({...d,inputs:{...d.inputs,...input},options:{...d.options,...options}}));window.setVideoConfigured=setConfigured;
const update=input=>setDraft(d=>({...d,inputs:{...d.inputs,...input},version:d.version+1,request_id:undefined}));
const changeOptions=(key,value)=>setDraft(d=>({...d,options:{...d.options,[key]:value},version:d.version+1}));
return <MediaWorkbench draft={draft} cap={{models:[model],options:model.options}} baseCap={{binding:model.id}} assets={assets} runs={[]} update={update} changeOptions={changeOptions} canGenerate={configured} configured={configured} generate={()=>{window.generateSnapshots.push(structuredClone(draft))}} busy={false} running={false} saveState="隔离测试草稿" context={<p>原 IP 已保留</p>} outputUI={()=>null} outputs={()=>[]} reloadAssets={async()=>{}} owner="video-test"/>}
window.generateSnapshots=[];createRoot(document.getElementById('root')).render(<Fixture/>);`;
const cssBundle=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'all.js'),external:['/visuals/*']});
const css=cssBundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js')});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
let apiRequests=0;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(url.pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}else if(url.pathname==='/picture.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync('build/tijian.png'))}else if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}else{if(url.pathname.startsWith('/api/'))apiRequests++;res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
let browser;const results=[];
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==base)throw Error('Unexpected external request');await route.continue()});await page.goto(base);
 const check=async(name,test)=>{await test();results.push({name,passed:true})};const state=()=>page.evaluate(()=>window.videoDraft);const gen=page.locator('.mw-generate');const patch=async(input={},options={})=>{await page.evaluate(({input,options})=>window.patchVideo(input,options),{input,options});await page.waitForFunction(({input,options})=>Object.entries(input).every(([k,v])=>JSON.stringify(window.videoDraft.inputs[k])===JSON.stringify(v))&&Object.entries(options).every(([k,v])=>JSON.stringify(window.videoDraft.options[k])===JSON.stringify(v)),{input,options})};
 const settings=page.getByRole('region',{name:'视频设置',exact:true});
 const choose=async(label,name)=>{
  await settings.getByRole('button',{name:label,exact:true}).click();
  const modal=page.getByRole('dialog',{name:label,exact:true});
  await modal.getByLabel('搜索图片素材').fill(name);
  const card=modal.locator('article').filter({hasText:name});
  await card.getByRole('button',{name:'预览 '+name}).click();
  await modal.locator('.asset-picker-full img').waitFor();
  await modal.getByRole('button',{name:'使用这张图片'}).click();
 };
 const snapshotCount=()=>page.evaluate(()=>window.generateSnapshots.length);
 const issue=message=>settings.getByRole('status').filter({hasText:message}).waitFor();
 await check('fixed model and settings are visible on main page, library above compact empty works',async()=>{
  await settings.getByText('MiniMax H3 Pro · 2K',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('生成模型').count(),0);
  assert.equal(await settings.getByLabel('视频画面比例').inputValue(),'9:16');
  const [library,works]=await page.locator('.mw-results').evaluate(e=>['.video-shelf','.mw-results-heading'].map(s=>e.querySelector(s).offsetTop));
  assert(library<works);
  assert.equal(await page.locator('.mw-panel .video-settings').count(),1);
  assert.equal(await page.locator('.mw-results .video-settings').count(),0);
  assert((await page.locator('.mw-panel').boundingBox()).width>=490);
  assert((await page.locator('.video-works-empty').boundingBox()).height<100);
 });
 await check('first frame uses image-only gallery, validates selection and preserves values',async()=>{
  const before=await snapshotCount();
  await issue('请添加首帧图片');await gen.click();assert.equal(await snapshotCount(),before);
  await choose('从素材库选择首帧','首帧素材');
  await gen.click();assert.equal(await snapshotCount(),before+1);
  assert.equal((await state()).inputs.frame_slots.first_frame,'id:image-a');
  assert.equal((await state()).inputs.profile_id,'original-ip');
  assert.equal((await state()).model_id,'media:minimax-h3-pro-2k');
 });
 await check('distinct first/last frames remain assigned across removal and reload',async()=>{
  await settings.getByRole('button',{name:'首尾帧',exact:true}).click();
  await issue('请添加尾帧图片');
  await choose('从素材库选择尾帧','尾帧素材');
  await settings.getByRole('button',{name:'移除首帧图片'}).click();
  await issue('请添加首帧图片');assert.deepEqual((await state()).inputs.frame_slots,{first_frame:'',last_frame:'id:image-b'});
  await page.reload();await settings.getByText('尾帧 · 尾帧素材',{exact:true}).waitFor();
  await choose('从素材库选择首帧','首帧素材');
  await settings.getByRole('button',{name:'交换首帧与尾帧'}).click();
  assert.equal((await state()).inputs.frame_slots.first_frame,'id:image-b');
 });
 await check('retains incompatible references and blocks invalid generation',async()=>{
  await settings.getByRole('button',{name:'文字生视频',exact:true}).click();
  await issue('文字生视频不使用素材');
  const before=await snapshotCount();await gen.click();assert.equal(await snapshotCount(),before);
  assert.deepEqual((await state()).inputs.image_ids,['image-a','image-b']);
 });
 await check('multi-reference accepts a video with the fixed Pro 2K model',async()=>{
  await settings.getByRole('button',{name:'多素材参考',exact:true}).click();
  await settings.getByLabel('从素材库选择参考视频').selectOption('video-a');
  await settings.getByLabel('从素材库选择参考音频').selectOption('audio-a');
  await settings.getByLabel('视频画面比例').selectOption('16:9');
  await settings.getByLabel('视频时长').selectOption('8');
  const before=await snapshotCount();await gen.click();assert.equal(await snapshotCount(),before+1);
  const snapshot=await page.evaluate(()=>window.generateSnapshots.at(-1));
  assert.deepEqual(snapshot.inputs.video_ids,['video-a']);
  assert.deepEqual(snapshot.options,{ratio:'16:9',duration:8});
 });
 await check('technical URL field stays folded until opened',async()=>{
  await patch({remote_references:[{kind:'image',url:'https://example.test/ref.png',title:'外部保留图'}]});
  assert(!(await settings.getByLabel('外部素材地址').isVisible()));
  assert(await settings.getByRole('button',{name:'移除外部素材1',exact:true}).isVisible());
  await settings.getByRole('button',{name:'使用素材链接或查看说明'}).click();
  assert(await settings.getByLabel('外部素材地址').isVisible());
 });
 await check('missing provider key never enables generation',async()=>{
  await page.evaluate(()=>window.setVideoConfigured(false));
  await page.getByText(/尚未配置可用服务/).waitFor();assert(await gen.isDisabled());
 });
 await page.screenshot({path:path.join(directory,'video-settings.png')});
 await check('no paid or backend calls, no runtime errors',async()=>{assert.equal(apiRequests,0);assert.deepEqual(errors,[])});
 console.log(JSON.stringify({passed:results.length,directory,paid_requests:0}));
} catch(error){results.push({passed:false,error:String(error)});throw error}
finally{fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({results,apiRequests},null,2));await browser?.close();await new Promise(resolve=>server.close(resolve))}
