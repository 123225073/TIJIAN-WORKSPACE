// Real built pages, isolated SQLite and explicitly simulated provider outputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';
const f=await startIsolatedUI('liquid-workspace'),pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
try{
 const task=await f.call('/tasks/open',{title:'隔离公众号体验','mode':'auto'});
 const send=async text=>{const job=await f.call('/tasks/'+task.id+'/send',{text,mode:'auto',skip_profile:true});for(let i=0;i<100;i++){const current=await f.call('/jobs/'+job.id);if(current.status==='done')return;if(current.status==='failed')throw Error(current.error);await pause(100)}throw Error('Fixture job timeout')};
 await send('帮我写一篇600字公众号文章：电梯结构');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 page=await browser.newPage({viewport:{width:1530,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['data:','blob:'].includes(url.protocol)&&url.origin!==f.base)return route.abort();return route.continue()});
 await page.goto(f.base);await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),f.auth.token);await page.goto(f.base+'/?ui=1#task/'+task.id);
 await page.getByRole('textbox',{name:'成果标题'}).waitFor();
 const states=[];
 for(const name of ['参考资料','版本','工作成果']){
  await page.locator('.aw-main-tabs').getByRole('button',{name,exact:true}).click();await settleUI(page);await page.waitForTimeout(80);
  const geometry=await page.locator('.aw-main-tabs').evaluate(el=>{const active=el.querySelector('.active'),a=active.getBoundingClientRect(),g=el.getBoundingClientRect();return {enabled:el.classList.contains('liquid-tabs'),x:parseFloat(el.style.getPropertyValue('--liquid-x')),expected:a.left-g.left+el.scrollLeft,indicator:getComputedStyle(el,'::before').transitionDuration}});
  assert(geometry.enabled);assert(Math.abs(geometry.x-geometry.expected)<1);assert(geometry.indicator.includes('0.38'));
  const measurement=await page.evaluate(measureContrast,{scope:'.aw-results',excludeUserPaper:true});states.push({name,...measurement});
  if(name!=='工作成果')assert.equal(await page.locator('.aw-result-scroll').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 29, 40)');
 }
 await page.screenshot({path:path.join(f.directory,'article.png'),fullPage:true});
 await send('帮我生成图片：公众号文章封面');await page.reload();await page.getByRole('textbox',{name:'媒体画面要求'}).waitFor();
 await page.getByRole('combobox',{name:'媒体生成模型'}).selectOption('fixture-image2');
 await page.getByRole('combobox',{name:'画面比例',exact:true}).selectOption('custom');
 await page.getByRole('textbox',{name:'自定义宽高比'}).fill('2.32:1');await page.getByRole('textbox',{name:'自定义宽高比'}).press('Tab');
 await page.getByRole('combobox',{name:'图片分辨率'}).selectOption('4K');
 assert((await page.locator('.parameter-adjustment').first().innerText()).includes('4K → 2K'));
 await page.getByRole('combobox',{name:'画面比例',exact:true}).selectOption('');await page.getByRole('combobox',{name:'图片分辨率'}).selectOption('');
 assert(!(await page.locator('.image-parameter-note').innerText()).includes('2560'));
 await page.getByRole('combobox',{name:'画面比例',exact:true}).selectOption('custom');await page.getByRole('textbox',{name:'自定义宽高比'}).fill('2.32:1');await page.getByRole('textbox',{name:'自定义宽高比'}).press('Tab');await page.getByRole('combobox',{name:'图片分辨率'}).selectOption('4K');
 await page.getByRole('button',{name:'生成图片 · 可能计费',exact:true}).click();
 await page.locator('.aw-media-result').scrollIntoViewIfNeeded();await page.locator('.aw-media-result img').waitFor({timeout:15000});
 await page.waitForFunction(()=>document.querySelector('.aw-media-result img')?.naturalWidth>=1024);
 const run=(await f.call('/studio/runs')).items[0];assert.equal(run.generation.options.size,'2560x1440');assert.equal(run.generation.options.requested_ratio,'2.32:1');assert(run.parameter_adjustment.includes('4K → 2K'));
 assert((await page.locator('.toast').allTextContents()).join('').includes('最接近'));
 await page.locator('.aw-main-tabs').getByRole('button',{name:'版本',exact:true}).click();assert.equal(await page.locator('.aw-result-scroll').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 29, 40)');
 await page.locator('.aw-main-tabs').getByRole('button',{name:'工作成果',exact:true}).click();await page.reload();await page.getByRole('combobox',{name:'图片分辨率'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'图片分辨率'}).inputValue(),'4K');
 await page.waitForFunction(()=>document.querySelector('[aria-label="媒体生成模型"]')?.value==='fixture-image2');await page.locator('.aw-media-result').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.aw-media-result img')?.naturalWidth>=1024);await settleUI(page);await page.waitForTimeout(450);
 await page.screenshot({path:path.join(f.directory,'image.png'),fullPage:true});
 for(const width of [1530,1024,760,520]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+width)}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.aw-main-tabs').evaluate(el=>getComputedStyle(el,'::before').transitionDuration),'0s');
 await page.goto(f.base+'/?ui=1#studio/image');await page.locator('.mw-mode-switch.liquid-tabs').waitFor();await page.getByRole('button',{name:'模型与参数',exact:true}).click();await page.getByRole('combobox',{name:'画面比例',exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 await page.goto(f.base+'/?ui=1#studio/text');await page.locator('.st-fields textarea').waitFor();await page.locator('.st-fields textarea').first().fill('隔离配图窗口测试');await page.getByRole('button',{name:'开始生成',exact:true}).click();await page.getByRole('button',{name:'确认上传与消耗',exact:true}).click();await page.locator('.article-editor').waitFor({timeout:15000});
 await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'素材库插图',exact:true}).click();await page.locator('.ap-tabs.liquid-tabs').waitFor();await page.getByRole('tab',{name:'AI 生成',exact:true}).click();await page.waitForTimeout(100);assert(await page.locator('.ap-tabs').evaluate(el=>parseFloat(el.style.getPropertyValue('--liquid-x'))>20));await page.getByRole('combobox',{name:'画面比例',exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(states.flatMap(state=>state.violations),[]);const report={passed:true,states,widths:[1530,1024,760,520],original_preview_width:1024,real_model:false,real_paid_image:false,integration:f.integration};fs.writeFileSync(path.join(f.directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,directory:f.directory,checks:'tabs, sources, versions, custom ratio, resolution fallback, toast, originals, reload, responsive, reduced motion, full editor'}));
}catch(e){if(page){await page.screenshot({path:path.join(f.directory,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-2400))}throw e}finally{await browser?.close();f.close()}
