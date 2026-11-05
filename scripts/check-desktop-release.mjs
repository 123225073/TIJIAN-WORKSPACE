// Runs the actual packaged app with an isolated userData directory; no provider keys.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const dir=path.resolve('.runtime','desktop-check-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const product=JSON.parse(fs.readFileSync('package.json','utf8')).build.productName;
const exe=process.env.TIJIAN_CHECK_EXE?path.resolve(process.env.TIJIAN_CHECK_EXE):path.resolve('release',version,'win-unpacked',product+'.exe');
const child=spawn(exe,['--enable-logging=stderr','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DESKTOP_DATA:dir}});
const desktopLog=fs.createWriteStream(path.join(dir,'electron.log'));child.stderr.pipe(desktopLog);
let exited=false;child.once('exit',()=>exited=true);let phase='startup';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let page;for(let i=0;i<150;i++){if(exited)throw Error('Desktop exited before loading');try{const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();page=pages.find(x=>x.type==='page'&&x.url.startsWith('http://127.0.0.1:'));if(page)break}catch{}await pause(200)}
 if(!page)throw Error('Desktop renderer not ready');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const view=browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().startsWith('http://127.0.0.1:'));
 if(!view)throw Error('Packaged browser page unavailable');
 const cdp=await view.context().newCDPSession(view);
 const call=async(method,params={})=>{let timer;try{return await Promise.race([cdp.send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(phase+': '+method+' timeout')),45000)})])}finally{clearTimeout(timer)}};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 phase='initial DOM';console.log('Inspecting packaged DOM');let text='';for(let i=0;i<60;i++){text=await evaluate('document.body?.innerText||String()');if(text.includes('登录')||text.includes('创作工作台'))break;await pause(100)}
 if(!text.includes('登录')&&!text.includes('创作工作台'))throw Error('Desktop UI did not load');
 phase='backend health';console.log('Inspecting packaged health');const health=await evaluate("fetch('/api/health').then(r=>r.json())");if(health.version!==version)throw Error('Wrong backend version');
 phase='library and discovery';console.log('Inspecting packaged library');const check=await evaluate(`(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})});if(!r.ok)throw Error('Isolated admin login failed');const d=await r.json();const capabilities=await fetch('/api/admin/capabilities',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());if(!['daily','writing','research','benchmark','topics','profile','check','knowledge'].every(p=>capabilities.items?.some(x=>x.id==='role:'+p&&x.kind==='role')))throw Error('Missing packaged system capabilities');const preview=await fetch('/api/admin/capabilities/preview/profile',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());if(!preview.text?.includes('个人定位访谈顾问'))throw Error('Missing packaged prompt composer');const settings=await fetch('/api/wechat/settings',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());const pending=await fetch('/api/wechat/browser/pending',{headers:{Authorization:'Bearer '+d.token}}).then(x=>x.json());const libraryHeaders={Authorization:'Bearer '+d.token,'Content-Type':'application/json'};const folder=await fetch('/api/objects/folder',{method:'POST',headers:libraryHeaders,body:JSON.stringify({title:'打包验收文件夹',library:'source'})}).then(r=>r.json());const source=await fetch('/api/import/text',{method:'POST',headers:libraryHeaders,body:JSON.stringify({title:'长文打包验证',body:'例行记录。'.repeat(4000)+'最后编号紫铜海豚392。',folder_id:folder.id})}).then(r=>r.json());const evidence=await fetch('/api/library/preview',{method:'POST',headers:libraryHeaders,body:JSON.stringify({query:'紫铜海豚编号',scope:{mode:'selected',modules:[],folder_ids:[folder.id],item_ids:[],excluded_ids:[]}})}).then(r=>r.json());const synthesis=await fetch('/api/synthesis',{headers:libraryHeaders}).then(r=>r.json());if(!evidence.excerpts?.some(x=>x.text.includes('紫铜海豚392')&&x.start>15000)||synthesis.settings?.time!=='23:30')throw Error('Packaged Wiki/retrieval service failed');const radar=await fetch('/api/discovery/source',{method:'POST',headers:libraryHeaders,body:JSON.stringify({url:'https://v.douyin.com/packaged-test/',keywords:''})}).then(r=>r.json());if(radar.status!=='needs_browser'||radar.items.length)throw Error('Packaged source capability reporting failed');return {radar_api:true,library_api:true,configured:settings.configured,url:settings.service_url,browserBridge:typeof window.tijianDesktop.wechatBody==='function',browserQueue:pending.active===false&&pending.items.length===0}})()`);
 phase='creation resources';console.log('Inspecting packaged creation');const creationPack=await evaluate(`(async()=>{const auth=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})}).then(r=>r.json());const headers={Authorization:'Bearer '+auth.token};const capabilities=await fetch('/api/admin/capabilities',{headers}).then(r=>r.json());if(!['skill:wechat-editor','skill:humanizer'].every(id=>capabilities.items.some(x=>x.id===id&&x.status==='published')))throw Error('Writing skill files missing from package');const visual=await fetch('/visuals/elevator-atrium-v1.png');if(!visual.ok||!visual.headers.get('content-type')?.startsWith('image/'))throw Error('Homepage background missing');return true})()`);if(!creationPack)throw Error('Creation package failed');
 phase='video draft contract';
 const h3Draft = await evaluate(`(async()=>{
  const auth=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})}).then(r=>r.json());
  const headers={Authorization:'Bearer '+auth.token,'Content-Type':'application/json'};
  const request=async(path,body)=>fetch('/api'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const catalog=await request('/studio/catalog').then(r=>r.json());
  const tool=catalog.tools.find(t=>t.id==='text_video');
  const ids=['minimax-h3-768p','minimax-h3-2k','minimax-h3-pro-768p','minimax-h3-pro-2k'];
  if(tool.binding!=='media:'+ids[0]||tool.models.length!==4||ids.some(id=>!tool.models.find(m=>m.family===id)))throw Error('Packaged H3 catalogue failed');
  const settings=await request('/admin/media-registry/providers',{id:'oairegbox',api_key:'isolated-packaged-test-only'}).then(r=>r.json());
  if(!settings.has_key||JSON.stringify(settings).includes('isolated-packaged-test-only'))throw Error('Packaged H3 key storage failed');
  const draft=await request('/studio/drafts',{tool:'text_video',title:'H3 isolation',input:{prompt:'电梯门缓缓打开',reference_mode:'reference',remote_references:[{kind:'video',url:'https://example.com/h3-fixture.mp4',title:'三秒测试参考'}]},options:{duration:7,ratio:'9:16'}}).then(r=>r.json());
  if(!draft.id||draft.model_id!==tool.binding||draft.options.duration!==7)throw Error('Packaged H3 draft save failed');
  const blocked=await request('/studio/generate',{draft_id:draft.id,version:draft.version,confirmed:true,request_id:'h3-isolated-invalid-ref'});
  if(blocked.status!==400||!(await blocked.json()).detail.includes('不支持参考视频'))throw Error('Standard H3 must block video reference');
  await request('/objects/profile',{title:'安装包隔离验收',status:'accepted'});
  sessionStorage.setItem('tijian-session',auth.token);
  sessionStorage.setItem('tijian-admin-session',auth.token);
  location.hash='studio/video?draft='+draft.id+'&mode=text_video';
  return draft.id;
 })()`);
 await call('Page.reload');
 const videoSettings=view.getByRole('region',{name:'视频设置',exact:true});
 await videoSettings.getByText('MiniMax H3 Pro · 2K',{exact:true}).waitFor({timeout:20000});
 if(await view.locator('.mw-panel .video-settings').count()!==1||await view.locator('.mw-results .video-settings').count())throw Error('Video settings must remain in the left creation pane');
 if(await view.getByLabel('生成模型',{exact:true}).count())throw Error('AI video must use the fixed model');
 if(await view.getByText('用场景模板整理要求',{exact:true}).count())throw Error('Legacy scene form still appears');
 if(await videoSettings.getByLabel('视频时长').inputValue()!=='7')throw Error('Old draft parameters were not restored');
 await view.screenshot({path:path.join(dir,'video-settings.png')});
 const convert=view.getByRole('button',{name:'转换为 MiniMax H3 官方模板',exact:true});
 const h3Fixture='subject_definitions: The input video provides camera movement.\nsummary: Elevator doors open.\nretention_analysis: Use <Video 1> for motion.\ndetailed_description: [Shot 1] The elevator doors slowly slide open.\noverall_soundscape: Soft mechanical movement.\nnon_diegetic_music: N/A';
 await view.route('**/api/studio/prompt/optimize',async route=>{
  const data=route.request().postDataJSON();
  if(data.h3_mode!=='reference'||data.reference_counts.video!==1||data.duration!==7)throw Error('Missing H3 template context');
  await route.fulfill({json:{status:'done',result:{optimized_prompt:h3Fixture}}});
 });
 await convert.click();
 await view.waitForFunction(text=>document.querySelector('textarea[aria-label="输入你的要求"]')?.value===text,h3Fixture);
 await view.getByRole('button',{name:'撤销优化',exact:true}).click();
 await view.waitForFunction(()=>document.querySelector('textarea[aria-label="输入你的要求"]')?.value==='电梯门缓缓打开');
 await view.unroute('**/api/studio/prompt/optimize');
 if(!h3Draft)throw Error('H3 draft missing');
 await view.screenshot({path:path.join(dir,'video-workbench.png')});
 console.log('Verified fixed H3 model, inline settings, conversion and undo');

 phase='video prompt library';
 const openPromptLibrary=()=>view.getByRole('button',{name:'提示词库',exact:true}).click();
 const promptLibrary=view.getByRole('dialog',{name:'视频提示词库',exact:true});
 await openPromptLibrary();
 await promptLibrary.getByRole('heading',{name:'品牌怎么比',exact:true}).waitFor();
 await view.screenshot({path:path.join(dir,'video-prompt-library.png')});
 await promptLibrary.getByRole('button',{name:'添加到末尾',exact:true}).click();
 const promptInput=view.getByLabel('输入你的要求',{exact:true});
 await promptInput.waitFor();
 const appliedPrompt=await promptInput.inputValue();
 if(!appliedPrompt.startsWith('电梯门缓缓打开')||appliedPrompt.length<30)throw Error('Prompt library failed to append the built-in prompt');

 await openPromptLibrary();
 await promptLibrary.getByRole('button',{name:'保存当前提示词',exact:true}).click();
 const fixtureTitle='安装包验收 · 自用镜头';
 await view.getByLabel('提示词名称',{exact:true}).fill(fixtureTitle);
 await view.getByLabel('提示词分类',{exact:true}).fill('本机验收');
 const savedPromptResponse=view.waitForResponse(r=>new URL(r.url()).pathname==='/api/studio/video-prompts'&&r.request().method()==='POST');
 await view.getByRole('button',{name:'保存到我的提示词',exact:true}).click();
 if(!(await savedPromptResponse).ok())throw Error('Packaged prompt library save failed');
 await call('Page.reload');
 await openPromptLibrary();
 await promptLibrary.getByRole('button',{name:'我的提示词',exact:true}).click();
 await promptLibrary.getByRole('button',{name:new RegExp(fixtureTitle)}).waitFor();
 const storedPrompt=await evaluate(`(async()=>{
  const response=await fetch('/api/studio/video-prompts',{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}});
  return response.ok&&(await response.json()).items.find(item=>item.title===${JSON.stringify(fixtureTitle)});
 })()`);
 if(storedPrompt?.category!=='本机验收'||storedPrompt.body!==appliedPrompt.trim())throw Error('Saved prompt did not persist on the packaged backend');
 console.log('Verified built-in prompt insertion and personal prompt persistence');

 if(!await evaluate("typeof window.tijianDesktop.wereadSession==='function'"))throw Error('Missing free subscription bridge');
 if(!await evaluate("typeof window.tijianDesktop.readClipboardImage==='function'"))throw Error('Missing desktop image clipboard bridge');
 if(!check.library_api||!check.browserBridge||!check.browserQueue||check.configured||check.url!=='https://www.cimidata.com/api-service')throw Error('Packaged API settings incorrect');
 await evaluate(`(async()=>{const auth=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin',password:'admin'})}).then(r=>r.json());sessionStorage.setItem('tijian-session',auth.token);await fetch('/api/objects/profile',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({title:'安装包隔离验收',status:'accepted'})});location.hash='studio/home'})()`);
 await call('Page.reload');
 let homeReady=false;for(let i=0;i<150;i++){homeReady=await evaluate("Boolean(document.querySelector('.tw-send:not(:disabled)'))").catch(()=>false);if(homeReady)break;await pause(100)}
 if(!homeReady)throw Error('Packaged homepage did not become interactive');
 await evaluate("if(document.querySelector('.tw-chat textarea').value!=='')throw Error('Expected blank homepage');document.querySelector('.tw-send').click()");
 let chatReady=false;for(let i=0;i<150;i++){chatReady=await evaluate("Boolean(document.querySelector('.aw-workspace'))").catch(()=>false);if(chatReady)break;await pause(100)}
 if(!chatReady)throw Error('Packaged blank chat did not open');
 const blankChat=await evaluate(`(async()=>{const id=location.hash.split('/')[1],state=await fetch('/api/state/updates?ids='+id,{headers:{Authorization:'Bearer '+sessionStorage.getItem('tijian-session')}}).then(r=>r.json()),task=state.items.find(x=>x.id===id);return task?.initial_text===''&&task.messages.length===0&&document.querySelector('.aw-composer textarea')?.value===''})()`);
 if(!blankChat)throw Error('Packaged blank entry created a message or nonempty composer');
 phase='content matrix';
 await evaluate(`(async()=>{
  const headers={Authorization:'Bearer '+sessionStorage.getItem('tijian-session'),'Content-Type':'application/json'};
  const request=async(path,body)=>{const response=await fetch('/api'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});if(!response.ok)throw Error(path+' '+response.status);return response.json()};
  const topic=await request('/studio/topics',{title:'核对家用梯井道尺寸',source_ids:[]});
  const flow=await request('/studio/flow',{new:true,version:0,brief:topic.title,stage:1,topic_id:topic.id});
  const matrix=await request('/studio/flows/'+flow.id+'/matrix');
  const publish=await request('/studio/matrix-publish/config');
  if(matrix.master.topic_id!==topic.id||!publish.items?.some(item=>item.platform==='website'))throw Error('Packaged matrix state or publication settings missing');
  location.hash='studio/flow?work='+flow.id+'&step=1';
 })()`);
 await view.getByLabel('内容矩阵步骤').getByRole('link',{name:'内容母版'}).waitFor({timeout:20000});
 await view.getByLabel('今天想讲什么？').waitFor();
 await view.getByRole('button',{name:'确定主题，进入母版'}).click();
 await view.getByRole('button',{name:'按选题生成文章'}).waitFor();
 await view.getByRole('button',{name:'直接撰写正文'}).click();
 const master=view.getByRole('article',{name:'母版正文',exact:true}).getByRole('textbox');
 await master.fill('独立验收底稿。现场尺寸需以实测为准。');
 await view.getByRole('button',{name:'下一步，选择平台'}).click();
 await view.getByRole('checkbox',{name:/微信公众号/}).waitFor();
 await view.screenshot({path:path.join(dir,'content-matrix.png')});
 phase='publication accounts';
 await view.getByLabel('内容矩阵步骤').getByRole('link',{name:'发布与账号'}).click();
  await view.getByRole('button',{name:'账号管理',exact:true}).click();
 await view.getByRole('heading',{name:'发布账号管理',exact:true}).waitFor();
 await view.getByRole('button',{name:'官网 / 品牌博客',exact:true}).click();
 await view.getByRole('region',{name:'官网 / 品牌博客连接'}).getByText('待配置连接').waitFor();
 await view.screenshot({path:path.join(dir,'publish-accounts.png')});
 phase='OAIREGBOX admin';
 await view.goto(new URL('/admin.html',view.url()).href);
 await view.getByRole('button',{name:'视频、图片与数字人模型',exact:true}).click();
 await view.getByRole('navigation',{name:'媒体服务平台'}).getByRole('button',{name:/OAIREGBOX/}).click();
 await view.getByRole('link',{name:/获取 API 令牌/}).waitFor();
 if(await view.locator('.mr-list article').count()!==4)throw Error('Expected four OAIREGBOX admin models');
 if(!await view.getByText('¥0.33/秒',{exact:false}).isVisible())throw Error('Missing H3 price in admin');
 await view.locator('.mr-list article').first().getByRole('button',{name:'功能',exact:true}).click();
 await view.getByRole('dialog',{name:'绑定前台功能'}).getByRole('checkbox',{name:'文生视频'}).waitFor();
 await view.getByRole('dialog',{name:'绑定前台功能'}).getByRole('checkbox',{name:'图生视频'}).waitFor();
 const result={passed:true,version,actual_packaged_desktop:true,library_api:true,system_capabilities:true,h3_video:true,video_prompt_library:true,content_matrix:true,isolated_data:true,api_settings:true,homepage_blank_chat:true};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result));
 console.log(JSON.stringify({...result,dir}));
 await call('Browser.close').catch(()=>{});
}finally{
 for(let i=0;i<30&&!exited;i++)await pause(100);
 if(!exited){const stop=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>stop.once('exit',r))}
}
