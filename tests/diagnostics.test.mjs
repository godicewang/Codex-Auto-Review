import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './helpers.mjs';
import {MAX_LOG_BYTES,trimDiagnostic,appendDiagnostic} from '../plugins/autoreview/src/diagnostics.mjs';

test('diagnostic maintenance keeps recent lines bounded while an append descriptor remains open',t=>{
 const f=fixture(t),file=path.join(f.store.dir,'service.log');
 fs.writeFileSync(file,'旧日志\n'.repeat(MAX_LOG_BYTES/8)+'最近记录\n');
 const fd=fs.openSync(file,'a');try{
  trimDiagnostic(file);assert.ok(fs.statSync(file).size<MAX_LOG_BYTES);
  fs.writeSync(fd,'继续写入\n');assert.match(fs.readFileSync(file,'utf8'),/最近记录\n继续写入\n$/);
  assert.equal(fs.readFileSync(file,'utf8').includes('\uFFFD'),false);
 }finally{fs.closeSync(fd);}
 for(let i=0;i<100;i++)appendDiagnostic(path.join(f.store.dir,'hook-errors.log'),new Error('x'.repeat(30000)));
 assert.ok(fs.statSync(path.join(f.store.dir,'hook-errors.log')).size<=MAX_LOG_BYTES);
 f.engine.collect();assert.equal(f.engine.state.cleanupError,undefined);
});

test('a broken diagnostic path reports maintenance failure without retaining a completed workspace',async t=>{
 const {enqueue}=await import('./helpers.mjs');const f=fixture(t),{runId}=enqueue(f);
 fs.mkdirSync(path.join(f.store.dir,'hook-errors.log'));await f.engine.drain();
 assert.equal(f.engine.run(runId).status,'completed');assert.equal(fs.existsSync(path.join(f.store.runDir(runId),'workspace')),false);
 assert.deepEqual(fs.readdirSync(path.join(f.store.dir,'blobs')),[]);assert.match(f.engine.state.cleanupError,/hook-errors.log|directory/i);
 fs.rmdirSync(path.join(f.store.dir,'hook-errors.log'));f.engine.collect();assert.equal(f.engine.state.cleanupError,undefined);
});
