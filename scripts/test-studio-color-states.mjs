// Isolated real React pages + local API. Fixtures are explicitly historical test data,
// never evidence of live generation. Also exports the shared WCAG measurement.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port};
export async function settleUI(page){
 await page.evaluate(async()=>{const finite=document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));await Promise.all(finite.map(animation=>animation.finished.catch(()=>{})))});
}
export async function startIsolatedUI(prefix='studio-color') {
 const directory=path.resolve('.runtime',prefix+'-'+Date.now());fs.mkdirSync(directory,{recursive:true});
 assert(fs.existsSync('dist/index.html'),'Integrated dist must be built by the main agent before UI verification');
 const apiPort=await freePort(),apiBase='http://127.0.0.1:'+apiPort,base=apiBase;
 const env={...process.env,TIJIAN_DATA:directory,TIJIAN_PORT:String(apiPort),TIJIAN_ALLOW_SELF_REGISTRATION:'1'};
 const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env});
 let output='';service.stderr.on('data',chunk=>output+=chunk);
 const close=()=>service.kill();
 try {
  let ready=false;for(let i=0;i<200;i++){try{ready=(await(await fetch(apiBase+'/api/health')).json()).ok&&(await fetch(base)).ok;if(ready)break}catch{}await pause(150)}assert(ready,output);
  const auth=await(await fetch(apiBase+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'visual@example.test',name:'隔离视觉验收',password:'isolated-test-only'})})).json();assert(auth.token);
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.token};
  const call=async(url,data,method=data===undefined?'GET':'POST')=>{const response=await fetch(apiBase+'/api'+url,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});assert(response.ok,url+' '+response.status+' '+(response.ok?'':await response.text()));return response.json()};
  const guard={external:[],forbidden:[]};
  const attach=async page=>{
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['data:','blob:'].includes(url.protocol)&&url.origin!==base&&url.origin!==apiBase){guard.external.push(request.url());return route.abort()}
    if(url.pathname.startsWith('/api/')){
     if(request.method()==='POST'&&/generate|publish|\/jobs(?:\/|$)|optimize|suggestion|\/refresh$/.test(url.pathname)){guard.forbidden.push(request.url());return route.abort()}
     return route.continue();
    }
    return route.continue();
   });
   await page.goto(base);await page.evaluate(token=>sessionStorage.setItem('tijian-session',token),auth.token);
  };
  const html=fs.readFileSync('dist/index.html','utf8');
  const integration={frontend:'integrated dist',indexModified:fs.statSync('dist/index.html').mtime.toISOString(),indexSHA256:createHash('sha256').update(html).digest('hex'),entrypoints:[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(match=>match[1])};
  return {directory,apiBase,base,auth,env,call,headers,attach,guard,close,integration};
 }catch(error){close();throw error}
}

