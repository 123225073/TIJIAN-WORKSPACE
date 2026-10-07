// Real React + disposable SQLite. The image is deterministic test artwork;
// the video is intentionally undecodable. No provider output/playback claims.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('hifly-ui'),checks=[],colors=[];
const dist=path.resolve(process.env.DIGITAL_HUMAN_UI_DIST||'dist');
let browser;
try {
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/seed-hifly-ui.py'],{env:fixture.env,windowsHide:true,stdio:['pipe','ignore','pipe']});
 let seedError='';seed.stderr.on('data',chunk=>seedError+=chunk);
 seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await new Promise(resolve=>seed.once('exit',resolve)),0,seedError);
 const mediaFixture=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import json,os,sys
from pathlib import Path
from backend import store as s, media_studio as m
from PIL import Image, ImageDraw
root=Path(os.environ['TIJIAN_DATA']).resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('hifly-ui-')
owner=json.load(sys.stdin)['owner'];s.init()
for a in s.list_(owner, 'studio_asset'):
    kind=a.get('asset_type')
    if kind not in ('video','audio','image'):continue
    value={**a,'mime_type':{'video':'video/mp4','audio':'audio/wav','image':'image/png'}[kind]}
    if kind=='image':
        image=Image.new('RGB',(480,640),'#222b3a');draw=ImageDraw.Draw(image)
        draw.rounded_rectangle((110,120,370,540),radius=70,fill='#9abbff')
        draw.ellipse((165,180,315,330),fill='#e4c891')
        draw.text((25,30),'ISOLATED PREVIEW FIXTURE',fill='#edf2fb')
        image.save(m._path(owner,a['local_file']),format='PNG')
    s.put(owner,'studio_asset',value,a['id'],a['version'])
