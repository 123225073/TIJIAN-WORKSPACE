import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const dir=path.resolve('.runtime','topic-library-ui-'+Date.now());
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
 for(let i=0;i<150;i++){try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(resolve=>setTimeout(resolve,150))}
 if(!ready)throw Error(errors||'Fixture not ready');
 const login=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'topic@example.test',password:'isolated-test-only',name:'选题测试'})});
 assert.equal(login.status,200);
 const auth=await login.json(),headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
 for(const title of ['电梯选型核对','维保资料整理']){
  const result=await fetch(base+'/api/studio/topics',{method:'POST',headers,body:JSON.stringify({title})});
  assert.equal(result.status,200);
 }
 browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1480,height:960}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('dialog',dialog=>dialog.accept());
 await page.goto(base);
 await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
 await page.goto(base+'/?ui=1#studio/topics');
 await page.getByRole('region',{name:'选题库列表管理'}).waitFor();
 await page.getByRole('row').filter({hasText:'电梯选型核对'}).getByRole('button',{name:'编辑'}).click();
 await page.getByRole('textbox',{name:'切入角度'}).fill('先核对参数与使用场景');
 await page.getByRole('button',{name:'保存选题'}).click();
 await page.getByText('选题已保存').waitFor();
 await page.getByRole('checkbox',{name:'选择当前列表全部选题'}).check();
 await page.getByRole('button',{name:/批量删除/}).click();
 await page.getByText('已移入回收区 2 条选题').waitFor();
 await page.getByRole('button',{name:'回收区'}).click();
 await page.getByText('电梯选型核对').waitFor();
 await page.getByRole('checkbox',{name:'选择当前列表全部选题'}).check();
 await page.getByRole('button',{name:/批量恢复/}).click();
 await page.getByRole('button',{name:'可用选题'}).click();
 await page.getByText('先核对参数与使用场景').waitFor();
 const topics=await(await fetch(base+'/api/studio/topics',{headers})).json();
 assert.equal(topics.items.length,2);
 assert(topics.items.some(x=>x.title==='电梯选型核对'&&x.angle==='先核对参数与使用场景'));
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({passed:true,checks:['inline topic edit','batch soft delete','recycle bin restore','persisted edit'],dir}));
}finally{if(browser)await browser.close();service.kill()}
