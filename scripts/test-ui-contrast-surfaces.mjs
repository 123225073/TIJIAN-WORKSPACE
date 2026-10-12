// Populated DOM fixtures for legacy chrome and protected authored paper.
// Uses Chromium computed paints, not a CSS-regex pass. No backend or network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const directory=path.resolve('.runtime','ui-contrast-surfaces-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const theme=fs.readFileSync('src/studio-theme.css','utf8'),outcomes=fs.readFileSync('src/outcomes.css','utf8');
const marker='/* Legacy task/proposal chrome must pair';assert(theme.includes(marker));
const oldTheme=theme.slice(0,theme.indexOf(marker)),oldOutcomes=outcomes.slice(0,outcomes.indexOf('.ts-theme .outcome-action'));
const legacy=['style','knowledge','feedback','task-workspace','work-pages','wechat-article'].map(file=>fs.readFileSync('src/'+file+'.css','utf8')).join('\n');
const fixtures=[
 {name:'legacy-outcome',html:`<section class="artifact"><div class="outcome-action"><span>隔离历史成果操作栏</span><button id="target">确定工作成果</button></div><div class="article-images"><div class="image-workspace"><div><label>配图画面<textarea placeholder="输入配图要求"></textarea></label><div class="image-options"><select><option>横版</option><option>竖版</option><option disabled>不可用</option></select></div><div class="button-row"><button disabled>等待生成</button><label class="image-upload">上传本地图片<input type="file"></label></div></div><div class="image-preview"><strong>待插入预览</strong><input placeholder="图片说明（可选）"><span class="muted">预览后再确认</span><button class="primary">确认插入文章</button></div></div></div><div class="artifact-footer"><span>草稿</span><button>保存修改</button></div></section>`},
 {name:'knowledge-popover',html:`<section class="knowledge-page"><div class="knowledge-management" open><summary>更多整理功能</summary><div class="knowledge-overview" style="position:static"><span>需核对 <strong>2</strong> 条</span><a href="#">查看核对事项</a><button id="target" class="quiet">检查文件变化</button></div></div><p class="candidate-notice">隔离历史资料：适用范围待核对。</p><section class="comparison"><h3>保留双方记录</h3><p>时间和范围可能不同</p></section><details class="knowledge-section-intro" open><summary>使用说明</summary><p>原文、来源与核查说明</p></details></section>`},
 {name:'shared-modal',html:`<section class="modal"><h2>隔离编辑表单</h2><p class="muted">保存前核对资料</p><label class="field">身份名称 <b>*</b><input value="测试定位"></label><label class="field">内容<textarea placeholder="输入完整内容"></textarea><small>内容将保存在本机</small></label><label class="field">分类<select><option>原始资料</option><option>个人记忆</option></select></label><p class="form-error" role="alert">请填写标题</p><footer class="modal-footer"><button id="target">取消</button><button class="primary">保存资料</button><button disabled>保存中</button></footer></section>`},
 {name:'feedback-cards',html:`<section class="page-operations" style="position:static"><div><strong>隔离完成样式</strong><span role="status">已完成</span><button id="target" class="quiet">收起</button></div><div class="operation-error"><strong>隔离失败样式</strong><span role="alert">请核对资料范围</span><button class="quiet operation-recover">定位并处理</button></div><div><strong>隔离进度样式</strong><div class="inline-job" role="status"><span>正在处理</span><small>仅为显示状态测试</small><div class="stream-preview"><div class="markdown"><p>本地历史过程文本</p></div></div><button class="quiet" disabled>暂不可用</button></div></div></section>`},
 {name:'selection-toolbar',html:`<div class="wa-selection-toolbar" style="position:static"><select aria-label="段落样式"><option disabled>段落样式</option><option>正文</option><option>小标题</option></select><button id="target">加粗</button><button>项目列表</button><select aria-label="选中文字颜色"><option disabled>颜色</option><option>深灰</option><option>蓝色</option></select><button disabled>暂不可用</button></div>`},
];
for(const [file,anchor] of [['ProfileFromTask.tsx','agent-fields'],['ArticleImagePicker.tsx','md-upload'],['KnowledgePage.tsx','candidate-notice'],['OperationFeedback.tsx','page-operations']])assert(fs.readFileSync('src/'+file,'utf8').includes(anchor),file+' fixture anchor changed');
const paper=`<section class="aw-section"><h3>文章界面标题</h3>${['article-preview','st-paper','wa-rich-editor','wa-preview','md-rendered'].map((name,i)=>`<div class="${name}" id="paper-${i}"><div class="markdown"><h2>纸张默认标题</h2><p>纸张默认正文</p><blockquote>默认引用</blockquote><p style="color:#087f5b" id="authored-p-${i}">作者的墨绿 <strong>继承颜色</strong></p><h2 style="color:#315ed6" id="authored-h-${i}">作者蓝色标题</h2><p><span style="color:#c34539" id="authored-span-${i}">作者红字</span></p></div></div>`).join('')}</section>`;
const browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const states=[],guard=[],report={passed:false,fixture_only:true,states,guard,directory};
const save=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.route('**/*',route=>{guard.push(route.request().url());return route.abort()});
 const mount=async(html,current,order='theme-last')=>{const base=legacy+'\n'+(current?outcomes:oldOutcomes),skin=current?theme:oldTheme;await page.setContent(`<html class="ts-theme"><head><style>${order==='theme-last'?base+'\n'+skin:skin+'\n'+base}</style></head><body><main class="shell"><div class="page-area">${html}</div></main></body></html>`);await settleUI(page)};
 const scan=async(name)=>{await settleUI(page);const result=await page.evaluate(measureContrast,{scope:'.page-area'});states.push({name,...result});save();return result};
 await mount(fixtures[0].html,false);report.baseline=await page.evaluate(measureContrast,{scope:'.outcome-action'});assert(report.baseline.violations.length,'legacy outcome must reproduce the lost contrast');
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 for(const order of ['theme-last','legacy-last'])for(const fixture of fixtures){
  await mount(fixture.html,true,order);await scan(fixture.name+'-'+order+'-default');
  const root=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#target'});
  for(const [state,forcedPseudoClasses] of [['hover',['hover']],['pressed',['hover','active']],['focus',['focus','focus-visible']]]){await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses});await scan(fixture.name+'-'+order+'-'+state)}
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});await page.locator('#target').evaluate(node=>node.disabled=true);await scan(fixture.name+'-'+order+'-disabled');
  if(order==='theme-last')await page.screenshot({path:path.join(directory,fixture.name+'.png'),fullPage:true});
 }
 const paints=()=>[...document.querySelectorAll('[id^=paper],[id^=authored]')].map(node=>({id:node.id,color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}));
 await mount(paper,false);const before=await page.evaluate(paints);await mount(paper,true);const after=await page.evaluate(paints);assert.deepEqual(after,before,'new repairs must leave authored paper colours unchanged');
 for(const entry of after){if(entry.id.startsWith('paper')){assert.equal(entry.background,'rgb(247, 248, 252)');assert.equal(entry.color,'rgb(32, 48, 71)')}else assert.equal(entry.color,entry.id.startsWith('authored-p')?'rgb(8, 127, 91)':entry.id.startsWith('authored-h')?'rgb(49, 94, 214)':'rgb(195, 69, 57)')}
 report.protectedPaper={before,after};await scan('protected-paper');await page.screenshot({path:path.join(directory,'protected-paper.png'),fullPage:true});
 report.failures=states.flatMap(s=>s.violations.map(v=>({state:s.name,...v})));report.unmeasured=states.flatMap(s=>s.unmeasured);report.passed=report.failures.length===0&&report.unmeasured.length===0&&guard.length===0;save();
 console.log(JSON.stringify({passed:report.passed,states:states.length,checked:states.reduce((n,s)=>n+s.checked,0),violations:report.failures.length,unmeasured:report.unmeasured.length,directory}));assert(report.passed,'computed contrast failures: '+directory);
}catch(error){report.executionError=error.message;save();throw error}finally{await browser.close()}
