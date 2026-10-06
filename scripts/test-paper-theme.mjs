// Protect document readability from surrounding dark UI and keep user formatting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';
const legacy=['style','studio','wechat-article','task-workspace','platform-publish','article-editor'].map(name=>fs.readFileSync('src/'+name+'.css','utf8')).join('\n');
const theme=fs.readFileSync('src/studio-theme.css','utf8');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
try {
 const page=await browser.newPage();
 const document=`<h2>正文二级标题</h2><h3>正文三级标题</h3><p>正文段落 <strong>重要信息</strong><span style="color:rgb(210,50,50)">人工红色</span></p><ul><li>列表内容</li></ul><blockquote>引用内容</blockquote>`;
 await page.setContent(`<html class="ts-theme"><head><style>${legacy}\n${theme}</style></head><body><main class="shell"><section class="aw-section"><div class="wa-rich-editor" id="chat">${document}</div></section><section class="wa-card"><h3 id="chrome">02 文章正文</h3><div class="wa-rich-editor" id="platform">${document}</div><div class="wa-preview" id="replace">${document}</div></section><aside class="studio-v2"><div class="st-preview" id="result">结果与版本</div></aside></main></body></html>`);
 await settleUI(page);
 const computed=await page.evaluate(()=>Object.fromEntries(['chat','platform','replace'].map(id=>{
  const paper=document.getElementById(id);return [id,{background:getComputedStyle(paper).backgroundColor,values:Object.fromEntries(['h2','h3','p','strong','li','blockquote','span'].map(selector=>{const node=paper.querySelector(selector),style=getComputedStyle(node);return [selector,{color:style.color,background:style.backgroundColor}]}))}];
 })));
 for(const [id,entry] of Object.entries(computed)){
  assert.equal(entry.background,'rgb(247, 248, 252)',id+' paper');
  for(const heading of ['h2','h3']){assert.equal(entry.values[heading].color,'rgb(23, 56, 86)',id+' '+heading+' text');assert.equal(entry.values[heading].background,'rgba(0, 0, 0, 0)',id+' heading must not inherit toolbar fill')}
  for(const selector of ['p','strong','li','blockquote'])assert.equal(entry.values[selector].color,'rgb(32, 48, 71)',id+' '+selector+' readable body');
  assert.equal(entry.values.span.color,'rgb(210, 50, 50)',id+' manual formatting');
 }
 // UI chrome follows the new theme; paper and manual formatting retain their
 // exact established colors. Do not mistake authored red text for UI failure.
 const contrast=await page.evaluate(measureContrast,{scope:'#chrome,#result,#chat,#platform,#replace',excludeUserPaper:true});
 assert(contrast.checked>=15,'paper readability coverage');assert.deepEqual(contrast.violations,[],'paper/chrome WCAG contrast');
 const excluded=await page.evaluate(measureContrast,{scope:'#chat span',excludeUserPaper:true});assert.equal(excluded.checked,0,'manual authored red is excluded from UI contrast');
 assert.deepEqual(await page.locator('#chrome').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color})),{background:'rgb(243, 246, 251)',color:'rgb(52, 73, 96)'},'article chrome platinum pairing');
 assert.equal(await page.locator('#result').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)','result pane white');
 console.log(JSON.stringify({passed:true,checks:['chat article','platform article','image replacement preview','light theme result pane','manual red preserved','paper/chrome WCAG'],computed,contrast}));
}finally{await browser.close()}
