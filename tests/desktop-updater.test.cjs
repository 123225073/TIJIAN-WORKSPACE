const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {registerUpdater}=require('../desktop/updater.cjs');
function fixture(options={}){
 const handlers={},updater=new EventEmitter(),contents={send(){},mainFrame:{}},calls=[];
 updater.checkForUpdates=async()=>{calls.push('check');updater.emit('update-available',{version:'0.14.1'})};
 updater.downloadUpdate=async()=>{calls.push('download');updater.emit('update-downloaded',{version:'0.14.1'})};
 updater.quitAndInstall=()=>calls.push('install');
 registerUpdater({app:{isPackaged:true,getVersion:()=> '0.14.0'},ipcMain:{handle:(key,fn)=>handlers[key]=fn},win:{webContents:contents,isDestroyed:()=>false},prepareInstall:async()=>calls.push('flush'),updater,configured:true,...options});
 return {calls,updater,call:(key)=>handlers['updates:'+key]({sender:contents,senderFrame:contents.mainFrame}),handlers};
}
test('no configured channel never claims latest or downloads',async()=>{const f=fixture({configured:false});assert.equal(f.call('get-state').status,'unconfigured');await f.call('check');await f.call('download');assert.deepEqual(f.calls,[])});
test('manual check download install phases with explicit installation',async()=>{const f=fixture();assert.equal(await f.call('install'),false);await f.call('check');assert.equal(f.call('get-state').status,'available');assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);await f.call('download');assert.equal(f.call('get-state').status,'downloaded');assert.deepEqual(f.calls,['check','download']);await f.call('install');await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,['check','download','flush','install'])});
test('failed download remains retryable and raw network errors are not exposed',async()=>{const f=fixture();await f.call('check');f.updater.downloadUpdate=async()=>{throw Error('secret-url')};await f.call('download');assert.equal(f.call('get-state').status,'error');assert(!JSON.stringify(f.call('get-state')).includes('secret-url'));assert.equal(await f.call('install'),false)});
test('foreign renderer cannot check or install',()=>{const f=fixture();assert.throws(()=>f.handlers['updates:install']({sender:{},senderFrame:{}}),/来源/)});
