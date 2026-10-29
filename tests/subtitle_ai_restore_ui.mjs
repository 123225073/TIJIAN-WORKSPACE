// Real local Whisper + offline fake text model, against an isolated database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
const root=process.cwd(),dist=path.resolve('dist'),python=path.resolve('.runtime/venv/Scripts/python.exe');
const directory=path.resolve('.runtime','article-editing-ui-subtitle-ai-'+Date.now());fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'model-mode.txt'),'normal');
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_ASR_DIR:path.resolve('.runtime/asr-tools'),TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
const service=spawn(python,['-B','-X','utf8','tests/subtitle_ai_ui_fixture.py'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';service.stderr.on('data',x=>logs+=x);service.stdout.on('data',x=>logs+=x);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.statusCode=502;res.end()});req.pipe(upstream);return}try{const name=u.pathname.startsWith('/assets/')||u.pathname.startsWith('/visuals/')?decodeURIComponent(u.pathname.slice(1)):'index.html';const file=path.resolve(dist,name);assert(file.startsWith(dist+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ui.address().port,backend='http://127.0.0.1:'+port;
let token='',browser,page;const outside=[],errors=[],result={directory,paidCalls:0,productionDataTouched:false};
const api=async(url,data)=>{const r=await fetch(backend+'/api'+url,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});assert(r.ok,url+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
try{
 for(let i=0;i<180;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}if(i===179)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
 const auth=await api('/auth/register',{email:'sub-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'隔离字幕验收'});token=auth.token;
 const draft=await api('/studio/drafts',{tool:'compose',title:'隔离成片',input:{scenes:[]},options:{}});
 const source=process.argv[2];assert(source&&fs.existsSync(source),'需要参考视频路径');const seed=spawnSync(python,['-B','-X','utf8','tests/video_composition_ui_seed.py',auth.user.id,draft.id,source],{cwd:root,env,encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);const seeded=JSON.parse(seed.stdout.trim());await api('/test/subtitle-snapshot',{asset_id:seeded.asset_id});const seed2=spawnSync(python,['-B','-X','utf8','tests/video_composition_ui_seed.py',auth.user.id,draft.id,source],{cwd:root,env,encoding:'utf8'});assert.equal(seed2.status,0,seed2.stderr);const seeded2=JSON.parse(seed2.stdout.trim());
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){outside.push(u.origin);return route.abort()}return route.continue()});
 await page.addInitScript(t=>sessionStorage.setItem('tijian-session',t),token);await page.goto(base+'/#studio/compose?draft='+draft.id);const remind=page.getByRole('button',{name:'稍后再做'});await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();await page.getByRole('button',{name:'＋ 添加画面'}).click();await page.getByLabel('画面素材').selectOption(seeded.asset_id);

 const old='1\n00:00:00,000 --> 00:00:02,000\n我原来编辑的字幕\n';
 await page.getByLabel('导入 SRT').setInputFiles({name:'old.srt',mimeType:'text/plain',buffer:Buffer.from(old)});
 await page.waitForTimeout(1800);assert.equal((await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt,old);
 fs.writeFileSync(path.join(directory,'model-mode.txt'),'number');
 const submit=page.waitForResponse(r=>r.url().includes('/transcribe-local')&&r.request().method()==='POST');await page.getByRole('button',{name:'重新识别并校对'}).click();await submit;
 await page.reload();await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();await page.getByText('AI 校对改变了数字',{exact:false}).waitFor({timeout:300000});
 assert.equal((await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt,old);await page.getByText('查看待确认字幕').click();assert((await page.locator('.lc-subtitle-text').innerText()).includes('123'));
 await page.getByRole('button',{name:'保留当前字幕'}).click();assert.equal((await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt,old);result.keepCurrent=true;
 await page.reload();await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();await page.getByRole('button',{name:'使用原始识别稿'}).waitFor();await page.getByRole('button',{name:'使用原始识别稿'}).click();await page.waitForTimeout(1800);const raw=(await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt;assert.notEqual(raw,old);assert(!raw.includes('123'));result.useRaw=true;
 await page.reload();await page.locator('.lc-workbench').waitFor();if(await remind.isVisible().catch(()=>false))await remind.click();await page.getByRole('button',{name:'使用待确认字幕'}).waitFor();await page.getByRole('button',{name:'使用待确认字幕'}).click();await page.waitForTimeout(1800);const candidate=(await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt;assert(candidate.includes('123'));result.useCandidate=true;
 fs.writeFileSync(path.join(directory,'model-mode.txt'),'normal');const submit2=page.waitForResponse(r=>r.url().includes('/transcribe-local')&&r.request().method()==='POST');await page.getByRole('button',{name:'重新识别并校对'}).click();const activeJob=await (await submit2).json();await page.getByLabel('画面素材').first().selectOption(seeded2.asset_id);await page.getByText('已更换主画面，原字幕任务仍在后台运行',{exact:false}).waitFor({timeout:30000});let ended;for(let n=0;n<180;n++){ended=await api('/jobs/'+activeJob.id);if(ended.status==='done')break;await page.waitForTimeout(500)}assert.equal(ended.status,'done');await page.waitForTimeout(1800);assert.equal((await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0].project.srt,candidate);result.changedAssetProtected=true;
 assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);result.ok=true;
}catch(e){result.error=e.stack;await page?.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});result.body=await page?.locator('body').innerText().catch(()=>'');process.exitCode=1}
finally{result.outside=outside;result.errors=errors;fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(result,null,2));await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();console.log(JSON.stringify(result))}
