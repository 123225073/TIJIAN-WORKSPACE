// Independent review: existing main-agent integrated dist, disposable local backend.
// No production build/package, user DB, provider keys or paid requests are used.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {chromium} from 'playwright-core';
import {startIsolatedUI} from './test-studio-color-states.mjs';

if(process.argv.includes('--marker-only')){
 // Exercise the exact current bookmark/serializer in a detached test DOM.
 // No application build, fixture backend, account or model is involved.
 const rich=fs.readFileSync('src/ArticleRichEditor.tsx','utf8');
 const pathSource=rich.slice(rich.indexOf(' const pathFor='),rich.indexOf(' const nodeFor='));
 const markSource=rich.slice(rich.indexOf(' const bookmark='),rich.indexOf(' const insertImages='));
 const serializer=fs.readFileSync('src/wechat-rich.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const position=fs.readFileSync('src/article-position.ts','utf8').replace(/^export /gm,'');
 const source=stripTypeScriptTypes(serializer+'\n'+position+'\n'+pathSource+'\n'+markSource)+'\nreturn bookmark();';
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage(),results=[];
 await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto('http://localhost/');
 try{
  await page.route('http://127.0.0.1/**',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto('http://127.0.0.1/marker-review');
  for(const scenario of ['within-strong','across-strong','across-paragraphs','collapsed-root-end']){
   const result=await page.evaluate(({source,scenario})=>{
    document.body.innerHTML='<div id="editor"><p><strong>ABCD</strong>EFGH</p><p>第二段末尾。</p></div>';const el=document.getElementById('editor'),bold=el.querySelector('strong').firstChild,plain=el.querySelector('p').lastChild,next=el.querySelectorAll('p')[1].firstChild,range=document.createRange();
    if(scenario==='within-strong'){range.setStart(bold,1);range.setEnd(bold,3)}
    else if(scenario==='across-strong'){range.setStart(bold,1);range.setEnd(plain,2)}
    else if(scenario==='across-paragraphs'){range.setStart(bold,2);range.setEnd(next,3)}
    else{range.selectNodeContents(el);range.collapse(false)}
    const selected=range.toString(),original='**ABCD**EFGH\n\n第二段末尾。',bookmark=new Function('editor','selection','remember','value',source)({current:el},{current:range},()=>{},original);
    const wanted=scenario==='within-strong'?'BC':scenario==='across-strong'?'BCD**EF':scenario==='across-paragraphs'?'CD**EFGH\n\n第二段':'第二段末尾。';
    return {scenario,selected,context:bookmark.context,original,wanted,ok:bookmark.context.text===wanted&&bookmark.context.body===original};
   },{source,scenario});results.push(result);
  }
  console.log(JSON.stringify({sourceOnly:true,results}));process.exitCode=results.some(x=>!x.ok)?1:0;
 }finally{await browser.close()}
 // Avoid running the integrated suite after this isolated branch.
 await new Promise(r=>setTimeout(r,100));process.exit(process.exitCode||0);
}

if(process.argv.includes('--position-only')){
 const source=stripTypeScriptTypes(fs.readFileSync('src/article-position.ts','utf8'));
 const position=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const results=[];const check=(name,fn)=>{try{fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.message})}};
 const body='第一段内容。\n\n第二段内容。';
 check('paragraph-end-caret-retains-surrounding-context',()=>{const mark=position.textBookmark(body,body.indexOf('\n\n'));assert.equal(mark.context.text,'第一段内容。',JSON.stringify(mark.context));assert(mark.context.start<=mark.context.end)});
 check('changed-body-never-silently-inserts-at-stale-caret',()=>{const mark=position.textBookmark(body,3);assert.throws(()=>position.insertAtBookmark('前置修改'+body,mark,'图片'),/正文已变化/)});
 check('unicode-selection-and-image-insertion-use-js-offsets-consistently',()=>{const text='甲😀乙。\n\n后段';const start=text.indexOf('乙');const mark=position.textBookmark(text,start,start+1);assert.equal(mark.context.text,'乙');const tag=position.imageTag('测试','/api/studio/assets/'+'f'.repeat(32)+'/file');const next=position.insertAtBookmark(text,mark,tag);assert(next.body.indexOf(tag)<next.body.indexOf('乙'));assert(next.body.startsWith('甲😀'))});
 console.log(JSON.stringify({sourceOnly:true,results,sourceSHA256:createHash('sha256').update(source).digest('hex')}));process.exit(results.some(x=>!x.ok)?1:0);
}

