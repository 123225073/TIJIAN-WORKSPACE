// Isolated browser fixture for account guidance. No real credentials or publishing calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const root=path.resolve('.'),out=path.join(root,'.runtime','publish-guidance-ui-'+Date.now());
await fs.mkdir(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PublishAccounts}from'./src/MatrixPublish';import'./src/matrix-navigation.css';createRoot(document.getElementById('root')).render(<PublishAccounts/>);`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',outfile:path.join(out,'fixture.js'),jsx:'automatic',write:false});
const assets=new Map(bundle.outputFiles.map(file=>[path.basename(file.path),file.contents]));
const unexpected=[];let savedConfigs=[];
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(req.method!=='GET'){unexpected.push(req.method+' '+req.url);res.writeHead(405);res.end('{}');return}
   if(req.url==='/api/wechat-publish/accounts'){res.end('{"items":[]}');return}
   if(req.url==='/api/studio/matrix-publish/config'){res.end(JSON.stringify({items:savedConfigs}));return}
   unexpected.push(req.url);res.writeHead(404);res.end('{}');return;
  }
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html class="ts-theme"><head><meta charset="UTF-8"><link rel="stylesheet" href="/fixture.css"><style>:root{--ts-line:#41536e;--ts-muted:#bfcee3;--ts-text:#edf4ff;--ts-elevated:#202d3e;--ts-accent:#a7c8ff}body{margin:0;background:#0f1621;color:#edf4ff;font:14px 'Microsoft YaHei',sans-serif}button{background:#202d3e;color:#edf4ff;cursor:pointer}a{color:#a7c8ff}.matrix-publish-config{display:grid;gap:16px}*{box-sizing:border-box}</style></head><body><div class="shell" id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);return}
  const filename=req.url==='/fixture.js'?'fixture.js':req.url==='/fixture.css'?'fixture.css':'';
  if(!filename){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':'text/css');res.end(assets.get(filename));
 }catch{res.writeHead(500);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1450,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);
 const native=page.getByRole('complementary',{name:'公众号参数获取指南'});
 await page.waitForTimeout(1000);assert.deepEqual(errors,[]);
 await native.waitFor();
 assert.match(await native.innerText(),/AppID 与 AppSecret 必须属于同一个公众号/);
 assert.match(await native.innerText(),/无需手动获取临时访问令牌/);
 assert.equal(await native.getByRole('link',{name:'打开微信开发者平台'}).getAttribute('href'),'https://developers.weixin.qq.com/platform/');
 await page.getByRole('button',{name:'添加账号',exact:true}).click();
 await page.getByRole('textbox',{name:'AppID',exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'wechat-guide.png'),fullPage:true});
 const choices=page.getByRole('navigation',{name:'选择发布平台'});
 const links={小红书:'https://creator.xiaohongshu.com/',知乎:'https://www.zhihu.com/creator',百家号:'https://baijiahao.baidu.com/',今日头条:'https://mp.toutiao.com/',简书:'https://www.jianshu.com/writer',搜狐号:'https://mp.sohu.com/'};
 for(const [label,url] of Object.entries(links)){
  await choices.getByRole('button',{name:label,exact:true}).click();
  const guide=page.getByRole('complementary',{name:label+'发布方式'});await guide.waitFor();
  assert.equal(await guide.getByRole('link').first().getAttribute('href'),url);
  assert.equal(await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).count(),0,'generic service form is not the default publishing method');
  const advanced=page.locator('summary').filter({hasText:'已有兼容发布服务'});await advanced.click();
  const serviceGuide=page.getByRole('complementary',{name:'发布参数获取指南'});
  assert.match(await serviceGuide.innerText(),/第三方接入，不是平台原生接口/);
  assert.match(await serviceGuide.innerText(),/保存连接不代表已通过真实账号发文验证/);
  assert.equal(await page.locator('pre,code').count(),0);
  assert.equal(await page.getByText('官网 / 发布服务接入格式',{exact:true}).count(),0);
  assert.equal(await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).count(),1);
 }
 await choices.getByRole('button',{name:'小红书',exact:true}).click();
 await page.getByText('尚未连接自动发布服务',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'service-guide.png'),fullPage:true});
 await choices.getByRole('button',{name:'今日头条',exact:true}).click();
 assert.match(await page.getByRole('complementary',{name:'今日头条发布方式'}).innerText(),/仅面向新闻媒体、国家机构/);
 savedConfigs=[{platform:'sohu',endpoint:'https://publisher.test/sohu',mode:'gateway',configured:true,enabled:false,revision:4,has_token:true}];
 await choices.getByRole('button',{name:'搜狐号',exact:true}).click();
 await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).inputValue(),'https://publisher.test/sohu');
 assert.equal(await page.getByRole('checkbox',{name:'启用连接'}).isChecked(),false,'existing disabled service stays disabled');
 await choices.getByRole('button',{name:'官网 / 品牌博客',exact:true}).click();
 const address=page.getByRole('textbox',{name:'WordPress 网站地址',exact:true});
 await address.waitFor();assert.equal(await page.getByRole('combobox',{name:'接入方式'}).inputValue(),'wordpress');
 await address.fill('https://example.test/brand');
 const profile=page.getByRole('link',{name:'打开我的网站个人资料'});
 assert.equal(await profile.getAttribute('href'),'https://example.test/brand/wp-admin/profile.php');
 await address.fill('https://example.test/brand/wp-json/wp/v2/');
 assert.equal(await profile.getAttribute('href'),'https://example.test/brand/wp-admin/profile.php');
 for(const invalid of ['javascript:alert(1)','https://user:secret@example.test','https://example.test/?token=secret','https://example.test/#secret']){
  await address.fill(invalid);assert.equal(await profile.count(),0);
 }
 await address.fill('https://example.test/brand');
 await page.screenshot({path:path.join(out,'wordpress-guide.png'),fullPage:true});
 savedConfigs=[{platform:'website',endpoint:'https://publisher.test/legacy-site',mode:'gateway',configured:true,enabled:true,revision:5,has_token:true}];
 await choices.getByRole('button',{name:'简书',exact:true}).click();
 await choices.getByRole('button',{name:'官网 / 品牌博客',exact:true}).click();
 await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'接入方式'}).inputValue(),'gateway','existing website gateway is never silently migrated');
 assert.equal(await page.getByRole('textbox',{name:'HTTPS 发布地址',exact:true}).inputValue(),'https://publisher.test/legacy-site');
 const widths=await page.evaluate(()=>({page:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 assert(widths.scroll<=widths.page,'account guidance must not overflow horizontally');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log(JSON.stringify({ok:true,checks:['WeChat native parameter and permission steps','six platform-specific publishing methods and official links','advanced service form hidden by default and explicitly third-party','Toutiao website-source qualification','existing service preserved without enabling','WordPress default and website-specific safe link','no mutation or external request','no horizontal overflow'],artifacts:out}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
