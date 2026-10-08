// Saved historical fixtures and real local media only. No model/provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,measureContrast} from './test-studio-color-states.mjs';

const fixture=await startIsolatedUI('workspace-ip'),checks=[],frames=[];
let browser;
try{
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import sys,json,os,shutil,wave,struct,math,zipfile,subprocess
from pathlib import Path
from PIL import Image
from backend import store as s,gateway as g,media_studio as m
d=json.load(sys.stdin);root=Path(os.environ['TIJIAN_DATA']).resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('workspace-ip-')
s.init();owner=d['owner']
s.set_config(m.CONFIG,{'hifly':{'base_url':m.PROVIDERS['hifly']['base_url'],'enabled':True,'secret':g.cipher().encrypt(b'isolated-fixture-only').decode()}})
scope=m._scope('hifly',m._service('hifly'));ids={}
video_fixture=Path('.runtime/creation-preview-ui/source.mp4')
if not video_fixture.is_file():
    archive=Path('.runtime/media-tools/ffmpeg-release-essentials.zip')
    assert archive.is_file(),'Prepare the project media-tools cache before running playable-media UI tests'
    with zipfile.ZipFile(archive) as bundle:
        member=next(name for name in bundle.namelist() if name.endswith('/bin/ffmpeg.exe'))
        ffmpeg=root/'fixture-ffmpeg.exe';ffmpeg.write_bytes(bundle.read(member))
    video_fixture=root/'fixture-source.mp4'
    subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=180x320:rate=12','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video_fixture)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
profile=s.put(owner,'profile',{'title':'隔离我的IP','position':'仅用于UI验收，不是真实身份'})
for kind in ('video','image','audio'):
    p=m._path(owner,s.uid()+{'video':'.mp4','image':'.png','audio':'.wav'}[kind])
    if kind=='video':shutil.copyfile(video_fixture,p)
    elif kind=='image':Image.new('RGB',(320,480),'#5285c9').save(p)
    else:
        with wave.open(str(p),'wb') as stream:
            stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000)
            stream.writeframes(b''.join(struct.pack('<h',int(1000*math.sin(2*math.pi*440*i/16000))) for i in range(48000)))
    source=s.put(owner,'studio_asset',{'title':'隔离创建原素材','asset_type':kind,'status':'ready','provider':'local','local_file':p.name,'mime_type':{'video':'video/mp4','image':'image/png','audio':'audio/wav'}[kind],'compat':m.COMPAT[kind]})
    tool='voice_create' if kind=='audio' else 'avatar_create'
    draft=s.put(owner,'studio_draft',{'tool':tool,'title':'隔离'+kind+'资产','model_id':'service:hifly','input':{kind+'_id':source['id']},'options':{}})
    run=s.put(owner,'studio_run',{'tool':tool,'provider':'hifly','status':'succeeded','draft_id':draft['id'],'draft_version':draft['version'],'snapshot':{'tool':tool,'input':{kind+'_id':source['id']},'options':{}},'asset_ids':[]})
    asset_type='voice' if kind=='audio' else 'avatar'
    clone=s.put(owner,'studio_asset',{'title':'隔离我的'+kind,'asset_type':asset_type,'provider':'hifly','provider_resource_id':'fixture-'+kind,'service_scope':scope,'status':'ready','visibility':'private','compat':m.COMPAT[asset_type],'run_id':run['id']})
    s.put(owner,'studio_run',{**run,'asset_ids':[clone['id']]},run['id']);ids[kind]=clone['id']
for kind in ('avatar','voice'):
    s.put(owner,'studio_asset',{'title':'公共资源不应进入我的IP'+kind,'asset_type':kind,'provider':'hifly','provider_resource_id':'fixture-public-'+kind,'service_scope':scope,'status':'ready','visibility':'public','compat':m.COMPAT[kind]})
    s.put(owner,'studio_asset',{'title':'已删除资源不应进入我的IP'+kind,'asset_type':kind,'provider':'hifly','provider_resource_id':'fixture-archived-'+kind,'service_scope':scope,'status':'ready','visibility':'private','archived':True,'compat':m.COMPAT[kind]})
