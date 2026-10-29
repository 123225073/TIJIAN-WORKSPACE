// Exercise pointer movement, scaling and live playback with real local video.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tijian-cover-test-')),video=path.join(temp,'sample.mp4');
const ff=path.resolve('.runtime/media-tools/ffmpeg.exe');
const made=spawnSync(ff,['-v','error','-y','-f','lavfi','-i','color=blue:s=360x640:r=25:d=5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=5','-c:v','libx264','-c:a','aac','-threads','2',video],{windowsHide:true,encoding:'utf8'});assert.equal(made.status,0,made.stderr);
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import CoverDesigner,{defaultCoverSettings}from'./src/CoverDesigner';function App(){const[v,set]=useState({...defaultCoverSettings,title:'电梯安全',subtitle:'需要注意的问题',overlayAssetId:'old',overlaySourceId:'video',overlayCanvasKey:'9:16:cover'});window.currentCover=v;return <CoverDesigner asset={{id:'video',asset_type:'video',file_url:'/api/video'}} value={v} onChange={set} aspectRatio="9:16" fit="cover" srt={'1\\n00:00:00,000 --> 00:00:01,500\\n测试字幕'} playbackRate={1.1}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://cover-interaction.local/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/video')return route.fulfill({status:200,contentType:'video/mp4',body:fs.readFileSync(video)});return route.fulfill({status:200,contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'})});
 await page.goto('http://cover-interaction.local/');await page.addStyleTag({content:fs.readFileSync('src/cover-designer.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByLabel('封面标题').waitFor();await page.locator('.cd-transform').waitFor();await page.getByRole('button',{name:'播放预览片头'}).waitFor({state:'visible'});
 const group=page.locator('.cd-transform'),b=await group.boundingBox();assert(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+35,b.y+b.height/2+25,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>window.currentCover?.placement?.group?.x>.02);let state=await page.evaluate(()=>window.currentCover);assert.equal(state.overlayAssetId,'');assert(state.placement.group.y>.01);
 const box=await page.locator('.cd-handle').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-20,box.y+box.height/2+45,{steps:5});await page.mouse.up();await page.waitForFunction(()=>window.currentCover.placement.group.scale>1.05);
 await page.getByRole('button',{name:'副标题',exact:true}).click();const sb=await group.boundingBox();await page.mouse.move(sb.x+sb.width/2,sb.y+sb.height/2);await page.mouse.down();await page.mouse.move(sb.x+sb.width/2-20,sb.y+sb.height/2+15,{steps:5});await page.mouse.up();await page.waitForFunction(()=>window.currentCover.placement.subtitle?.x<-.01);
 await page.getByRole('button',{name:'播放预览片头'}).click();await page.getByText('测试字幕').waitFor();await page.waitForFunction(()=>{const v=document.querySelector('.cd-frame video');return v&&!v.paused&&v.currentTime>0.4});const rate=await page.locator('.cd-frame video').evaluate(v=>v.playbackRate);assert.equal(rate,1.1);await page.waitForFunction(()=>document.querySelector('.cd-frame video')?.currentTime>3.12);const bright=await page.locator('.cd-frame canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>170&&d[i+1]>170&&d[i+2]>170)n++;return n});assert(bright<20,'标题超过设置时长后应消失');await page.getByRole('button',{name:'停止播放'}).click();await page.getByRole('button',{name:'下载封面 JPG'}).waitFor({state:'visible'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,groupDrag:true,resize:true,individualDrag:true,playback:true,subtitlePreview:true,oldOverlayInvalidated:true}));
}finally{await browser.close()}
