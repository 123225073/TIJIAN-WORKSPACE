// CSS-only populated DOM fixtures matching the inspected React components.
// No app build, credentials, backend, provider discovery or external requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';

const marker='/* Radar/admin colour repairs.';
const theme=fs.readFileSync('src/studio-theme.css','utf8');
assert(theme.includes(marker));
const baseline=theme.slice(0,theme.indexOf(marker));
const legacy=['style','work-pages','radar','admin','outcomes','feedback','model-services','media-registry-admin','system-library','ark-video','studio','studio-home','tishijie-home','knowledge','article-editor','wechat-article','task-workspace'].map(name=>fs.readFileSync(`src/${name}.css`,'utf8')).join('\n');
const directory=path.resolve('.runtime',`radar-admin-color-${Date.now()}`);
fs.mkdirSync(directory,{recursive:true});
const states=[],guard=[];
const field=(id,label='搜索列表')=>`<input id="${id}" aria-label="${label}" placeholder="搜索名称或内容">`;
const select=(id)=>`<select id="${id}" aria-label="筛选"><option value="all">全部分类</option><option value="on">已启用</option><option disabled>不可用选项</option></select>`;
const buttons=(prefix)=>`<div class="button-row"><button id="${prefix}-action">保存修改</button><button class="primary" id="${prefix}-primary">主要操作</button><button class="text-button" id="${prefix}-text">查看详情</button><button disabled>等待任务完成</button></div>`;
const fixtures=[
  {name:'radar-filled',html:`<main class="page-area"><div class="work-page radar-page">
    <header class="work-page-title"><div><span class="section-number">02 / TIJIAN</span><h1>行业雷达</h1><p>跟踪行业来源</p></div>${buttons('radar')}</header>
    <div class="work-tabs"><button id="radar-tab" class="active">关注信源 <span>3</span></button><button>平台热榜 <span>6 平台</span></button></div>
    <div class="radar-status-line"><span>3 个信源已启用</span><a href="#">管理信源</a></div>
    <div class="scoped-progress"><span class="progress-symbol">✓</span><div><strong>更新完成</strong><span>新增 12 条</span></div></div>
    <div class="scoped-progress has-error"><span class="progress-symbol">!</span><div><strong>部分来源失败</strong><span>查看来源说明</span></div></div>
    <div class="radar-toolbar"><div class="filter-search"><span>⌕</span>${field('radar-search')}</div>${select('radar-select')}<label class="industry-filter"><input type="checkbox" id="radar-check">电梯关键词</label></div>
    <section class="work-block news-table"><div class="block-heading"><h2>行业资讯 <small>12</small></h2><span>点击标题查看内容</span></div><button class="news-row" id="news-row"><span class="news-category">行业线索</span><span><strong>老旧电梯更新资料说明</strong><small>监管栏目 · 2026-10-07 · 上海</small></span></button></section>
    <p class="radar-explanation">综合热榜，数据按平台分别展示</p><section class="hotlist-board"><header><span class="platform-mark">抖</span><div><h2>抖音热榜</h2><small>获取于 10-07</small></div><span>12 条</span></header><div class="hotlist-rows"><button id="hot-row"><b class="top-rank">1</b><span><strong>物业现场沟通</strong><small>热度 2000</small></span></button><button><b>4</b><span><strong>行业新闻</strong><small>热度 500</small></span></button></div></section>
    <section class="radar-welcome"><h2>选择持续关注的来源</h2><p>添加行业网站</p></section></div></main>`,targets:['radar-action','radar-primary','radar-text','radar-tab','radar-search','radar-select','radar-check','news-row','hot-row'],selected:['radar-tab']},
  {name:'source-manager-filled',html:`<div class="radar-source-manager"><div class="source-manager-tools"><span>3 个信源</span>${buttons('source')}</div><div class="filter-search">${field('source-search')}</div><article class="source-card"><div class="source-card-icon">◎</div><div class="source-card-main"><header><h3>监管栏目</h3><span class="source-status">可读取</span></header><a class="source-url" href="#">本地测试来源</a><div class="source-facts"><span>关键词：电梯</span><span>发现 12 · 新增 3</span></div><p class="source-note">已读取本地测试列表</p><span class="source-status warning">获取失败</span><p class="source-note warning">检查来源说明</p><div class="source-actions"><button id="source-fetch">获取资讯</button><button disabled>已暂停</button></div></div></article></div>`,targets:['source-action','source-primary','source-search','source-fetch']},
  {name:'radar-modal-filled',html:`<div class="radar-page"><div class="reader-overlay"><section class="detail-drawer discovery-panel" role="dialog"><div class="block-heading"><h2>读取信源网页</h2><button class="icon-button" id="radar-close" aria-label="关闭">×</button></div><p class="muted">核对可见作品后勾选保存</p><label class="field">网址${field('drawer-field')}</label><details class="discovery-browser-controls" open><summary id="drawer-summary">需要登录或加载更多</summary>${select('drawer-select')}</details><div class="discovery-result"><strong>发现 12 条线索</strong><p>本地样式测试内容</p><small>日期未知请核对原页面</small></div><div class="discovery-list"><label class="discovery-entry"><input id="lead-check" type="checkbox"><span><strong>电梯行业公告</strong><small>作者 · 日期</small><a href="#">核对原文</a></span></label></div><div class="browser-leads"><label><input type="checkbox" checked><span>公告正文标题</span></label></div><p class="form-error">测试错误提示</p><p class="local-warning">当前只提供线索</p><div class="drawer-actions">${buttons('drawer')}<a class="button" href="#" id="drawer-link">浏览器原文</a></div></section></div></div>`,targets:['radar-close','drawer-field','drawer-summary','drawer-select','lead-check','drawer-action','drawer-primary','drawer-link']},
  {name:'admin-models-filled',html:`<div class="admin-shell"><aside class="admin-sidebar"><h1>梯世界 · 管理</h1><button class="active" id="admin-nav">模型与服务</button></aside><main class="admin-main"><header><h2>模型与服务</h2><span>配置作用于后续任务</span></header><div class="model-services"><div class="model-category"><button class="active" id="model-category">文本与图片模型</button><button>视频、图片与数字人</button></div><div class="provider-browser"><nav class="provider-directory"><button class="active" id="provider"><strong>本地测试服务</strong><small>2 个模型 · 已上架</small></button><button><strong>其他测试服务</strong><small>待配置</small></button></nav><section class="surface provider-section"><h2>本地模型列表</h2><span class="model-status on">已上架</span><span class="model-status off">已下架</span>${buttons('model')}<div class="model-filters">${field('model-search')}${select('model-select')}</div><p class="inline-job">测试连接状态</p><p class="inline-job failed">测试失败说明</p><div class="provider-table"><table><thead><tr><th>模型</th><th>能力</th><th>测试状态</th><th>上架</th><th>操作</th></tr></thead><tbody><tr><td>测试文本模型</td><td>文本</td><td>未测试</td><td><input id="model-check" type="checkbox" checked></td><td><button id="model-test">测试模型</button></td></tr><tr><td>测试图片模型</td><td>生图</td><td>测试中</td><td><input type="checkbox" disabled></td><td><button disabled>等待测试</button></td></tr></tbody></table></div></section></div></div></main></div>`,targets:['admin-nav','model-category','provider','model-action','model-primary','model-search','model-select','model-check','model-test'],selected:['model-category','provider']},
  {name:'admin-media-filled',html:`<div class="admin-shell"><main class="admin-main"><section class="mr-admin"><p class="mr-callout">本地媒体目录 · 测试不执行生成</p><p class="admin-notice">已保存</p><div class="provider-browser"><nav class="provider-directory"><button class="active" id="media-provider"><strong>测试媒体平台</strong><small>2 个模型 · 已上架</small></button></nav><section class="surface provider-section"><h2>媒体模型</h2><div class="model-filters">${field('media-search')}${select('media-select')}</div><div class="mr-list"><article><div><strong>测试视频模型</strong><small>AI 视频 · 本地模型编号</small><small>前台：文生视频 · 接口已适配</small></div><span class="mr-badge on">已上架</span><button id="media-edit">功能</button></article><article><div><strong>测试图片模型</strong><small>AI 生图</small></div><span class="mr-badge">已下架</span><button disabled>随平台停用</button></article></div></section></div></section></main></div>`,targets:['media-provider','media-search','media-select','media-edit'],selected:['media-provider']},
  {name:'admin-knowledge-filled',html:`<div class="admin-shell"><main class="admin-main"><section class="system-library"><header class="sl-header"><div><p class="sl-eyebrow">SYSTEM KNOWLEDGE / ADMIN</p><h2>系统知识库</h2><p>文件是依据，Wiki 是整理层</p></div></header><div class="sl-stats">${['原始文件','待解析','解析失败','异常资料','已发布 Wiki','知识关联'].map((label,i)=>`<div><strong>${i+1}</strong><span>${label}</span></div>`).join('')}</div><p class="sl-progress">解析中</p><div class="sl-layout"><aside class="sl-tree"><div class="sl-pane-title">资料分类 <small>最多六级</small></div><button class="sl-folder active" id="knowledge-folder">全部资料</button><button class="sl-folder">电梯技术</button></aside><div class="sl-main"><div class="sl-toolbar"><div class="sl-tabs"><button class="active" id="knowledge-tab">原始文件 <span>12</span></button><button>Wiki 页面 <span>9</span></button></div>${field('knowledge-search')}</div><div class="sl-table-head"><span>名称</span><span>状态</span><span>大小 / 版本</span><span>更新</span></div><button class="sl-row active" id="knowledge-row"><span class="sl-name"><strong>电梯现场资料</strong></span><span class="sl-status live">已发布</span><span>12 KB</span><span>10-07</span></button><button class="sl-row"><span class="sl-name"><strong>待解析资料</strong></span><span class="sl-status failed">解析失败</span><span>v2</span><span>10-07</span></button><div class="sl-create"><strong>在线新建</strong><button id="knowledge-create">文档</button><small>保存为原件</small></div><div class="sl-maintenance"><span>上次：尚未运行</span><button disabled>关联检查中</button></div></div><aside class="sl-detail"><div class="sl-pane-title">资料详情 <span>v2</span></div><h3>电梯现场资料</h3><label class="field">整理内容<textarea id="wiki-body">本地测试 Wiki 内容</textarea></label><div class="sl-meta"><span>校验</span><code>0123456789</code></div><div class="sl-publish"><strong>问答可见性</strong><p>发布前核对内容</p>${buttons('knowledge')}</div><div class="sl-placeholder"><h3>选择一份资料</h3><p>查看资料详情</p></div></aside></div></section></main></div>`,targets:['knowledge-folder','knowledge-tab','knowledge-search','knowledge-row','knowledge-create','wiki-body','knowledge-action','knowledge-primary'],selected:['knowledge-folder','knowledge-tab','knowledge-row']},
  {name:'admin-modal-filled',html:`<div class="admin-shell"><main class="admin-main"><div class="modal-backdrop"><section class="modal mr-modal sl-create-modal" role="dialog"><h2>配置服务平台</h2><p>本地表单样式验证</p><label class="field">平台编号<input id="modal-readonly" value="test-platform" readonly></label><label class="field">平台名称${field('modal-field')}</label><label class="field">分类${select('modal-select')}</label><label class="field">内容<textarea id="modal-body" placeholder="输入资料正文"></textarea></label><fieldset><legend>前台功能</legend><label class="switch-row"><input id="modal-check" type="checkbox" checked>图片生成</label></fieldset><details class="ark-storage-form" open><summary id="storage-summary">可选存储</summary><p>本地参数说明</p><a href="#">查看说明</a></details><p class="form-error">测试错误提示</p>${buttons('modal')}</section></div></main></div>`,targets:['modal-readonly','modal-field','modal-select','modal-body','modal-check','storage-summary','modal-action','modal-primary']},
];

