import {spawn} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {createRequire} from 'node:module';
const dir=path.resolve('.runtime','outcome-ui-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/outcome-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port)}});let errors='';service.stderr.on('data',x=>errors+=x);const base='http://127.0.0.1:'+port;
try{
 let ready=false;for(let i=0;i<150;i++){try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(r=>setTimeout(r,150))}if(!ready)throw Error(errors);
 const child=spawn(createRequire(import.meta.url)('electron'),['scripts/test-outcome-ui-runner.cjs',dir,base],{windowsHide:true,stdio:'inherit'});
 const code=await new Promise((r,j)=>{child.on('exit',r);child.on('error',j)});const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));if(code!==0||!result.passed)throw Error(JSON.stringify(result));console.log(JSON.stringify({...result,dir}));
}finally{service.kill()}
