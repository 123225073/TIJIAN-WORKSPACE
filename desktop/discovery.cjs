// Product feature: isolated browser windows, no preload, no application token or Node access.
const {BrowserWindow,ipcMain,dialog}=require('electron');
const crypto=require('node:crypto');
const catalogue=require('./platforms.json');
const hub=require('./platform-sessions.cjs');
const routing=require('./reader-routing.cjs');
const allowed=['mp.weixin.qq.com','weixin.sogou.com','xiaohongshu.com','xhslink.com','weibo.com','weibo.cn','zhihu.com','toutiao.com','douyin.com','bilibili.com','kuaishou.com','github.com','x.com','twitter.com','goofish.com','channels.weixin.qq.com'];
const platformURL=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{return false}};
// Read only rendered links. No request signatures, hidden APIs or arbitrary supplied scripts.
const scanScript=`(()=>Array.from(document.querySelectorAll('a[href]')).map(a=>({url:a.href,title:(a.innerText||a.getAttribute('title')||a.querySelector('img')?.alt||'').trim().slice(0,500)})).filter(x=>x.title.length>3))()`;
function entries(rows){const seen=new Set();return rows.filter(x=>{if(!platformURL(x.url)||seen.has(x.url))return false;const u=new URL(x.url);const article=/^\/s(?:\/|$)|^\/link$|\/explore\/[a-z0-9]+|\/discovery\/item\/|\/question\/\d+|\/p\/\d+|\/article\/\d+|\/video\/|\/status\/\d+|\/short-video\/|^\/item(?:$|\/)/i.test(u.pathname)||(u.hostname.endsWith('weibo.com')&&/^\/\d+\/[a-zA-Z0-9]+$/.test(u.pathname))||(u.hostname==='github.com'&&/^\/[^/]+\/[^/]+$/.test(u.pathname)&&!['search','login','settings','orgs','users'].includes(u.pathname.split('/')[1]));if(!article)return false;seen.add(x.url);return true}).slice(0,100)}
module.exports=(getWindow,getBase)=>{
 const windows=new Map(),running=new Set(),preferred=new Map();
 ipcMain.handle('discovery-browser',async(event,data)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==getBase())throw Error('无效窗口');
  const res=await fetch(getBase()+'/api/state',{headers:{Authorization:'Bearer '+data.token}});if(!res.ok)throw Error('请先登录工作台');
  const state=await res.json();let partition,platform='reader',targetURL;
  if(data.action==='open'){
   const response=await fetch(getBase()+'/api/discovery/browser-target',{method:'POST',headers:{Authorization:'Bearer '+data.token,'Content-Type':'application/json'},body:JSON.stringify({url:data.url})});
   if(!response.ok)throw Error('网址无效或不允许访问');
   targetURL=(await response.json()).url;if(!targetURL.startsWith('https://'))throw Error('内置网页仅接受HTTPS地址');
   const choices=routing.candidates(state,targetURL,data.channel_id),preferenceKey=state.user.id+':'+choices.platform;
   let chosen=choices.channels.find(x=>x.id===preferred.get(preferenceKey));
   if(choices.channels.length===1)chosen=choices.channels[0];
   if(!chosen&&choices.channels.length>1){
    const result=await dialog.showMessageBox(getWindow(),{type:'question',title:'选择用于阅读的平台账号',message:'使用哪个账号打开此平台网页？',detail:'复用该账号已有的登录资料。本次启动期间会记住选择。',buttons:[...choices.channels.map(x=>x.title),'取消'],cancelId:choices.channels.length,noLink:true});
    if(result.response>=choices.channels.length)throw Error('已取消打开网页');chosen=choices.channels[result.response];
   }
   data={...data,channel_id:chosen?.id||''};if(chosen)preferred.set(preferenceKey,chosen.id);
  }
  if(data.channel_id){const channel=state.objects.find(x=>x.id===data.channel_id&&x.kind==='channel'&&!x.archived);if(!channel||!catalogue.some(p=>p.value===channel.platform))throw Error('平台账号不存在');partition=hub.partitionFor(state.user.id,channel.id);platform=channel.platform;}
  else partition='persist:reader-'+crypto.createHash('sha256').update(state.user.id).digest('hex');
  const key=state.user.id+':'+(data.channel_id||'public');let window=windows.get(key);
  const ctx=await hub.context(partition,platform);
  if(data.action==='open'){
   return hub.serial(ctx,async()=>{
   window=windows.get(key);
   const url=targetURL;
   if(!window||window.isDestroyed()){
    window=new BrowserWindow({show:false,width:1120,height:840,title:'梯见 · 网页阅读与发现',autoHideMenuBar:true,webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    windows.set(key,window);window.on('closed',()=>windows.delete(key));
    hub.attach(window,ctx);
   }
   try{await hub.bound(window.loadURL(url),15000)}catch{throw Error('网页加载失败或超时，请检查网络后重试')}
   window.show();window.focus();return {channel_id:data.channel_id||'',status:data.channel_id?'已复用平台账号“'+state.objects.find(x=>x.id===data.channel_id).title+'”的登录资料。':'网页已打开；尚未添加此平台的运营账号，使用独立浏览窗口。'};
   });
  }
  if(!window||window.isDestroyed())throw Error('请先打开平台窗口');
  if(!platformURL(window.webContents.getURL()))throw Error('当前网站不支持平台清单读取，可使用自动识别网址');
  if(data.action==='read'){
   const page=await window.webContents.executeJavaScript(`(()=>{const el=document.querySelector('#js_content,article,.note-content,.RichContent-inner,.detail-desc');return {url:location.href,title:document.querySelector('#activity-name,h1,.note-title')?.innerText||document.title,body:el?.innerText?.slice(0,100000)||''}})()`);
   if(!platformURL(page.url)||page.body.trim().length<100||/验证|验证码|环境异常/.test(page.title))throw Error('当前页没有可读取的正文，请先打开具体文章或笔记');
   return page;
  }
  if(data.action!=='scan')throw Error('无效操作');
  if(running.has(key))throw Error('正在读取，请稍候');running.add(key);
  try{
   let all=[];
   for(let i=0;i<(data.more?5:1);i++){
    if(window.isDestroyed())throw Error('平台窗口已关闭');
    if(!platformURL(window.webContents.getURL()))throw Error('页面已跳转，请重新打开平台');
    all.push(...await window.webContents.executeJavaScript(scanScript));
    if(data.more){await window.webContents.executeJavaScript('window.scrollBy(0,Math.max(600,window.innerHeight))');await new Promise(r=>setTimeout(r,900));}
   }
   return {items:entries(all),note:'已读取平台页面中加载的作品链接。请核对作者；未加载内容、分页和受限内容不计入清单。'};
  }finally{running.delete(key)}
 });
};
module.exports.entries=entries;
