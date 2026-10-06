// Actual built React + isolated local API; no private data or paid generation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedUI,settleUI,workflowMetrics} from './test-studio-color-states.mjs';
const fixture=await startIsolatedUI('flow-title'),report=[];let browser;
try {
 await fixture.call('/workspace',{});
 const work=await fixture.call('/studio/flow',{new:true,version:0,brief:'标题去重验收作品',stage:0});
 const other=await fixture.call('/studio/flow',{new:true,version:0,brief:'另一件标题验收作品',stage:0});
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-gpu']});
 const page=await browser.newPage();await fixture.attach(page);
 for(const viewport of [{width:1530,height:1000},{width:1366,height:768},{width:1000,height:700}]){
  await page.setViewportSize(viewport);
  for(const route of ['studio/flow','studio/flow?work='+work.id+'&step=2']){
   await page.goto(fixture.base+'/?ui=1#'+route);await page.locator('.cf-node').nth(4).waitFor();await settleUI(page);
   assert.equal(await page.locator('.workspace').getByText('一站式创作',{exact:true}).count(),1,'workspace must display the title only once');
   assert.equal(await page.locator('.workspace').getByRole('heading',{name:'一站式创作',exact:true}).count(),1,'keep the actual page heading');
   assert.equal(await page.locator('.breadcrumb').getByText('一站式创作',{exact:true}).count(),0,'do not repeat it in the breadcrumb');
   assert.equal(await page.getByRole('navigation',{name:'工作台导航'}).getByRole('button',{name:'一站式创作',exact:true}).count(),1,'keep navigation entry');
   const metrics=await workflowMetrics(page);assert.equal(metrics.nodes.length,5);assert(metrics.nodes.every(node=>node.visible&&node.buttonVisible),'all five steps must fit');
   assert(!metrics.scrolls.some(node=>node.content>node.height+2),JSON.stringify({viewport,route,scrolls:metrics.scrolls}));
   const picker=page.getByLabel('切换当前作品');const target=(await picker.inputValue())===work.id?other.id:work.id;await picker.selectOption(target);await page.locator('.cf-node').nth(4).waitFor();assert.equal(await picker.inputValue(),target);
   assert.equal(await page.locator('.workspace').getByText('一站式创作',{exact:true}).count(),1,'switching work must not reintroduce duplicate title');
   report.push({viewport,route:route.split('?')[0],passed:true});
  }
 }
 await page.goto(fixture.base+'/?ui=1#studio/text');await page.locator('.st-header').waitFor();
 assert.equal(await page.locator('.breadcrumb strong').innerText(),'文案创作','other pages retain their location breadcrumb');
 assert.deepEqual(fixture.guard,{external:[],forbidden:[]});
 await page.goto(fixture.base+'/?ui=1#studio/flow?work='+work.id);await page.locator('.cf-node').nth(4).waitFor();
 await page.screenshot({path:path.join(fixture.directory,'flow-single-title.png')});
 fs.writeFileSync(path.join(fixture.directory,'result.json'),JSON.stringify({passed:true,checks:report,private_data:false,paid_generation:false},null,2));
 console.log(JSON.stringify({passed:true,cases:report.length,title_once:true,other_breadcrumbs_preserved:true,directory:fixture.directory}));
} finally {await browser?.close();fixture.close()}
