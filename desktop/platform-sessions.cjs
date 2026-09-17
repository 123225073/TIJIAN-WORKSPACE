const {app, BrowserWindow, session, safeStorage} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {trustedURL, popupAllowed, inspectPage, httpsURL, cookieDomainAllowed} = require('./platform-policy.cjs');
const contexts = new Map();
const labels = {authenticated:'已登录', login_required:'需要登录', checking:'正在检查', unknown:'尚未确认', saved:'上次已登录', error:'加载异常', signed_out:'已退出登录'};
const securePreferences = partition => ({partition, contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true});
const partitionFor = (user, id) => 'persist:platform-' + crypto.createHash('sha256').update(user + ':' + id).digest('hex');
const bound = (promise, ms=12000) => { let timer; return Promise.race([promise, new Promise((_, reject) => {timer=setTimeout(()=>reject(Error('timeout')),ms)})]).finally(()=>clearTimeout(timer)); };
function accountWindows(ctx) { return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.session === ctx.session); }
function vaultFile(ctx) { return path.join(app.getPath('userData'), 'platform-sessions', crypto.createHash('sha256').update(ctx.partition).digest('hex') + '.bin'); }
function save(ctx) {
  ctx.saving = (ctx.saving || Promise.resolve()).catch(()=>{}).then(async()=>{
    if(ctx.clearing) return;
    await ctx.session.cookies.flushStore(); ctx.session.flushStorageData();
    if(!safeStorage.isEncryptionAvailable()) { ctx.persistenceError=true; return; }
    const cookies = (await ctx.session.cookies.get({session:true})).filter(c => cookieDomainAllowed(c.domain));
    if(ctx.clearing) return;
    const file=vaultFile(ctx); fs.mkdirSync(path.dirname(file), {recursive:true});
    const content=safeStorage.encryptString(JSON.stringify({version:1, platform:ctx.platform, savedAt:Date.now(), cookies, lastVerified:ctx.lastVerified||null}));
    fs.writeFileSync(file+'.tmp', content); fs.renameSync(file+'.tmp',file); ctx.persistenceError=false;
  }).catch(()=>{ctx.persistenceError=true});
  return ctx.saving;
}
async function restore(ctx) {
  if(!safeStorage.isEncryptionAvailable()) {ctx.persistenceError=true; return;}
  try {
    const data=JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultFile(ctx))));
    if(data.version!==1 || data.platform!==ctx.platform || !Number.isFinite(data.savedAt) || Date.now()-data.savedAt>7*86400000 || data.savedAt>Date.now()+60000) return;
    ctx.lastVerified=Number.isFinite(data.lastVerified)?data.lastVerified:null;
    const existing=await ctx.session.cookies.get({});
    for(const c of Array.isArray(data.cookies)?data.cookies.slice(0,500):[]) {
      if(!c.session || typeof c.domain!=='string' || typeof c.path!=='string') continue;
      const url=(c.secure?'https:':'http:')+'//'+c.domain.replace(/^\./,'')+c.path;
      if(!cookieDomainAllowed(c.domain) || existing.some(e=>e.name===c.name&&e.domain===c.domain&&e.path===c.path)) continue;
      const cookie={url,name:c.name,value:c.value,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite};
      if(!c.hostOnly) cookie.domain=c.domain;
      try { await ctx.session.cookies.set(cookie); } catch {ctx.persistenceError=true;}
    }
  } catch(e) { if(e.code!=='ENOENT') ctx.persistenceError=true; }
}
async function context(partition, platform) {
  let ctx=contexts.get(partition);
  if(!ctx) {
    ctx={partition,platform,session:session.fromPartition(partition),code:'unknown',lastVerified:null,operation:Promise.resolve()}; contexts.set(partition,ctx);
    ctx.ready=restore(ctx).then(()=>{
      ctx.session.setPermissionRequestHandler((wc,p,cb)=>cb(false));
      ctx.session.setPermissionCheckHandler(()=>false);
      ctx.session.cookies.on('changed',()=>{if(!ctx.clearing){clearTimeout(ctx.saveTimer);ctx.saveTimer=setTimeout(()=>void save(ctx),500)}});
    });
  }
  await ctx.ready;
  if(ctx.platform!==platform) throw Error('账号平台已更改，请为新平台新增账号，避免混用登录状态');
  return ctx;
}
function serial(ctx, fn) {const result=ctx.operation.catch(()=>{}).then(fn);ctx.operation=result.catch(()=>{});return result;}
function attach(window, ctx) {
  const wc=window.webContents;
  if(wc.__tijianPlatform) return; wc.__tijianPlatform=true;
  wc.setUserAgent(wc.getUserAgent().replace(/\s(?:Electron|elevator-workbench|梯见工作台)\/\S+/g,''));
  wc.setWindowOpenHandler(({url})=>{
    if(!popupAllowed(url,wc.getURL())) {ctx.notice='授权窗口地址未获支持；可使用平台原生扫码或验证码登录';return {action:'deny'};}
    // Native child preserves opener, OAuth callback and session, including about:blank flows.
    return {action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,width:1000,height:780,webPreferences:securePreferences(ctx.partition)}};
  });
  wc.on('did-create-window',child=>{child.webContents.__platformOAuth=true;attach(child,ctx)});
  const guard=(event,url)=>{if(!(ctx.platform==='reader'?httpsURL(url):trustedURL(url))){event.preventDefault();ctx.notice='页面跳转被阻止：仅支持平台及其 HTTPS 授权页面';}};
  wc.on('will-navigate',guard);wc.on('will-redirect',guard);
  wc.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain){wc.__platformError=null;ctx.notice=null;}});
  wc.on('did-finish-load',()=>{wc.__platformLoadedAt=Date.now();});
  wc.on('did-fail-load',(_e,code,_description,url,isMain)=>{
    if(code!==-3 && (isMain || (()=>{try{return new URL(url).hostname==='open.weixin.qq.com'}catch{return false}})())) wc.__platformError='页面加载失败（'+code+'），请检查网络后重试';
  });
  wc.on('render-process-gone',()=>{wc.__platformError='平台窗口进程已停止，请重新打开';});
  window.on('closed',()=>{if(!ctx.clearing) void save(ctx);});
  const preventDownload=(event,_item,source)=>{if(source===wc)event.preventDefault()};
  ctx.session.on('will-download',preventDownload);
  window.on('closed',()=>ctx.session.removeListener('will-download',preventDownload));
}
async function inspectWindow(window, platform) {
  if(window.isDestroyed() || window.webContents.isLoadingMainFrame()) return 'checking';
  const wc=window.webContents;
  if(wc.__platformError) return 'error';
  const host=new URL(require('./platforms.json').find(p=>p.value===platform)?.url || 'https://invalid.test').hostname.replace(/^www\./,'');
  let frames;
  try {frames=wc.mainFrame.framesInSubtree.filter(f=>{try{const u=new URL(f.url);return u.protocol==='https:'&&(u.hostname===host||u.hostname.endsWith('.'+host)||u.hostname==='open.weixin.qq.com')}catch{return false}}).slice(0,5);} catch {return 'checking';}
  let result='unknown';
  for(const frame of frames) {
    try {
      const code=await bound(frame.executeJavaScript('('+inspectPage.toString()+')('+JSON.stringify(platform)+')'),2500);
      if(code==='blank' && Date.now()-(wc.__platformLoadedAt||Date.now())>8000){wc.__platformBlank=true;return 'error';}
      wc.__platformBlank=false;
      if(code==='login_required') return code;
      if(code==='authenticated') result=code;
    } catch {result='checking';}
  }
  return result;
}
async function status(ctx) {
  const windows=accountWindows(ctx);
  let code=windows.length?'unknown':ctx.code==='signed_out'?'signed_out':ctx.lastVerified?'saved':'unknown';
  if(windows.length) {
    const results=await Promise.all(windows.map(w=>inspectWindow(w,ctx.platform)));
    code=results.includes('authenticated')?'authenticated':results.includes('error')?'error':results.includes('login_required')?'login_required':results.includes('checking')?'checking':'unknown';
  }
  if(code==='authenticated') {ctx.lastVerified=Date.now(); if(ctx.code!==code)void save(ctx);}
  if(code==='login_required') {ctx.lastVerified=null;if(ctx.code!==code)void save(ctx);}
  ctx.code=code;
  const detail=ctx.notice || (code==='error'?windows.map(w=>w.webContents.__platformError||(w.webContents.__platformBlank?'平台或授权页面返回空白，请重新加载或改用平台原生扫码、验证码登录':null)).find(Boolean):null) || ({authenticated:'已识别平台后台；登录状态自动更新',login_required:'请在平台窗口完成登录；手机确认后稍候即可',checking:'等待平台页面加载并检查登录状态',saved:'窗口已关闭，保留上次验证记录；点击检查状态可重新验证',unknown:windows.length?'页面已打开，但尚未找到可靠的登录标识；无需反复扫码':'本机登录资料保留；打开平台或检查状态即可验证',signed_out:'已清除此账号在本机保存的登录资料',error:'授权页面未能加载，请重试或改用平台原生扫码'})[code];
  return {code,status:labels[code],detail,lastVerified:ctx.lastVerified,windowOpen:windows.length>0,persistenceWarning:ctx.persistenceError?'本机加密保存暂不可用，重启后可能需要重新登录':null};
}
async function logout(ctx) {
  ctx.clearing=true;clearTimeout(ctx.saveTimer);
  try {
    for(const w of accountWindows(ctx)) w.destroy();
    await ctx.saving;
    await ctx.session.clearStorageData();await ctx.session.clearAuthCache();await ctx.session.cookies.flushStore();
    fs.rmSync(vaultFile(ctx),{force:true});fs.rmSync(vaultFile(ctx)+'.tmp',{force:true});
    ctx.lastVerified=null;ctx.code='signed_out';ctx.notice=null;ctx.persistenceError=false;
  } finally {ctx.clearing=false;}
  return status(ctx);
}
async function flushAll() {await Promise.all([...contexts.values()].map(async ctx=>{clearTimeout(ctx.saveTimer);await ctx.ready;await ctx.operation;await save(ctx)}));}
module.exports={context,partitionFor,attach,status,logout,serial,accountWindows,securePreferences,bound,flushAll};
