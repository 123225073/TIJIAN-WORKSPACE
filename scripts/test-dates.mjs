import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
await build({entryPoints:['src/dates.ts'],bundle:true,platform:'node',format:'cjs',outfile:'.runtime/dates-check.cjs'});
const {localDay,monthStart,localMinute}=createRequire(import.meta.url)('../.runtime/dates-check.cjs');
for(const [y,m,d] of [[2026,0,1],[2026,8,17],[2028,1,29],[2026,11,31]]){
 const value=new Date(y,m,d,0,5);
 assert.equal(localDay(value),`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
 assert.equal(monthStart(value),`${y}-${String(m+1).padStart(2,'0')}-01`);
 assert.equal(localMinute(value),localDay(value)+'T00:05');
}
console.log('PASS: local midnight, month/year boundaries, leap day, datetime default');
