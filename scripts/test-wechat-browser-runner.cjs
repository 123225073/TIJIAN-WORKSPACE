// Actual Electron IPC + backend queue. HTTPS page is an explicit isolated challenge fixture.
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=process.argv[2],base=process.argv[3];let main,reader,verified=false,challengeCount=0;
app.setPath('userData',path.join(dir,'browser'));app.on('window-all-closed',()=>{});
ipcMain.handle('remember-login',()=>null);
require('../desktop/wechat-body.cjs')(()=>main,()=>base);
app.on('browser-window-created',(_e,win)=>{
 if(!main)return;
 reader=win;
 // Never contact a real website or use a real platform session in this acceptance test.
 win.webContents.session.protocol.handle('https',request=>{
  const url=new URL(request.url);if(url.hostname!=='mp.weixin.qq.com')return new Response('',{status:403});
  if(url.searchParams.has('verified'))verified=true;
  if(!verified){challengeCount++;return new Response('<title>隔离测试验证页</title><h1>这不是微信验证码，仅用于验证等待流程</h1><button id="verify" onclick="location.href=location.href+\'&verified=1\'">测试完成验证</button>',{headers:{'content-type':'text/html; charset=utf-8'}})}
  return new Response('<div id="js_name">界面验收公众号</div><h1 id="activity-name">浏览器正文 '+url.searchParams.get('mid')+'</h1><div id="js_content">'+('这是隔离测试正文。'.repeat(80))+url.searchParams.get('mid')+'</div>',{headers:{'content-type':'text/html; charset=utf-8'}});
 });
});
app.whenReady().then(async()=>{
 try{
  main=new BrowserWindow({show:false,width:1530,height:1000,webPreferences:{preload:path.resolve('desktop/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const js=code=>main.webContents.executeJavaScript(code);
  const wait=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100))}throw Error('UI timeout '+code+' '+await js('document.body.innerText'))};
  const click=async text=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`)};
  await main.loadURL(base);
  await js(`(async()=>{const d=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'browser@example.test',password:'browser-fixture-password',name:'浏览器队列验收'})}).then(r=>r.json());sessionStorage.setItem('tijian-session',d.token);const h={Authorization:'Bearer '+d.token,'Content-Type':'application/json'};const post=(p,b,method='POST')=>fetch('/api'+p,{method,headers:h,body:JSON.stringify(b)}).then(r=>r.json());await post('/workspace',{});const b=await post('/objects/benchmark',{title:'界面验收公众号',platform:'公众号',url:'https://mp.weixin.qq.com/s/ui-fixture'});await post('/wechat/settings',{app_id:'ui-fixture-id',app_secret:'ui-fixture-secret'},'PUT');await post('/wechat/resolve',{benchmark_id:b.id,url:b.url,confirmed:true});let run=await post('/wechat/runs',{benchmark_id:b.id});run=await post('/wechat/runs/'+run.id+'/next',{confirmed:true,version:run.version});await post('/wechat/runs/'+run.id+'/next',{confirmed:true,version:run.version})})()`);
  await main.loadURL(base+'/?browser-test=1#benchmark');await click('发现账号文章');
  await wait("document.querySelectorAll('.cimi-articles .discovery-entry').length===4");
  await click('选择当前结果（最多100篇）');await click('采集所选正文（不收次幂费用）');
  await wait("document.querySelector('.collection-feedback')?.innerText.includes('等待你完成微信验证')");
  for(let i=0;i<100&&(!reader||reader.isDestroyed()||!reader.isVisible());i++)await new Promise(r=>setTimeout(r,30));
  assert.ok(reader&&!reader.isDestroyed()&&reader.isVisible());assert.equal(verified,false);
  // Clicking a blank backdrop hides the drawer, but the queue keeps waiting for the user.
  await js("document.querySelector('.reader-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  await wait("!document.querySelector('.reader-overlay')");
  await wait("document.querySelector('.scoped-progress')?.innerText.includes('等待你完成微信验证')");
  await click('文章库与订阅');
  await reader.webContents.executeJavaScript("document.getElementById('verify').click()");
  await wait("document.querySelector('.collection-feedback')?.innerText.includes('成功 4 篇')");
  await wait("document.body.innerText.includes('正文已保存 4 篇')");
  assert.equal(challengeCount,1);assert.equal(await js('location.hash'),'#benchmark');
  assert.equal(await js("fetch('/fixture/stats').then(r=>r.json()).then(x=>x.paid)"),3);
  await js("document.querySelector('.wechat-library > .record-delete button').click()");
  await wait("!document.querySelector('.wechat-library > .collection-result')");
  await js("document.querySelector('.cimi-coverage .record-delete button').click()");
  await wait("!document.querySelector('select[aria-label=\"历史查询与断点\"]')");
  await js("document.querySelector('.cimi-articles .record-delete button').click()");
  await wait("document.querySelectorAll('.cimi-articles .discovery-entry').length===3");
  await click('文章资料');await click('发现账号文章');
  await wait("!!document.querySelector('.reader-overlay')");
  // Drawer clicks stay open; only its backdrop closes it.
  await js("document.querySelector('.detail-drawer').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  assert.ok(await js("!!document.querySelector('.reader-overlay')"));
  await js("document.querySelector('.reader-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  await wait("!document.querySelector('.reader-overlay')");
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,real_ipc_and_backend:true,explicit_fixture_not_live_wechat:true,manual_challenge_then_batch_continue:4,one_challenge:challengeCount,free_no_cimi_calls:true,drawer_dismiss_preserves_running_queue:true,delete_job_run_article:true}));
 }catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.message,reader:reader?{destroyed:reader.isDestroyed(),visible:!reader.isDestroyed()&&reader.isVisible()}:null,windows:BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),visible:w.isVisible(),url:w.webContents.getURL()}))}));process.exitCode=1}
 finally{if(reader&&!reader.isDestroyed())reader.destroy();main?.destroy();app.exit(process.exitCode||0)}
});
