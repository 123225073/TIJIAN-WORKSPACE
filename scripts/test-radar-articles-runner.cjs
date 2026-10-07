const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=process.argv[2],base=process.argv[3];app.setPath('userData',path.join(dir,'browser'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({show:false,width:1530,height:1000,webPreferences:{backgroundThrottling:false,offscreen:true}});
 const opened=[];win.webContents.setWindowOpenHandler(({url})=>{opened.push(url);return {action:'deny'}});
 const js=c=>win.webContents.executeJavaScript(c),wait=async c=>{for(let i=0;i<180;i++){if(await js(`!!(${c})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timeout: '+c+' '+await js('document.body.innerText'))};
 const click=async text=>{const c=`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled)`;await wait(c);await js(c+'.click()')};
 const shot=async name=>{await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(dir,name+'.png'),(await win.webContents.capturePage()).toPNG())};
 const d=await(await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'library@example.test',password:'isolated-password-381',name:'资料与记忆验收'})})).json();
 const h={Authorization:'Bearer '+d.token,'Content-Type':'application/json'};
 const api=async(url,data,method)=>{const r=await fetch(base+'/api'+url,{method:method||(data?'POST':'GET'),headers:h,body:data?JSON.stringify(data):undefined});assert.equal(r.status,200,await r.clone().text());return r.json()};
 await api('/workspace',{});
 const feed=await api('/objects/feed',{title:'喜鹊招标 · 电梯与扶梯',url:'https://xcc.bidizhaobiao.com/search',keywords:'电梯 扶梯',type:'auto',enabled:true});
 const dy=await api('/objects/feed',{title:'抖音博主 · 待打开主页',url:'https://v.douyin.com/test/',keywords:'',type:'auto',enabled:true});
 await win.loadURL(base);await js(`sessionStorage.setItem('tijian-session',${JSON.stringify(d.token)})`);await win.loadURL(base+'/?radar=1#radar');
 await wait("document.querySelector('.radar-page')");
 assert.equal(await js("document.querySelectorAll('a[href=\"#settings/radar\"]').length"),1);
 assert.equal(await js("document.querySelector('[aria-label=发布时间]').value"),'');
 await click('获取全部资讯');await wait("document.querySelectorAll('.news-row').length===2");
 assert.ok(await js("document.body.innerText.includes('10分钟前更新（网站标注）')"));await shot('01-radar-results');
 await js(`(()=>{const el=document.querySelector('[aria-label=筛选信源]');el.value=${JSON.stringify(feed.id)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await click('获取该信源资讯');await wait("document.querySelector('.scoped-progress')?.innerText.includes('新增 0 条')");
 const state=await api('/state');assert.equal(state.objects.filter(x=>x.kind==='news').length,2);assert.equal(state.objects.find(x=>x.id===dy.id).last_result.status,'needs_browser');
 const firstNews=state.objects.filter(x=>x.kind==='news')[0];const article='https://www.xqzhaobiao.com/xqAdmin/#/tender/index?id='+firstNews.external_id+'&type=bid&pattern=10';
 assert.equal(await js("document.querySelector('.news-title').href"),article);
 await js("document.querySelector('.news-title').click()");await wait("!document.querySelector('[role=dialog]')");
 for(let i=0;i<20&&!opened.length;i++)await new Promise(r=>setTimeout(r,50));assert.equal(opened[0],article);
 await js("document.querySelector('.news-actions button').click()");await wait("document.querySelector('[role=dialog]')");
 assert.equal(await js("document.querySelector('.drawer-actions a').href"),article);
 assert.ok(await js("document.querySelector('[role=dialog]').innerText.includes('完整公告可能需要')"));assert.ok(await js("document.querySelector('[role=dialog]').innerText.includes('公开搜索线索')"));await shot('02-public-lead');await js("document.querySelector('[aria-label=关闭阅读]').click()");
 // Search keeps the direct target; legacy and unknown links retain honest labels.
 await js("(()=>{const el=document.querySelector('[aria-label=搜索当前雷达列表]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'维保');el.dispatchEvent(new Event('input',{bubbles:true}))})()");
 await wait("document.querySelectorAll('.news-row').length===1");assert.equal(await js("document.querySelector('.news-title').href"),'https://www.xqzhaobiao.com/xqAdmin/#/tender/index?id=101&type=bid&pattern=10');
 const seeded=require('node:child_process').spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',"import json,sys;from backend import store as s;s.init();d=json.load(sys.stdin);s.put(d['owner'],'news',{'title':'维保未提供明细','url':'https://example.com/search','external_id':'123','link_scope':'source_search','feed_id':d['feed'],'body':'未提供公告链接','status':'summary'})"],{windowsHide:true,env:{...process.env,TIJIAN_DATA:dir},input:JSON.stringify({owner:d.user.id,feed:feed.id}),encoding:'utf8'});assert.equal(seeded.status,0,seeded.stderr);
 await win.reload();await wait("document.querySelectorAll('.news-row').length===3");
 await js("Array.from(document.querySelectorAll('.news-row')).find(x=>x.innerText.includes('维保未提供明细')).querySelector('.news-actions button').click()");await wait("document.querySelector('[role=dialog]')");
 assert.equal(await js("document.querySelector('.drawer-actions a').innerText.trim()"),'打开来源搜索页');assert.equal(await js("document.querySelector('.drawer-actions a').href"),'https://example.com/search');
 await js("document.querySelector('[aria-label=关闭阅读]').click()");
 // Rejected article URLs must not reappear through the source-search fallback.
 const badURLs=['https://[invalid','https://test-user:test-pass@example.com/search'];
 const badSeed=require('node:child_process').spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',"import json,sys;from backend import store as s;s.init();d=json.load(sys.stdin);[s.put(d['owner'],'news',{'title':'无效导航'+str(i),'url':url,'external_id':'123','link_scope':'source_search','feed_id':d['feed'],'body':'无效来源','status':'summary'}) for i,url in enumerate(d['urls'])]"],{windowsHide:true,env:{...process.env,TIJIAN_DATA:dir},input:JSON.stringify({owner:d.user.id,feed:feed.id,urls:badURLs}),encoding:'utf8'});assert.equal(badSeed.status,0,badSeed.stderr);
 await win.reload();await wait("document.querySelectorAll('.news-row').length===5");
 for(let i=0;i<badURLs.length;i++){
  assert.equal(await js(`Array.from(document.querySelectorAll('.news-row')).find(x=>x.innerText.includes('无效导航${i}')).querySelectorAll('a').length`),0);
  await js(`Array.from(document.querySelectorAll('.news-row')).find(x=>x.innerText.includes('无效导航${i}')).querySelector('.news-actions button').click()`);await wait("document.querySelector('[role=dialog]')");
  assert.equal(await js("document.querySelectorAll('.drawer-actions a').length"),0);await js("document.querySelector('[aria-label=关闭阅读]').click()");
 }
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['single settings entry','all dates default','public keyword search','unknown dates visible','single source refresh','dedupe','blocked source state','public lead reader','article title opens exact docId','search preserves article link','summary contains original link','unknown source fallback','invalid source links rejected']}));
 }catch(e){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.stack}));process.exitCode=1;}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)}});
