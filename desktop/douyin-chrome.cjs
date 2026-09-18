// Dedicated, persistent Chrome/Edge session. Public API calls only; no screen or input automation.
const {app}=require('electron'),{chromium}=require('playwright-core');
const fs=require('fs'),path=require('path'),net=require('net'),crypto=require('crypto'),{spawn}=require('child_process');
const mediaURL=require('./douyin-data.cjs').mediaURL,children=new Set();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function browserPath(){return [path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')].find(x=>fs.existsSync(x))}
function stop(child){if(!child||child.exitCode!==null)return;spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
app.on('will-quit',()=>{for(const child of children)stop(child)});
async function open(pump,owner,visible=false,url='about:blank'){
 if(pump.window&&!pump.window.isDestroyed())return pump.window;
 if(pump.window)await pump.window.destroy();
 const executable=browserPath();if(!executable)throw Error('抖音采集需要本机 Chrome 或 Edge，请安装后重试');
 const folder=path.join(app.getPath('userData'),'douyin-browser',crypto.createHash('sha256').update(owner).digest('hex'));fs.mkdirSync(folder,{recursive:true});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(executable,[...(!visible?['--start-minimized']:[]),'--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+folder,url],{windowsHide:!visible,stdio:'ignore'});children.add(child);child.once('exit',()=>children.delete(child));
 let browser;try{for(let i=0;i<40;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:800,noDefaults:true});break}catch{}await pause(200)}if(!browser)throw Error('抖音浏览器未能启动，请检查 Chrome 或 Edge 是否可用')}catch(e){stop(child);throw e}
 const context=browser.contexts()[0],page=context.pages()[0]||await context.newPage();let closed=false,lastError=null;
 page.on('requestfailed',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())lastError='page failed'});
 page.on('response',r=>{if(r.request().isNavigationRequest()&&r.request().frame()===page.mainFrame()&&r.status()<400)lastError=null});
 // New windows cannot call local APIs or read files. They stay inside this dedicated profile.
 context.on('page',p=>{if(p!==page)void p.close()});
 try{await page.waitForLoadState('domcontentloaded',{timeout:25000});await pause(2500)}catch{lastError='page failed'}
 const wrapper={
  isDestroyed:()=>closed||page.isClosed()||!browser.isConnected(),
  destroy:async()=>{if(closed)return;closed=true;const timer=setTimeout(()=>stop(child),2000);try{await browser.close()}catch{}finally{clearTimeout(timer);stop(child)}},
  show:async()=>{const cdp=await context.newCDPSession(page);try{const info=await cdp.send('Browser.getWindowForTarget');await cdp.send('Browser.setWindowBounds',{windowId:info.windowId,bounds:{windowState:'normal'}})}finally{await cdp.detach()}pump.headed=true;await page.bringToFront()},
  focus:async()=>{if(pump.headed&&!page.isClosed())await page.bringToFront()},
  loadURL:async target=>{for(let attempt=0;attempt<2;attempt++){try{await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});lastError=null;return}catch(e){if(attempt||!String(e.message).includes('ERR_CONNECTION'))throw e;await pause(1500)}}},
  webContents:{getURL:()=>page.url(),get __platformError(){return lastError},executeJavaScript:async code=>{try{return await page.evaluate(code)}catch(e){const kind=String(e.message).includes('context was destroyed')?'页面仍在跳转':String(e.message).includes('closed')?'窗口连接关闭':'页面执行失败';throw Error('抖音'+kind+'，请重新获取作品')}}}
 };
 pump.window=wrapper;pump.headed=visible;
 pump.ctx={session:{fetch:async(url,options={})=>{
  if(!mediaURL(url))throw Error('媒体地址不在支持范围内');options.signal?.throwIfAborted();
  const cdp=await context.newCDPSession(page);let stream;
  const cleanup=async()=>{if(stream)await cdp.send('IO.close',{handle:stream}).catch(()=>{});await cdp.detach().catch(()=>{})};
  const onAbort=()=>void cleanup();options.signal?.addEventListener('abort',onAbort,{once:true});
  try{
   const tree=await cdp.send('Page.getFrameTree');const result=await cdp.send('Network.loadNetworkResource',{frameId:tree.frameTree.frame.id,url,options:{disableCache:false,includeCredentials:true}});options.signal?.throwIfAborted();
   const r=result.resource;stream=r.stream;if(!r.success||!stream)throw Error('媒体连接失败（'+(r.netErrorName||'HTTP '+r.httpStatusCode)+'）');
   const body=new ReadableStream({pull:async controller=>{try{options.signal?.throwIfAborted();const part=await cdp.send('IO.read',{handle:stream,size:262144});if(part.data)controller.enqueue(Buffer.from(part.data,part.base64Encoded?'base64':'utf8'));if(part.eof){controller.close();options.signal?.removeEventListener('abort',onAbort);await cleanup()}}catch(e){controller.error(e);await cleanup()}},cancel:cleanup});
   return new Response(body,{status:r.httpStatusCode||200,headers:r.headers||{}});
  }catch(e){options.signal?.removeEventListener('abort',onAbort);await cleanup();throw e}
 }}};
 return wrapper;
}
module.exports={open};
