import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';

const dir=path.resolve('.runtime','019-ui-'+Date.now());
fs.mkdirSync(dir,{recursive:true});
const server=net.createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
await new Promise(resolve=>server.close(resolve));
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{
  windowsHide:true,stdio:['ignore','ignore','pipe'],
  env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1'},
});
let errors='';
service.stderr.on('data',chunk=>errors+=chunk);
const base='http://127.0.0.1:'+port;
try{
  let ready=false;
  for(let i=0;i<150;i++){
    try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(!ready)throw Error(errors||'Fixture not ready');
  const child=spawn(createRequire(import.meta.url)('electron'),['scripts/test-019-ui-runner.cjs',dir,base],{windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
  if(code!==0||!result.passed)throw Error(JSON.stringify({...result,dir}));
  console.log(JSON.stringify({...result,dir}));
}finally{service.kill()}
