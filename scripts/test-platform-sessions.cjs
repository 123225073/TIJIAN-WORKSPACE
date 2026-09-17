// Isolated Electron integration tests. All web responses are local fixtures, never real platform logins.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const phase=process.argv[2],dir=path.resolve(process.argv[3]);
app.setPath('userData',dir);
app.on('window-all-closed',()=>{});
// Keep every fixture window invisible, including product paths that normally show a QR window.
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){};
const hub=require('../desktop/platform-sessions.cjs');
const policy=require('../desktop/platform-policy.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const load=async(w,url)=>{await w.loadURL(url);if(w.webContents.isLoadingMainFrame())await hub.bound(new Promise(r=>w.webContents.once('did-stop-loading',r)),3000)};
const checks=[];
const pass=name=>checks.push(name);
app.whenReady().then(async()=>{
 try{
  const partition=hub.partitionFor('test-owner','wechat-account');
  const ctx=await hub.context(partition,'wechat');
  if(phase==='seed'){
   assert.ok(safeStorage.isEncryptionAvailable());
   await ctx.session.cookies.set({url:'https://mp.weixin.qq.com/',name:'session_fixture',value:'synthetic-session-secret',httpOnly:true,secure:true,sameSite:'lax'});
   await ctx.session.cookies.set({url:'https://mp.weixin.qq.com/',domain:'.weixin.qq.com',name:'parent_fixture',value:'synthetic-parent-secret',httpOnly:true,secure:true,sameSite:'no_restriction'});
   ctx.lastVerified=Date.now();await hub.flushAll();
   const files=fs.readdirSync(path.join(dir,'platform-sessions'));
   assert.ok(files.length);for(const file of files)assert.ok(!fs.readFileSync(path.join(dir,'platform-sessions',file)).includes(Buffer.from('synthetic-session-secret')));
   pass('Windows encrypted session snapshot; no plaintext credential');
  }else{
   const cookies=await ctx.session.cookies.get({name:'session_fixture'});assert.equal(cookies.length,1);assert.equal(cookies[0].value,'synthetic-session-secret');assert.ok(cookies[0].hostOnly&&cookies[0].httpOnly&&cookies[0].secure);assert.equal(cookies[0].sameSite,'lax');
   assert.equal((await hub.status(ctx)).code,'saved');pass('Fresh process restores session cookie attributes and last verification');
   const parentCookie=(await ctx.session.cookies.get({name:'parent_fixture'}))[0];assert.equal(parentCookie.domain,'.weixin.qq.com');assert.equal(parentCookie.hostOnly,false);assert.equal(parentCookie.sameSite,'no_restriction');pass('Wechat parent-domain session cookies survive restart');
   const other=await hub.context(hub.partitionFor('other-owner','wechat-account'),'wechat');assert.equal((await other.session.cookies.get({})).length,0);pass('Owner and account partition isolation');
   await assert.rejects(()=>hub.context(partition,'weibo'));pass('Cross-platform session reuse rejected');
   const oldPartition=hub.partitionFor('test-owner','expired');
   const oldFile=path.join(dir,'platform-sessions',crypto.createHash('sha256').update(oldPartition).digest('hex')+'.bin');
   fs.writeFileSync(oldFile,safeStorage.encryptString(JSON.stringify({version:1,platform:'wechat',savedAt:Date.now()-8*86400000,cookies})));const old=await hub.context(oldPartition,'wechat');assert.equal((await old.session.cookies.get({})).length,0);pass('Expired snapshots are not restored');

   let body='<div>内容管理 数据分析</div>';
   ctx.session.protocol.handle('https',()=>new Response('<html><body>'+body+'</body></html>',{headers:{'content-type':'text/html; charset=utf-8'}}));
   const w=new BrowserWindow({show:false,webPreferences:hub.securePreferences(partition)});hub.attach(w,ctx);
   await load(w,'https://mp.weixin.qq.com/cgi-bin/home?token=123');assert.equal((await hub.status(ctx)).code,'authenticated');pass('Official account dashboard fallback detected without old nickname selector');
   body='<div style="display:none" class="weui-desktop-account__nickname">hidden</div>';await load(w,'https://mp.weixin.qq.com/');assert.equal((await hub.status(ctx)).code,'unknown');pass('Hidden DOM does not falsely assert login');
   body='<div class="weui-desktop-account__nickname">test</div>';await w.reload();await pause(150);assert.equal((await hub.status(ctx)).code,'authenticated');
   w.destroy();assert.equal((await hub.status(ctx)).code,'saved');pass('Closing window preserves last verified state without claiming live login');
   const cctx=await hub.context(hub.partitionFor('test-owner','channels'),'channels');let cbody='<div class="finder-ui-desktop-menu">作品管理</div>';
   cctx.session.protocol.handle('https',()=>new Response('<body>'+cbody+'</body>',{headers:{'content-type':'text/html; charset=utf-8'}}));
   const cw=new BrowserWindow({show:false,webPreferences:hub.securePreferences(cctx.partition)});hub.attach(cw,cctx);await load(cw,'https://channels.weixin.qq.com/platform');assert.equal((await hub.status(cctx)).code,'authenticated');
   cbody+='<div class="login-mask">扫码登录</div>';cw.reload();await pause(150);assert.equal((await hub.status(cctx)).code,'login_required');pass('Channels dashboard navigation accepted; visible login overlay takes priority');

   assert.ok(policy.popupAllowed('https://open.weixin.qq.com/connect/qrconnect?test=1','https://weibo.com/'));
   assert.ok(policy.popupAllowed('about:blank','https://weibo.com/'));
   for(const url of ['file:///C:/test','javascript:alert(1)','https://weibo.com.evil.test/','https://evil.test/','https://user:pass@weibo.com/'])assert.equal(policy.popupAllowed(url,'https://weibo.com/'),false);
   assert.equal(policy.popupAllowed('about:blank','https://evil.test/'),false);pass('OAuth allowlist and unsafe protocol/domain rejection');
   const bctx=await hub.context(hub.partitionFor('test-owner','weibo'),'weibo');
   let bbody='Fixture';bctx.session.protocol.handle('https',()=>new Response('<body>'+bbody+'</body>',{headers:{'content-type':'text/html'}}));
   const parent=new BrowserWindow({show:false,webPreferences:hub.securePreferences(bctx.partition)});
   const nativeHandler=parent.webContents.setWindowOpenHandler.bind(parent.webContents);
   parent.webContents.setWindowOpenHandler=fn=>nativeHandler(details=>{const result=fn(details);if(result.action==='allow')result.overrideBrowserWindowOptions.show=false;return result});
   hub.attach(parent,bctx);await load(parent,'https://weibo.com/');
   const created=new Promise(resolve=>parent.webContents.once('did-create-window',resolve));
   await parent.webContents.executeJavaScript("window.addEventListener('message',e=>{if(e.origin==='https://open.weixin.qq.com'&&e.data==='callback')window.callbackReceived=true}); window.authChild=window.open('about:blank'); Boolean(window.authChild)");
   const child=await hub.bound(created,5000);assert.equal(child.webContents.session,parent.webContents.session);
   await load(child,'https://open.weixin.qq.com/connect/qrconnect');
   const isolation=await child.webContents.executeJavaScript("({node:typeof require,app:typeof window.tijianDesktop,opener:!!window.opener})");
   assert.deepEqual(isolation,{node:'undefined',app:'undefined',opener:true});
   await child.webContents.executeJavaScript("opener.postMessage('callback','https://weibo.com')");await pause(100);assert.equal(await parent.webContents.executeJavaScript('Boolean(window.callbackReceived)'),true);
   pass('Native about:blank OAuth child shares session and callbacks; no Node or app bridge');
   bbody='';await load(child,'https://open.weixin.qq.com/connect/qrconnect');child.webContents.__platformLoadedAt=Date.now()-10000;assert.equal((await hub.status(bctx)).code,'error');pass('Blank OAuth response gets actionable error, not false logged-in state');
   child.webContents.emit('did-fail-load',{},-105,'fixture','https://open.weixin.qq.com/connect/qrconnect',true);assert.equal((await hub.status(bctx)).code,'error');pass('Loading failure is surfaced');
   await bctx.session.cookies.set({url:'https://weibo.com',name:'logout_fixture',value:'x'});await hub.flushAll();
   await hub.serial(bctx,()=>hub.logout(bctx));assert.ok(parent.isDestroyed()&&child.isDestroyed());assert.equal((await bctx.session.cookies.get({})).length,0);assert.equal((await hub.status(bctx)).code,'signed_out');pass('Logout closes all related windows and clears cookies');
   // IPC boundary and closed-window verification use the same real context with fixture pages.
   let handler;const register=ipcMain.handle;ipcMain.handle=(name,fn)=>{if(name==='platform-account')handler=fn};
   const frame={url:'http://127.0.0.1:12345'},sender={mainFrame:frame},event={sender,senderFrame:frame};
   require('../desktop/accounts.cjs')(()=>({webContents:sender}),()=>frame.url);ipcMain.handle=register;
   const originalFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({user:{id:'test-owner'},objects:[{id:'wechat-account',kind:'channel',platform:'wechat'}]})});
   await assert.rejects(()=>handler({sender:{},senderFrame:frame},{id:'wechat-account',action:'status'}));
   await assert.rejects(()=>handler(event,{id:'not-owned',action:'status'}));
   body='<div class="weui-desktop-account__nickname">test</div>';
   assert.equal((await handler(event,{id:'wechat-account',action:'check'})).code,'authenticated');
   assert.equal(hub.accountWindows(ctx).length,0);pass('IPC caller/ownership checks and closed-window revalidation');
   await Promise.all([handler(event,{id:'wechat-account',action:'open'}),handler(event,{id:'wechat-account',action:'open'})]);assert.equal(hub.accountWindows(ctx).length,1);pass('Concurrent open actions reuse one account window');
   const reader=hub.accountWindows(ctx)[0];delete reader.__accountHome;assert.equal((await handler(event,{id:'wechat-account',action:'check'})).code,'authenticated');assert.equal(hub.accountWindows(ctx)[0],reader);pass('Reader window shares account verification instead of a competing session');
   let discovery;ipcMain.handle=(name,fn)=>{if(name==='discovery-browser')discovery=fn};
   require('../desktop/discovery.cjs')(()=>({webContents:sender}),()=>frame.url);ipcMain.handle=register;
   const owned=[{id:'weibo',kind:'channel',platform:'weibo',title:'Fixture account'},{id:'wechat-account',kind:'channel',platform:'wechat',title:'Wechat'}];
   global.fetch=async(url,options)=>({ok:true,json:async()=>url.endsWith('/browser-target')?{url:JSON.parse(options.body).url}:{user:{id:'test-owner'},objects:owned}});
   await bctx.session.cookies.set({url:'https://weibo.com',name:'reuse_fixture',value:'synthetic'});
   bbody='<a href="https://weibo.com/123/Abcd">Fixture article title</a>';
   const opened=await discovery(event,{action:'open',url:'https://s.weibo.com/weibo?q=test'});
   assert.equal(opened.channel_id,'weibo');
   let browser=hub.accountWindows(bctx)[0];assert.equal(browser.webContents.session,bctx.session);
   assert.equal((await browser.webContents.session.cookies.get({name:'reuse_fixture'})).length,1);
   pass('Actual radar IPC without channel_id automatically reuses existing account session');
   browser.destroy();await discovery(event,{action:'open',url:'https://weibo.com/123/Abcd'});
   browser=hub.accountWindows(bctx)[0];assert.equal(browser.webContents.session,bctx.session);
   assert.equal((await discovery(event,{action:'scan',channel_id:opened.channel_id})).items.length,1);
   pass('Reopened reader retains account session and discovery reads the resolved account window');
   await assert.rejects(()=>discovery(event,{action:'open',url:'https://weibo.com/',channel_id:'wechat-account'}));
   await assert.rejects(()=>discovery(event,{action:'open',url:'https://weibo.com/',channel_id:'foreign'}));
   const routing=require('../desktop/reader-routing.cjs');assert.equal(routing.platformFor('https://weibo.com.evil.test/'),null);
   assert.equal(routing.candidates({objects:[{...owned[0],archived:true}]},'https://weibo.com/').channels.length,0);
   pass('Reader rejects mismatched or unowned accounts and excludes archived accounts and spoofed hosts');
   ipcMain.handle=(name,fn)=>{if(name==='discovery-browser')discovery=fn};
   require('../desktop/discovery.cjs')(()=>({webContents:sender}),()=>frame.url);ipcMain.handle=register;
   owned.push({id:'weibo-two',kind:'channel',platform:'weibo',title:'Second fixture'});
   const second=await hub.context(hub.partitionFor('test-owner','weibo-two'),'weibo');
   second.session.protocol.handle('https',()=>new Response('<body>Second account</body>'));
   const dialog=require('electron').dialog,originalDialog=dialog.showMessageBox;let prompts=0;
   dialog.showMessageBox=async()=>{prompts++;return {response:1}};
   assert.equal((await discovery(event,{action:'open',url:'https://weibo.com/'})).channel_id,'weibo-two');
   assert.equal((await discovery(event,{action:'open',url:'https://s.weibo.com/weibo?q=next'})).channel_id,'weibo-two');
   assert.equal(prompts,1);assert.notEqual(second.session,bctx.session);
   dialog.showMessageBox=originalDialog;pass('Multiple accounts prompt once and reuse selected account without merging sessions');
   let wechat;ipcMain.handle=(name,fn)=>{if(name==='wechat-discovery')wechat=fn};
   require('../desktop/wechat-discovery.cjs')(()=>({webContents:sender}),()=>frame.url);ipcMain.handle=register;
   const login=hub.accountWindows(ctx)[0];await load(login,'https://mp.weixin.qq.com/cgi-bin/home?token=123');
   global.fetch=async url=>({ok:true,json:async()=>url.endsWith('/discovery/account')?{account:{name:'Target',biz:'TARGET_BIZ',article_url:'https://mp.weixin.qq.com/s/fixture'}}:{user:{id:'test-owner'},objects:owned}});
   const originalSessionFetch=ctx.session.fetch.bind(ctx.session);let listRequests=0;
   ctx.session.fetch=async url=>{
    const u=new URL(url);assert.equal(u.hostname,'mp.weixin.qq.com');
    if(u.pathname.endsWith('/searchbiz'))return new Response(JSON.stringify({base_resp:{ret:0},list:[{nickname:'Target',fakeid:'target'}]}));
    assert.equal(u.searchParams.get('fakeid'),'target');listRequests++;
    const begin=Number(u.searchParams.get('begin'));
    return new Response(JSON.stringify({base_resp:{ret:0},publish_page:JSON.stringify({total_count:4,publish_list:begin?[]:Array.from({length:4},(_,i)=>({publish_info:JSON.stringify({appmsgex:[{title:'Own article',link:`https://mp.weixin.qq.com/s?__biz=TARGET_BIZ&mid=${i+1}&idx=1`,create_time:1704067200}]})}))})}));
   };
   const articles=await wechat(event,{action:'start',input:'https://mp.weixin.qq.com/s/fixture',limit:2});
   assert.equal(articles.items.length,2);assert.equal(articles.done,true);assert.equal(articles.error,undefined);assert.equal(articles.channel_id,'wechat-account');assert.equal(listRequests,1);
   assert.ok(!JSON.stringify(articles).includes('token=123'));
   await assert.rejects(()=>wechat({sender:{},senderFrame:frame},{action:'next',id:articles.id}));
   await wechat(event,{action:'cancel',id:articles.id});await assert.rejects(()=>wechat(event,{action:'next',id:articles.id}));
   ctx.session.fetch=originalSessionFetch;pass('Wechat article discovery IPC uses owned session, confirms publisher and scope, hides credentials, supports cancellation');
   await hub.logout(second);await hub.logout(bctx);global.fetch=originalFetch;
   await hub.logout(ctx);await hub.logout(cctx);await hub.flushAll();pass('Explicit logout remains clear after final flush');
  }
  fs.writeFileSync(path.join(dir,phase+'-result.json'),JSON.stringify({passed:true,checks},null,2));
 }catch(e){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,phase+'-result.json'),JSON.stringify({passed:false,checks,error:e.stack},null,2));process.exitCode=1;}
 finally{for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(process.exitCode||0);}
});
