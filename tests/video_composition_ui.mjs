// Full UI and real local composition API against isolated data; no paid calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const root=process.cwd(),dist=path.resolve('dist'),python=path.resolve('.runtime/venv/Scripts/python.exe');
const directory=path.resolve('.runtime','article-editing-ui-video-composition-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
const service=spawn(python,['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';service.stderr.on('data',x=>logs+=x);service.stdout.on('data',x=>logs+=x);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.statusCode=502;res.end()});req.pipe(upstream);return}try{const name=u.pathname.startsWith('/assets/')||u.pathname.startsWith('/visuals/')?decodeURIComponent(u.pathname.slice(1)):'index.html';const file=path.resolve(dist,name);assert(file.startsWith(dist+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ui.address().port,backend='http://127.0.0.1:'+port;
let token='',browser,page;const outside=[],forbidden=[],errors=[],result={directory,paidCalls:0,productionDataTouched:false};
const api=async(url,data)=>{const r=await fetch(backend+'/api'+url,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});assert(r.ok,url+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
try{
 for(let i=0;i<160;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}if(i===159)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
 const auth=await api('/auth/register',{email:'video-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'隔离视频验收'});token=auth.token;
 const flowMode=process.argv.includes('--flow');
 const flow=flowMode?await api('/studio/flow',{new:true,version:0,brief:'隔离数字人测试',stage:'2',tool_path:'avatar/text',creation_channel:'avatar'}):null;
 const draft=await api(flow?'/studio/flows/'+flow.id+'/drafts':'/studio/drafts',{tool:'text_avatar',title:'隔离数字人视频',input:{text:'隔离测试口播'},options:{}});
 const seed=spawnSync(python,['-B','-X','utf8','tests/video_composition_ui_seed.py',auth.user.id,draft.id],{cwd:root,env,encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);const seeded=JSON.parse(seed.stdout.trim());
 const originalHash=createHash('sha256').update(fs.readFileSync(seeded.file)).digest('hex');
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){outside.push(u.origin);return route.abort()}if(route.request().method()==='POST'&&/\/(generate|optimize|send|publish|sync)(\/|$)/.test(u.pathname)){forbidden.push(u.pathname);return route.abort()}return route.continue()});
 const returnTo=flow?'studio/flow?work='+flow.id+'&step=2':'';
 await page.addInitScript(t=>sessionStorage.setItem('tijian-session',t),token);await page.goto(base+'/#studio/avatar/text?draft='+draft.id+(flow?'&return='+encodeURIComponent(returnTo):''));
 const remind=page.getByRole('button',{name:'稍后再做'});if(await remind.isVisible().catch(()=>false))await remind.click();
 const output=page.locator('.st-output').filter({hasText:'隔离合成测试视频'}).first();await output.waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();
 await output.getByRole('button',{name:/放大查看视频/}).click();await page.locator('dialog video').waitFor({state:'visible'});await page.getByRole('button',{name:'关闭弹窗'}).click();
 const [rawDownload]=await Promise.all([page.waitForEvent('download'),output.getByRole('button',{name:'下载',exact:true}).click()]);await rawDownload.saveAs(path.join(directory,'original-download'));assert(fs.statSync(path.join(directory,'original-download')).size>1000);result.originalDownloadName=rawDownload.suggestedFilename();
 const toggle=output.getByRole('button',{name:/模板与字幕合成/});assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();
 for(const name of ['简洁白','行业蓝','暖金']){const button=output.getByRole('button',{name:new RegExp(name)});await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true')}
 await output.getByRole('button',{name:/行业蓝/}).click();result.threeTemplates=true;
 await output.locator('.vc-field input[type=text], .vc-field input:not([type])').first().fill('电梯报价先看条件');await output.getByText('已有 SRT 字幕（可选）').click();await output.locator('.vc-field textarea').fill('1\n00:00:00,300 --> 00:00:01,500\n电梯报价需要先看条件\n\n2\n00:00:01,500 --> 00:00:02,900\n请核对现场实际情况');
 const duration=output.getByLabel('标题显示时长');assert.equal(await duration.inputValue(),'3');
 const preview=output.locator('.vc-stage video');await preview.waitFor();await preview.evaluate(v=>v.readyState>=1?Promise.resolve():new Promise(resolve=>v.addEventListener('loadedmetadata',resolve,{once:true})));await preview.evaluate(v=>{v.currentTime=4;v.dispatchEvent(new Event('seeked',{bubbles:true}))});
 await output.locator('.vc-title').waitFor({state:'hidden'});await duration.selectOption('5');await output.locator('.vc-title').waitFor({state:'visible'});
 await duration.selectOption('3');await preview.evaluate(v=>{v.currentTime=0;v.dispatchEvent(new Event('seeked',{bubbles:true}))});await output.locator('.vc-title').waitFor({state:'visible'});result.titleDurationPreview=true;
 await page.screenshot({path:path.join(directory,'before.png'),fullPage:true});await output.getByRole('button',{name:'合成并保存新视频'}).click();await output.getByText('合成完成',{exact:true}).waitFor({timeout:120000});
 const composed=output.locator('.vc-result');await composed.locator('video').waitFor({state:'visible'});await composed.getByRole('button',{name:/放大查看视频/}).click();await page.locator('dialog video').waitFor({state:'visible'});await page.getByRole('button',{name:'关闭弹窗'}).click();
 const [videoDownload]=await Promise.all([page.waitForEvent('download'),composed.getByRole('button',{name:'下载成片'}).click()]);await videoDownload.saveAs(path.join(directory,'composition-download'));assert(fs.statSync(path.join(directory,'composition-download')).size>1000);result.compositionDownloadName=videoDownload.suggestedFilename();
 assert.equal(createHash('sha256').update(fs.readFileSync(seeded.file)).digest('hex'),originalHash);await page.screenshot({path:path.join(directory,'after.png'),fullPage:true});
 const assets=(await api('/studio/assets')).items;const composedAsset=assets.find(a=>a.source_asset_id===seeded.asset_id);assert(composedAsset,'成片应持久化到素材库');result.assetId=composedAsset.id;result.sourceHashUnchanged=true;result.expandBoth=true;result.downloadBoth=true;
 if(flow){assert.equal(composedAsset.flow_id,flow.id,'成片应继承当前作品');await composed.getByRole('button',{name:'使用此成片并返回'}).click();await page.waitForFunction(id=>location.hash.includes('studio/flow')&&location.hash.includes(id),flow.id);const current=await api('/studio/flow?work_id='+flow.id);assert.equal(current.video_id,composedAsset.id,'一站式作品应引用该成片');result.flowReturned=true;result.flowVideoId=current.video_id;await page.screenshot({path:path.join(directory,'flow-return.png'),fullPage:true})}
 assert.deepEqual(outside,[]);assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);result.ok=true;
}catch(e){result.error=e.stack;await page?.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});result.body=await page?.locator('body').innerText().catch(()=>'');process.exitCode=1}
finally{result.outside=outside;result.forbidden=forbidden;result.errors=errors;fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(result,null,2));await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();console.log(JSON.stringify(result))}
