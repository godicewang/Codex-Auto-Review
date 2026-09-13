import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';
import {fixture,enqueue} from './helpers.mjs';import {runAudit} from '../plugins/autoreview/src/codex.mjs';
const fake=path.resolve('tests/fake-codex.mjs');
const audit=options=>runAudit({...options,executable:process.execPath,prefixArgs:[fake]});
test('actual child App Server enforces readonly isolation and returns Chinese structured findings',async t=>{const f=fixture(t,{audit});const {runId}=enqueue(f);await f.engine.drain();assert.equal(f.engine.run(runId).status,'completed');assert.match(f.engine.run(runId).findings[0].suggestion,/主对话/);assert.equal(fs.readFileSync(path.join(f.root,'main.js'),'utf8'),'export const value = 2;\n');assert.ok(f.store.events(runId).every(e=>e.type==='status'));});
test('protocol failures and cancellation terminate unfinished worker',async t=>{const f=fixture(t);await assert.rejects(audit({cwd:f.root,prompt:'fail'}),/Test failure/);const c=new AbortController(),p=audit({cwd:f.root,prompt:'hang',signal:c.signal});const timer=setTimeout(()=>c.abort(),200);t.after(()=>clearTimeout(timer));await assert.rejects(p,/cancelled|closed/);});
test('runAudit waits for actual worker exit on success, failure, and cancellation',async t=>{
 const f=fixture(t);
 for(const prompt of ['review','fail','hang']){
  const controller=new AbortController();let pid;
  const p=audit({cwd:f.root,prompt,signal:controller.signal,onEvent:e=>{
   if(e.method==='test/workerStarted'){pid=e.params.pid;if(prompt==='hang')controller.abort();}
  }});
  if(prompt==='review')await p;else await assert.rejects(p,/Test failure|cancelled|closed/);
  assert.ok(pid);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }
});
test('shutdown kills a worker and tool that ignore graceful termination before deleting their workspace',async t=>{
 let begin,pids;const started=new Promise(resolve=>begin=resolve);
 const f=fixture(t,{audit:options=>runAudit({...options,executable:process.execPath,prefixArgs:[fake,'--stubborn'],prompt:'hang',onEvent:e=>{
  if(e.method==='test/workerStarted'){pids=e.params;begin();}
 }})});
 const {runId}=enqueue(f),work=f.engine.drain();await started;
 await f.engine.close();await work;
 assert.throws(()=>process.kill(pids.pid,0),{code:'ESRCH'});
 // An OS may briefly retain an exited orphan as a zombie; allow it to be reaped.
 for(let i=0;i<40;i++){try{process.kill(pids.toolPid,0);}catch{break;}await new Promise(resolve=>setTimeout(resolve,25));}
 assert.throws(()=>process.kill(pids.toolPid,0),{code:'ESRCH'});
 assert.equal(fs.existsSync(path.join(f.store.runDir(runId),'workspace')),false);
 assert.deepEqual(fs.readdirSync(path.join(f.store.dir,'blobs')),[]);
 assert.equal(f.engine.run(runId).status,'cancelled');
});
