import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fixture,event,enqueue,report} from './helpers.mjs';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {serve} from '../plugins/autoreview/src/server.mjs';
import {request} from '../plugins/autoreview/src/client.mjs';
import {queueAdvice,prepareAdvice,MAX_DELIVERY_RECEIPTS} from '../plugins/autoreview/src/advice.mjs';
import {id} from '../plugins/autoreview/src/util.mjs';
const receipt=(result,sessionId='session-1',turnId='next')=>({deliveryId:result.deliveryId,sessionId,turnId});
const prompt=f=>f.engine.hook(event(f.root,'UserPromptSubmit','next',{prompt:'继续'}));
const ids=result=>JSON.parse(result.additionalContext.split('\n')[1]).reports.map(r=>r.reviewId);
const dispatch=(f,{brokenPipe=false}={})=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.resolve('plugins/autoreview/hooks/dispatch.mjs')],{cwd:f.root,env:{...process.env,AUTOREVIEW_HOME:f.store.dir,AUTOREVIEW_WORKER:'0'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';if(brokenPipe)child.stdout.destroy();else child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(JSON.stringify(event(f.root,'UserPromptSubmit','next',{prompt:'继续'})));
});

test('a lost prepared response survives restart and the next prompt retries the complete report',async t=>{
 const f=fixture(t),{runId}=enqueue(f);await f.engine.drain();const ignored=prompt(f);
 assert.equal(f.engine.run(runId).deliveredAt,undefined);assert.equal(f.store.state.adviceQueue.length,1);
 await f.engine.close();const recovered=new Engine({store:new Store(f.store.dir)});t.after(()=>recovered.close());
 const retry=recovered.hook(event(f.root,'UserPromptSubmit','next',{prompt:'补充消息'}));assert.deepEqual(ids(retry),[runId]);assert.notEqual(retry.deliveryId,ignored.deliveryId);
 assert.equal(recovered.acknowledgeAdvice(receipt(retry)).acknowledgedReports,1);assert.equal(recovered.state.adviceQueue.length,0);
});
test('ACK binds to its session and turn, is idempotent, and cannot consume reports finished after preparation',async t=>{
 const f=fixture(t),{runId}=enqueue(f);await f.engine.drain();const prepared=prompt(f);
 const later={...f.engine.run(runId),id:id(),deliveredAt:undefined};f.store.state.runs.push(later);queueAdvice(f.store.state,later);
 for(const wrong of [receipt(prepared,'wrong'),receipt(prepared,'session-1','wrong'),{deliveryId:id(),sessionId:'session-1',turnId:'next'}])assert.throws(()=>f.engine.acknowledgeAdvice(wrong),/回执/);
 assert.equal(f.store.state.adviceQueue.length,2);assert.equal(f.engine.acknowledgeAdvice(receipt(prepared)).acknowledgedReports,1);
 assert.deepEqual(f.store.state.adviceQueue.map(q=>q.runId),[later.id]);assert.ok(f.engine.run(runId).transportAckAt);
 assert.equal(f.engine.acknowledgeAdvice(receipt(prepared)).alreadyAcknowledged,true);assert.equal(f.store.state.hookStats.transportAckReports,1);
});
test('unacknowledged receipt history stays bounded without evicting any pending reports',async t=>{
 const f=fixture(t);enqueue(f);await f.engine.drain();const context={projectId:f.project.id,sessionId:'session-1',turnId:'next',language:'zh',currentDigest:'x'};
 for(let i=0;i<100;i++)prepareAdvice(f.store.state,context);
 assert.equal(f.store.state.adviceDeliveries.length,MAX_DELIVERY_RECEIPTS);assert.equal(f.store.state.adviceQueue.length,1);assert.equal(f.store.state.runs[0].deliveredAt,undefined);
});
test('overlapping manual-report handoffs acknowledge a report only once without changing its recorded recipient',async t=>{
 const f=fixture(t),run=f.engine.manual(f.project.id,'检查当前项目');await f.engine.drain();
 const first=prompt(f),second=f.engine.hook(event(f.root,'UserPromptSubmit','second',{session_id:'other-session',prompt:'另一个会话'}));
 assert.deepEqual(ids(first),[run.id]);assert.deepEqual(ids(second),[run.id]);
 assert.equal(f.engine.acknowledgeAdvice(receipt(first)).acknowledgedReports,1);
 assert.equal(f.engine.acknowledgeAdvice(receipt(second,'other-session','second')).acknowledgedReports,0);
 assert.equal(f.engine.run(run.id).deliveredTurnId,'next');assert.equal(f.store.state.hookStats.transportAckReports,1);
});
test('a real dispatcher with a broken stdout pipe leaves reports pending and fails open',async t=>{
 const f=fixture(t);enqueue(f);await f.engine.drain();const app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());
 const result=await dispatch(f,{brokenPipe:true});assert.equal(result.code,0,result.stderr);
 assert.equal(f.store.state.adviceQueue.length,1);assert.equal(f.store.state.runs[0].deliveredAt,undefined);
 assert.match(fs.readFileSync(path.join(f.store.dir,'hook-errors.log'),'utf8'),/EPIPE|pipe|write/i);
});
test('ACK failure after valid stdout keeps one JSON output and retries the report on the next prompt',async t=>{
 const f=fixture(t),{runId}=enqueue(f);await f.engine.drain();const app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());
 const ack=f.engine.acknowledgeAdvice.bind(f.engine);let attempts=0;f.engine.acknowledgeAdvice=()=>{attempts++;throw new Error('Receipt transport failed');};
 const first=await dispatch(f);assert.equal(first.code,0);const output=JSON.parse(first.stdout);assert.deepEqual(JSON.parse(output.hookSpecificOutput.additionalContext.split('\n')[1]).reports.map(r=>r.reviewId),[runId]);
 assert.equal(attempts,2);assert.equal(f.store.state.adviceQueue.length,1);
 f.engine.acknowledgeAdvice=ack;const second=await dispatch(f);assert.equal(second.code,0);assert.deepEqual(JSON.parse(JSON.parse(second.stdout).hookSpecificOutput.additionalContext.split('\n')[1]).reports.map(r=>r.reviewId),[runId]);assert.equal(f.store.state.adviceQueue.length,0);
});
test('a new dispatcher upgrades a legacy daemon before submitting a prompt that could consume advice',async t=>{
 let serviceFile;
 t.after(async()=>{if(serviceFile&&fs.existsSync(serviceFile)){const info=JSON.parse(fs.readFileSync(serviceFile,'utf8'));await request(info,'/api/shutdown',{});}});
 const f=fixture(t),{runId}=enqueue(f);await f.engine.drain();serviceFile=path.join(f.store.dir,'service.json');
 const app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());let legacyHookRequests=0;
 app.server.prependListener('request',(req,res)=>{
  if(req.url==='/api/hook')legacyHookRequests++;
  if(req.url==='/api/health'){
   const end=res.end.bind(res);res.end=(body,...args)=>{const json=JSON.parse(body);delete json.hookProtocol;return end(JSON.stringify(json),...args);};
  }
 });
 const result=await dispatch(f);assert.equal(result.code,0,result.stderr);assert.equal(legacyHookRequests,0);
 assert.deepEqual(JSON.parse(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.split('\n')[1]).reports.map(r=>r.reviewId),[runId]);
 const persisted=JSON.parse(fs.readFileSync(f.store.file,'utf8'));assert.equal(persisted.adviceQueue.length,0);assert.ok(persisted.runs[0].transportAckAt);
});
