// Real local video and save/render API with isolated SQLite; never uses paid services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';

const root=process.cwd(),dist=path.resolve('dist'),python=path.resolve('.runtime/venv/Scripts/python.exe');
const directory=path.resolve('.runtime','article-editing-ui-music-trim-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const env={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
const service=spawn(python,['-B','-X','utf8','tests/article-ui-fixture.py'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';service.stderr.on('data',x=>logs+=x);service.stdout.on('data',x=>logs+=x);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const ui=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/')){const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.statusCode=502;res.end()});req.pipe(upstream);return}try{const name=u.pathname.startsWith('/assets/')||u.pathname.startsWith('/visuals/')?decodeURIComponent(u.pathname.slice(1)):'index.html';const file=path.resolve(dist,name);assert(file.startsWith(dist+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}});
await new Promise(resolve=>ui.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ui.address().port,backend='http://127.0.0.1:'+port;
let token='',browser,page;const outside=[],errors=[],result={directory,paidCalls:0,productionDataTouched:false};
const api=async(url,data)=>{const r=await fetch(backend+'/api'+url,{method:data?'POST':'GET',headers:{'Connection':'close','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});assert(r.ok,url+' '+r.status+' '+(r.ok?'':await r.text()));return r.json()};
try{
 for(let i=0;i<180;i++){try{if((await fetch(backend+'/api/health')).ok)break}catch{}if(i===179)throw Error(logs);await new Promise(r=>setTimeout(r,100))}
 const auth=await api('/auth/register',{email:'compose-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'隔离成片验收'});token=auth.token;
 const draft=await api('/studio/drafts',{tool:'compose',title:'隔离本地成片',input:{scenes:[]},options:{}});

 const ff=path.resolve('.runtime/media-tools/ffmpeg.exe');
 const image=path.join(directory,'main.png'),detail=path.join(directory,'detail.png'),music=path.join(directory,'five-minutes.mp3');
 for(const [args,file] of [
  [['-f','lavfi','-i','color=c=blue:s=120x180','-frames:v','1','-threads','1'],image],
  [['-f','lavfi','-i','color=c=red:s=120x180','-frames:v','1','-threads','1'],detail],
  [['-f','lavfi','-i','sine=frequency=880:sample_rate=44100:duration=300','-c:a','libmp3lame','-b:a','64k'],music],
 ]){
  const cmd=spawnSync(ff,['-v','error','-y',...args,file],{windowsHide:true,encoding:'utf8'});
  assert.equal(cmd.status,0,cmd.stderr);
 }
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server']});
 page=await browser.newPage({viewport:{width:1600,height:1050}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==base){outside.push(u.origin);return route.abort()}
  if(route.request().method()==='POST'&&/\/(generate|optimize|send|publish|sync)(\/|$)/.test(u.pathname)){result.paidCalls++;return route.abort()}
  return route.continue();
 });
 await page.addInitScript(t=>sessionStorage.setItem('tijian-session',t),token);
 await page.goto(base+'/#studio/compose?draft='+draft.id);
 const remind=page.getByRole('button',{name:'稍后再做'});
 await page.locator('.lc-workbench').waitFor();
 if(await remind.isVisible().catch(()=>false))await remind.click();

 const localFile=(label)=>page.locator('input[type=file][aria-label="'+label+'"]');
 await localFile('上传主画面').setInputFiles(image);
 await page.getByText('已导入轨道：main.png').waitFor();
 assert(await page.getByLabel('画面素材').inputValue());
 await page.getByText('片段详细设置',{exact:true}).click();
 await page.getByLabel('播放时长（秒）').fill('70');
 await localFile('上传补充画面').setInputFiles(detail);
 await page.getByText('已导入轨道：detail.png').waitFor();
 assert(await page.getByLabel('补充素材').inputValue());
 await localFile('上传背景音乐').setInputFiles(music);
 await page.getByText('已导入轨道：five-minutes.mp3').waitFor();
 await page.getByText('原音频 300',{exact:false}).waitFor();
 const inField=page.getByLabel('素材起点（秒）',{exact:true}).last();
 const outField=page.getByLabel('素材终点（秒）',{exact:true});
 await inField.fill('120.125');
 await outField.fill('180.125');
 await page.getByLabel('进入成片的时间（秒）').fill('5');
 await page.getByRole('button',{name:'应用裁剪'}).click();
 await page.getByText('60 秒',{exact:true}).waitFor();
 const clip=page.getByRole('button',{name:'编辑背景音乐片段'});
 await clip.scrollIntoViewIfNeeded();
 const right=clip.locator('.music-edge.out'),handle=await right.boundingBox(),lane=await clip.locator('..').boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2-lane.width*4/70,handle.y+handle.height/2,{steps:8});
 await page.mouse.up();
 assert(Number(await outField.inputValue())<177);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 assert.equal(await outField.inputValue(),'180.125');
 await page.getByLabel('成片播放位置').fill('5');
 await page.waitForFunction(()=>Math.abs((document.querySelector('.ct-stage-wrap audio')?.currentTime||0)-120.125)<.06);
 const play=page.getByRole('button',{name:'▶ 播放成片'});
 await play.click();
 await page.waitForFunction(()=>{const a=document.querySelector('.ct-stage-wrap audio');return a&&!a.paused&&a.currentTime>=120.125});
 await page.getByLabel('成片播放位置').fill('65.1');
 await page.waitForFunction(()=>document.querySelector('.ct-stage-wrap audio')?.paused===true);
 if(await page.getByRole('button',{name:'暂停',exact:true}).isVisible())await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByText('已保存',{exact:true}).waitFor();
 const saved=(await api('/studio/local-compose/projects?draft_id='+draft.id)).items[0];
 assert.deepEqual([saved.project.music.start,saved.project.music.trim,saved.project.music.length],[5,120.125,60]);
 assert.equal(saved.project.scenes.length,1);
 assert.equal(saved.project.b_roll.length,1);
 await page.reload();
 await page.locator('.lc-workbench').waitFor();
 if(await remind.isVisible().catch(()=>false))await remind.click();
 assert.equal(await outField.inputValue(),'180.125');
 await page.getByRole('button',{name:'编辑背景音乐片段'}).click();
 await page.locator('.lc-music-tools').screenshot({path:path.join(directory,'music-tools.png')});
 assert.deepEqual(outside,[]);
 assert.deepEqual(errors,[]);
 assert.equal(result.paidCalls,0);
 result.ok=true;
}catch(e){result.error=e.stack;await page?.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1}
finally{fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));await browser?.close();ui.closeAllConnections();await new Promise(resolve=>ui.close(resolve));service.kill();console.log(JSON.stringify(result))}
