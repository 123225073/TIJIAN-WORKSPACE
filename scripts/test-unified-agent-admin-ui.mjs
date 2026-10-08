// Actual integrated React + isolated DB. No real generation or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('studio-agent-admin');
let browser;
try{
 const login=await(await fetch(fixture.apiBase+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})})).json();
 assert(login.token);
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1050}});
 await fixture.attach(page);
 await page.evaluate(token=>sessionStorage.setItem('tijian-admin-session',token),login.token);
 await page.goto(fixture.base+'/admin.html#skills');
 await page.locator('.capability-editor').waitFor();
 assert.equal(await page.getByRole('tab',{name:'统一 Agent',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByLabel('能力正文',{exact:true}).fill('UI_BASE_FREE_PREVIEW：一个助手，按照用户需求选择方法。');
 await page.getByRole('button',{name:'保存并启用',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已生效'}).waitFor();
 await page.getByRole('tab',{name:'任务方法',exact:true}).click();
 for(const name of ['问答与资料引用','平台写作','身份访谈','事实核查','知识整理'])await page.locator('.capability-list button').filter({hasText:name}).waitFor();
 await page.locator('.capability-list button').filter({hasText:'平台写作'}).click();
 await page.getByLabel('能力正文',{exact:true}).fill('UI_PRESERVED_WRITING_V2：自然的行业写作，保留资料与人工修改。');
 await page.getByRole('button',{name:'保存并启用',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已生效'}).waitFor();
 await page.getByRole('tab',{name:'Skills 方法库',exact:true}).click();
 await page.getByRole('button',{name:'＋ 添加 Skill',exact:true}).click();
 await page.getByLabel('能力名称',{exact:true}).fill('隔离 UI 方法');
 await page.getByLabel('能力正文',{exact:true}).fill('UI_ACTUAL_PUBLISHED_METHOD：优先解释读者的具体处境。');
 await page.getByLabel('适用功能',{exact:true}).selectOption('writing');
 await page.getByRole('button',{name:'保存并启用',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已生效'}).waitFor();
 await page.getByLabel('预览任务',{exact:true}).selectOption('writing');
 await page.getByRole('button',{name:'预览生效提示词',exact:true}).click();
 await page.locator('.capability-preview pre').filter({hasText:'UI_BASE_FREE_PREVIEW'}).waitFor();
 const preview=await page.locator('.capability-preview pre').innerText();
 assert(preview.includes('UI_PRESERVED_WRITING_V2')&&preview.includes('UI_ACTUAL_PUBLISHED_METHOD'));
 await page.getByRole('button',{name:'停用',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
 await page.getByRole('button',{name:'预览生效提示词',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.capability-preview pre')?.textContent.includes('UI_ACTUAL_PUBLISHED_METHOD'));
 for(const width of [1500,1024,390]){
  await page.setViewportSize({width,height:1050});await settleUI(page);
  const measured=await page.locator('.capabilities').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert(measured.scroll<=measured.client+2&&measured.document<=width+2,JSON.stringify(measured));
  await page.screenshot({path:path.join(fixture.directory,'admin-'+width+'.png'),fullPage:true});
 }
 assert.equal(fixture.guard.forbidden.length,0);assert.equal(fixture.guard.external.length,0);
 const report={passed:true,base_entry:true,preserved_custom_writing:true,published_and_disabled_skills:true,free_preview:true,viewports:[1500,1024,390],real_model:false};
 fs.writeFileSync(path.join(fixture.directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,directory:fixture.directory}));
}finally{await browser?.close();fixture.close()}
