import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
const dir=path.resolve('.runtime/wechat-ui');fs.mkdirSync(dir,{recursive:true});
const bundle=await build({write:false,stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {WechatDiscovery} from './src/WechatDiscovery';
 import {createRun,advance,view} from './desktop/wechat-list.cjs';
 const run=createRun({name:'测试发布账号',biz:'TARGET_BIZ'},{});
 const page=async begin=>({base_resp:{ret:0},publish_page:{total_count:40,publish_list:Array.from({length:Math.min(5,40-begin)},(_,i)=>({publish_info:{appmsgex:[{title:'该账号文章 '+(begin+i+1),link:'https://mp.weixin.qq.com/s?__biz=TARGET_BIZ&mid='+(begin+i+1)+'&idx=1',create_time:1704067200}]}}))}});
 window.tijianDesktop={wechatDiscovery:async data=>{if(data.action==='cancel')return {};await advance(run,page,data.confirm_all);return {id:'fixture',...view(run)}}};
 createRoot(document.getElementById('root')).render(<React.StrictMode><WechatDiscovery account={{url:'https://mp.weixin.qq.com/s/fixture'}} t={{}} onClose={()=>{}}/></React.StrictMode>);
 `},bundle:true,format:'iife',platform:'browser',outfile:path.join(dir,'ui.js')});

const css=fs.readdirSync('dist/assets').find(x=>x.endsWith('.css'));
fs.copyFileSync(path.join('dist/assets',css),path.join(dir,'style.css'));
fs.writeFileSync(path.join(dir,'index.html'),'<html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><div id="root"></div><script src="ui.js"></script></html>');
const electron=createRequire(import.meta.url)('electron');
const payloads=new Map(['index.html','style.css'].map(file=>['/'+file,fs.readFileSync(path.join(dir,file))]));
payloads.set('/ui.js',Buffer.from(bundle.outputFiles[0].contents));
const server=http.createServer((req,res)=>{const file=req.url==='/'?'/index.html':req.url;const body=payloads.get(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(body||'');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(electron,['scripts/test-wechat-ui-runner.cjs',dir,'http://127.0.0.1:'+server.address().port],{windowsHide:true,stdio:'ignore'});
const r=await new Promise(resolve=>child.on('exit',status=>resolve({status})));server.close();
const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));if(r.status!==0||!result.passed)throw Error(JSON.stringify(result));console.log('PASS: rendered React flow pauses at 30, confirms all 40, preserves front-loaded scope controls under StrictMode');