export async function seedFilledFlow(fixture){
 assert.equal(fixture.env.TIJIAN_DATA,fixture.directory);
 assert(fixture.directory.startsWith(path.resolve('.runtime')+path.sep)&&/^studio-/.test(path.basename(fixture.directory)),'seed only the disposable fixture');
 const topics=await fixture.call('/studio/topics');assert(topics.items.length,'filled flow needs an isolated topic');
 const python=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import json,sys
from backend import store as s
d=json.load(sys.stdin);s.init();owner=d['owner']
flow=s.put(owner,'studio_flow',{'title':'隔离四产物流程','brief':'物业老旧电梯更新资料核对与现场条件说明。'*8,'topic_id':d['topic_id'],'stage':3,'platform':'wechat','assembled':'yes'})
content=s.put(owner,'content',{'title':'隔离长名称文稿：物业旧电梯更新记录、现场条件与沟通准备。'*5,'body':'隔离排版测试文稿，仅用于显示名称与选择状态。','flow_id':flow['id']})
links={'content_id':content['id']}
for field,kind,label in [('cover_id','image','封面'),('video_id','video','视频'),('audio_id','audio','配音')]:
    asset=s.put(owner,'studio_asset',{'title':('隔离长名称'+label+'：物业现场资料核对与电梯更新准备。')*5,'asset_type':kind,'status':'ready','provider':'fixture','flow_id':flow['id'],'fixture_only':True})
    links[field]=asset['id']
flow=s.put(owner,'studio_flow',{**flow,**links},flow['id'],flow['version'])
print(json.dumps({'flow_id':flow['id'],'links':links,'fixture_only':True}))
`],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let result='',error='';python.stdout.on('data',chunk=>result+=chunk);python.stderr.on('data',chunk=>error+=chunk);python.stdin.end(JSON.stringify({owner:fixture.auth.user.id,topic_id:topics.items[0].id}));assert.equal(await new Promise(resolve=>python.on('exit',resolve)),0,error);return JSON.parse(result);
}

// Executed inside Chromium. Measures direct text, field values/placeholders and
// native option styles; uses alpha compositing at every ancestor, including group
// opacity. Gradient stops are sampled conservatively, never replaced by one stop.
export function measureContrast({scope='.page-area',excludeUserPaper=false,viewportOnly=false}={}) {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});
 const rgba=value=>{
  const parts=(value.match(/[\d.]+/g)||[]).map(Number);
  if(value.startsWith('rgb'))return [...parts.slice(0,3),parts[3]??1];
  if(value.startsWith('color(srgb '))return [...parts.slice(0,3).map(v=>v*255),parts[3]??1];
  if(value==='transparent')return [0,0,0,0];
  context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);const pixel=[...context.getImageData(0,0,1,1).data];return [...pixel.slice(0,3),pixel[3]/255];
 };
 const over=(color,base)=>color.slice(0,3).map((v,i)=>v*color[3]+base[i]*(1-color[3]));
 const mix=(a,b,opacity)=>a.map((v,i)=>v*opacity+b[i]*(1-opacity));
 const lum=color=>color.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const describe=node=>{const names=[];for(let current=node;current&&names.length<5;current=current.parentElement){names.unshift(current.tagName.toLowerCase()+(current.id?'#'+current.id:[...current.classList].map(x=>'.'+x).join('')));if(current.matches(scope))break}return names.join(' > ')};
 const paper='.wa-rich-editor,.wa-preview,.md-rendered,.article-preview,.st-paper';
 const entries=[],unmeasured=[];
 for(const root of document.querySelectorAll(scope))for(const node of [root,...root.querySelectorAll('*')]){
  if(node.closest('svg,script,style')||node.matches('[type=checkbox],[type=radio],[type=file]'))continue;
  const option=node.tagName==='OPTION',visibleNode=option?node.closest('select'):node;
  const style=getComputedStyle(node),rect=visibleNode.getBoundingClientRect();
  if(!rect.width||!rect.height||style.visibility!=='visible'||node.closest('[hidden]')||[...function*(n){for(;n;n=n.parentElement)yield n}(visibleNode)].some(n=>getComputedStyle(n).display==='none'||Number(getComputedStyle(n).opacity)===0))continue;
  let hiddenDetails=false;for(let ancestor=visibleNode.parentElement;ancestor;ancestor=ancestor.parentElement){if(ancestor.matches('details:not([open])')&&!ancestor.querySelector(':scope > summary')?.contains(visibleNode)){hiddenDetails=true;break}}if(hiddenDetails)continue;
  if(viewportOnly&&(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth))continue;
  // Explicit user formatting belongs to the document. UI toolbar/fields are still measured.
  if(excludeUserPaper&&node.closest(paper)&&node.closest('[style*="color"]'))continue;
  const direct=[...node.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ').trim();
  const samples=[];if(direct)samples.push({kind:'text',text:direct,color:style.color});
  if(node.matches('input,textarea')&&node.value)samples.push({kind:'value',text:node.value,color:style.color});
  if(node.matches('input,textarea')&&node.placeholder&&!node.value){const placeholder=getComputedStyle(node,'::placeholder');samples.push({kind:'placeholder',text:node.placeholder,color:placeholder.color,opacity:Number(placeholder.opacity)})}
  if(!samples.length)continue;
  const ancestors=[];for(let current=node;current;current=current.parentElement)ancestors.unshift(current);
  let variants=[{bg:[255,255,255],layers:[]}];
  for(const ancestor of ancestors){
   const css=getComputedStyle(ancestor),base=rgba(css.backgroundColor),gradient=css.backgroundImage;
   const stops=(gradient.match(/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]+\)/g)||[]).map(rgba);
   if(gradient!=='none'&&!stops.length)unmeasured.push({selector:describe(node),reason:'background image requires pixel review',image:gradient});
   const paints=stops.length?stops.map(stop=>({base,stop})):[{base,stop:[0,0,0,0]}];
   variants=variants.flatMap(variant=>paints.map(paint=>{const bg=over(paint.stop,over(paint.base,variant.bg));return {bg,layers:[...variant.layers,{before:variant.bg,opacity:Number(css.opacity)}]}}));
   if(variants.length>128){unmeasured.push({selector:describe(node),reason:'too many gradient combinations'});variants=variants.slice(0,128)}
  }
  for(const sample of samples){
   const color=rgba(sample.color);color[3]*=sample.opacity??1;
   const results=variants.map(variant=>{let fg=over(color,variant.bg),bg=variant.bg;for(const layer of [...variant.layers].reverse()){fg=mix(fg,layer.before,layer.opacity);bg=mix(bg,layer.before,layer.opacity)}return {ratio:ratio(fg,bg),foreground:fg,background:bg}});
   const worst=results.reduce((a,b)=>a.ratio<b.ratio?a:b),font=parseFloat(style.fontSize),weight=Number(style.fontWeight),disabled=!!node.closest(':disabled,[aria-disabled=true]'),minimum=disabled?3:font>=24||font>=18.6667&&weight>=700?3:4.5;
   entries.push({selector:describe(node),kind:sample.kind,text:sample.text.slice(0,90),color:sample.color,backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,opacity:style.opacity,foreground:worst.foreground.map(n=>+n.toFixed(2)),background:worst.background.map(n=>+n.toFixed(2)),contrast:+worst.ratio.toFixed(3),minimum,font,weight,disabled,failed:worst.ratio+1e-6<minimum});
  }
 }
 return {checked:entries.length,entries,violations:entries.filter(x=>x.failed),unmeasured:[...new Map(unmeasured.map(x=>[JSON.stringify(x),x])).values()]};
}

export async function workflowMetrics(page) {
 return page.evaluate(()=>{
  const rect=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
  const fullyVisible=node=>{const r=node.getBoundingClientRect();if(r.width<=0||r.height<=0||r.top<0||r.bottom>innerHeight+1||r.left<0||r.right>innerWidth+1)return false;for(let p=node.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),pr=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)&&(r.top<pr.top-1||r.bottom>pr.bottom+1))return false}return true};
  const nodes=[...document.querySelectorAll('.cf-node')].map((node,index)=>{const button=node.querySelector(':scope > button'),number=node.querySelector('.cf-step-number,.cf-node-number,.cf-step-dot > span,.cf-step-dot'),s=number&&getComputedStyle(number);return {step:index+1,label:node.querySelector('strong')?.textContent,rect:rect(node),visible:fullyVisible(node),buttonVisible:fullyVisible(button),number:number?{text:number.textContent.trim(),font:parseFloat(s.fontSize),rect:rect(number),visible:fullyVisible(number)}:null}});
  const scrolls=[document.scrollingElement,document.querySelector('.page-area')].filter(Boolean).map(n=>({selector:n.className||n.tagName,top:n.scrollTop,height:n.clientHeight,content:n.scrollHeight,overflow:getComputedStyle(n).overflowY}));
  const detail=document.querySelector('.cf-detail'),inside=detail?[detail,...detail.querySelectorAll('*')].filter(n=>!n.matches('input,textarea,select')&&/auto|scroll/.test(getComputedStyle(n).overflowY)).map(n=>({selector:n.className,...rect(n),height:n.clientHeight,content:n.scrollHeight,overflow:getComputedStyle(n).overflowY})):[];
  const manifest=[...document.querySelectorAll('.cf-node-manifest span')].map(node=>({text:node.textContent,...rect(node),visible:fullyVisible(node)}));
  return {viewport:{width:innerWidth,height:innerHeight},nodes,manifest,scrolls,inside,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2};
 });
}

export async function testWorkflow(page,{base,directory,record,flowId='',filled=false}) {
 for(const viewport of [{width:1366,height:768},{width:1530,height:1000},{width:1000,height:700}]){
  await page.setViewportSize(viewport);await page.goto(base+'/?ui=1#studio/flow'+(flowId?'?work='+flowId:''));await page.locator('.cf-node').nth(4).waitFor();await page.locator('.cf-loading').waitFor({state:'hidden'});
  if(filled){await page.locator('.cf-node-manifest span').nth(3).waitFor();assert.equal(await page.locator('.cf-node-products [class=ready]').count(),5,'four products and selected platform');assert.equal(await page.locator('.cf-node-manifest span').count(),4,'all four long-name products must remain rendered')}
  for(const stage of [0,1,2,3,4]){
   await page.locator('.cf-node > button').nth(stage).click();await settleUI(page);
   if(stage===3){await page.locator('.cf-import summary').click();await page.waitForTimeout(80)}
   const metrics=await workflowMetrics(page),contrast=await page.evaluate(measureContrast,{scope:'.cf-page'}),failures=contrast.violations.map(x=>`${x.selector} ${x.text}: ${x.contrast} < ${x.minimum}`);
   if(metrics.nodes.length!==5)failures.push('all five nodes must exist');
   if(filled&&(metrics.manifest.length!==4||metrics.manifest.some(item=>!item.visible)))failures.push('all four filled product names must fit on screen');
   for(const node of metrics.nodes){if(!node.visible||!node.buttonVisible)failures.push('step '+node.step+' clipped');if(!node.number?.visible||node.number.font<22||!new RegExp('0?'+node.step).test(node.number.text))failures.push('step '+node.step+' visible number must be >=22px')}
   if(metrics.scrolls.some(s=>s.top>1||s.content>s.height+2))failures.push('workflow requires outer page scrolling');
   if(metrics.horizontalOverflow)failures.push('horizontal overflow');
   if(!metrics.inside.length)failures.push('right editor needs its own scroll container');
   let scrollProof=null;
   const target=metrics.inside.find(s=>s.content>s.height+2);
   if(target){
    const locator=page.locator('.'+target.selector.trim().split(/\s+/).join('.')).first();
    const before=await locator.evaluate(node=>({inside:node.scrollTop,page:document.querySelector('.page-area').scrollTop,document:document.scrollingElement.scrollTop}));
    const bounds=await locator.boundingBox();
    // Target the panel's padding, so a nested long textarea cannot consume the wheel.
    const point={x:bounds.x+7,y:bounds.y+Math.min(bounds.height/2,250)};
    const hit=await page.evaluate(({x,y})=>{const node=document.elementFromPoint(x,y);return {tag:node?.tagName,className:node?.className,insideDetail:!!node?.closest('.cf-detail')}},point);
    if(!hit.insideDetail||['TEXTAREA','SELECT','INPUT'].includes(hit.tag))failures.push('wheel target must hit the editor panel outside native fields');
    await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,before.inside>0?-1200:1200);
    await page.waitForFunction(({selector,value})=>document.querySelector(selector).scrollTop!==value,{selector:'.'+target.selector.trim().split(/\s+/).join('.'),value:before.inside},{timeout:2000}).catch(()=>{});
    const after=await locator.evaluate(node=>({inside:node.scrollTop,page:document.querySelector('.page-area').scrollTop,document:document.scrollingElement.scrollTop}));
    scrollProof={point,hit,before,after};if(after.inside===before.inside)failures.push('right editor cannot scroll with wheel');
    if(after.page!==before.page||after.document!==before.document)failures.push('right editor wheel scroll leaked to outer page');
    await locator.evaluate((node,value)=>node.scrollTop=value,before.inside);
   }
   const state=`flow-${filled?'filled-':''}${viewport.width}x${viewport.height}-step-${stage+1}`;
   await page.screenshot({path:path.join(directory,state+'.png')});
   record({state,filled,metrics,contrast,scrollProof,failures});
  }
 }
}

async function main(){
 const fixture=await startIsolatedUI(),{directory,base,call,attach,env}=fixture;
 let browser,page;const states=[],errors=[];
 const record=state=>{states.push(state);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:false,real_paid_model:false,integration:fixture.integration,states,errors,guard:fixture.guard},null,2))};
 try {
  const topics=[];for(const [i,length] of [8,32,96,180].entries())topics.push(await call('/studio/topics',{title:('隔离选题'+i+'：物业电梯更新与维保条件核对').repeat(12).slice(0,length),angle:'短角度与长角度的真实排版核对。'.repeat(i+1),rationale:'根据现场资料核对，避免把估计写成事实。'.repeat(i+1),audience:'物业经理',origin:'隔离视觉资料',source_ids:[],status:'selected',next_action:['create','rework','hold','done'][i]}));
  await call('/objects/profile',{title:'隔离测试物业顾问',position:'行业资料核对',audience:'物业经理',style:'清晰'});
  const content=await call('/objects/content',{title:'隔离旧稿：先核对更新条件',body:'## 已生成旧稿（仅测试历史数据）\n\n先核对维保记录、现场条件和设备状态。\n\n> 请向专业机构核实具体方案。\n\n- 核对资料\n- 保留记录',platform:'wechat',outcome_type:'writing',target_words:1200});
  const draft=await call('/studio/text/drafts',{title:'隔离旧稿输入',input:{brief:'根据已有现场记录向物业经理解释旧电梯更新准备。',format:'公众号文章',target_words:1200}});
  // Seed one completed historical job directly into ONLY this isolated database.
  const owner=fixture.auth.user.id,seed={owner,content_id:content.id,draft_id:draft.id};assert(owner,'isolated fixture owner');
  const python=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import json,sys; from backend import store as s; d=json.load(sys.stdin); s.init(); j=s.put(d["owner"],"job",{"status":"done","input":{"action":"studio_text","draft_id":d["draft_id"],"draft_version":1},"result":{"content_id":d["content_id"]},"message":"隔离历史任务，仅用于UI复核"}); print(j["id"])'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let seeded='',seedError='';python.stdout.on('data',c=>seeded+=c);python.stderr.on('data',c=>seedError+=c);python.stdin.end(JSON.stringify(seed));assert.equal(await new Promise(r=>python.on('exit',r)),0,seedError);assert(seeded.trim());
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});page=await browser.newPage({viewport:{width:1530,height:1000}});page.on('pageerror',e=>errors.push(e.message));await attach(page);
  const scan=async(state,scope)=>{await settleUI(page);const metrics=await page.evaluate(measureContrast,{scope,excludeUserPaper:true});assert(metrics.checked>0,state+' has no measured text');await page.screenshot({path:path.join(directory,state+'.png'),fullPage:true});record({state,...metrics,failures:metrics.violations.map(x=>`${x.selector} ${x.text}: ${x.contrast} < ${x.minimum}`),...(metrics.unmeasured.length?{needsPixelReview:true}:{})})};
  const hover=async(state,selector,scope)=>{const node=page.locator(selector).first();await node.hover();await scan(state,scope);await page.mouse.move(0,0)};
  await page.goto(base+'/?ui=1#studio/home');await page.locator('.sidebar .account-control').waitFor();await scan('sidebar-account-default','.sidebar .account-control');assert(await page.locator('.sidebar .account-name').isVisible());await hover('sidebar-account-hover','.sidebar .account-control','.sidebar .account-control');
  await page.goto(base+'/?ui=1#studio/topics');await page.locator('.tlc-table tbody tr').nth(3).waitFor();assert.equal(await page.locator('.tlc-table tbody tr').count(),4);await scan('topics-default','.tlc');
  await page.getByPlaceholder('搜索选题、来源或理由').fill('隔离选题');await scan('topics-search-value','.tlc');
  for(let i=0;i<4;i++){const row=page.locator('.tlc-table tbody tr').nth(i);await row.hover();await scan('topics-hover-length-'+[8,32,96,180][i],'.tlc');await row.locator('input[type=checkbox]').check();assert(await row.locator('input[type=checkbox]').isChecked());await page.mouse.move(0,0);await scan('topics-selected-length-'+[8,32,96,180][i],'.tlc');await row.hover();await scan('topics-selected-hover-'+i,'.tlc')}
  await hover('topics-batch-hover','.tlc-batch button:not(:disabled)','.tlc');
  for(const label of ['已归档','回收区','可用选题']){await page.getByRole('button',{name:label,exact:true}).click();await scan('topics-filter-'+label,'.tlc');assert(await page.getByRole('button',{name:label,exact:true}).evaluate(n=>n.classList.contains('is-active')));await hover('topics-filter-hover-'+label,'.tlc-views .is-active','.tlc')}
  await page.locator('.tlc-row-actions button').first().click();await page.locator('.tlc-editor').waitFor();await scan('topics-inline-form-options','.tlc');
  await page.goto(base+'/?ui=1#studio/text?draft='+draft.id);await page.locator('.article-editor').waitFor();assert.equal(await page.getByRole('tab',{name:'预览',exact:true}).getAttribute('aria-selected'),'true');
  await scan('text-old-draft-preview','.studio-v2');
  await page.locator('.st-source-detail summary').filter({hasText:'本次资料与版本'}).click();await scan('text-fields-helper-options','.studio-v2');
  for(const mode of ['编辑','双栏','预览']){await page.getByRole('tab',{name:mode,exact:true}).click();assert.equal(await page.getByRole('tab',{name:mode,exact:true}).getAttribute('aria-selected'),'true');await scan('text-selected-'+mode,'.studio-v2');await hover('text-selected-hover-'+mode,'.md-toolbar [aria-selected=true]','.studio-v2')}
  await page.getByRole('tab',{name:'编辑',exact:true}).click();await page.getByLabel('编辑生成文稿').fill(content.body+'\n\n仅本地草稿修改，用于测试启用与禁用按钮。');await scan('text-dirty-bottom-buttons','.studio-v2');await hover('text-save-hover','.md-toolbar .st-primary','.studio-v2');
  await page.goto(base+'/?ui=1#studio/image');await page.locator('.media-workbench').waitFor();await scan('media-default','.media-workbench');await page.getByRole('button',{name:'模型与参数'}).click();await page.getByLabel('生成模型').selectOption('fixture-image2');await scan('media-dropdown-options','.mw-parameters');await page.getByRole('button',{name:'完成设置'}).click();await page.locator('.media-refs-drop').waitFor();await scan('media-reference-primary-secondary','.media-workbench');
  for(const cls of ['media-refs-drop','media-refs-paste'])await hover('media-hover-'+cls,'.'+cls,'.media-refs');
  // Hold an isolated upload response to observe the actual React busy/disabled state.
  let release;const held=new Promise(r=>release=r);await page.route('**/api/studio/upload',async route=>{await held;const response=await route.fetch({url:fixture.apiBase+'/api/studio/upload'});await route.fulfill({response})});
  const chooserPromise=page.waitForEvent('filechooser');await page.locator('.media-refs-drop').click();const chooser=await chooserPromise;await chooser.setFiles({name:'隔离参考图.png',mimeType:'image/png',buffer:fs.readFileSync('build/tijian.png')});await page.locator('.media-refs-drop:disabled').waitFor();await scan('media-real-upload-disabled','.media-workbench');release();await page.unroute('**/api/studio/upload');await page.locator('.media-refs-selected .media-ref-card').waitFor();await scan('media-selected-reference','.media-workbench');
  await page.getByRole('link',{name:'图片编辑',exact:true}).click();await page.locator('.ie-workspace').waitFor();await scan('image-edit-default','.ie-workspace');
  await testWorkflow(page,{base,directory,record});
  const filled=await seedFilledFlow(fixture);await testWorkflow(page,{base,directory,record,flowId:filled.flow_id,filled:true});
  const violations=states.flatMap(s=>s.failures||[]);assert.deepEqual(errors,[]);assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:!violations.length,real_paid_model:false,integration:fixture.integration,states,errors,guard:fixture.guard},null,2));console.log(JSON.stringify({passed:!violations.length,states:states.length,violations:violations.length,directory}));assert.equal(violations.length,0,'Visual state failures; see result.json and screenshots');
 }catch(error){record({state:'execution-error',error:error.message,failures:[error.message]});if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence: '+directory);throw error}
 finally{if(browser){for(const context of browser.contexts())for(const tab of context.pages())await tab.unrouteAll({behavior:'ignoreErrors'});await browser.close()}fixture.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
