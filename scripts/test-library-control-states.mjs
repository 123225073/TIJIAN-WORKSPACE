// Deterministic CSS cascade checks for related controls, including body portals.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {measureContrast,settleUI} from './test-studio-color-states.mjs';
const legacy=['style','knowledge','library','system-library','studio','image-edit-workspace','article-image-picker'].map(n=>fs.readFileSync('src/'+n+'.css','utf8')).join('\n');
const theme=fs.readFileSync('src/studio-theme.css','utf8');
const directory=path.resolve('.runtime','library-control-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),states=[];
try {
 const cases=[
  ['folder','<div class="knowledge-page"><button class="folder-item">未分类资料</button></div>','.folder-item','active'],
  ['batch','<div class="knowledge-page"><div class="library-list-actions"><button>全选结果</button></div></div>','button'],
  ['reference-mode','<div class="reference-modes"><button>指定范围</button></div>','button','active'],
  ['reference-module','<div class="reference-modules"><div><button>知识资料</button></div></div>','button'],
  ['reference-action','<div class="reference-actions"><button>全选当前结果</button></div>','button'],
  ['system-folder','<div class="system-library"><button class="sl-folder">系统知识分类</button></div>','.sl-folder','active'],
  ['system-row','<div class="system-library"><button class="sl-row"><span class="sl-name"><strong>参考资料名称</strong></span><span>更新时间</span><span class="sl-status live">已启用</span><span>已保存</span></button></div>','.sl-row','active'],
  ['image-reference','<section class="ie-workspace"><div class="ie-source-list"><article><div><button>用作参考图</button></div></article></div></section>','button','pressed'],
  ['picture-card','<dialog class="studio-modal" open><div class="ap-grid"><article><strong>文章配图</strong><small>已保存图片</small><button>选为配图</button></article></div></dialog>','article','selected'],
  ['asset-action','<div class="studio-v2"><article class="st-asset-card"><button>下载原文件</button></article></div>','button'],
 ];
 const page=await browser.newPage({viewport:{width:1200,height:800}}),cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 for(const order of ['theme-last','legacy-last'])for(const [name,markup,selector,selected] of cases){
  await page.setContent(`<html class="ts-theme"><head><style>${order==='theme-last'?legacy+'\n'+theme:theme+'\n'+legacy}</style></head><body>${markup}</body></html>`);
  const node=page.locator(selector).first();const root=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.root.nodeId,selector});
  const force=classes=>cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:classes});
  const scan=async state=>{await settleUI(page);const snapshot=await page.evaluate(measureContrast,{scope:'body'});states.push({name,order,state,...snapshot})};
  await scan('default');await force(['hover']);await scan('hover');
  await force(['focus','focus-visible']);await scan('keyboard');await force([]);
  if(selected){await node.evaluate((n,state)=>state==='pressed'?n.setAttribute('aria-pressed','true'):n.classList.add(state),selected);await scan('selected');await force(['hover']);await scan('selected-hover')}

 }
 const violations=states.flatMap(s=>s.violations);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({passed:!violations.length,states,provider_calls:false},null,2));
 console.log(JSON.stringify({passed:!violations.length,states:states.length,violations:violations.length,directory}));assert.equal(violations.length,0);
}finally{await browser.close()}
