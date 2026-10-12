// Real integrated React pages, seeded historical records, disposable local backend.
// Run after main-agent build: node scripts/test-ui-contrast-workspace.mjs
// CSS-only review before that build: add --source-css. Baseline proof: --expect-red.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {startIsolatedUI,measureContrast,settleUI} from './test-studio-color-states.mjs';

const sourceCSS=process.argv.includes('--source-css'),expectRed=process.argv.includes('--expect-red');
// Freeze inputs for this run while other agents edit/build the shared checkout.
const cssFiles=['src/outcomes.css','src/studio-theme.css'];
const css=cssFiles.map(file=>({file,body:fs.readFileSync(file,'utf8')}));
const staticFiles=new Map();
function snapshot(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())snapshot(file);else staticFiles.set('/'+path.relative('dist',file).replaceAll('\\','/'),fs.readFileSync(file))}}
snapshot('dist');
const fixture=await startIsolatedUI('studio-ui-contrast'),{directory,base,attach}=fixture;
let browser,page;
const states=[],errors=[],extraGuard=[];
const report={passed:false,sourceCSS,expectRed,real_paid_model:false,fixture_only:true,integration:fixture.integration,css:css.map(({file,body})=>({file,sha256:createHash('sha256').update(body).digest('hex')})),states,errors,guard:fixture.guard,extraGuard};
const persist=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
async function seed(){
 assert.equal(fixture.env.TIJIAN_DATA,directory);
 assert(directory.startsWith(path.resolve('.runtime')+path.sep));
 const python=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['-c',String.raw`
import json,sys
from backend import store as s, assistant_workspace as aw
d=json.load(sys.stdin);s.init();owner=d['owner']
s.set_config('synthesis:'+owner,{'auto_wiki':False,'auto_memory':False,'auto_journal':False})
put=lambda kind,value:s.put(owner,kind,value)
profile=put('profile',{'title':'隔离 UI 验收身份','position':'电梯资料核对','audience':'物业经理','style':'通俗、克制','status':'accepted'})
proposal={'id':'contrast-profile-proposal','kind':'profile','operation':'create','status':'pending','fields':{'title':'隔离定位顾问','position':'把电梯资料讲清楚','audience':'物业负责人','style':'清晰表达，保留依据','views':'先核实，再提出建议','body':'## 定位方案\n\n【隔离历史数据，仅测 UI】帮助物业核对现场资料。\n\n> 依据、范围与待核对事项应清楚可见。\n\n- 不把估计写成事实\n- 保留原文来源'},'notes':['范围尚待本人确认，不能作为实际生成成果。']}
task=put('task',{'title':'隔离 IP 方案可读性验收','mode':'profile','profile_id':profile['id'],'messages':[{'role':'user','text':'【隔离历史数据】请整理定位。','at':'2026-10-01T00:00:00Z'},{'role':'assistant','text':'【隔离历史数据】请核对待写入方案。','at':'2026-10-01T00:01:00Z'}],'agent_proposal':proposal})
task=aw.attach_proposal(owner,task,proposal)
content=put('content',{'title':'隔离工作成果纸张','body':'## 纸张标题\n\n【隔离历史稿件】白纸深字应保持可读。\n\n{#color:blue}作者选定的蓝色文字{#/color}\n\n> 现场条件需要核对。','outcome_type':'writing','platform':'wechat','status':'draft'})
writing=put('task',{'title':'隔离文稿验收','mode':'writing','profile_id':profile['id'],'messages':[{'role':'user','text':'【隔离历史数据】查看已保存稿件。','at':'2026-10-01T00:00:00Z'}],'content_id':content['id'],'platform_outcomes':{'wechat':content['id']},'active_outcome':'wechat'})
source=put('source',{'title':'隔离知识原文','body':'## 资料标题\n\n【隔离历史资料】核对现场记录。','status':'ready','source_type':'用户粘贴','url':''})
issue=put('issue',{'title':'隔离待核对知识','body':'【隔离历史资料】范围不同的记录需要分别保留。','status':'pending','type':'knowledge_candidate','candidate_kind':'knowledge','reason':'缺少明确适用范围。','region':'上海','source_ids':[source['id']]})
feed=put('feed',{'title':'隔离监管栏目','url':'https://example.invalid/local-fixture','type':'web','enabled':True})
put('news',{'title':'隔离现场资料公告','body':'【隔离历史摘要】无外部读取。','feed_id':feed['id'],'published':'2026-10-01','category':'行业线索','region':'上海'})
for i in range(2):put('studio_topic',{'title':'隔离选题：'+('现场条件核对与沟通准备。'*(i+1)),'angle':'向物业说明资料准备。','rationale':'仅为隔离历史候选，尚待核对。','audience':'物业经理','origin':'本地测试资料','source_ids':[source['id']],'status':'selected','next_action':'create'})
put('studio_asset',{'title':'隔离素材条目','asset_type':'image','provider':'fixture','status':'ready','visibility':'mine','fixture_only':True})
print(json.dumps({'task':task['id'],'writing':writing['id'],'source':source['id'],'issue':issue['id']}))
`],{env:fixture.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='';python.stdout.on('data',chunk=>output+=chunk);python.stderr.on('data',chunk=>error+=chunk);
 python.stdin.end(JSON.stringify({owner:fixture.auth.user.id}));assert.equal(await new Promise(resolve=>python.on('exit',resolve)),0,error);return JSON.parse(output);
}
try{
 const ids=await seed();report.ids=ids;
 browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 page=await browser.newPage({viewport:{width:1530,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await attach(page);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){extraGuard.push(url.href);return route.abort()}
  if(url.pathname.startsWith('/api/')){
   // Pure local conversion; this endpoint neither publishes nor invokes a model.
   if(url.pathname==='/api/wechat-publish/preview')return route.continue();
   if(/generate|publish|prepare-profile|\/agent\/apply|\/jobs(?:\/|$)|optimize|\/refresh$/.test(url.pathname)||url.searchParams.get('refresh')==='true'){extraGuard.push(url.href);return route.abort()}
   return route.fallback();
  }
  const key=url.pathname==='/'?'/index.html':url.pathname,body=staticFiles.get(key);
  if(body)return route.fulfill({body,contentType:key.endsWith('.css')?'text/css':key.endsWith('.js')?'application/javascript':key.endsWith('.html')?'text/html':undefined});
  return route.fallback();
 });
 const go=async(route,selector)=>{await page.goto(base+'/?ui=1#'+route);await page.locator(selector).first().waitFor();if(sourceCSS)await page.addStyleTag({content:css.map(x=>x.body).join('\n')});await settleUI(page)};
 const scan=async(name,scope,screenshot=false)=>{
  await settleUI(page);const result=await page.evaluate(measureContrast,{scope,excludeUserPaper:true});assert(result.checked>0,name+' must contain rendered text');
  states.push({name,...result});if(screenshot)await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});persist();return result;
 };
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const controlStates=async(prefix,locator,scope)=>{
  const target=page.locator(locator).first();assert(await target.count(),prefix+' control exists');
  const id='contrast-control';await target.evaluate((node,id)=>node.id=id,id);const root=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#'+id});
  const focusable=await target.evaluate(node=>node.matches('button,input,select,textarea,a[href],[tabindex]'));
  for(const [name,forcedPseudoClasses] of [['hover',['hover']],['pressed',['hover','active']],...(focusable?[['focus',['focus','focus-visible']]]:[])]){await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses});await scan(prefix+'-'+name,scope);if(name==='focus')assert.notEqual(await target.evaluate(node=>getComputedStyle(node).outlineStyle),'none',prefix+' visible keyboard focus')}
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
  if(await target.evaluate(node=>'disabled' in node)){const original=await target.evaluate(node=>node.disabled);await target.evaluate(node=>node.disabled=true);await scan(prefix+'-disabled',scope);await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});await scan(prefix+'-disabled-hover',scope);await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});await target.evaluate((node,value)=>node.disabled=value,original)}
  await target.evaluate(node=>node.removeAttribute('id'));
 };
 await go('task/'+ids.task,'.agent-fields dd');
 await page.locator('.agent-result details:not(.profile-recovery)').evaluate(node=>node.open=true);
 const proposal=await scan('profile-proposal-default','.agent-result',true);report.proposal=proposal.entries.filter(x=>/agent-fields.*dd/.test(x.selector));
 assert(report.proposal.length>=5,'five seeded profile fields');
 if(expectRed){assert(report.proposal.some(x=>x.contrast<1.5),'baseline must reproduce pale surface and near-white profile text');report.passed=true;persist();console.log(JSON.stringify({baseline_reproduced:true,profile:report.proposal,directory}));}
 else{
  await controlStates('proposal-secondary','.agent-result .button-row button:nth-child(2)','.agent-result');
  await controlStates('proposal-primary','.agent-result .primary','.agent-result');
  await page.locator('.agent-result .button-row button:nth-child(2)').click();await page.locator('.modal').waitFor();await scan('proposal-edit-modal','.modal',true);await controlStates('modal-save','.modal .primary','.modal');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await go('studio/topics','.tlc-table tbody tr');await scan('topics-default','.tlc',true);
  await controlStates('topics-active-tab','.tlc-views .is-active','.tlc');
  await page.locator('.tlc-table tbody tr input[type=checkbox]').first().check();await scan('topics-selected','.tlc');
  await controlStates('topics-selected-row','.tlc-table tbody tr','.tlc');
  await page.locator('.tlc-row-actions button').first().click();await page.locator('.tlc-editor').waitFor();await scan('topics-form','.tlc',true);await controlStates('topics-field','.tlc-form input','.tlc');
  await go('radar','.news-row');await scan('radar-default','.radar-page',true);await controlStates('radar-tab','.radar-page .work-tabs .active','.radar-page');await controlStates('radar-search','.radar-toolbar input','.radar-page');
  await page.getByRole('button',{name:'查看摘要：隔离现场资料公告'}).click();await page.locator('.detail-drawer').waitFor();await scan('radar-reader','.detail-drawer',true);await controlStates('radar-reader-button','.drawer-actions button','.detail-drawer');
  await go('knowledge/source/'+ids.source,'.knowledge-reader-actions');await scan('knowledge-source','.knowledge-page',true);await page.getByRole('button',{name:'添加文字',exact:true}).click();await page.locator('.modal').waitFor();await scan('knowledge-import-modal','.modal',true);await controlStates('knowledge-title','.modal input[name=title]','.modal');
  await page.locator('.modal input[name=title]').fill('隔离保存反馈');await page.locator('.modal textarea[name=body]').fill('【隔离资料】用于验证实际保存通知，禁止自动整理。');
  // Isolated save only; automatic synthesis was disabled by the seed.
  await page.locator('.modal form').evaluate(form=>form.requestSubmit());await page.locator('.modal').waitFor({state:'hidden'});await page.locator('.toast').waitFor();await scan('knowledge-save-toast','.toast',true);
  // The import navigates to its new record, so its old-route progress card is gone.
  // Exercise this separate React chrome with an explicitly labelled UI event fixture.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('operation',{detail:{id:'isolated-ui-success',route:location.hash.slice(1),label:'隔离完成提示样式',path:'/isolated-ui-success',pending:false,at:Date.now()}})));await page.locator('.page-operations').waitFor();await scan('operation-complete','.page-operations',true);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('operation',{detail:{id:'isolated-ui-error',route:location.hash.slice(1),label:'隔离错误提示样式',path:'/isolated-ui-error',pending:false,error:'【仅测 UI】请核对输入资料。',at:Date.now()}})));await page.locator('.operation-error').waitFor();await scan('operation-error','.page-operations',true);await controlStates('operation-recover','.operation-recover','.page-operations');
  await go('knowledge/issues/'+ids.issue,'.candidate-notice');await scan('knowledge-issue','.knowledge-page',true);await page.getByRole('button',{name:'审阅并保存',exact:true}).click();await page.locator('.modal').waitFor();await scan('knowledge-review-modal','.modal',true);await page.getByRole('button',{name:'关闭',exact:true}).click();
  await go('studio/assets','.st-asset-card');await scan('assets-default','.studio-v2',true);await controlStates('assets-upload','.st-section-head label.st-primary','.studio-v2');await page.getByRole('textbox',{name:'搜索资源'}).fill('隔离');await scan('assets-filter-value','.studio-v2');
  await go('task/'+ids.writing,'.wa-rich-editor');await scan('writing-paper-and-chrome','.aw-results',true);
  report.paper=await page.locator('.wa-rich-editor').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,authored:getComputedStyle(node.querySelector('[data-wa-color=blue]')).color}));
  assert.equal(report.paper.background,'rgb(247, 248, 252)');assert.equal(report.paper.color,'rgb(32, 48, 71)');assert.equal(report.paper.authored,'rgb(49, 94, 214)','author-selected blue must survive');
  await page.locator('.wa-rich-editor [data-wa-color=blue]').evaluate(node=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
  await page.locator('.wa-selection-toolbar').waitFor();await scan('writing-selection-toolbar','.wa-selection-toolbar',true);await controlStates('writing-toolbar-button','.wa-selection-toolbar button','.wa-selection-toolbar');await controlStates('writing-toolbar-colour','.wa-selection-toolbar select[aria-label="选中文字颜色"]','.wa-selection-toolbar');
  await page.evaluate(()=>{getSelection().removeAllRanges();document.querySelector('.wa-rich-editor').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
  await controlStates('writing-preview-button','.aw-outcome-bar button','.aw-results');
  await page.getByRole('button',{name:'阅读预览',exact:true}).click();await page.locator('.wa-proof-frame').waitFor();
  const preview=page.frameLocator('.wa-proof-frame');await preview.getByText('作者选定的蓝色文字').waitFor();
  report.previewPaper=await preview.getByText('作者选定的蓝色文字').evaluate(node=>({background:getComputedStyle(document.documentElement).backgroundColor,authored:getComputedStyle(node).color}));assert.equal(report.previewPaper.background,'rgb(255, 255, 255)');assert.equal(report.previewPaper.authored,'rgb(49, 94, 214)');
  const frame=await (await page.locator('.wa-proof-frame').elementHandle()).contentFrame(),frameContrast=await frame.evaluate(measureContrast,{scope:'body'});assert(frameContrast.checked>0,'actual iframe paper text must be measured');states.push({name:'writing-preview-paper',...frameContrast});persist();
  await scan('writing-preview-chrome','.aw-results',true);
  report.failures=states.flatMap(state=>state.violations.map(v=>({state:state.name,...v})));report.unmeasured=states.flatMap(state=>state.unmeasured);
  report.passed=report.failures.length===0&&errors.length===0&&extraGuard.length===0&&fixture.guard.external.length===0&&fixture.guard.forbidden.length===0;persist();
  console.log(JSON.stringify({passed:report.passed,mode:sourceCSS?'integrated dist + source CSS snapshot':'integrated dist',states:states.length,checked:states.reduce((n,s)=>n+s.checked,0),violations:report.failures.length,unmeasured:report.unmeasured.length,errors,guard:fixture.guard,extraGuard,directory}));
  assert.equal(report.passed,true,'Computed UI contrast failures; see result.json and screenshots');
 }
}catch(error){report.executionError=error.message;persist();if(page)await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence: '+directory);throw error}
finally{if(browser)await browser.close();fixture.close()}
