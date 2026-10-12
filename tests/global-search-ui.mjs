import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
// Serve this disposable bundle from memory: independent child processes on this
// host can see newly written JS as enterprise-encrypted TSD bytes. No policy changes.
const bundle=await build({entryPoints:['tests/global-search-fixture.tsx'],bundle:true,format:'esm',jsx:'automatic',outfile:'fixture.js',write:false,define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent'});
const server=http.createServer((request,response)=>{
 const name=request.url.split('?')[0];
 if(name==='/fixture.js'||name==='/fixture.css'){response.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');response.end(bundle.outputFiles.find(file=>file.path.endsWith(name.slice(1))).contents);return}
 response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<html lang="zh-CN"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:#111b28;color:#e7eef8"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
let browser;
const result=(id,title,category='原始资料',extra={})=>({id,kind:'source',title,category,summary:'关键词在真实内容中匹配',route:'knowledge/source/'+id,score:100,version:1,updated:'2026-10-12T00:00:00Z',match_reason:'标题匹配',matched_terms:['结婚'],related_ids:[id],...extra});
try{
 const base='http://127.0.0.1:'+port;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],queries=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.stack)});
 let releaseOld,releaseCleared,failed=0;
 await page.route('**/api/search?*',async route=>{
  const q=new URL(route.request().url()).searchParams.get('q');queries.push(q);
  if(q==='结'){await new Promise(r=>releaseOld=r);return route.fulfill({json:[result('a'.repeat(32),'旧响应不应出现')]})}
  if(q==='清空测试'){await new Promise(r=>releaseCleared=r);return route.fulfill({json:[result('a'.repeat(32),'清空前的旧结果')]})}
  if(q==='失败'&&failed++===0)return route.fulfill({status:500,json:{detail:'隔离接口失败'}});
  if(q==='素材')return route.fulfill({json:[result('c'.repeat(32),'结婚图片','素材',{kind:'studio_asset',related_ids:['c'.repeat(32),'d'.repeat(32),'e'.repeat(32)],route:'studio/works?record='+'c'.repeat(32),edit_route:'studio/image?draft='+'d'.repeat(32)+'&mode=text_image&return=studio%2Fflow%3Fwork%3Df%26step%3D2'})]});
  return route.fulfill({json:[result('b'.repeat(32),'结婚指南'),result('f'.repeat(32),'婚礼筹备','选题',{kind:'studio_topic',route:'studio/topics?topic='+'f'.repeat(32),match_reason:'相关词：结婚→婚礼'})]});
 });
 await page.route('**/api/state/updates?*',route=>route.fulfill({json:{items:[{id:'c'.repeat(32),kind:'studio_asset',title:'结婚图片',version:1,updated:'2026-10-12',asset_type:'image',body:'仅展示所选记录的完整内容'}]}}));
 await page.route('**/api/hotlists/refresh',route=>route.fulfill({json:{id:'test-job',kind:'job',status:'queued'}}));
 await page.goto(base+'/tests/global-search-fixture.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('dialog',{name:'全局搜索'}).waitFor({timeout:60000});
 const input=page.getByRole('textbox',{name:'搜索资料与作品'});
 assert.equal(await page.getByRole('dialog',{name:'全局搜索'}).count(),1);
 assert.equal(queries.length,0);
 await input.fill('结');await page.waitForFunction(()=>true);for(let i=0;i<30&&!releaseOld;i++)await page.waitForTimeout(30);assert(releaseOld);
 await input.fill('结婚');await page.getByRole('button').filter({hasText:'结婚指南'}).waitFor();releaseOld();await page.waitForTimeout(150);
 assert.equal(await page.getByText('旧响应不应出现').count(),0);
 assert.equal(await page.getByText('相关词：结婚→婚礼',{exact:false}).count(),1);
 await page.getByRole('navigation',{name:'搜索结果类别'}).getByRole('button',{name:'选题'}).click();assert.equal(await page.getByText('结婚指南',{exact:true}).count(),0);
 await input.fill('清空测试');for(let i=0;i<30&&!releaseCleared;i++)await page.waitForTimeout(30);assert(releaseCleared);await input.fill('');releaseCleared();await page.waitForTimeout(150);
 assert.equal(await page.getByText('清空前的旧结果').count(),0);assert(!queries.includes(''));
 await input.fill('失败');await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('结婚指南',{exact:true}).waitFor();
 await page.getByRole('button').filter({hasText:'结婚指南'}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('status',{name:'导航结果'}).textContent(),'knowledge/source/'+'b'.repeat(32));
 await page.getByRole('button',{name:'打开搜索',exact:true}).click();assert.equal(await page.locator('.global-search-result').count(),0);
 await input.fill('素材');await page.getByText('已合并 3 条关联记录',{exact:false}).waitFor();await page.locator('.global-search-result').click();await page.getByText('仅展示所选记录的完整内容').waitFor();
 await page.getByRole('button',{name:'继续编辑原稿'}).click();assert((await page.getByRole('status',{name:'导航结果'}).textContent()).startsWith('studio/image?draft='));
 const oldBoard=page.getByRole('region',{name:'小红书热榜'});assert((await oldBoard.innerText()).includes('历史榜单'));assert((await oldBoard.innerText()).includes('2026/9/18'));
 await oldBoard.getByRole('button',{name:'重试此平台'}).click();await page.getByText('已提交更新',{exact:true}).waitFor();
 assert((await page.getByRole('region',{name:'抖音热榜'}).innerText()).includes('上游榜单'));
 await page.getByRole('button',{name:'打开搜索',exact:true}).click();await page.setViewportSize({width:560,height:800});
 assert(await page.getByRole('dialog').evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth));
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: 12 UI contracts — empty search, stale responses, clear-in-flight, categories, synonyms, retry, exact navigation, reopen, family preview, original editor, failed hotlist retry, mobile/Escape');
}finally{await browser?.close();server.close()}
