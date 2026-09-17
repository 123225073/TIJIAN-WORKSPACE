const {app,ipcMain,safeStorage}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.runtime','remember-test-'+Date.now());
app.setPath('userData',dir);
app.whenReady().then(async()=>{
 let child;
 try{
  const port=await new Promise(r=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>r(p))})});
  const base='http://127.0.0.1:'+port;
  child=spawn(path.join(root,'.venv','Scripts','python.exe'),['-m','backend.run'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,TIJIAN_PORT:String(port),TIJIAN_DATA:path.join(dir,'data')}});
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,250));}
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'remember-test@example.test',password:require('node:crypto').randomBytes(18).toString('hex'),name:'隔离测试'})});
  const {token}=await response.json();assert.ok(token);assert.ok(safeStorage.isEncryptionAvailable());
  let handler;ipcMain.handle=(name,fn)=>{handler=fn};
  const frame={url:base},sender={mainFrame:frame},event={sender,senderFrame:frame};
  require('../desktop/remember.cjs')(()=>({webContents:sender}),()=>base);
  await handler(event,{action:'save',token});
  const file=path.join(dir,'remembered-login.bin');assert.ok(!fs.readFileSync(file).includes(Buffer.from(token)));
  assert.equal((await handler(event,{action:'read'})).token,token);
  await assert.rejects(()=>handler({sender:{},senderFrame:frame},{action:'read'}));
  await handler(event,{action:'clear'});assert.ok(!fs.existsSync(file));
  console.log('PASS: Windows encrypted credential roundtrip, caller isolation, clear');
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['Windows encryption','roundtrip','caller isolation','clear']}));
 }catch(e){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:false,error:e.message}));process.exitCode=1;}
 finally{child?.kill();app.exit(process.exitCode||0);}
});
