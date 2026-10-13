// Real wechat-rich.ts in an isolated browser. Transpile source only; no app build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import ts from 'typescript';
import {chromium} from 'playwright-core';
const transpile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const modules={
 '/rich.js':transpile('src/wechat-rich.ts').replace("'./article-production'","'/production.js'").replace("'dompurify'","'/purify.js'").replace("'marked'","'/marked.js'"),
 '/production.js':transpile('src/article-production.ts'),
 '/purify.js':fs.readFileSync('node_modules/dompurify/dist/purify.es.mjs','utf8'),
 '/marked.js':fs.readFileSync('node_modules/marked/lib/marked.esm.js','utf8'),
};
const server=http.createServer((req,res)=>{if(modules[req.url]){res.setHeader('Content-Type','text/javascript');res.end(modules[req.url])}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="editor" contenteditable="true"></div>')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/article-production.json','utf8'));
 const evidence=await page.evaluate(async fixtures=>{
  const rich=await import('/rich.js'),production=await import('/production.js'),root=document.querySelector('#editor');
  const results=[];
  for(const example of fixtures.filter(item=>item.count)){
   root.innerHTML=rich.markdownToEditorHtml(example.body);
   const chips=[...root.querySelectorAll('[data-wa-production]')],expected=production.parseArticleProduction(example.body).instructions;
   const roundtrip=rich.editorToMarkdown(root),firstParagraph=root.querySelector('p');firstParagraph.append(document.createTextNode('手工追加正文。'));
   const edited=rich.editorToMarkdown(root);
   // Same detached-marker technique used by ArticleRichEditor.bookmark().
   const clone=root.cloneNode(true),target=clone.querySelector('p');target.append(document.createTextNode('TJTESTSTART选区TJTESTEND'));
   const serialized=rich.editorToMarkdown(clone),start=serialized.indexOf('TJTESTSTART'),withoutBegin=serialized.replace('TJTESTSTART',''),end=withoutBegin.indexOf('TJTESTEND');
   const withoutMarkers=withoutBegin.replace('TJTESTEND','');
   results.push({name:example.name,count:chips.length,expectedRaw:expected.map(item=>item.raw),raw:chips.map(chip=>chip.dataset.waProduction),
    nonEditable:chips.every(chip=>chip.contentEditable==='false'),display:root.innerText,roundtripRaw:production.parseArticleProduction(roundtrip).instructions.map(item=>item.raw),
    editedRaw:production.parseArticleProduction(edited).instructions.map(item=>item.raw),editedHasManual:edited.includes('手工追加正文。'),
    selection:withoutMarkers.slice(start,end),reader:rich.readerArticleText(edited)});
  }
  const raw=':::article-production illustration escaped\n提示词：<img src=x onerror="window.BAD=1"> & 引号 "\n\n\n制作说明：保留空行。\n:::end-article-production';
  const image='![保留图片](/api/studio/assets/'+'a'.repeat(32)+'/file)';
  root.innerHTML=rich.markdownToEditorHtml('正文。\n\n'+raw+'\n\n'+image);
  const safety={raw:root.querySelector('[data-wa-production]').dataset.waProduction,expectedRaw:raw,
   activeImages:root.querySelectorAll('img').length,images:root.querySelectorAll('[data-wa-image]').length,
   result:rich.editorToMarkdown(root),image,BAD:window.BAD||0,visible:root.innerText};
  return {results,safety};
 },fixtures);
 for(const item of evidence.results){
  assert.equal(item.count,item.expectedRaw.length,item.name);assert(item.nonEditable,item.name);
  assert.deepEqual(item.raw,item.expectedRaw,item.name);assert.deepEqual(item.roundtripRaw,item.expectedRaw,item.name);assert.deepEqual(item.editedRaw,item.expectedRaw,item.name);
  assert(item.editedHasManual,item.name);assert.equal(item.selection,'选区',item.name);
  assert(!item.display.includes('图片内容建议：'),item.name);assert(!item.reader.includes('图片内容建议：'),item.name);
 }
 assert.equal(evidence.safety.raw,evidence.safety.expectedRaw);assert(evidence.safety.result.includes(evidence.safety.expectedRaw));
 assert(evidence.safety.result.includes(evidence.safety.image));assert.equal(evidence.safety.images,1);
 assert.equal(evidence.safety.activeImages,0);assert.equal(evidence.safety.BAD,0);assert(!evidence.safety.visible.includes('onerror'));
 console.log(`PASS: ${evidence.results.length} real browser editor cases; raw preservation, manual edits, bookmark coordinates, existing image chips and escaped metadata`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