`],{env:fixture.env,windowsHide:true,stdio:['pipe','ignore','pipe']});
 let mediaError='';mediaFixture.stderr.on('data',chunk=>mediaError+=chunk);mediaFixture.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await new Promise(resolve=>mediaFixture.once('exit',resolve)),0,mediaError);
 await fixture.call('/workspace',{});
 const profile=await fixture.call('/objects/profile',{title:'预览测试用户IP',position:'仅用于隔离布局验证'});
 const assets=(await fixture.call('/studio/assets')).items;
 const asset=kind=>assets.find(item=>item.asset_type===kind);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await fixture.attach(page);
 // A separate build is supported so this test never races the main agent's dist.
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==fixture.base)return route.fallback();
  const file=url.pathname==='/'?path.join(dist,'index.html'):url.pathname.startsWith('/assets/')?path.join(dist,url.pathname.slice(1)):'';
  if(!file||!fs.existsSync(file))return route.fallback();
  assert(file.startsWith(dist+path.sep));
  await route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});
 });
 const dialog=()=>page.locator('.studio-modal[open]');
 const enlarge=()=>page.getByRole('button',{name:/^放大预览：/});
 const saved=async(required)=>{
  for(let i=0;i<70;i++){
   const drafts=(await fixture.call('/studio/drafts')).items;
   const draft=drafts.find(item=>item.tool==='avatar_create'&&item.title==='隔离形象名称'&&required.every(key=>item.input[key]));
   if(draft)return draft;
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Avatar draft did not save expected name/material');
 };
 await page.goto(fixture.base+'/?ui=1#studio/avatar/create');
 await page.locator('.st-avatar-create').waitFor();
 await page.waitForFunction(id=>document.querySelector('.st-context select')?.value===id,profile.id);
 assert.equal(await page.getByLabel('形象名称',{exact:true}).count(),1);
 assert.equal(await page.getByLabel('草稿名称',{exact:true}).count(),0);
 await page.getByLabel('形象名称',{exact:true}).fill('隔离形象名称');
 await page.getByLabel('人物视频',{exact:false}).selectOption(asset('video').id);
 const videoDraft=await saved(['video_id']);assert(!videoDraft.input.image_id);
 checks.push('one-nearby-name-input-and-video-draft-persist');
 await enlarge().click();await dialog().waitFor();
 const video=dialog().locator('video');await video.waitFor();
 assert(await video.evaluate(node=>node.controls&&node.paused&&!node.autoplay&&node.preload==='metadata'));
 const previewBox=await video.boundingBox(),inlineBox=await page.locator('.st-human-preview-inline video').boundingBox();
 assert(previewBox.height>inlineBox.height*1.5&&previewBox.width>inlineBox.width);
 colors.push(await page.evaluate(measureContrast,{scope:'.studio-modal[open]'}));
 await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
 assert(await enlarge().evaluate(node=>document.activeElement===node));
 checks.push('video-enlarge-controls-no-autoplay-esc-focus-return');
 await enlarge().click();await dialog().waitFor();
 assert(await dialog().getByRole('button',{name:'关闭弹窗'}).evaluate(node=>document.activeElement===node));
 const focusCycle=[];
 for(const key of ['Tab','Tab','Shift+Tab','Shift+Tab']){
  await page.keyboard.press(key);
  const focus=await dialog().evaluate(node=>({tag:document.activeElement?.tagName,inside:node.contains(document.activeElement),documentFocused:document.hasFocus(),body:document.activeElement===document.body}));
  focusCycle.push({key,...focus});
  // Native dialogs may yield to browser chrome. It is a leak only when
  // an application element receives focus outside the modal.
  assert(focus.inside||(focus.body&&!focus.documentFocused),'Focus leaked to background application content: '+JSON.stringify(focus));
 }
 if(process.env.PREVIEW_FOCUS_DIAGNOSTICS==='1')console.log(JSON.stringify({focusCycle}));
 await dialog().getByRole('button',{name:'关闭弹窗'}).focus();
 await page.getByLabel('形象名称',{exact:true}).evaluate(node=>node.focus());
 assert(await dialog().evaluate(node=>node.contains(document.activeElement)),'The open modal must prevent focus moving into the background form');
 await dialog().getByRole('button',{name:'关闭弹窗'}).click();await dialog().waitFor({state:'detached'});
 assert(await enlarge().evaluate(node=>document.activeElement===node));
 checks.push('close-button-and-reopen');
 await enlarge().click();await dialog().waitFor();
 // Simulate an underlying material change while a modal is open: the keyed
 // preview must unmount and close the old dialog, even before the new file loads.
 await page.getByRole('button',{name:'人物照片创建',exact:true}).evaluate(node=>node.click());
 await dialog().waitFor({state:'detached'});
 assert.equal(await page.locator('.st-human-media-preview').count(),0);
 await page.getByLabel('人物照片',{exact:false}).selectOption(asset('image').id);
 const imageDraft=await saved(['image_id']);assert(!imageDraft.input.video_id);
 checks.push('switch-source-closes-old-preview-and-clears-other-material');
 await enlarge().click();await dialog().waitFor();
 await dialog().locator('img').waitFor();
 assert.equal(await dialog().locator('img').getAttribute('data-no-zoom'),'true');
 await dialog().locator('img').click();
 assert.equal(await page.locator('dialog[open]').count(),1,'Image should not open a nested global lightbox');
 await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
 checks.push('image-enlarge-and-no-nested-lightbox');
 await page.reload();await page.locator('.st-avatar-create').waitFor();
 await page.waitForFunction(()=>document.querySelector('.st-human-name input')?.value==='隔离形象名称');
 assert.equal(await page.getByLabel('人物照片',{exact:false}).inputValue(),asset('image').id);
 assert.equal(await dialog().count(),0);
 checks.push('reload-keeps-name-and-photo-closes-preview');
 for(const width of [1530,1050,760,390]){
  await page.setViewportSize({width,height:1000});await settleUI(page);
  const layout=await page.evaluate(()=>{
   const field=document.querySelector('.st-human-name'),material=document.querySelector('.st-human-material-heading'),guide=document.querySelector('.st-provider-guide');
   return {overflow:document.documentElement.scrollWidth>innerWidth+1,nameBottom:field.getBoundingClientRect().bottom,materialTop:material.getBoundingClientRect().top,guideBottom:guide.getBoundingClientRect().bottom,nameTop:field.getBoundingClientRect().top};
  });
  assert(!layout.overflow,'Horizontal overflow at '+width);
  assert(layout.nameTop-layout.guideBottom>=20&&layout.materialTop-layout.nameBottom>=20,'Material groups overlap at '+width);
  await enlarge().click();await dialog().waitFor();
  const box=await dialog().boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);
  await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
  checks.push('group-spacing-and-preview-fit-'+width);
 }
 await page.setViewportSize({width:1530,height:1000});
 for(const state of ['normal','hover','focus']){
  const choice=page.getByRole('button',{name:'人物照片创建',exact:true});
  if(state==='hover')await choice.hover();
  if(state==='focus')await choice.focus();
  await settleUI(page);colors.push(await page.evaluate(measureContrast,{scope:'.st-human-workspace',excludeUserPaper:true}));
 }
 assert.deepEqual(colors.flatMap(result=>result.violations),[]);
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 await page.screenshot({path:path.join(fixture.directory,'avatar-create.png'),fullPage:true});
 await enlarge().click();await dialog().waitFor();
 await page.screenshot({path:path.join(fixture.directory,'avatar-preview.png')});
 const report={passed:true,checks,colors,directory:fixture.directory,dist,indexSHA256:createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex'),paid_generation:false,video_decode_verified:false};
 fs.writeFileSync(path.join(fixture.directory,'preview-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length,colorStates:colors.length,directory:fixture.directory,dist}));
}finally{await browser?.close();fixture.close()}
