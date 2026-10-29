// Verify that cover placement is applied to both downloadable and overlay pixels.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const bundle=await build({entryPoints:['src/CoverDesigner.tsx'],bundle:true,format:'iife',globalName:'CoverTesting',write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage();await page.route('http://cover-transform.local/',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body></body></html>'}));await page.goto('http://cover-transform.local/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const {drawCover,defaultCoverSettings}=window.CoverTesting;
  const options={...defaultCoverSettings,style:'headline',title:'测试标题'};
  const draw=o=>{const c=document.createElement('canvas');const boxes=drawCover(c,null,o,720,1280);const p=c.getContext('2d').getImageData(0,0,720,1280).data;let minX=720,maxX=-1,minY=1280,maxY=-1;for(let y=0;y<1280;y++)for(let x=0;x<720;x++)if(p[(y*720+x)*4+3]){minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY)}return {box:boxes.title,pixels:[minX,minY,maxX,maxY]}};
  const normal=draw(options),moved=draw({...options,placement:{group:{x:.10,y:.08,scale:1}}}),individual=draw({...options,placement:{title:{x:-.1,y:.06,scale:1.3}}});
  const frame=document.createElement('canvas');frame.width=720;frame.height=1280;frame.getContext('2d').fillRect(0,0,720,1280);
  const cover=document.createElement('canvas'),layer=document.createElement('canvas');const adjusted={...options,placement:{group:{x:.1,y:.08,scale:1.1},title:{x:-.1,y:.02,scale:1.3}}};
  drawCover(cover,frame,adjusted,720,1280);drawCover(layer,null,adjusted,720,1280);const merged=document.createElement('canvas');merged.width=720;merged.height=1280;const ctx=merged.getContext('2d');ctx.drawImage(frame,0,0);ctx.drawImage(layer,0,0);const a=cover.getContext('2d').getImageData(0,0,720,1280).data,b=ctx.getImageData(0,0,720,1280).data;let maxDiff=0;for(let i=0;i<a.length;i++)maxDiff=Math.max(maxDiff,Math.abs(a[i]-b[i]));return {normal,moved,individual,maxDiff};
 });
 assert(Math.abs((result.moved.box.x-result.normal.box.x)-72)<1);assert(Math.abs((result.moved.box.y-result.normal.box.y)-102.4)<1);
 assert(result.individual.box.w>result.normal.box.w*1.29);assert(result.individual.pixels[0]<result.normal.pixels[0]-30);assert(result.maxDiff<=2,JSON.stringify(result));
 console.log(JSON.stringify({passed:true,groupMoved:true,individualMovedAndScaled:true,coverOverlayMatch:true}));
}finally{await browser.close()}
