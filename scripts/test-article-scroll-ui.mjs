// Real TaskWorkspace/PlatformArticleOutcome/ArticleRichEditor + full source CSS.
// All APIs are local fixtures. No backend, database, credentials or paid calls.
// node scripts/test-article-scroll-ui.mjs [--baseline]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const baseline=process.argv.includes('--baseline');
const directory=path.resolve('.runtime',`article-scroll-${baseline?'baseline':'source'}-${Date.now()}`);
fs.mkdirSync(directory,{recursive:true});
const plugins=baseline?[{name:'committed-scroll-baseline',setup(builder){
 builder.onLoad({filter:/[\\/]src[\\/](ArticleRichEditor|PlatformArticleOutcome)\.tsx$/},({path:filename})=>{
  const result=spawnSync('git',['show','HEAD:src/'+path.basename(filename)],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);return {contents:result.stdout,loader:'tsx',resolveDir:path.resolve('src')};
 });
}}]:[];
const owner='isolated-article-scroll-owner';
const body=Array.from({length:90},(_,i)=>`第${i+1}段：电梯行业长文测试，核对维保记录和乘客服务。正文只用于本地滚动验证。`).join('\n\n')+'\n\n长文底部书签前半后半，保留结尾。';
const content={id:'isolated-scroll-content',kind:'content',task_id:'isolated-scroll-task',title:'长文编辑独立滚动验收',body,version:1,wechat_style:{font_size:'16',line_height:'1.8',paragraph_gap:'12',accent:'forest'}};
const asset={id:'1'.repeat(32),kind:'studio_asset',title:'隔离插图',asset_type:'image',status:'ready',width:320,height:180,mime_type:'image/svg+xml',file_url:'/api/studio/assets/'+'1'.repeat(32)+'/file'};
const task={id:content.task_id,kind:'task',title:'公众号长文滚动测试',active_outcome:'wechat',platform_outcomes:{wechat:content.id},messages:[{role:'assistant',text:'这是本地真实组件 fixture，未调用模型。'}]};
const fixture={state:{user:{id:owner},models:[],objects:[content,asset],complete:true},task,content};
const entry=`import {createRoot} from 'react-dom/client';import TaskWorkspace from './src/TaskWorkspace';
const fixture=window.articleScrollFixture;const t={state:fixture.state,task:fixture.task,get:id=>fixture.state.objects.find(x=>x.id===id),list:kind=>fixture.state.objects.filter(x=>x.kind===kind),opts:()=>[],refresh:async()=>{},setError:error=>{throw Error(error)},setNotice:()=>{},action:async fn=>fn()};
createRoot(document.getElementById('root')).render(<TaskWorkspace {...t}/>);`;
// Transform fixture code in memory only; do not invoke project build or write dist.
const app=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,outfile:path.join(directory,'app.js'),external:['/visuals/*'],plugins});
const css=app.outputFiles.find(file=>file.path.endsWith('.css')).text;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},jsx:'automatic',bundle:true,format:'iife',write:false,outfile:path.join(directory,'fixture.js'),plugins});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}
 else if(pathname==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css)}
 else if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html class="ts-theme"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}
 else {res.statusCode=503;res.end('No backend connected')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263b59"/><text x="25" y="100" fill="#edf2fb">LOCAL FIXTURE IMAGE</text></svg>';
const results=[],screenshots=[],unexpected=[],browserErrors=[];
let browser;
const test=async(name,fn)=>{try{results.push({name,ok:true,evidence:await fn()})}catch(error){results.push({name,ok:false,error:error.stack})}const result=results.at(-1);console.log(JSON.stringify({name:result.name,ok:result.ok,error:result.error}))};
const shot=async(page,name)=>{const filename=name+'.png';await page.screenshot({path:path.join(directory,filename),fullPage:true});screenshots.push(filename)};
const open=async(viewport={width:1366,height:768},articleBody=body)=>{
 const context=await browser.newContext({viewport}),page=await context.newPage();
 page.setDefaultTimeout(8000);page.on('pageerror',error=>browserErrors.push(error.message));
 const requests=[];
 await context.addInitScript(fixture=>{window.articleScrollFixture=fixture},{...fixture,state:{...fixture.state,objects:[{...content,body:articleBody},asset]}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){unexpected.push(request.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname.slice(4);requests.push({path:p,method:request.method(),body:request.postData()});
  if(p==='/studio/assets')return route.fulfill({json:{items:[asset]}});
  if(p==='/studio/catalog')return route.fulfill({json:{tools:[]}});
  if(p==='/studio/runs')return route.fulfill({json:{items:[]}});
  if(p==='/tasks/'+content.task_id+'/outcomes/'+content.id+'/handoffs')return route.fulfill({json:{items:[]}});
  if(p==='/studio/assets/'+asset.id+'/file')return route.fulfill({contentType:'image/svg+xml',body:svg});
  if(p==='/wechat-publish/preview')return route.fulfill({json:{html:request.postDataJSON().body.split('\n\n').map(text=>'<p>'+text+'</p>').join('')}});
  unexpected.push(request.method()+' '+p);return route.abort();
 });
 await page.goto(base);const editor=page.getByRole('textbox',{name:'公众号文章正文'});await editor.waitFor();
 // Align the article section inside the real scrollable outcome. On mobile,
 // first scroll the real stacked workspace into the viewport as well.
 await editor.evaluate(el=>{
  const outcome=el.closest('.aw-outcome'),section=el.closest('.aw-section');
  outcome.scrollTop+=section.getBoundingClientRect().top-outcome.getBoundingClientRect().top;
  if(matchMedia('(max-width:820px)').matches)outcome.closest('.aw-results').scrollIntoView({block:'start'});
 });
 return {context,page,editor,requests};
};
const geometry=page=>page.evaluate(()=>{
 const el=document.querySelector('.article-rich-editor'),outer=el.closest('.aw-outcome'),toolbar=el.closest('.aw-section').querySelector('.aw-editor-actions');
 const rect=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
 return {editor:{...rect(el),clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth},toolbar:rect(toolbar),outer:{...rect(outer),scrollTop:outer.scrollTop},windowY:scrollY,viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth};
});
const pointInside=async page=>{
 const g=await geometry(page),top=Math.max(g.editor.top,g.outer.top,0),bottom=Math.min(g.editor.bottom,g.outer.bottom,g.viewport.height);
 assert(bottom>top,'editor has a visible scroll target');await page.mouse.move((g.editor.left+g.editor.right)/2,(top+bottom)/2);
};
const caret=async(editor,select=false)=>editor.evaluate((el,select)=>{
 el.focus({preventScroll:true});const p=el.querySelector('p:last-child');assertLocal(p,'last paragraph missing');
 const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.textContent.includes('前半后半'))break}
 const offset=node.textContent.indexOf('后半'),range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+(select?2:0));
 window.getSelection().removeAllRanges();window.getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 function assertLocal(value,message){if(!value)throw Error(message)}
},select);
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.ARTICLE_SCROLL_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 await test('长文鼠标滚轮只滚正文，顶部插图工具保持可见',async()=>{
  const {context,page,editor}=await open();try{
   const before=await geometry(page);if(baseline){await shot(page,'baseline-unbounded-article');fs.writeFileSync(path.join(directory,'baseline-geometry.json'),JSON.stringify(before,null,2))}assert(before.editor.scrollHeight>before.editor.clientHeight*3,'long article must overflow inside editor');
   await pointInside(page);await page.mouse.wheel(0,1600);await page.waitForFunction(()=>document.querySelector('.article-rich-editor').scrollTop>500);
   const after=await geometry(page);assert.equal(after.outer.scrollTop,before.outer.scrollTop);assert.equal(after.windowY,before.windowY);assert.equal(after.toolbar.top,before.toolbar.top);
   await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForFunction(()=>{const el=document.querySelector('.article-rich-editor');return el.scrollTop+el.clientHeight>=el.scrollHeight-2});
   await page.mouse.wheel(0,900);await page.waitForTimeout(160);assert.equal((await geometry(page)).outer.scrollTop,before.outer.scrollTop,'no wheel chaining at bottom');
   const buttons=page.locator('.aw-editor-actions button');for(const b of await buttons.all()){const r=await b.boundingBox();assert(r.y>=0&&r.y+r.height<=after.viewport.height,'image actions remain visible')}
   await shot(page,'desktop-long-bottom');return {before,after,bottom:await geometry(page)};
  }finally{await context.close()}
 });
 await test('长文底部光标经真实素材弹窗插图，书签和正文保留',async()=>{
  const {context,page,editor}=await open();try{
   await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await caret(editor);const before=await geometry(page);
   await page.locator('.aw-editor-actions').getByRole('button',{name:'插入图片',exact:true}).click();
   const mark=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'article-position:'+owner+':'+content.id);
   assert.equal(mark.startOffset,'长文底部书签前半'.length);assert.equal(mark.endOffset,mark.startOffset);assert.equal(mark.context.text,'长文底部书签前半后半，保留结尾。');
   await page.getByRole('button',{name:'选择这张图片',exact:true}).click();await page.getByRole('button',{name:'确认插入文稿',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.article-rich-editor img')?.naturalWidth>0);
   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).values.body,'platform-draft:'+owner+':'+content.id);
   assert.match(saved,/长文底部书签前半\s*!\[隔离插图\][\s\S]*后半，保留结尾/);assert(saved.includes('第90段')&&saved.includes('第1段'));
   assert.equal(await editor.locator('img').count(),1);assert((await geometry(page)).editor.scrollTop>1000,'insertion keeps the editor near the bookmarked bottom');
   const scrollAfter=(await geometry(page)).editor.scrollTop;await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await shot(page,'desktop-bookmark-insert');return {context:{start:mark.context.start,end:mark.context.end,text:mark.context.text},scrollBefore:before.editor.scrollTop,scrollAfter,images:1,localDraft:true};
  }finally{await context.close()}
 });
 await test('生成新配图只打开真实弹窗，底部段落上下文正确且未调用生成',async()=>{
  const {context,page,editor,requests}=await open();try{
   await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await caret(editor);
   await page.locator('.aw-editor-actions').getByRole('button',{name:'生成新配图',exact:true}).click();
   await page.getByRole('dialog').waitFor();assert.match(await page.locator('.ap-context').innerText(),/长文底部书签前半后半/);
   await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
   assert(!requests.some(r=>/generate|article-illustration-prompt/.test(r.path)));assert((await geometry(page)).editor.scrollTop>1000);
   return {bookmarkContextPreserved:true,modelCalls:0,paidCalls:0};
  }finally{await context.close()}
 });
 await test('正文滚动后收起悬浮格式栏，保存的选区仍可插图',async()=>{
  const {context,page,editor}=await open();try{
   await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForTimeout(100);await caret(editor,true);
   await page.getByRole('toolbar',{name:'选中文字格式'}).waitFor();await editor.evaluate(el=>{el.scrollTop-=200});
   await page.getByRole('toolbar',{name:'选中文字格式'}).waitFor({state:'hidden'});
   await page.locator('.aw-editor-actions').getByRole('button',{name:'插入图片',exact:true}).click();
   const mark=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'article-position:'+owner+':'+content.id);assert.equal(mark.context.body.slice(mark.context.start,mark.context.end),'后半');
   return {staleToolbarHidden:true,selectionPreserved:true};
  }finally{await context.close()}
 });
 await test('阅读预览仍使用原排版组件和完整正文，返回可编辑',async()=>{
  const {context,page,editor,requests}=await open();try{
   await page.getByRole('button',{name:'阅读预览',exact:true}).click();await page.getByRole('textbox',{name:'公众号文章正文'}).waitFor({state:'hidden'});
   const frame=page.frameLocator('iframe[title="公众号排版预览"]');await frame.getByText('长文底部书签前半后半，保留结尾。',{exact:true}).waitFor();
   const preview=await page.locator('.wa-layout-proof').evaluate(el=>{const parent=el.closest('.aw-article-preview')||el.parentElement;return {height:parent.getBoundingClientRect().height,overflow:getComputedStyle(parent).overflowY,frameHeight:el.querySelector('iframe').getBoundingClientRect().height}});
   assert.equal(preview.frameHeight,520);assert.equal(preview.overflow,'visible');assert.equal(JSON.parse(requests.find(r=>r.path==='/wechat-publish/preview').body).body,body);
   await page.getByRole('button',{name:'继续编辑',exact:true}).click();await editor.waitFor();assert((await editor.innerText()).includes('第90段'));await shot(page,'preview-return-editor');return preview;
  }finally{await context.close()}
 });
 for(const viewport of [{width:390,height:844},{width:600,height:420}])await test(`小屏 ${viewport.width}×${viewport.height} 工具栏可见、正文独立滚动、无横向溢出`,async()=>{
  const {context,page,editor}=await open(viewport);try{
   const before=await geometry(page);assert(before.editor.clientHeight>=70,'usable editor height');assert(before.editor.scrollHeight>before.editor.clientHeight*3);
   await pointInside(page);await page.mouse.wheel(0,1200);await page.waitForFunction(()=>document.querySelector('.article-rich-editor').scrollTop>500);
   const after=await geometry(page);assert.equal(after.outer.scrollTop,before.outer.scrollTop);assert.equal(after.windowY,before.windowY);assert.equal(after.toolbar.top,before.toolbar.top);
   assert(after.pageWidth<=viewport.width+1);assert(after.editor.scrollWidth<=after.editor.clientWidth+1);
   for(const button of await page.locator('.aw-editor-actions button').all()){const r=await button.boundingBox();assert(r.x>=0&&r.x+r.width<=viewport.width+1&&r.y>=0&&r.y+r.height<=viewport.height,'toolbar fits viewport')}
   await editor.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForTimeout(100);await caret(editor,true);const floating=page.getByRole('toolbar',{name:'选中文字格式'});await floating.waitFor();const r=await floating.boundingBox();assert(r.x>=0&&r.x+r.width<=viewport.width+1,'format toolbar fits small screen');
   await shot(page,`small-${viewport.width}-${viewport.height}`);return after;
  }finally{await context.close()}
 });
 await test('短文仍可直接输入、编辑高度不随长文撑开',async()=>{
  const {context,page,editor}=await open({width:1366,height:768},'短文正文。');try{
   const before=await geometry(page);assert(before.editor.scrollHeight<=before.editor.clientHeight+1);
   await editor.fill('短文继续编辑。');assert.equal(await editor.innerText(),'短文继续编辑。');assert.equal((await geometry(page)).editor.clientHeight,before.editor.clientHeight);return before.editor;
  }finally{await context.close()}
 });
 await test('隔离边界：无真实API或浏览器异常',async()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(browserErrors,[]);return {backendStarted:false,productionDataTouched:false,realGeneration:false,paidCalls:0}});
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 const sourceHashes=Object.fromEntries(['src/ArticleRichEditor.tsx','src/PlatformArticleOutcome.tsx','src/article-scroll.css'].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({baseline,directory,sourceHashes,results,screenshots,unexpected,browserErrors,productionDataTouched:false,paidCalls:0},null,2));
 console.log(JSON.stringify({directory,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,baseline}));
 if(results.some(r=>!r.ok)||!results.length)process.exitCode=1;
}
