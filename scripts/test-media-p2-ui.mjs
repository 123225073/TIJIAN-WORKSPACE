import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

// Fresh local fixture only. This test must never confirm a paid generation.
const editorSources=['src/ImageEditWorkspace.tsx','src/image-edit-workspace.css','src/MediaReferences.tsx','src/media-references.css','src/image-clipboard.ts','src/MediaWorkbench.tsx','src/AssetPicker.tsx','src/Studio.tsx','src/media-resize.css'];
const index=fs.existsSync('dist/index.html')?fs.readFileSync('dist/index.html','utf8'):'';
const builtAssets=[...index.matchAll(/\/assets\/(workspace-[^"']+\.(?:js|css))/g)].map(match=>match[1]);
assert(builtAssets.some(name=>name.endsWith('.js'))&&builtAssets.some(name=>name.endsWith('.css')),'请先运行 npm run build，确保页面产物存在');
const latestSource=Math.max(...editorSources.map(name=>fs.statSync(name).mtimeMs));
const oldestBundle=Math.min(...builtAssets.map(name=>fs.statSync(path.join('dist/assets',name)).mtimeMs));
assert(oldestBundle>=latestSource,'编辑器源码比测试页面新，请先运行 npm run build');
const dir=path.resolve('.runtime','media-p2-ui-'+Date.now());
fs.mkdirSync(dir,{recursive:true});
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
 windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let errors='',browser;
service.stderr.on('data',chunk=>errors+=chunk);
try{
 let ready=false;
 for(let i=0;i<150;i++){
  try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 if(!ready)throw Error(errors||'Fixture not ready');
 const login=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'media-p2@example.test',password:'isolated-test-only',name:'图片媒体验收'})});
 assert.equal(login.status,200);
 const auth=await login.json(),headers={Authorization:'Bearer '+auth.token};
 const catalog=await(await fetch(base+'/api/studio/catalog',{headers})).json();
 const referenceModel=catalog.tools.find(tool=>tool.id==='text_image')?.models?.find(model=>model.family==='gpt-image-2.5-edit');
 assert(referenceModel,'图片生成目录应提供支持参考图的模型');
 const legacyTextModel=catalog.tools.find(tool=>tool.id==='text_image')?.models?.find(model=>model.id==='fixture-image2');
 const legacyEditModel=catalog.tools.find(tool=>tool.id==='image_edit')?.models?.find(model=>model.id==='fixture-image2');
 assert(legacyTextModel&&legacyEditModel,'同一生图模型应同时出现在图片生成和图片编辑');
 assert.equal(legacyTextModel.reference_limits?.image,16,'GPT Image 生成应允许同样数量的参考图片');
 assert.equal(legacyEditModel.reference_limits?.image,16,'GPT Image 编辑应支持多张输入图');
 assert.deepEqual(legacyEditModel.options,legacyTextModel.options,'同一生图模型在生成和编辑时应使用相同参数');
 browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1480,height:960}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 let generationRequests=0,thumbnailRequests=0,originalRequests=0;
 page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(pathname==='/api/studio/generate')generationRequests++;if(pathname.endsWith('/thumbnail'))thumbnailRequests++;if(/^\/api\/studio\/assets\/[^/]+\/file$/.test(pathname))originalRequests++});
 const savedDraft=async(tool,accept=()=>true)=>{
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   const response=await fetch(base+'/api/studio/drafts',{headers});
   assert.equal(response.status,200);
   const item=(await response.json()).items.find(draft=>draft.tool===tool&&accept(draft));
   if(item)return item;
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error(tool+' 草稿未按预期保存；浏览器提示：'+(await page.locator('[role=alert]').allInnerTexts()).join(' | '));
 };
 const png=fs.readFileSync('build/tijian.png');
 const setClipboardImage=async()=>page.evaluate(base64=>{
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>[{types:['image/png'],getType:async()=>new Blob([bytes],{type:'image/png'})}]}});
 },png.toString('base64'));
 await page.goto(base);
 await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/image?mode=text_image');
 await page.locator('.media-refs-drop').waitFor();
 await page.getByRole('button',{name:'模型与参数'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.mw-modal-model select option').length>1,undefined,{timeout:30000});
 await page.getByLabel('生成模型').selectOption(legacyTextModel.id);
 await page.getByRole('button',{name:'完成设置'}).click();
 await page.getByLabel('输入你的要求').fill('电梯产品展示，简洁可靠的视觉风格');
 // Keep the real library response pending: upload results must be usable
 // without waiting for this unrelated list request to finish.
 let releaseAssetReads;
 const assetReadGate=new Promise(resolve=>releaseAssetReads=resolve);
 await page.route('**/api/studio/assets',async route=>{await assetReadGate;await route.continue()});
 await page.locator('.media-refs input[type=file]').setInputFiles([
  {name:'reference-a.png',mimeType:'image/png',buffer:png},
  {name:'reference-b.png',mimeType:'image/png',buffer:png},
 ]);
 await page.waitForFunction(()=>document.querySelector('.media-refs-label')?.textContent?.includes('2 / 16'),undefined,{timeout:5000});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.media-refs-preview img')).filter(img=>img.complete&&img.naturalWidth>0).length===2);
 assert.equal(await page.locator('.media-refs-paste').isEnabled(),true,'素材库读取缓慢时上传和粘贴应及时恢复');
 assert(thumbnailRequests>=2,'参考图预览应读取缩略图');
 assert.equal(originalRequests,0,'缩略图预览不能下载整张原图');
 await page.screenshot({path:path.join(dir,'reference-controls.png')});
 await page.setViewportSize({width:1000,height:700});
 assert.equal(await page.locator('.media-refs-actions').evaluate(node=>node.scrollWidth<=node.clientWidth),true,'小窗口参考素材按钮不能横向溢出');
 assert.equal(await page.locator('.media-refs-paste span').evaluate(node=>node.getBoundingClientRect().height<25),true,'粘贴图片按钮文字应保持一行');
 await page.setViewportSize({width:1480,height:960});
 const resumedRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/studio/assets');
 releaseAssetReads();
 await resumedRead;
 await page.unroute('**/api/studio/assets');
 assert.equal(new URL(page.url()).hash.includes('mode=image_edit'),false,'上传参考图不能切换到图片编辑');
 assert.equal(await page.locator('.mw-mode-switch a[aria-current=page]').innerText(),'图片生成');
 await page.waitForTimeout(1100);
 await page.getByRole('button',{name:'模型与参数'}).click();
 assert.equal(await page.getByLabel('生成模型').inputValue(),legacyTextModel.id,'上传参考图后不应强制换回中转模型');
 await page.getByRole('button',{name:'完成设置'}).click();
 const legacyGeneratedDraft=await savedDraft('text_image',draft=>draft.model_id===legacyTextModel.id&&draft.input?.image_ids?.length===2);
 assert.equal(legacyGeneratedDraft.input.image_id,legacyGeneratedDraft.input.image_ids[0]);
 assert.equal(await page.locator('.media-refs-selected > div').count(),2);
 assert.equal(await page.locator('.media-refs-row select').count(),0,'不应再显示看不到原图的素材下拉框');
 await setClipboardImage();
 await page.getByRole('button',{name:/粘贴截图/}).click();
 await page.waitForFunction(()=>document.querySelector('.media-refs-label')?.textContent?.includes('3 / 16'),undefined,{timeout:30000});
 await page.locator('.media-refs-selected > div').last().getByRole('button',{name:/移除/}).click();
 await page.locator('.media-refs-paste').evaluate((button,base64)=>{
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  const data=new DataTransfer();data.items.add(new File([bytes],'screenshot.png',{type:'image/png'}));
  button.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },png.toString('base64'));
 await page.waitForFunction(()=>document.querySelector('.media-refs-label')?.textContent?.includes('3 / 16'),undefined,{timeout:30000});
 await page.locator('.media-refs-selected > div').last().getByRole('button',{name:/移除/}).click();
 await page.waitForFunction(()=>document.querySelector('.media-refs-label')?.textContent?.includes('2 / 16'));
 await page.locator('.media-refs-preview').first().click();
 await page.locator('.image-lightbox[open]').waitFor();
 await page.waitForFunction(()=>Boolean(document.querySelector('.image-lightbox-stage img')?.naturalWidth));
 assert(originalRequests>0,'放大查看时应读取原图');
 await page.locator('.image-lightbox').getByRole('button',{name:'关闭'}).click();

 await page.route('**/api/studio/runs',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{
  id:'isolated-generation-result',tool:'text_image',draft_id:legacyGeneratedDraft.id,title:'隔离测试生成',status:'succeeded',asset_ids:[legacyGeneratedDraft.input.image_ids[0]],created:new Date().toISOString(),generation:{input:{prompt:'电梯产品展示，简洁可靠的视觉风格'},model_title:'隔离测试模型'},
 }]})}));
 await page.reload();
 await page.locator('.mw-result-card').waitFor();
 assert.deepEqual(await page.locator('.mw-result-card .st-output-footer button, .mw-result-card footer button').allTextContents(),['下载','复制提示词'],'图片生成结果只应保留下载和复制提示词');
 assert.equal(await page.locator('.mw-result-card .st-inline').count(),0);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedPrompt=text}}}));
 await page.getByRole('button',{name:'复制提示词'}).click();
 assert.equal(await page.evaluate(()=>window.__copiedPrompt),'电梯产品展示，简洁可靠的视觉风格');
 await page.unroute('**/api/studio/runs');

 // Enter image editing explicitly; reference-image generation must stay separate.
 await page.getByRole('link',{name:'图片编辑'}).click();
 await page.locator('.ie-workspace').waitFor();
 assert(new URL(page.url()).hash.includes('mode=image_edit'));
 assert.equal(await page.getByRole('navigation',{name:'图片创作方式'}).getByRole('link',{name:'图片生成'}).isVisible(),true,'图片生成切换入口必须在编辑页直接可见');
 await page.getByRole('button',{name:'模型与参数'}).click();
 await page.getByLabel('生成模型').selectOption(legacyEditModel.id);
 await page.getByRole('button',{name:'完成设置'}).click();
 await setClipboardImage();
 await page.getByRole('button',{name:'粘贴截图'}).click();
 await page.locator('.ie-reference-details summary small').getByText('1 / 16').waitFor();
 await savedDraft('image_edit',draft=>draft.input?.image_id&&draft.input?.image_ids?.length===1);
 await page.locator('.ie-workspace input[type=file]').setInputFiles({name:'edit-original.png',mimeType:'image/png',buffer:png});
 await savedDraft('image_edit',draft=>draft.input?.image_id&&draft.input?.image_ids?.length===1&&draft.input.image_id!==legacyGeneratedDraft.input.image_ids[0]);
 await page.locator('.ie-reference-details summary small').getByText('1 / 16').waitFor();
 await setClipboardImage();
 await page.getByRole('button',{name:'粘贴截图'}).click();
 await page.locator('.ie-layer').first().waitFor();
 await page.getByRole('button',{name:'删除插入对象 1'}).click();
 await page.locator('.ie-layer').first().waitFor({state:'detached'});
 await page.screenshot({path:path.join(dir,'before-edit-hit.png')});
 await page.locator('.ie-hit').waitFor();
 await page.locator('.ie-canvas-image img').waitFor({state:'visible'});
 const hit=page.locator('.ie-hit');
 await hit.scrollIntoViewIfNeeded();
 const bounds=await hit.boundingBox();
 assert(bounds&&bounds.width>100&&bounds.height>100,'原图画布应有可框选区域');
 const draw=async(x1,y1,x2,y2)=>{
  await page.mouse.move(bounds.x+bounds.width*x1,bounds.y+bounds.height*y1);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*x2,bounds.y+bounds.height*y2,{steps:6});
  await page.mouse.up();
 };
 await draw(.10,.13,.35,.38);
 await draw(.53,.52,.82,.81);
 await page.locator('.ie-mark').nth(1).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'区域 2 的修改说明'}).evaluate(node=>document.activeElement===node),true,'框选后应直接聚焦对应备注');
 await page.getByRole('button',{name:'区域 1',exact:true}).click();
 await page.getByRole('textbox',{name:'区域 1 的修改说明'}).fill('把左上角改为深绿色，保留原有结构');
 await page.getByRole('button',{name:'区域 2',exact:true}).click();
 await page.getByRole('textbox',{name:'区域 2 的修改说明'}).fill('清理右下角杂物，补全背景纹理');
 await page.getByRole('button',{name:'图片素材',exact:true}).click();
 const referenceCard=page.locator('.ie-source-list article').filter({hasText:'reference-a.png'});
 await referenceCard.getByRole('button',{name:'加参考'}).click();
 await savedDraft('image_edit',draft=>draft.input?.image_ids?.length===2&&draft.input?.edit_marks?.length===2);
 await page.getByRole('button',{name:'关闭图片素材'}).click();
 assert.equal(await page.locator('.ie-stage').isVisible(),true);
 assert.equal(await page.locator('.mw-history').isVisible(),false,'编辑时不应在画布下面堆放历史作品');
 await page.screenshot({path:path.join(dir,'image-edit-workspace.png')});
 const marked=await savedDraft('image_edit',draft=>draft.input?.edit_marks?.length===2&&draft.input.edit_marks.every(mark=>mark.instruction?.trim()));
 assert.notEqual(marked.input.edit_marks[0].instruction,marked.input.edit_marks[1].instruction);
 assert(marked.input.edit_marks.every(mark=>mark.x>=0&&mark.y>=0&&mark.x+mark.width<=1&&mark.y+mark.height<=1));
 const beforeMove=(await savedDraft('image_edit')).input.edit_marks[0];
 const moving=await page.locator('.ie-mark').first().boundingBox();
 assert(moving,'标注框必须可拖动');
 await page.mouse.move(moving.x+moving.width/2,moving.y+moving.height/2);
 await page.mouse.down();await page.mouse.move(moving.x+moving.width/2+38,moving.y+moving.height/2+20,{steps:6});await page.mouse.up();
 const moved=await savedDraft('image_edit',draft=>draft.input?.edit_marks?.[0]?.x>beforeMove.x+.01);
 const beforeResize=moved.input.edit_marks[0];
 const handle=await page.locator('.ie-mark').first().locator('.ie-mark-handle-se').boundingBox();
 assert(handle,'标注框四角应显示缩放手柄');
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+35,handle.y+handle.height/2+26,{steps:6});await page.mouse.up();
 await savedDraft('image_edit',draft=>draft.input?.edit_marks?.[0]?.width>beforeResize.width+.01);
 assert((await page.locator('.ie-mark-caption').first().innerText()).includes('深绿色'),'区域备注应直接显示在图上');
 await page.getByRole('button',{name:'+ 添加区域'}).click();
 assert.equal(await page.getByRole('textbox',{name:'区域 3 的修改说明'}).evaluate(node=>document.activeElement===node),true,'键盘添加区域后应聚焦备注');
 await page.getByRole('button',{name:'删除区域 3'}).click();
 await page.setViewportSize({width:1000,height:800});
 const narrowStage=await page.locator('.ie-stage').boundingBox();
 assert(narrowStage&&narrowStage.width>=320,'最小窗口宽度下画布应保留可操作宽度');
 await page.screenshot({path:path.join(dir,'image-edit-narrow.png')});
 await page.getByRole('button',{name:'模型与参数'}).click();
 assert.equal(await page.getByLabel('生成模型').isVisible(),true,'窄窗口仍可打开模型与生成设置');
 await page.getByRole('button',{name:'完成设置'}).click();
 await page.setViewportSize({width:1480,height:960});
 await page.reload();
 await page.locator('.ie-mark').nth(1).waitFor();
 await page.getByRole('button',{name:/区域 1/}).first().click();
 assert.equal(await page.getByRole('textbox',{name:'区域 1 的修改说明'}).inputValue(),'把左上角改为深绿色，保留原有结构');
 await page.getByRole('button',{name:/区域 2/}).first().click();
 assert.equal(await page.getByRole('textbox',{name:'区域 2 的修改说明'}).inputValue(),'清理右下角杂物，补全背景纹理');

 await page.getByRole('button',{name:'图片叠加合成'}).click();
 assert.equal(await page.getByRole('button',{name:'保存合成新图'}).isDisabled(),true,'没有可见对象时不能合成');
 await setClipboardImage();
 await page.getByRole('button',{name:'粘贴截图'}).click();
 await page.locator('.ie-layer').first().waitFor();
 await savedDraft('image_edit',draft=>draft.input?.image_layers?.length===1);
 await page.getByRole('button',{name:'删除插入对象 1'}).click();
 await page.locator('.ie-layer').first().waitFor({state:'detached'});
 await savedDraft('image_edit',draft=>!draft.input?.image_layers?.length);
 await page.getByRole('button',{name:'图片素材',exact:true}).click();
 const material=page.locator('.ie-source-list article').filter({hasText:'reference-b.png'});
 await material.waitFor();
 // Dispatch the browser's drag events with one DataTransfer object. Playwright's
 // dragTo does not consistently fire HTML dragstart on this scrollable shelf.
 await material.evaluate(source=>{
  const stage=document.querySelector('.ie-stage'),overlay=document.querySelector('.ie-overlay');
  if(!stage||!overlay)throw Error('原图画布未就绪');
  const transfer=new DataTransfer(),bounds=overlay.getBoundingClientRect();
  source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  if(!transfer.getData('application/x-tijian-asset'))throw Error('素材拖动未写入素材编号');
  const position={bubbles:true,cancelable:true,dataTransfer:transfer,clientX:bounds.left+bounds.width*.62,clientY:bounds.top+bounds.height*.45};
  stage.dispatchEvent(new DragEvent('dragover',position));
  stage.dispatchEvent(new DragEvent('drop',position));
 });
 await page.locator('.ie-layer').first().waitFor();
 const layered=await savedDraft('image_edit',draft=>draft.input?.image_layers?.length===1&&draft.input.image_layers[0].asset_id===legacyGeneratedDraft.input.image_ids[1]);
 assert.equal(layered.input.image_id,marked.input.image_id,'插入素材不能替换原图');
 assert.equal(layered.input.image_layers[0].asset_id,legacyGeneratedDraft.input.image_ids[1]);
 let releaseUpload,uploadReached;
 const uploadGate=new Promise(resolve=>{releaseUpload=resolve}),uploadStarted=new Promise(resolve=>{uploadReached=resolve});
 await page.route('**/api/studio/upload',async route=>{uploadReached();await uploadGate;await route.continue()});
 await page.getByRole('button',{name:'保存合成新图'}).click();
 await uploadStarted;
 await page.locator('.ie-layer-list input').first().fill('40');
 await savedDraft('image_edit',draft=>draft.input?.image_layers?.[0]?.x===.4);
 releaseUpload();
 await page.getByText('合成图已存入素材库；画布期间发生变化，当前编辑已保留。').waitFor({timeout:30000});
 await page.unroute('**/api/studio/upload');
 const afterRace=await savedDraft('image_edit',draft=>draft.input?.image_layers?.[0]?.x===.4);
 assert.equal(afterRace.input.image_id,marked.input.image_id,'异步合成不得覆盖期间的新编辑');
 await page.getByRole('button',{name:'保存合成新图'}).click();
 await page.getByText('合成图已保存。').waitFor({timeout:30000});
 const composed=await savedDraft('image_edit',draft=>draft.input?.image_id!==marked.input.image_id&&draft.input?.image_layers?.length===0);
 assert.equal(composed.input.edit_marks.length,2,'保存合成图仍应保留两处独立修改说明');
 const assets=await(await fetch(base+'/api/studio/assets',{headers})).json();
 const composite=assets.items.find(asset=>asset.id===composed.input.image_id);
 assert(composite?.title?.startsWith('图片合成-')&&composite.file_url,'合成结果应作为可再次使用的图片素材保存');
 const image=await fetch(base+composite.file_url,{headers});
 assert.equal(image.status,200);
 assert((await image.arrayBuffer()).byteLength>0,'合成图文件应可读取');
 await page.getByRole('button',{name:'图片素材',exact:true}).click();
 await page.locator('.ie-asset-drawer').waitFor({state:'hidden'});
 await page.locator('.ie-stage').evaluate((stage,bytes)=>{
  const transfer=new DataTransfer(),file=new File([new Uint8Array(bytes)],'placed-object.png',{type:'image/png'});
  transfer.items.add(file);
  const bounds=stage.querySelector('.ie-overlay').getBoundingClientRect();
  const event={bubbles:true,cancelable:true,dataTransfer:transfer,clientX:bounds.left+bounds.width*.25,clientY:bounds.top+bounds.height*.35};
  stage.dispatchEvent(new DragEvent('drop',event));
 },Array.from(png));
 const uploadedLayer=await savedDraft('image_edit',draft=>draft.input?.image_layers?.length===1&&draft.input.image_id===composed.input.image_id);
 assert(uploadedLayer.input.image_layers[0].x<.25,'本地上传的对象应按投放位置放置');
 await page.getByRole('button',{name:'标注后 AI 重绘'}).click();
 await page.getByRole('button',{name:'清空标注'}).click();
 const cleared=await savedDraft('image_edit',draft=>draft.input?.edit_marks?.length===0);
 assert.equal(cleared.input.image_layers.length,1,'清空标注不应删除画布图片对象');
 await page.route('**/api/studio/runs',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{
  id:'isolated-image-edit-result',tool:'image_edit',draft_id:cleared.id,title:'隔离测试结果',status:'succeeded',asset_ids:[composite.id,legacyGeneratedDraft.input.image_ids[0]],
  created:new Date().toISOString(),generation:{input:{prompt:'隔离测试，不调用生图服务'},model_title:'隔离测试模型'},
 }]})}));
 await page.reload();
 await page.locator('.ie-latest-result').waitFor();
 const canvasBox=await page.locator('.ie-stage').boundingBox(),resultBox=await page.locator('.ie-latest-result').boundingBox();
 assert(canvasBox&&resultBox&&resultBox.y>=canvasBox.y+canvasBox.height-2,'修改结果应在原图画布下方');
 assert(resultBox.height>=130,'修改结果应有可辨认的图片预览');
 await page.screenshot({path:path.join(dir,'image-edit-result.png')});
 assert.equal(await page.locator('.ie-result-card').count(),2,'同批两张结果都应作为横向卡片展示');
 await page.getByRole('button',{name:'预览修改结果 2'}).click();
 await page.getByRole('dialog',{name:/预览/}).waitFor();
 await page.getByRole('button',{name:'关闭 ×'}).click();
 const downloadReady=page.waitForEvent('download',{timeout:6000}).catch(()=>null);
 await page.locator('.ie-result-card').nth(1).getByRole('button',{name:'下载'}).click();
 const downloaded=await downloadReady;
 if(!downloaded)throw Error('顶部下载未开始：'+(await page.locator('.ie-error').allInnerTexts()).join(' | '));
 assert(downloaded.suggestedFilename().endsWith('.png'),'最新结果应可在画布上方直接下载');
 await page.unroute('**/api/studio/runs');

 // The configured legacy GPT Image model must reach the normal cost confirmation.
 // Stop there: this fixture must never submit a paid generation request.
 assert.equal(composed.model_id,legacyEditModel.id);
 await page.getByRole('button',{name:'图片叠加合成'}).click();
 await page.getByRole('button',{name:'删除插入对象 1'}).click();
 await savedDraft('image_edit',draft=>draft.input?.image_layers?.length===0);
 await page.getByRole('button',{name:'标注后 AI 重绘'}).click();
 await page.getByRole('button',{name:'+ 添加区域'}).click();
 await page.getByRole('textbox',{name:'区域 1 的修改说明'}).fill('只把电梯门改为深绿色');
 const submit=page.getByRole('button',{name:/按标注生成新图/});
 await savedDraft('image_edit',draft=>draft.input?.edit_marks?.length===1&&draft.input.edit_marks[0].instruction==='只把电梯门改为深绿色');
 assert.equal(await submit.isEnabled(),true,'已配置生图模型和有效标注应可进入提交确认；页面提示：'+(await page.locator('[role=alert]').allInnerTexts()).join(' | '));
 await submit.click();
 await page.locator('.st-dialog').waitFor();
 assert.equal(generationRequests,0,'验收只检查确认界面，不发起付费生成');
 await page.keyboard.press('Escape');

 // Read-only history fixture verifies disclosure without generating media.
 const tail='【提示词结束：完整内容必须能看到】';
 const longPrompt='请生成一张供电梯选型文章使用的图片。'+('核对场景与安全细节，保持真实且不添加未经确认的品牌；').repeat(24)+tail;
 await page.route('**/api/studio/runs',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{
  id:'isolated-prompt-history',tool:'text_image',draft_id:'isolated-history',title:'隔离历史记录',status:'failed',asset_ids:[],
  created:new Date().toISOString(),generation:{input:{prompt:longPrompt},model_title:'隔离测试模型'},
 }]})}));
 await page.goto(base+'/?ui=1#studio/image?mode=text_image');
 const disclosure=page.locator('.mw-prompt-detail');
 await disclosure.waitFor();
 assert.equal(await disclosure.evaluate(node=>node.open),false);
 await disclosure.locator('summary').click();
 assert.equal(await disclosure.evaluate(node=>node.open),true);
 assert.equal((await disclosure.locator('p').innerText()).trim(),longPrompt);
 assert.equal(generationRequests,0,'测试只能到费用确认，不能提交付费生成');
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({passed:true,checks:['multiple references stay in text_image','name-only asset dropdown removed','clipboard button and Ctrl+V add image references','edit clipboard sets original, adds reference and movable object','reference preview opens','reference model and saved count','two independent marks survive reload','movable resizable marks and visible notes','min-width canvas and settings','active note beside canvas','asset drawer and positioned local upload','composite preserves concurrent edits','clear marks preserves image objects','two horizontal result cards and per-image download','configured legacy image model reaches cost confirmation without paid request','full history prompt expands'],dir}));
}finally{if(browser)await browser.close();service.kill()}