fixtures.push({name:'hifly-component-states',html:`<main class="page-area"><section class="studio-v2"><section class="st-provider-guide"><strong>飞影数字人</strong><p>选择素材并准备本次输入</p><small>服务说明</small><button id="guide-button">查看使用说明</button><a id="guide-link" href="#">了解服务</a></section><div class="st-input-choice" role="radiogroup"><button id="input-choice" role="radio" aria-checked="true"><strong>视频</strong><small>使用已有视频</small></button><button role="radio" aria-checked="false">图片</button><button disabled>暂不可用</button></div><button class="st-input-choice selected" id="standalone-choice">文稿</button><div class="st-resource-empty"><strong>还没有可用资源</strong><p>从素材库选择，或创建新资源</p><a id="resource-link" href="#">打开素材库</a><button id="resource-button">创建资源</button><button disabled>等待完成</button><a aria-disabled="true">暂不可用</a></div></section></main>`,targets:['guide-button','guide-link','input-choice','standalone-choice','resource-link','resource-button'],selected:['input-choice','standalone-choice']});

// Check fixture anchors against actual sources so a renamed selector fails explicitly.
for(const [file,names] of [['WorkPages.tsx',['radar-page','news-row','news-category','hotlist-board','detail-drawer']],['RadarSources.tsx',['radar-source-manager','source-card']],['DiscoveryPanels.tsx',['discovery-result','discovery-entry']],['ModelServices.tsx',['model-category','provider-directory','provider-table']],['MediaRegistryAdmin.tsx',['mr-list','mr-modal']],['KnowledgeAdmin.tsx',['sl-stats','sl-table-head','sl-folder','sl-row']]]){
  const source=fs.readFileSync(`src/${file}`,'utf8');for(const name of names)assert(source.includes(name),`${file}: fixture selector ${name} no longer exists`);
}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',route=>{guard.push(route.request().url());return route.abort()});
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  for(const order of ['theme-last','legacy-last'])for(const fixture of fixtures){
    const html=fixture.html.replace('<div class="admin-shell"><main','<div class="admin-shell"><aside class="admin-sidebar"><h1>梯世界 · 管理</h1><p>ADMIN CONSOLE</p></aside><main');
    await page.setContent(`<html class="ts-theme"><head><style>${order==='theme-last'?legacy+'\n'+theme:theme+'\n'+legacy}</style></head><body>${html}</body></html>`);
    const scan=async(state,id)=>{
      await settleUI(page);const result=await page.evaluate(measureContrast,{scope:'body'});
      assert(result.checked>10,fixture.name+' populated text coverage');
      states.push({fixture:fixture.name,order,state,id,checked:result.checked,minimum:Math.min(...result.entries.map(x=>x.contrast)),violations:result.violations,unmeasured:result.unmeasured});
    };
    await scan('default');
    for(const id of fixture.targets){
      const target=page.locator('#'+id),root=await cdp.send('DOM.getDocument');
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#'+id});
      const force=classes=>cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:classes});
      // Selected and default appearances of the same real controls.
      const selected=fixture.selected?.includes(id);
      if(selected)await target.evaluate(node=>{node.classList.remove('active','selected');if(node.hasAttribute('aria-checked'))node.setAttribute('aria-checked','false')});
      await scan('control-default',id);
      await force(['hover']);await scan('hover',id);
      await force(['hover','active']);await scan('pressed',id);
      await force(['focus','focus-visible']);await scan('focus-visible',id);
      const outline=await target.evaluate(node=>getComputedStyle(node).outlineStyle);assert.notEqual(outline,'none',id+' keyboard focus');
      await force([]);
      if(selected){await target.evaluate(node=>{node.classList.add('active');if(node.hasAttribute('aria-checked'))node.setAttribute('aria-checked','true')});await scan('selected',id);await force(['hover']);await scan('selected-hover',id);await force(['focus','focus-visible']);await scan('selected-focus',id);await force([]);if(id!=='knowledge-row')assert.equal(await target.evaluate(node=>getComputedStyle(node).color),'rgb(154, 187, 255)',id+' selected accent')}
      const kind=await target.evaluate(node=>({tag:node.tagName,type:node.type}));
      if(['INPUT','TEXTAREA'].includes(kind.tag)&&!['checkbox','radio'].includes(kind.type)){
        const value=await target.inputValue();await target.evaluate(node=>{node.value='带值搜索 / 本地表单'});await scan('filled',id);await target.evaluate((node,value)=>{node.value=value},value);
      }
      if(kind.type==='checkbox'){await target.evaluate(node=>{node.checked=!node.checked});await scan('checked-change',id);await target.evaluate(node=>{node.checked=!node.checked})}
      if(kind.tag==='SELECT'){await target.selectOption('on');await scan('selected-option',id);await target.selectOption('all')}
      if(['BUTTON','INPUT','TEXTAREA','SELECT'].includes(kind.tag)){
        await target.evaluate(node=>{node.disabled=true});await scan('disabled',id);await force(['hover']);await scan('disabled-hover',id);if(kind.tag==='BUTTON')assert.equal(await target.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(35, 43, 56)',id+' disabled beats hover/selected');await force([]);await target.evaluate(node=>{node.disabled=false});
      }
    }
    if(order==='theme-last')await page.screenshot({path:path.join(directory,fixture.name+'.png'),fullPage:true});
  }

  // Compare established front-page and authored-paper computed colours before/after.
  const protectedMarkup=`<main class="shell"><section class="page-area"><section class="tw-home"><h1 class="tw-hero-title">首页</h1><div class="tw-chat"><textarea placeholder="开始工作">已输入目标</textarea><button class="tw-tool">图片</button></div></section><section class="knowledge-page"><button class="folder-item active">资料分类</button></section><section class="studio-v2"><div class="st-preview"><h2>结果与版本</h2></div></section><section class="benchmark-content"><div class="work-tabs"><button class="active">对标账号</button></div></section><div class="wa-rich-editor"><h2>正文标题</h2><p>正文段落 <span style="color:rgb(210,50,50)">人工红色</span></p></div></section></main>`;
  const styles=()=>[...document.querySelectorAll('body *')].map(node=>{const style=getComputedStyle(node);return {tag:node.tagName,class:node.className,color:style.color,background:style.backgroundColor,border:style.borderColor,shadow:style.boxShadow}});
  for(const order of ['theme-last','legacy-last']){
    const load=async sheet=>page.setContent(`<html class="ts-theme"><head><style>${order==='theme-last'?legacy+'\n'+sheet:sheet+'\n'+legacy}</style></head><body>${protectedMarkup}</body></html>`);
    await load(baseline);const before=await page.evaluate(styles);await load(theme);assert.deepEqual(await page.evaluate(styles),before,order+' protected colours');
  }

  // Transpile this single SVG component into the disposable test directory; no app build.
  const iconPath=path.join(directory,'PlatformIcon.mjs');
  const output=ts.transpileModule(fs.readFileSync('src/PlatformIcon.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.deepEqual(output.diagnostics,[]);fs.writeFileSync(iconPath,output.outputText);
  const {PlatformIcon}=await import(pathToFileURL(iconPath).href);
  const icons=['wechat','channels','douyin','xiaohongshu','moments'];
  const iconMarkup=icons.map(platform=>renderToStaticMarkup(React.createElement(PlatformIcon,{platform,size:64,title:platform}))).join('');
  for(const platform of icons){const svg=renderToStaticMarkup(React.createElement(PlatformIcon,{platform,size:20,className:'test-icon'}));assert(svg.includes('aria-hidden="true"'));assert(svg.includes('width="20"'));assert(svg.includes('class="test-icon"'));assert(!/<(?:image|use)|href=/.test(svg),platform+' local-only SVG')}
  assert.equal(renderToStaticMarkup(React.createElement(PlatformIcon,{platform:'公众号'})),renderToStaticMarkup(React.createElement(PlatformIcon,{platform:'wechat'})));
  await page.setContent(`<html><body style="background:#171d28;display:flex;gap:20px;padding:30px">${iconMarkup}</body></html>`);await page.screenshot({path:path.join(directory,'platform-icons.png')});
  assert.deepEqual(guard,[],'no network requests');
  const violations=states.flatMap(state=>state.violations.map(value=>({fixture:state.fixture,order:state.order,state:state.state,id:state.id,...value})));
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:!violations.length,kind:'CSS cascade fixtures; not live app acceptance',states,violations,protected_colours_unchanged:true,platform_icons:icons,network_requests:guard,build:false,provider_calls:false},null,2));
  console.log(JSON.stringify({passed:!violations.length,states:states.length,violations:violations.length,directory}));
  if(violations.length)console.log(JSON.stringify(violations.slice(0,12),null,2));
  assert.equal(violations.length,0,'See result.json for contrast failures');
}finally{await browser.close()}