s.put(owner,'studio_asset',{'title':'隔离无原素材形象','asset_type':'avatar','provider':'hifly','provider_resource_id':'fixture-no-preview','service_scope':scope,'status':'ready','visibility':'private','compat':m.COMPAT['avatar']})
for index in range(3):
    s.put(owner,'studio_asset',{'title':'隔离额外形象'+str(index),'asset_type':'avatar','provider':'hifly','provider_resource_id':'fixture-extra-'+str(index),'service_scope':scope,'status':'ready','visibility':'private','compat':m.COMPAT['avatar']})
content=s.put(owner,'content',{'title':'隔离稿件标题','body':'短的历史稿件，仅用于布局验证。','summary':'隔离摘要','cover_brief':'隔离画面建议','status':'draft'})
content=s.put(owner,'content',{**content,'body':('正文只用于滚动和页面布局验证，不是AI生成内容。\n\n'*100)},content['id'],content['version'])
task=s.put(owner,'task',{'title':'电梯报价为什么差这么多？写成公众号文章','mode':'auto','profile_id':profile['id'],'active_outcome':'wechat','platform_outcomes':{'wechat':content['id']},'messages':[{'role':'user','text':'隔离已保存的历史会话','at':s.now()},{'role':'assistant','text':'隔离历史成果，不调用模型。','at':s.now()}]})
s.put(owner,'content',{**content,'task_id':task['id']},content['id'],content['version'])
ids['task']=task['id'];ids['content']=content['id'];print(json.dumps(ids))
`],{env:{...fixture.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='';seed.stdout.on('data',c=>output+=c);seed.stderr.on('data',c=>error+=c);seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await new Promise(r=>seed.once('exit',r)),0,error);const ids=JSON.parse(output);
 await fixture.call('/workspace',{});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1530,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await fixture.attach(page);await page.reload();
 await page.goto(fixture.base+'/#task/'+ids.task);await page.locator('.aw-workspace').waitFor();
 for(const {width,height} of [{width:1530,height:1000},{width:1000,height:700},{width:390,height:1000}]){
  await page.setViewportSize({width,height});
  const samples=[];
  for(const tab of ['工作成果','参考资料','版本','工作成果']){
   await page.locator('.aw-main-tabs').getByRole('button',{name:tab,exact:true}).click();await settleUI(page);
   if(tab==='版本')await page.locator('.aw-result-scroll .version-card').first().waitFor();
   const metrics=await page.evaluate(()=>{
    const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    const scroll=document.querySelector('.aw-outcome,.aw-result-scroll');
    return {workspace:rect('.aw-workspace'),grid:rect('.aw-grid'),conversation:rect('.aw-conversation'),results:rect('.aw-results'),scroll:rect('.aw-outcome,.aw-result-scroll'),overflow:document.documentElement.scrollWidth>innerWidth+1,scrollOverflow:getComputedStyle(scroll).overflowY,scrollbarGutter:getComputedStyle(scroll).scrollbarGutter};
   });
   assert.equal(metrics.overflow,false,tab+' '+width+'整页横向溢出');
   assert.equal(metrics.scrollOverflow,'auto',tab+'必须在自己的滚动区内显示');
   samples.push({tab,...metrics});
  }
  fs.writeFileSync(path.join(fixture.directory,'frames.json'),JSON.stringify([...frames,{width,height,samples}],null,2));
  for(const box of ['workspace','grid','conversation','results','scroll']){
   assert(Math.max(...samples.map(x=>x[box].width))-Math.min(...samples.map(x=>x[box].width))<2,width+' '+box+'页签宽度发生变化');
   if(box==='results')assert(Math.max(...samples.map(x=>x[box].height))-Math.min(...samples.map(x=>x[box].height))<2,width+' 右侧外框高度发生变化');
  }
  for(const sample of samples)assert.equal(sample.scrollbarGutter,'stable',sample.tab+'滚动条不应使内容宽度跳变');
  frames.push({width,height,samples});checks.push('stable-tabs-and-independent-scroll-'+width+'x'+height);
 }
 await page.setViewportSize({width:1530,height:1000});
 const title=page.getByRole('textbox',{name:'成果标题'});await title.fill('人工修改后切换页签仍保留');
 await page.locator('.aw-main-tabs').getByRole('button',{name:'版本',exact:true}).click();
 await page.locator('.aw-main-tabs').getByRole('button',{name:'工作成果',exact:true}).click();
 assert.equal(await title.inputValue(),'人工修改后切换页签仍保留');
 const stored=(await fixture.call('/state')).objects.find(x=>x.id===ids.content);assert.equal(stored.title,'人工修改后切换页签仍保留');
 checks.push('switching-tabs-preserves-and-saves-manual-draft');
 await page.screenshot({path:path.join(fixture.directory,'workspace-desktop.png')});
 await page.goto(fixture.base+'/#studio/brand');await page.locator('.ip-dashboard').waitFor();
 const video=page.locator('.ip-resource-card').filter({hasText:'隔离我的video'}),audio=page.locator('.ip-resource-card').filter({hasText:'隔离我的audio'}),photo=page.locator('.ip-resource-card').filter({hasText:'隔离我的image'});
 await video.locator('video').waitFor();await audio.locator('audio').waitFor();await photo.locator('img').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.ip-resource-card video')].some(v=>v.readyState>=2&&v.videoWidth>0)&&[...document.querySelectorAll('.ip-resource-card audio')].some(a=>a.readyState>=2));
 assert(await photo.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
 await video.locator('video').evaluate(v=>{v.muted=true;return v.play()});await audio.locator('audio').evaluate(a=>{a.muted=true;return a.play()});
 await page.waitForFunction(()=>document.querySelector('.ip-resource-card video').currentTime>.2&&document.querySelector('.ip-resource-card audio').currentTime>.2);
 checks.push('real-local-avatar-video-photo-and-voice-audio-decoded-and-played');
 assert.match(await video.innerText(),/原素材供核对形象/);assert.match(await audio.innerText(),/原素材供核对声音/);
 assert.equal(await page.locator('.ip-dashboard').getByText(/公共资源不应进入|已删除资源不应进入/).count(),0);
 const missing=page.locator('.ip-resource-card').filter({hasText:'隔离无原素材形象'});assert.equal(await missing.locator('video,audio,img').count(),0);assert.match(await missing.innerText(),/未提供可验证预览/);
 assert.equal(await page.locator('.ip-resource-card').filter({hasText:/隔离额外形象/}).count(),3,'超过四个形象也应全部显示');
 checks.push('personal-only-resource-list-and-honest-original-media-labels');
 await video.getByRole('button',{name:'放大预览：隔离我的video',exact:true}).click();
 const dialog=page.locator('.studio-modal[open]');await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('.studio-modal[open] video')?.readyState>=2);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal(await video.getByRole('button',{name:'放大预览：隔离我的video',exact:true}).evaluate(el=>el===document.activeElement),true);
 checks.push('personal-avatar-expand-playback-and-escape-focus-return');
 for(const width of [1530,850,390]){
  await page.setViewportSize({width,height:1000});await settleUI(page);
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));
  const contrast=await page.evaluate(measureContrast,{scope:'.ip-assets',excludeUserPaper:true});assert.deepEqual(contrast.violations,[],JSON.stringify(contrast.violations));
  await page.locator('.page-area').evaluate(el=>el.scrollTo({top:0}));await page.screenshot({path:path.join(fixture.directory,'personal-ip-'+width+'.png'),fullPage:true});checks.push('personal-ip-no-horizontal-overflow-and-readable-'+width);
 }
 await page.reload();await page.locator('.ip-resource-card video').waitFor();await page.locator('.ip-resource-card audio').waitFor();checks.push('personal-assets-survive-page-reload');
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 const report={passed:true,checks,frames,paid_generation:false,real_local_media:true,historical_clone_fixture:true,directory:fixture.directory};fs.writeFileSync(path.join(fixture.directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(fixture.directory,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(0,2500))}}throw error}finally{await browser?.close();fixture.close()}
