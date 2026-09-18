// Deterministic fake platform responses, isolated to this test's browser partition.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const dir=process.argv[2],base=process.argv[3];app.setPath('userData',path.join(dir,'browser'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let win;try{
 require('electron').ipcMain.handle('remember-login',()=>null);
 const d=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'douyin@example.test',password:'isolated-password-381',name:'抖音流程验收'})})).json();
 const headers={Authorization:'Bearer '+d.token,'Content-Type':'application/json'};
 const api=async(url,data,method)=>{const r=await fetch(base+'/api'+url,{method:method||(data?'POST':'GET'),headers,body:data?JSON.stringify(data):undefined});assert.equal(r.status,200,await r.clone().text());return r.json()};
 await api('/workspace',{});const sec='MS4wLjABAAAA_fixture_publisher';const account=await api('/objects/benchmark',{title:'电梯行业信息 · 测试数据',platform:'抖音',url:'https://www.douyin.com/user/'+sec});
 const hub=require('../desktop/platform-sessions.cjs');const partition='persist:douyin-reader-'+crypto.createHash('sha256').update(d.user.id).digest('hex');const ctx=await hub.context(partition,'reader');
 let extra=false,failedMedia=false;const stamp=Math.floor(Date.now()/1000)-300;
 const row=(id,images=false)=>({aweme_id:id,author:{sec_uid:sec,nickname:'测试发布者'},create_time:id==='333333'?Math.floor(Date.now()/1000)+1:stamp,desc:images?'电梯验收图文（测试）':'电梯维护案例（测试）',statistics:{digg_count:12,comment_count:2},video:{play_addr:{url_list:['https://media.douyinvod.com/'+id+'.mp4']}},...(images?{images:[{url_list:['https://media.douyinpic.com/a.jpg']}]}:{})});
 ctx.session.protocol.handle('https',request=>{
  const u=new URL(request.url);if(u.hostname==='media.douyinvod.com'||u.hostname==='media.douyinpic.com'){
   if(failedMedia)return new Response('unavailable',{status:403});const bytes=Buffer.alloc(1024);if(u.pathname.endsWith('.mp4'))bytes.write('ftyp',4);else{bytes[0]=255;bytes[1]=216}return new Response(bytes,{headers:{'content-type':u.pathname.endsWith('.mp4')?'video/mp4':'image/jpeg'}});
  }
  const data=[row('111111'),row('222222',true),...(extra?[row('333333')]:[])];
  if(u.pathname.includes('/aweme/'))return new Response(JSON.stringify(u.pathname.includes('/detail/')?{aweme_detail:data.find(x=>x.aweme_id===u.searchParams.get('aweme_id'))}:{aweme_list:[...data,{...row('999999'),author:{sec_uid:'wrong',nickname:'推荐账号'}}],has_more:0}),{headers:{'content-type':'application/json'}});
  const id=u.pathname.split('/').pop();return new Response(`<html><body><h1>平台响应测试页</h1><script>fetch('/aweme/v1/web/aweme/${u.pathname.startsWith('/user/')?'post/':'detail/?aweme_id='+id}').then(r=>r.json()).then(x=>document.body.append('loaded'))</script></body></html>`,{headers:{'content-type':'text/html'}});
 });
 win=new BrowserWindow({show:false,width:1530,height:1000,webPreferences:{preload:path.resolve('desktop/preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 require('../desktop/douyin.cjs')(()=>win,()=>base,{testElectron:true});
 const js=c=>win.webContents.executeJavaScript(c),wait=async c=>{for(let i=0;i<250;i++){if(await js(`!!(${c})`))return;await new Promise(r=>setTimeout(r,120))}throw Error('Timeout '+c+' '+await js('document.body.innerText'))};
 const click=async text=>{const c=`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled)`;await wait(c);await js(c+'.click()')};
 const shot=async name=>{await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.join(dir,name+'.png'),(await win.webContents.capturePage()).toPNG())};
 await win.loadURL(base);await js(`sessionStorage.setItem('tijian-session',${JSON.stringify(d.token)})`);await win.loadURL(base+'/?douyin-test=1#benchmark/'+account.id);
 await wait("document.querySelector('.douyin-library')");await click('获取作品');await wait("document.querySelectorAll('.douyin-work-list article').length===2");
 assert.ok(!(await js('document.body.innerText')).includes('推荐账号'));await shot('01-works');
 // Reconnect loses ephemeral media URLs; detail refresh must recover downloads.
 await js(`window.tijianDesktop.douyin({action:'disconnect',token:${JSON.stringify(d.token)}})`);
 await js(`window.tijianDesktop.douyin({action:'connect',token:${JSON.stringify(d.token)}})`);
 await js("document.querySelector('.douyin-selection input').click()");await click('下载媒体（最多30条）');await wait("Array.from(document.querySelectorAll('.douyin-download-state')).filter(x=>x.innerText.includes('已下载')).length===2");
 const status=await api('/douyin/'+account.id+'/status');assert.equal(status.works.length,2);assert.ok(status.works.every(x=>x.files.length===1&&x.files[0].size===1024));
 const file=await fetch(base+'/api/douyin/works/'+status.works[0].id+'/file/0',{headers});assert.equal((await file.arrayBuffer()).byteLength,1024);
 await click('保存所选文案');await wait("document.body.innerText.includes('发布文案已存入原始资料')");assert.equal((await api('/state')).objects.filter(x=>x.kind==='source'&&x.douyin_work_id).length,2);await shot('02-downloaded');
 await js("Array.from(document.querySelectorAll('.work-tabs button')).find(x=>x.textContent.includes('订阅与通知')).click()");await click('开启订阅');
 for(let i=0;i<150;i++){if((await api('/douyin/'+account.id+'/status')).subscription?.baseline_at)break;await new Promise(r=>setTimeout(r,200))}
 assert.equal((await api('/douyin/'+account.id+'/status')).notices.length,0);extra=true;
 await api('/douyin/'+account.id+'/subscription',{enabled:true,interval_minutes:360},'PUT');await wait("document.querySelectorAll('.douyin-notice').length===1");await shot('03-subscription-notice');await click('标为已读');await wait("document.querySelectorAll('.douyin-notice').length===0");await click('暂停订阅');await wait("document.querySelector('.douyin-sub-status strong')?.textContent==='订阅已暂停'");
 assert.equal((await api('/douyin/'+account.id+'/status')).subscription.enabled,false);
 // A real native download error must remain a failed job, not a successful empty file.
 failedMedia=true;const job=await api('/douyin/'+account.id+'/download',{ids:[status.works[0].id]});let result;for(let i=0;i<160;i++){result=(await api('/state')).objects.find(x=>x.id===job.id);if(result.finished_at)break;await new Promise(r=>setTimeout(r,200))}assert.equal(result.status,'failed');assert.equal(result.result.failed,1);
 await js(`location.hash='settings/benchmark/${account.id}/saved'`);await wait("document.body.innerText.includes('编辑账号')");await click('编辑账号资料');await wait("document.querySelector('form')");assert.ok(!(await js("document.querySelector('form').innerText")).includes('RSS'));await shot('04-account-settings');
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,fixture_platform:true,checks:['upstream page API transport','author identity excludes recommendation','video and image download after reconnect/detail refresh','file bytes persisted and authenticated export','publish text save','subscription baseline','new notice and read','pause subscription','media failure visible','Douyin settings without RSS']}));
 }catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.stack}));process.exitCode=1}finally{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy();app.exit(process.exitCode||0)}});
