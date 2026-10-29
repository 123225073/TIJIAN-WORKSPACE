// Exercise the packaged backend and bundled FFmpeg with isolated data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const root=process.cwd(),version=JSON.parse(fs.readFileSync('package.json','utf8')).version,resources=path.resolve('release',version,'win-unpacked/resources');
const exe=path.join(resources,'backend/tijian-service/tijian-service.exe'),ff=path.join(resources,'media-tools/ffmpeg.exe'),probe=path.join(resources,'media-tools/ffprobe.exe');
const directory=path.resolve('.runtime','packaged-video-composition-'+Date.now());fs.mkdirSync(directory,{recursive:true});
for(const file of [exe,ff,probe])assert(fs.existsSync(file),file);
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})});
const env={...process.env,TIJIAN_DATA:path.join(directory,'data'),TIJIAN_PORT:String(port),TIJIAN_FFMPEG:ff,TIJIAN_FFPROBE:probe,TIJIAN_ALLOW_SELF_REGISTRATION:'1'};
const child=spawn(exe,[],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const base='http://127.0.0.1:'+port,hash=x=>createHash('sha256').update(x).digest('hex');let token='';
const result={directory,backend:exe,ffmpeg:ff,ffprobe:probe,productionDataTouched:false,paidCalls:0};
const fetchApi=async(url,opts={})=>{const r=await fetch(base+'/api'+url,{...opts,headers:{...(opts.headers||{}),...(token?{Authorization:'Bearer '+token}:{})}});if(!r.ok)throw Error(url+' '+r.status+' '+await r.text());return r};
try{
 for(let i=0;i<180;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}if(child.exitCode!==null||i===179)throw Error('backend unavailable: '+logs);await new Promise(r=>setTimeout(r,200))}
 const account={email:'packaged-'+randomUUID()+'@example.test',password:randomUUID()+'-Aa1!',name:'打包隔离验收'};
 const auth=await (await fetchApi('/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account)})).json();token=auth.token;
 const source=path.join(directory,'source.mp4');let cmd=spawnSync(ff,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=360x640:r=25:d=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-c:a','aac','-threads','2',source],{windowsHide:true,encoding:'utf8'});assert.equal(cmd.status,0,cmd.stderr);
 const before=fs.readFileSync(source),form=new FormData();form.append('file',new Blob([before],{type:'video/mp4'}),'sample.mp4');
 const uploaded=await (await fetchApi('/studio/upload',{method:'POST',body:form})).json();
 const payload={style:'blue',title:'电梯报价先看条件',position:'bottom',srt:'1\n00:00:00,300 --> 00:00:01,500\n电梯报价需要先看条件\n\n2\n00:00:01,500 --> 00:00:02,900\n请核对现场实际情况'};
 const output=await (await fetchApi('/studio/assets/'+uploaded.id+'/compose-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
 const original=Buffer.from(await (await fetchApi('/studio/assets/'+uploaded.id+'/file')).arrayBuffer());const video=Buffer.from(await (await fetchApi('/studio/assets/'+output.id+'/file')).arrayBuffer());
 assert.equal(hash(original),hash(before));assert(video.length>1000);const outputPath=path.join(directory,'output.mp4');fs.writeFileSync(outputPath,video);
 cmd=spawnSync(probe,['-v','error','-show_streams','-show_format','-of','json',outputPath],{encoding:'utf8',windowsHide:true});assert.equal(cmd.status,0,cmd.stderr);const info=JSON.parse(cmd.stdout);assert(info.streams.some(x=>x.codec_type==='audio'));assert(info.streams.some(x=>x.codec_type==='video'&&x.width===360&&x.height===640));assert(Math.abs(Number(info.format.duration)-3)<.15);
 cmd=spawnSync(ff,['-v','error','-y','-ss','0.8','-i',outputPath,'-frames:v','1',path.join(directory,'output-frame.png')],{encoding:'utf8',windowsHide:true});assert.equal(cmd.status,0,cmd.stderr);
 result.outputAsset=output.id;result.originalHashUnchanged=true;result.outputBytes=video.length;result.duration=Number(info.format.duration);result.dimensions='360x640';result.audioPresent=true;result.frame=path.join(directory,'output-frame.png');result.ok=true;
}catch(e){result.error=e.stack;process.exitCode=1}
finally{child.kill();fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(directory,'backend.log'),logs);console.log(JSON.stringify(result))}
