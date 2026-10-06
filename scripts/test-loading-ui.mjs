// Current-source UI smoke: a fresh studio-ui-fixture and Vite dev server only.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

const dir=path.resolve('.runtime','loading-ui-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const base='http://127.0.0.1:'+port;
const service=spawn(path.resolve('.runtime/venv/Scripts/python.exe'),['scripts/studio-ui-fixture.py'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_ALLOW_SELF_REGISTRATION:'1',PYTHONIOENCODING:'utf-8'}});
let serviceError='';service.stderr.on('data',bytes=>serviceError+=bytes);
let vite;
try{
 let ready=false;for(let n=0;n<150;n++){try{ready=(await(await fetch(base+'/api/health')).json()).ok;if(ready)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
 if(!ready)throw new Error('Isolated fixture did not start');
 let ui=base;
 if(!process.argv.includes('--built')){
  vite=await createServer({configFile:false,cacheDir:path.join(dir,'vite-cache'),plugins:[react()],optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','lucide-react','marked','dompurify']},server:{host:'127.0.0.1',port:0,proxy:{'/api':base}}});await vite.listen();
  const address=vite.httpServer.address();ui='http://127.0.0.1:'+address.port;
 }
 const child=spawn(process.execPath,['scripts/test-loading-ui-browser.cjs',dir,base,ui],{windowsHide:true,stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});
 const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
 if(code||!result.passed)throw new Error(JSON.stringify(result));
 console.log(JSON.stringify({...result,mode:process.argv.includes('--built')?'existing-main-build':'source-dev',dir}));
}finally{await vite?.close();service.kill()}
