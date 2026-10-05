import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const dir=path.resolve('.runtime','wechat-layout-ui-'+Date.now());
fs.mkdirSync(dir,{recursive:true});
const socket=net.createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
 windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let stderr='',browser;
service.stderr.on('data',chunk=>stderr+=chunk);
try{
 let ready=false;
 for(let i=0;i<150;i++){
  try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 if(!ready)throw Error(stderr||'Isolated fixture did not start');
 const login=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'layout-ui@example.test',password:'isolated-test-only',name:'排版验收'})});
 assert.equal(login.status,200);
 const auth=await login.json(),headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 const api=async(url,method='GET',body)=>{
  const response=await fetch(base+'/api'+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  return response.json();
 };
 const topic=await api('/studio/topics','POST',{title:'公众号排版核对'});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(base);
 await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/topics?topic='+topic.id);
 const input=page.getByRole('textbox',{name:'公众号文章正文'});
 await input.waitFor();
 await input.fill('## 项目核对\n\n先看现场。\n\n1. 核对尺寸\n\n2. 核对维保');
 const proof=page.frameLocator('iframe[title="公众号排版预览"]');
 await proof.getByText('核对维保').waitFor();
 const paragraphs=await proof.locator('p').allTextContents();
 assert.equal(paragraphs.filter(text=>text.includes('1.核对尺寸')).length,1);
 assert.equal(paragraphs.filter(text=>text.includes('2.核对维保')).length,1);
 assert.equal(await proof.locator('ol,ul,li').count(),0);
 await page.locator('.wa-card input[type=file]').setInputFiles({name:'scene.png',mimeType:'image/png',buffer:fs.readFileSync('build/tijian.png')});
 await proof.locator('img').waitFor();
 assert((await proof.locator('img').first().getAttribute('src')).startsWith('data:image/'));
 await page.locator('.wa-style-details summary').click();
 await page.getByLabel('公众号正文字号').selectOption('17');
 await page.getByLabel('公众号正文段距').selectOption('8');
 await page.getByLabel('公众号排版强调色').selectOption('blue');
 await proof.locator('section[style*="font-size:17px"]').waitFor();
 await page.getByRole('button',{name:'保存发布稿'}).first().click();
 await page.getByText('发布稿已保存；尚未发布').waitFor();
 const saved=(await api('/studio/deliveries')).items.find(item=>item.topic_id===topic.id);
 assert.deepEqual(saved.wechat_style,{font_size:'17',line_height:'1.8',paragraph_gap:'8',accent:'blue'});
 const preview=await api('/wechat-publish/preview','POST',{body:saved.body,wechat_style:saved.wechat_style});
 assert(preview.html.includes('font-size:17px'));
 assert(!/<ol\b|<ul\b|<li\b/.test(preview.html));
 await page.reload();
 await page.locator('.wa-style-details summary').click();
 await page.getByLabel('公众号正文字号').waitFor();
 assert.equal(await page.getByLabel('公众号正文字号').inputValue(),'17');
 const reloaded=page.getByRole('textbox',{name:'公众号文章正文'});
 await reloaded.evaluate(element=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const start=node.textContent.indexOf('先看现场');if(start>=0){const range=document.createRange(),selection=window.getSelection();range.setStart(node,start);range.setEnd(node,start+4);selection.removeAllRanges();selection.addRange(range);element.focus();element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));break}}});
 await page.getByRole('button',{name:'加粗',exact:true}).click();
 assert(/<(?:strong|b)>先看现场<\/(?:strong|b)>/.test(await reloaded.innerHTML()));
 await proof.locator('strong').getByText('先看现场').waitFor();
 await reloaded.evaluate(element=>{const node=Array.from(element.querySelectorAll('strong,b')).find(x=>x.textContent==='先看现场').firstChild,selection=window.getSelection(),range=document.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
 await page.getByLabel('选中文字颜色').selectOption('red');
 await proof.locator('span[style*="color:#c34539"]').getByText('先看现场').waitFor();
 await reloaded.evaluate(element=>{const node=Array.from(element.querySelectorAll('span')).find(x=>x.textContent==='先看现场'&&x.hasAttribute('data-wa-color'))?.firstChild,selection=window.getSelection(),range=document.createRange();if(!node)throw Error('颜色标记未找到');range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
 await page.getByLabel('选中文字大小').selectOption('20');
 await proof.locator('span[style*="font-size:20px"]').getByText('先看现场').waitFor();
 await reloaded.evaluate(element=>{const node=Array.from(element.querySelectorAll('span')).find(x=>x.textContent==='先看现场'&&x.hasAttribute('data-wa-size'))?.firstChild,selection=window.getSelection(),range=document.createRange();if(!node)throw Error('字号标记未找到');range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
 await page.getByLabel('段落样式').selectOption('heading');
 await proof.locator('h2').getByText('先看现场').waitFor();
 await page.getByRole('button',{name:'保存发布稿'}).first().click();
 await page.getByText('发布稿已保存；尚未发布').waitFor();
 const formatted=(await api('/studio/deliveries')).items.find(item=>item.topic_id===topic.id);
 assert(formatted.body.includes('## **{#color:red}{#size:20}先看现场{#/size}{#/color}**'));
 await page.reload();
 await page.getByLabel('公众号正文字号').waitFor({state:'attached'});
 await proof.locator('h2 span[style*="font-size:20px"]').getByText('先看现场').waitFor();
 await reloaded.evaluate(element=>{const selection=window.getSelection(),range=document.createRange(),clipboardData=new DataTransfer();range.selectNodeContents(element);range.collapse(false);selection.removeAllRanges();selection.addRange(range);element.focus();clipboardData.setData('text/plain','## 粘贴标题\n\n粘贴内容');element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}))});
 await proof.locator('h2').getByText('粘贴标题').waitFor();
 assert.equal(await reloaded.locator('h2').filter({hasText:'粘贴标题'}).count(),1);
 await page.locator('.wa-rich-editor').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(dir,'wechat-layout.png'),fullPage:true});
 await page.screenshot({path:path.join(dir,'wechat-rich-editor.png')});
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({passed:true,checks:['single list markers','inline image in final proof','left-side global style controls','same backend preview','save and reload','selected text heading/bold/color/size persists','pasted Markdown appears formatted on the left'],screenshot:path.join(dir,'wechat-layout.png')}));
}finally{if(browser)await browser.close();service.kill()}
