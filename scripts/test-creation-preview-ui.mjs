// Real playable local fixtures; cloned status is an isolated historical fixture.
// Never creates a provider task, and never claims this is a real clone acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('creation-preview'),checks=[];
let browser;
try {
 const seed=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import sys,json,os,shutil
from pathlib import Path
from PIL import Image
from backend import store as s,gateway as g,media_studio as m
d=json.load(sys.stdin);root=Path(os.environ['TIJIAN_DATA']).resolve()
assert root.is_relative_to(Path('.runtime').resolve()) and root.name.startswith('creation-preview-')
s.init();owner=d['owner']
s.set_config(m.CONFIG,{'hifly':{'base_url':m.PROVIDERS['hifly']['base_url'],'enabled':True,'secret':g.cipher().encrypt(b'isolated-fixture-only').decode()}})
scope=m._scope('hifly',m._service('hifly'));ids={}
for kind in ('video','image'):
    p=m._path(owner,s.uid()+('.mp4' if kind=='video' else '.png'))
    if kind=='video':shutil.copyfile('.runtime/creation-preview-ui/source.mp4',p)
    else:Image.new('RGB',(320,480),'#5285c9').save(p)
    source=s.put(owner,'studio_asset',{'title':'原始创建素材','asset_type':kind,'status':'ready','provider':'local','local_file':p.name,'mime_type':'video/mp4' if kind=='video' else 'image/png','compat':m.COMPAT[kind]})
    draft=s.put(owner,'studio_draft',{'tool':'avatar_create','title':'隔离'+kind+'形象','model_id':'service:hifly','input':{kind+'_id':source['id']},'options':{}})
    run=s.put(owner,'studio_run',{'tool':'avatar_create','provider':'hifly','status':'succeeded','draft_id':draft['id'],'draft_version':draft['version'],'snapshot':{'tool':'avatar_create','input':{kind+'_id':source['id']},'options':{}},'asset_ids':[]})
    clone=s.put(owner,'studio_asset',{'title':'隔离'+kind+'形象','asset_type':'avatar','provider':'hifly','provider_resource_id':'fixture-'+kind,'service_scope':scope,'status':'ready','compat':m.COMPAT['avatar'],'run_id':run['id']})
    s.put(owner,'studio_run',{**run,'asset_ids':[clone['id']]},run['id']);ids[kind]={'draft':draft['id'],'asset':clone['id'],'source':source['id']}
print(json.dumps(ids))
`],{env:{...fixture.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='';seed.stdout.on('data',c=>output+=c);seed.stderr.on('data',c=>error+=c);seed.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));
 assert.equal(await new Promise(r=>seed.once('exit',r)),0,error);const ids=JSON.parse(output);
 await fixture.call('/workspace',{});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('response',r=>{if(r.status()>=400)console.log('FAILED LOCAL RESPONSE',r.status(),new URL(r.url()).pathname)});
 page.on('pageerror',e=>errors.push(e.message));await fixture.attach(page);await page.reload();
 await page.goto(fixture.base+'/#studio/avatar/library');
 const card=page.locator('.st-asset-card').filter({hasText:'隔离video形象'});
 try{await card.waitFor()}catch(error){console.log((await page.locator('body').innerText()).slice(0,2500));console.log(JSON.stringify(await fixture.call('/studio/assets')));await page.screenshot({path:path.join(fixture.directory,'failure.png')});throw error}await card.scrollIntoViewIfNeeded();
 await card.locator('video').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.st-asset-card video')].some(v=>v.readyState>=2&&v.videoWidth>0));
 assert.match(await card.innerText(),/创建素材|创建原/);
 assert.match(await card.innerText(),/已确认|已完成/);
 checks.push('legacy-clone-first-frame-and-confirmed-status');
 await card.locator('video').evaluate(v=>{v.muted=true;return v.play()});
 await page.waitForFunction(()=>[...document.querySelectorAll('.st-asset-card video')].some(v=>v.currentTime>.2));
 const before=await card.locator('video').evaluate(v=>v.currentTime);
 await card.getByRole('button',{name:/放大预览/}).click();
 const dialog=page.locator('.studio-modal[open]');await dialog.waitFor();
 await page.waitForFunction(()=>document.querySelector('.studio-modal[open] video')?.readyState>=2);
 assert((await dialog.locator('video').evaluate(v=>v.currentTime))>=before-.2);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 checks.push('actual-decoding-playback-and-enlarge-resume');
 const photo=page.locator('.st-asset-card').filter({hasText:'隔离image形象'});
 await photo.scrollIntoViewIfNeeded();await photo.locator('img').waitFor();
 assert(await photo.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
 checks.push('photo-avatar-uses-image-preview');
 for(const width of [1500,850,390]){
  await page.setViewportSize({width,height:1000});await settleUI(page);
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));
  const colors=await page.evaluate(measureContrast,{scope:'.st-asset-grid',excludeUserPaper:true});
  assert.deepEqual(colors.violations,[],JSON.stringify(colors.violations));checks.push('responsive-readable-library-'+width);
 }
 await page.setViewportSize({width:1500,height:1000});
 await page.goto(fixture.base+'/#studio/avatar/create?draft='+ids.video.draft);
 await page.locator('.st-clone-output').waitFor();
 await page.locator('.st-clone-output video').waitFor();
 assert.equal(await page.locator('.st-clone-output').getByRole('button',{name:/下载/}).count(),0);
 assert.match(await page.locator('.st-clone-output').innerText(),/飞影.*已确认|飞影.*克隆完成/);
 await page.reload();await page.locator('.st-clone-output video').waitFor();
 checks.push('creation-result-reload-preview-and-no-invalid-download');
 await page.screenshot({path:path.join(fixture.directory,'creation-result.png'),fullPage:true});
 await page.goto(fixture.base+'/#studio/avatar/library');await card.waitFor();
 await page.screenshot({path:path.join(fixture.directory,'library.png'),fullPage:true});
 const profile=await fixture.call('/objects/profile',{title:'原稿IP',position:'仅用于原稿身份保留验收'});
 const origin=await fixture.call('/studio/drafts',{tool:'text_avatar',title:'原稿保持',profile_id:profile.id,input:{text:'原稿内容必须保持',video_id:ids.video.source},options:{}});
 const returnRoute='studio/avatar/text?draft='+origin.id+'&mode=text_avatar';
 await page.goto(fixture.base+'/#'+returnRoute);
 await page.waitForFunction(()=>document.querySelector('.st-human-workspace textarea')?.value==='原稿内容必须保持');
 await page.getByRole('button',{name:'使用人物视频',exact:true}).click();
 await page.waitForFunction(id=>Object.keys(localStorage).some(k=>{try{const d=JSON.parse(localStorage.getItem(k));return d?.server_id===id&&d.human_source==='video'}catch{return false}}),origin.id);
 const draftCount=(await fixture.call('/studio/drafts')).items.length;
 await page.goto(fixture.base+'/#studio/avatar/library?return='+encodeURIComponent(returnRoute));await card.waitFor();
 assert.equal(await card.getByRole('button',{name:/用于文字驱动/}).count(),0);
 await card.getByRole('button',{name:'使用并返回原稿',exact:true}).click();
 await page.waitForFunction(id=>document.querySelector('select')&&[...document.querySelectorAll('select')].some(s=>s.value===id),ids.video.asset);
 assert.equal(await page.locator('.st-human-workspace textarea').inputValue(),'原稿内容必须保持');
 assert.equal(await page.locator('.st-context select').inputValue(),profile.id);
 assert.equal(await page.getByRole('button',{name:'选择飞影形象',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal((await fixture.call('/studio/drafts')).items.length,draftCount);
 checks.push('return-resource-preserves-original-text-ip-and-switches-away-from-video');
 await page.goto(fixture.base+'/#studio/works');await page.getByRole('heading',{name:'资产创建记录',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'视频作品',exact:true}).count(),0);
 checks.push('clones-classified-as-asset-creation');
 assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 const report={passed:true,checks,paid_generation:false,real_local_video_decoded:true,clone_status_fixture:true,directory:fixture.directory};
 fs.writeFileSync(path.join(fixture.directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();fixture.close()}
