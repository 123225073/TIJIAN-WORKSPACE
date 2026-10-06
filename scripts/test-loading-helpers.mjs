import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const load=async file=>{
 const {outputText}=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
};
const {mergeObjects,reconcileState,queuedRefresh}=await load('src/stateLoading.ts');
const item=(version,updated,extra={})=>({id:'one',kind:'job',title:'Test',version,updated,...extra});
const old=item(1,'2026-10-06T01:00:00');
assert.equal(mergeObjects([old],[{...old}])[0],old);
assert.equal(mergeObjects([old],[item(1,'2026-10-06T01:00:01',{stream_text:'New delta'})])[0].stream_text,'New delta');
assert.equal(mergeObjects([item(2,'2026-10-06T01:00:02')],[old])[0].version,2);
assert.equal(mergeObjects([item(1,'2026-10-06T01:00:02')],[old])[0].updated,'2026-10-06T01:00:02');
assert(!mergeObjects([{...old,summary_only:true}],[old])[0].summary_only);
const state={user:{id:'alice'},objects:[old],complete:true};
assert.equal(reconcileState(state,{...state,objects:[{...old}]}),state);
const newJob={...item(1,'2026-10-06T01:00:02Z'),id:'new-job'};
assert(mergeObjects([old,newJob],[old],false,Date.parse('2026-10-06T01:00:01Z')).includes(newJob));
let releases=[],loads=0;
const refresh=queuedRefresh(async()=>{loads++;await new Promise(resolve=>releases.push(resolve))});
const first=refresh(),second=refresh(),third=refresh();
assert.equal(first,second);assert.equal(second,third);assert.equal(loads,1);
releases.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,2);
releases.shift()();await first;

// Browser API contract without live sessions, servers, or providers.
const storage=new Map();globalThis.sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
globalThis.location={pathname:'/',hash:'#studio/home'};globalThis.window=new EventTarget();
globalThis.CustomEvent=class extends Event{constructor(name,{detail}){super(name);this.detail=detail}};
const {api,setToken,restoreLogin}=await load('src/api.ts');
setToken('isolated-session');let requests=[];
globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
const read=api('/state'),shared=api('/state');assert.equal(requests.length,1);
requests.shift().resolve(new Response(JSON.stringify({ok:true})));assert.deepEqual(await read,await shared);
const pending=api('/state'),write=api('/objects/source',{title:'Save'}),afterWrite=api('/state');assert.equal(requests.length,3);
requests.splice(0).forEach(x=>x.resolve(new Response('{}')));await Promise.all([pending,write,afterWrite]);
const prior=api('/state');setToken('another-session');const next=api('/state');assert.equal(requests.length,2);
requests.shift().resolve(new Response('{"detail":"old session"}',{status:401}));await assert.rejects(prior);
requests.shift().resolve(new Response('{}'));await next;
assert.equal(storage.get('tijian-session'),'another-session');
setToken('');window.tijianDesktop={rememberLogin:async()=>({token:'restored-test'})};
const restored=restoreLogin();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests[0].url,'/api/auth/me');
requests.shift().resolve(new Response('{"user":{"id":"alice"}}'));await restored;
const failed=api('/bootstrap');requests.shift().resolve(new Response('{"detail":"Visible error"}',{status:500}));await assert.rejects(failed,/Visible error/);
const retry=api('/bootstrap');assert.equal(requests.length,1);requests.shift().resolve(new Response('{}'));await retry;
console.log('PASS: stable state, streaming updates, stale protection, queued refresh, GET sharing, write/session isolation, login and error propagation');
