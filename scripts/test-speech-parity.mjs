// Exercise the actual TypeScript helper and Python helper with the same fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {chromium} from 'playwright-core';
const cases=JSON.parse(fs.readFileSync('tests/speech-cases.json','utf8'));
const source=fs.readFileSync('src/speech-helper.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let frontend;
try{const page=await browser.newPage();frontend=await page.evaluate(async({code,cases})=>{const {speechFromContent}=await import('data:text/javascript;base64,'+code);return cases.map(c=>speechFromContent(c.source));},{code:Buffer.from(compiled).toString('base64'),cases});}finally{await browser.close();}
const python=spawnSync(path.resolve('.runtime/venv/Scripts/python.exe'),['-c','import json,sys; from backend.speech_helper import speech_from_content; print(json.dumps([speech_from_content(c["source"]) for c in json.load(sys.stdin)],ensure_ascii=False))'],{input:JSON.stringify(cases),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});
assert.equal(python.status,0,python.stderr);const backend=JSON.parse(python.stdout);
for(let i=0;i<cases.length;i++){
 const item=cases[i],front=frontend[i],back=backend[i];
 assert.equal(front.text,item.text,item.name+' frontend text');assert.equal(back.text,item.text,item.name+' backend text');
 for(const field of ['text','source_field','needs_conversion','cleaned'])assert.deepEqual(front[field],back[field],item.name+' parity '+field);
 assert.equal(front.source_field,item.field,item.name+' explicit field');assert.equal(front.needs_conversion,item.needs_conversion,item.name+' rewrite semantics');
}
console.log(JSON.stringify({passed:true,shared_cases:cases.length,cases:cases.map(x=>x.name),real_model_called:false}));