if(process.argv.includes('--contrast-only')){
 // Adapt the changed test selector in memory; leave the color agent's file intact.
 const source=fs.readFileSync('scripts/test-ui-contrast-workspace.mjs','utf8')
  .replace("from './test-studio-color-states.mjs'",'from '+JSON.stringify(pathToFileURL(path.resolve('scripts/test-studio-color-states.mjs')).href))
  .replace("from 'playwright-core'",'from '+JSON.stringify(import.meta.resolve('playwright-core')))
  .replace("\ncontent=put('content'", "\nfrom backend import assistant_workspace as aw\ntask=aw.attach_proposal(owner,{**task,'profile_binding':{'operation':'create','target_id':None,'reference_profile_id':profile['id']}},{**proposal,'operation':'create','target_id':None,'reference_profile_id':profile['id']})\ncontent=put('content'")
  .replace("page.locator('.agent-result details').evaluate", "page.locator('.agent-result details').first().evaluate");
 try{await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));process.exit(0)}catch(e){console.error('Color audit failed: '+e.message.slice(0,700));process.exit(1)}
}

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p};
const watched=['src/article-draft.tsx','src/PlatformArticleOutcome.tsx','src/ArticleRichEditor.tsx','src/ArticleImagePicker.tsx','src/CurrentActivity.tsx','src/App.tsx'];
const hashes=()=>Object.fromEntries(watched.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const before=hashes(),results=[],guard=[],errors=[];
const port=await freePort(),base='http://127.0.0.1:'+port,ui=base;
const directory=path.resolve('.runtime','article-editing-ui-adversarial-'+Date.now()+'-'+randomUUID());fs.mkdirSync(directory,{recursive:true});
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONDONTWRITEBYTECODE:'1'};
const backend=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['tests/article-ui-fixture.py'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
const staticFiles=new Map();const snapshot=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,entry.name);if(entry.isDirectory())snapshot(f);else staticFiles.set('/'+path.relative('dist',f).replaceAll('\\','/'),fs.readFileSync(f))}};snapshot('dist');
let logs='',browser,mainFixture;
for(const stream of [backend.stdout,backend.stderr])stream.on('data',d=>logs=(logs+d).slice(-12000));
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7);
const test=async(name,fn)=>{if(only&&!name.includes(only))return;try{const evidence=await fn();results.push({name,ok:true,evidence})}catch(e){results.push({name,ok:false,error:e.message})}console.log(JSON.stringify(results.at(-1)))};
try{
 for(const url of [base+'/api/health',ui]){let ready=false;for(let i=0;i<150;i++){try{ready=(await fetch(url)).ok;if(ready)break}catch{}await delay(100)}assert(ready,logs)}
 const auth=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'adversarial-ui@example.test',password:'isolated-only-381',name:'独立审查'})})).json();assert(auth.token);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 const api=async(p,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+'/api'+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,p+' '+await r.clone().text());return r.json()};
 await api('/workspace',{});
 // Valid PNG produced in memory. Uploaded only to the disposable fixture.
 const image=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import io,base64;from PIL import Image;b=io.BytesIO();Image.new("RGB",(80,60),"green").save(b,format="PNG");print(base64.b64encode(b.getvalue()).decode())'],{windowsHide:true,encoding:'utf8'});assert.equal(image.status,0,image.stderr);const png=Buffer.from(image.stdout.trim(),'base64');
 const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'独立审查配图.png');
 const ur=await fetch(base+'/api/studio/upload',{method:'POST',headers:{Authorization:headers.Authorization},body:form});assert(ur.ok,await ur.clone().text());const uploaded=await ur.json(),picture=uploaded.asset||uploaded;
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu','--no-proxy-server']});
 const open=async(mode='platform')=>{
  let {content,task}=await api('/test/article',{});
  const seed=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import json,sys;from backend import store as s;d=json.load(sys.stdin);owner=d["owner"];s.init();t=s.get(owner,d["task"]);c=s.get(owner,d["content"]);t=s.put(owner,"task",{**t,"platform_outcomes":{"wechat":c["id"]},"active_outcome":"wechat"},t["id"]);c=s.put(owner,"content",{**c,"title":"审查稿"+c["id"]},c["id"]);s.put(owner,"job",{"title":c["title"],"status":"done","input":{"action":"studio_text"},"result":{"content_id":c["id"]}});print(json.dumps({"task":t,"content":c}))'],{env,encoding:'utf8',input:JSON.stringify({owner:auth.user.id,task:task.id,content:content.id}),windowsHide:true});assert.equal(seed.status,0,seed.stderr);({content,task}=JSON.parse(seed.stdout));
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(!['data:','blob:'].includes(u.protocol)&&u.origin!==ui){guard.push(u.href);return r.abort()}const key=u.pathname==='/'?'/index.html':u.pathname;const body=staticFiles.get(key);if(body)return r.fulfill({body,contentType:key.endsWith('.js')?'application/javascript':key.endsWith('.css')?'text/css':key.endsWith('.html')?'text/html':undefined});return r.continue()});
  await page.addInitScript(token=>{if(window===window.top)sessionStorage.setItem('tijian-session',token)},auth.token);
  await page.goto(ui+'/?ui=1#'+(mode==='platform'?'task/'+task.id:'studio/works'),{waitUntil:'domcontentloaded'});
  const expand=async()=>{const record=page.locator('.st-work-record').filter({hasText:content.title});await record.first().waitFor();if(!await record.first().getAttribute('open'))await record.first().locator('summary').click();await page.locator('.article-editor').waitFor()};
  if(mode==='article')await expand();else await page.locator('.article-rich-editor').waitFor();
  return {page,content,task,remount:async()=>{await page.reload({waitUntil:'domcontentloaded'});if(mode==='article')await expand();else await page.locator('.article-rich-editor').waitFor()}};
 };
 const caret=async(page,offset)=>page.locator('.article-rich-editor').evaluate((el,n)=>{el.focus();const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),text=w.nextNode(),r=document.createRange();r.setStart(text,n);r.collapse(true);window.getSelection().removeAllRanges();window.getSelection().addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))},offset);
 await test('article-unsaved-draft-survives-remount',async()=>{const {page,remount}=await open('article');try{await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByLabel('编辑生成文稿').fill('离开后必须保留的人工稿');await remount();await page.getByRole('tab',{name:'编辑',exact:true}).click();assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),'离开后必须保留的人工稿')}finally{await page.close()}});
 await test('platform-all-fields-survive-remount',async()=>{const {page}=await open();try{await page.getByLabel('成果标题').fill('未保存的人工标题');await page.locator('.article-rich-editor').fill('未保存的人工正文');await page.getByLabel('成果摘要').fill('未保存的人工摘要');await page.reload();await page.locator('.article-rich-editor').waitFor();assert.equal(await page.getByLabel('成果标题').inputValue(),'未保存的人工标题');assert.match(await page.locator('.article-rich-editor').innerText(),/未保存的人工正文/);assert.equal(await page.getByLabel('成果摘要').inputValue(),'未保存的人工摘要')}finally{await page.close()}});
 await test('metadata-only-version-change-does-not-create-false-conflict',async()=>{const {page,content}=await open('article');try{await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByLabel('编辑生成文稿').fill('人工编辑稿');await api('/objects/'+content.id,{version:content.version,status:'draft',review_note:'元数据变化'},'PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('status').filter({hasText:/已保存稿件/}).waitFor();assert.equal(await page.getByRole('region',{name:'稿件保存冲突'}).count(),0);assert.equal((await api('/state/updates?ids='+content.id)).items[0].body,'人工编辑稿')}finally{await page.close()}});
 await test('real-conflict-keeps-both-versions-and-local-recovery',async()=>{const {page,content,remount}=await open('article');try{await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByLabel('编辑生成文稿').fill('我的本地草稿');await api('/objects/'+content.id,{version:content.version,body:'另一个窗口的服务器稿'},'PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();const region=page.getByRole('region',{name:'稿件保存冲突'});await region.waitFor();assert.match(await region.innerText(),/我的本地草稿/);assert.match(await region.innerText(),/另一个窗口的服务器稿/);assert(await page.getByLabel('编辑生成文稿').isEditable());await page.getByRole('button',{name:'采用服务器稿，保留本地备份'}).click();await remount();await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByText(/可恢复的版本/).click();await page.getByRole('button',{name:'恢复到编辑区'}).click();assert.equal(await page.getByLabel('编辑生成文稿').inputValue(),'我的本地草稿')}finally{await page.close()}});
 await test('caret-image-is-real-and-visible-in-editor-and-reading-preview',async()=>{const {page}=await open();try{await caret(page,5);await page.getByRole('button',{name:'插入图片',exact:true}).click();await page.getByRole('button',{name:'选择这张图片'}).first().click();await page.getByRole('button',{name:'确认插入文稿'}).click();await page.waitForFunction(()=>document.querySelector('.article-rich-editor img')?.naturalWidth>0);const text=await page.locator('.article-rich-editor').innerText();assert(text.indexOf('独立审查配图')<text.indexOf('后半'),text);await page.getByRole('button',{name:'阅读预览',exact:true}).click();const frame=page.frameLocator('iframe[title="公众号排版预览"]');await frame.locator('img').waitFor();assert(await frame.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0))}finally{await page.close()}});
 for(const edited of [false,true])await test('async-generated-image-restores-original-caret-after-close-and-remount'+(edited?'-after-manual-edit':''),async()=>{const {page}=await open();let complete=false,requestId;const runId='a'.repeat(32);const run=()=>({id:runId,kind:'studio_run',status:complete?'succeeded':'running',request_id:requestId,asset_ids:complete?[picture.id]:[]});try{
  await page.route('**/api/studio/generate',r=>{requestId=r.request().postDataJSON().request_id;return r.fulfill({json:{run:run()}})});
  await page.route('**/api/studio/runs',r=>r.fulfill({json:{items:[run()]}}));
  await page.route('**/api/studio/runs/'+runId+'/refresh',r=>r.fulfill({json:{run:run()}}));
  if(edited)await page.locator('.article-rich-editor').fill('人工改写前半后半。');await caret(page,5);await page.getByRole('button',{name:/^(?:AI )?生成新配图$/}).click();await page.getByLabel('配图提示词').fill('【隔离模拟生图】第一段的画面');await page.getByRole('dialog').getByRole('button',{name:'生成新配图',exact:true}).click();await page.getByRole('button',{name:'确认生成配图'}).click();await page.getByText('配图生成中，完成后回填正文；关闭后可重新打开核查原任务。').waitFor();await page.getByRole('button',{name:'关闭弹窗'}).click();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.article-rich-editor').waitFor();complete=true;await page.getByRole('button',{name:/^(?:AI )?生成新配图$/}).click();await page.waitForFunction(()=>document.querySelector('.article-rich-editor img')?.naturalWidth>0,undefined,{timeout:5000}).catch(async()=>{throw Error('重开后插入失败：'+await page.locator('.ap-error').innerText().catch(()=>page.locator('.article-rich-editor').innerText()))});const text=await page.locator('.article-rich-editor').innerText();assert(text.indexOf('独立审查配图')<text.indexOf('后半'),'原 caret=第一段第5字，重开后实际正文='+text);return {simulatedGeneration:true,paidCalls:false};
 }finally{await page.close()}});
 await test('integrated-search-opens-the-selected-record-with-real-image',async()=>{const {page}=await open();try{await page.keyboard.press('Control+k');await page.getByLabel('搜索资料与作品').fill('独立审查配图');await page.locator('.global-search-result').first().waitFor();await page.locator('.global-search-result').first().click();await page.getByRole('button',{name:'打开所在页面',exact:true}).click();await page.getByRole('region',{name:'搜索定位的记录'}).waitFor();assert.equal(new URL(page.url()).hash,'#studio/works?record='+picture.id);await page.waitForFunction(()=>document.querySelector('.search-record-panel img')?.naturalWidth>0);assert.match(await page.locator('.search-record-panel').innerText(),/独立审查配图/)}finally{await page.close()}});
 await test('integrated-search-ignores-out-of-order-responses',async()=>{const {page}=await open();let release;try{const hit=title=>({id:'f'.repeat(32),kind:'source',title,version:1,updated:'2026-10-12',category:'原始资料',summary:title,route:'knowledge/source/'+'f'.repeat(32),score:100,match_reason:'标题匹配',matched_terms:[title],related_ids:['f'.repeat(32)]});await page.route('**/api/search?*',async r=>{const q=new URL(r.request().url()).searchParams.get('q');if(q==='慢请求'){await new Promise(resolve=>release=resolve);return r.fulfill({json:[hit('旧响应不应出现')]})}return r.fulfill({json:[hit('新响应准确结果')]})});await page.keyboard.press('Control+k');const input=page.getByLabel('搜索资料与作品');await input.fill('慢请求');for(let i=0;i<30&&!release;i++)await delay(30);assert(release);await input.fill('快请求');await page.getByText('新响应准确结果',{exact:true}).first().waitFor();release();await delay(200);assert.equal(await page.getByText('旧响应不应出现',{exact:true}).count(),0)}finally{release?.();await page.close()}});
 await test('formatted-selection-sends-exact-selected-text-to-context-generator',async()=>{const {page}=await open();let submitted;try{
  const select=()=>page.locator('.article-rich-editor').evaluate(el=>{el.focus();const node=el.querySelector('strong,b')?.firstChild||el.querySelector('p').firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,2);window.getSelection().removeAllRanges();window.getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
  await select();await page.getByRole('toolbar',{name:'选中文字格式'}).getByRole('button',{name:'加粗',exact:true}).click();await select();
  await page.route('**/api/studio/text/article-illustration-prompt',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{id:'review-prompt',kind:'job',status:'done',result:{suggested_prompt:'隔离提示词'}}})});
  await page.locator('.aw-editor-actions').getByRole('button',{name:/^(?:AI )?生成新配图$/}).click();await page.getByRole('button',{name:'AI 整理画面提示词'}).click();for(let i=0;i<30&&!submitted;i++)await delay(30);assert(submitted);assert.equal(submitted.body.slice(submitted.start,submitted.end),'第一',JSON.stringify(submitted));
 }finally{await page.close()}});
 await test('wechat-delivery-context-prompt-accepts-its-own-publishing-draft',async()=>{const {page}=await open();try{
  const topic=await api('/studio/topics',{title:'隔离公众号发布稿配图',angle:'位置核对',source_ids:[]});const delivery=await api('/studio/deliveries',{topic_id:topic.id,platform:'wechat',title:'隔离公众号发布稿',body:'第一段前半后半。\n\n第二段结尾。'});
  await page.goto(base+'/?ui=1#studio/topics?topic='+topic.id+'&platform=wechat',{waitUntil:'domcontentloaded'});await page.locator('.article-rich-editor').waitFor();await caret(page,5);await page.getByRole('button',{name:'AI 生成新配图',exact:true}).click();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/studio/text/article-illustration-prompt'));await page.getByRole('button',{name:'AI 整理画面提示词',exact:true}).click();const response=await responsePromise;assert(response.ok(),'公众号发布稿 id='+delivery.id+' 被自己的上下文接口拒绝：'+await response.text());
  await page.getByRole('button',{name:'采用 AI 提示词',exact:true}).waitFor();
 }finally{await page.close()}});
 for(const broken of [false,true])await test('full-media-preview-'+(broken?'404-has-visible-error':'loads-while-offscreen'),async()=>{const {page,task}=await open();try{
  const seed=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import json,sys;from backend import store as s;d=json.load(sys.stdin);owner=d["owner"];s.init();t=s.get(owner,d["task"]);draft=s.put(owner,"studio_draft",{"title":"隔离图片方案","tool":"text_image","input":{"prompt":"隔离图像"},"model_id":"fixture-image","options":{}});run=s.put(owner,"studio_run",{"title":"隔离完成图片","tool":"text_image","draft_id":draft["id"],"provider":"fixture","status":"succeeded","asset_ids":[d["picture"]]});s.put(owner,"task",{**t,"media_outcomes":{"image":draft["id"]},"media_runs":{"image":run["id"]},"active_outcome":"image"},t["id"])'],{env,encoding:'utf8',input:JSON.stringify({owner:auth.user.id,task:task.id,picture:picture.id}),windowsHide:true});assert.equal(seed.status,0,seed.stderr);
  if(broken)await page.route('**/api/studio/assets/'+picture.id+'/file',r=>r.fulfill({status:404,json:{detail:'隔离模拟：文件不可用'}}));await page.setViewportSize({width:1000,height:700});await page.reload({waitUntil:'domcontentloaded'});await page.locator('.aw-media-result').waitFor();
  if(!broken){await page.waitForFunction(()=>document.querySelector('.aw-media-result img')?.naturalWidth>0,undefined,{timeout:5000});return await page.locator('.aw-media-result img').evaluate(img=>({loaded:img.naturalWidth>0,top:img.getBoundingClientRect().top,viewport:innerHeight}))}
  await delay(700);const text=await page.locator('.aw-media-result').innerText();assert.match(text,/失败|不可用|无法|重试|无法读取/,'404 后结果区永久占位且没有可见失败说明：'+text);
 }finally{await page.close()}});
 // Existing integrated dist: test actual App login boundary and current-task control.
 await test('editor-account-isolation-never-resumes-another-accounts-draft',async()=>{
  const fixture=await startIsolatedUI('demo-adversarial-editor-account');await fixture.call('/workspace',{});
  const draft=await fixture.call('/studio/drafts',{tool:'text_image',title:'A账户私有图片草稿',input:{prompt:'A账户草稿，不能作为B的当前任务'},model_id:'fixture-image',options:{}});
  const page=await browser.newPage({viewport:{width:1530,height:1000}});
  try{await fixture.attach(page);await page.goto(fixture.base+'/?ui=1#studio/image?draft='+draft.id+'&mode=text_image');await page.locator('.mw-prompt textarea,.mw-field textarea').first().waitFor();await page.locator('.account-control').click();await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.locator('.auth-page').waitFor();
   const response=await fetch(fixture.base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'editor-owner-b@example.test',password:'isolated-editor-b-password',name:'B编辑账户'})});assert(response.ok);await page.locator('input[name=email]').fill('editor-owner-b@example.test');await page.locator('input[name=password]').fill('isolated-editor-b-password');await page.getByRole('button',{name:'进入工作台',exact:false}).click();await page.locator('.account-control').waitFor();await page.locator('.sidebar').getByRole('button',{name:'首页',exact:true}).click();
   const resumed=await page.getByRole('button',{name:'继续当前任务',exact:true}).count();const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('current-activity:'))));assert.equal(resumed,0,'B账户继续当前任务继承了A的草稿路由：'+JSON.stringify(stored));
  }finally{await page.close();fixture.close()}
 });
 await test('integrated-main-current-work-is-isolated-after-account-switch',async()=>{
  mainFixture=await startIsolatedUI('demo-adversarial-main');await mainFixture.call('/workspace',{});const task=await mainFixture.call('/objects/task',{title:'A账户私有任务',messages:[]});const page=await browser.newPage({viewport:{width:1530,height:1000}});
  try{await mainFixture.attach(page);await page.goto(mainFixture.base+'/?ui=1#task/'+task.id);await page.locator('.aw-workspace').waitFor();await page.locator('.sidebar').getByRole('button',{name:'我的 IP',exact:true}).click();await page.getByRole('button',{name:'继续当前任务',exact:true}).click();assert(new URL(page.url()).hash.endsWith(task.id));await page.locator('.account-control').click();await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.locator('.auth-page').waitFor();const r=await fetch(mainFixture.base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner-b@example.test',password:'isolated-b-password',name:'B账户'})});const other=await r.json();assert(other.token);await page.locator('input[name=email]').fill('owner-b@example.test');await page.locator('input[name=password]').fill('isolated-b-password');await page.getByRole('button',{name:'进入工作台',exact:false}).click();await page.locator('.account-control').waitFor();await page.locator('.sidebar').getByRole('button',{name:'首页',exact:true}).click();assert.match(await page.locator('.account-control').innerText(),/B账户/);assert.equal(await page.getByRole('button',{name:'继续当前任务',exact:true}).count(),0);assert.equal(await page.getByText('A账户私有任务',{exact:true}).count(),0);return mainFixture.integration}finally{await page.close()}
 });
 console.log(JSON.stringify({reviewOnly:true,results,guard,errors,hashesBefore:before,hashesAfter:hashes(),paidCalls:false,productionDBWrites:false}));
 if(results.some(x=>!x.ok)||guard.length||errors.length)process.exitCode=1;
}finally{await browser?.close();mainFixture?.close();backend.kill()}
