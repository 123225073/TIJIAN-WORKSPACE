// Populated knowledge-library interaction regression. Only disposable local data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('knowledge-hover');let browser;
const states=[];
try {
 await fixture.call('/workspace',{});
 const folder=await fixture.call('/objects/folder',{title:'现场资料',library:'source'});
 for(let i=0;i<3;i++)await fixture.call('/objects/source',{title:['电梯现场记录','较长资料名称：项目条件与采购资料核对','待整理文件'][i],body:'现场记录仅用于界面验证，不是模型生成。',folder_id:i===2?'':folder.id,status:'saved'});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1530,height:1000}});await fixture.attach(page);
 await page.goto(fixture.base+'/?ui=1#knowledge');await page.locator('.knowledge-select').nth(2).waitFor();
 const scan=async name=>{await settleUI(page);const result=await page.evaluate(measureContrast,{scope:'.knowledge-page'});
  const rows=await page.locator('.knowledge-select').evaluateAll(nodes=>nodes.map(n=>({hover:n.matches(':hover'),focus:n.matches(':focus-visible'),background:getComputedStyle(n).backgroundColor,selected:n.closest('.knowledge-entry').classList.contains('selected')})));
  states.push({name,...result,rows});await page.screenshot({path:path.join(fixture.directory,name+'.png')});
 };
 await scan('default');
 for(let i=0;i<3;i++){
  const row=page.locator('.knowledge-select').nth(i);await row.hover();assert(await row.evaluate(n=>n.matches(':hover')));await scan('hover-'+i);
  await row.click();await page.waitForFunction(index=>document.querySelectorAll('.knowledge-entry')[index]?.classList.contains('selected'),i);await scan('selected-hover-'+i);
  await page.mouse.move(0,0);await scan('selected-'+i);
  await page.evaluate(()=>document.activeElement?.blur());await row.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert(await row.evaluate(n=>n.matches(':focus-visible')));await scan('keyboard-focus-'+i);
 }
 for(const [name,selector] of [['folder','.folder-item'],['edit','.knowledge-row-actions button'],['delete','.knowledge-row-actions .record-delete button'],['tab','.knowledge-tabs button']]){
  await page.locator(selector).first().hover();await scan('hover-'+name);
 }
 await page.locator('.knowledge-more-tabs summary').click();await page.locator('.knowledge-more-tabs button').first().hover();await scan('hover-more-category');
 const violations=states.flatMap(s=>s.violations);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:!violations.length,states,isolated:true,paid_generation:false},null,2));
 console.log(JSON.stringify({passed:!violations.length,states:states.length,violations:violations.length,directory:fixture.directory}));assert.equal(violations.length,0);
}catch(e){fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:false,error:e.message,states},null,2));throw e}finally{await browser?.close();fixture.close()}
