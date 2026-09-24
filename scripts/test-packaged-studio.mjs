// Runs the packaged backend with an isolated copy of settings, never the live workspace.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import crypto from 'node:crypto';
const root=path.resolve('.'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,dir=path.join(root,'.runtime','packaged-studio-'+Date.now()),bundle=path.join(root,'release',version,'win-unpacked','resources');fs.mkdirSync(dir,{recursive:true});
const dbSetup=`import os,sqlite3,json,hashlib,secrets,time,shutil
from pathlib import Path
dest=Path(os.environ['TEST_DATA']);source=Path(os.environ['APPDATA'])/'elevator-workbench'/'data'
with sqlite3.connect((source/'workbench.sqlite').as_uri()+'?mode=ro',uri=True) as old,sqlite3.connect(dest/'workbench.sqlite') as new:old.backup(new)
shutil.copyfile(source/'provider.key',dest/'provider.key')
with sqlite3.connect(dest/'workbench.sqlite') as db:
    before={k:hashlib.sha256(v.encode()).hexdigest() for k,v in db.execute('SELECT key,value FROM config') if k in ('providers','models','bindings','reference_chunks_config')}
    owner=db.execute("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1").fetchone()[0]
    for key,value in list(db.execute("SELECT key,value FROM config WHERE key LIKE 'workspace:%'")):db.execute('UPDATE config SET value=? WHERE key=?',(json.dumps(str(dest/'workspaces'/key.split(':',1)[1])),key))
    db.execute('INSERT OR REPLACE INTO config VALUES (?,?)',('automatic_knowledge_enabled','false'))
    token=secrets.token_urlsafe(40);db.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),owner,time.time()+3600))
    counts=dict(db.execute('SELECT kind,count(*) FROM objects GROUP BY kind'))
print(json.dumps({'token':token,'before':before,'counts':counts}))
`;
const setup=spawnSync(path.join(root,'.runtime','venv','Scripts','python.exe'),['-c',dbSetup],{windowsHide:true,encoding:'utf8',env:{...process.env,TEST_DATA:dir}});if(setup.status!==0)throw Error('Could not prepare isolated upgrade fixture');
const fixture=JSON.parse(setup.stdout);
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));const base='http://127.0.0.1:'+port;
let child;
async function start(){child=spawn(path.join(bundle,'backend','tijian-service','tijian-service.exe'),[],{windowsHide:true,stdio:'ignore',cwd:dir,env:{...process.env,TIJIAN_DATA:dir,TIJIAN_PORT:String(port),TIJIAN_FFPROBE:path.join(bundle,'media-tools','ffprobe.exe')}});for(let i=0;i<100;i++){try{if((await(await fetch(base+'/api/health')).json()).ok)return}catch{}await new Promise(r=>setTimeout(r,150))}throw Error('Packaged backend startup failed')}
async function stop(){if(child){const p=child;child=null;p.kill();await new Promise(r=>p.once('exit',r))}}
async function api(url,options={}){const r=await fetch(base+'/api'+url,{...options,headers:{Authorization:'Bearer '+fixture.token,...options.headers}});if(!r.ok)throw Error('Packaged API failed '+url+' '+r.status);return r}
try{
 await start();const health=await(await api('/health')).json();if(health.version!==version)throw Error('Unexpected packaged version');
 const creator=await(await fetch(base+'/')).text(),admin=await(await fetch(base+'/admin.html')).text();if(!creator.includes('workspace-')||!admin.includes('admin-'))throw Error('Separate frontend entries missing');
 const catalogue=await(await api('/studio/catalog')).json();if(catalogue.tools.length!==11)throw Error('Media catalogue incomplete');
 const wav=Buffer.alloc(44+6*16000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'isolated-six-seconds.wav');const asset=await(await api('/studio/upload',{method:'POST',body:form})).json();if(asset.duration!==6)throw Error('Packaged media probe failed');
 await stop();await start();const received=Buffer.from(await(await api('/studio/assets/'+asset.id+'/file')).arrayBuffer());if(crypto.createHash('sha256').update(received).digest('hex')!==crypto.createHash('sha256').update(wav).digest('hex'))throw Error('Media changed after restart');
 await stop();
 const check=`import sqlite3,hashlib,json,os
from pathlib import Path
p=Path(os.environ['TEST_DATA']);f=json.loads(os.environ['FIXTURE_JSON'])
with sqlite3.connect(p/'workbench.sqlite') as db:
    now={k:hashlib.sha256(v.encode()).hexdigest() for k,v in db.execute('SELECT key,value FROM config') if k in f['before']}
    assert now==f['before'],'Configuration changed'
    counts=dict(db.execute('SELECT kind,count(*) FROM objects GROUP BY kind'))
    assert all(counts.get(k,0)>=v for k,v in f['counts'].items()),'Existing records lost'
print('preserved')`;
 const tested=spawnSync(path.join(root,'.runtime','venv','Scripts','python.exe'),['-c',check],{windowsHide:true,encoding:'utf8',env:{...process.env,TEST_DATA:dir,FIXTURE_JSON:JSON.stringify(fixture)}});if(tested.status!==0)throw Error('Data preservation check failed');
 const report={passed:true,packaged_backend:true,version:health.version,independent_admin_entry:true,media_probe_seconds:asset.duration,media_survives_restart:true,existing_config_and_records_preserved:true,live_data_read_only:true,live_providers_called:false};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,dir}));
}finally{await stop()}
