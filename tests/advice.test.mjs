import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,event,enqueue,report,deliveredHook} from './helpers.mjs';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {id} from '../plugins/autoreview/src/util.mjs';
import {queueAdvice,MAX_ADVICE_CHARS,MAX_REPORT_CHARS,MAX_PENDING_REPORTS} from '../plugins/autoreview/src/advice.mjs';
const payload = result => JSON.parse(result.additionalContext.split('\n').slice(1).join('\n'));
function publish(f, overrides={}) {
 const run={id:id(),projectId:f.project.id,sessionId:'session-1',turnId:id(),createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),status:'completed',prompt:'审计要求',snapshotDigest:'a'.repeat(64),report:'发现明确问题。',findings:structuredClone(report.findings),limitations:[],...overrides};
 f.store.state.runs.push(run);queueAdvice(f.store.state,run);return run;
}

test('all queued reports, including a later clean report, are delivered FIFO without overwriting findings',t=>{
 const f=fixture(t),first=publish(f),second=publish(f,{findings:[],report:'未发现有充分证据的 Bug。'}),third=publish(f);
 const result=deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'继续'})),batch=payload(result);
 assert.deepEqual(batch.reports.map(r=>r.reviewId),[first.id,second.id,third.id]);
 assert.equal(batch.reports[0].findings.length,1);assert.equal(batch.reports[1].findings.length,0);
 assert.equal(result.preparedReports,3);assert.deepEqual(f.store.state.adviceQueue,[]);
 assert.equal(deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'补充'})).additionalContext,undefined);
});

test('48k cap retains complete overflow reports and drains them on the next message even within the same turn',t=>{
 const f=fixture(t),large=structuredClone(report.findings[0]);
 Object.assign(large,{title:'明确缺陷'.repeat(16),evidence:'证'.repeat(260),impact:'影'.repeat(160),suggestion:'改'.repeat(260)});
 const findings=Array.from({length:5},()=>structuredClone(large));
 assert.ok(JSON.stringify({summary:'明确问题',findings,limitations:[]}).length<MAX_REPORT_CHARS);
 const runs=Array.from({length:20},()=>publish(f,{findings}));let delivered=[];
 while(f.store.state.adviceQueue.length){
  const result=deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'继续，处理已发现的问题'}));
  assert.ok(result.additionalContext.length<=MAX_ADVICE_CHARS);
  const batch=payload(result);assert.ok(batch.reports.length);assert.equal(batch.remainingReports,f.store.state.adviceQueue.length);
  for(const r of batch.reports){assert.deepEqual(r.findings,findings);delivered.push(r.reviewId);}
 }
 assert.deepEqual(delivered,runs.map(r=>r.id));assert.equal(new Set(delivered).size,20);
});

test('a report completed after the first user message is delivered with a later steering message',async t=>{
 const f=fixture(t);enqueue(f);
 deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'下一轮需求'}));
 await f.engine.drain();
 const result=deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'补充当前需求'}));
 assert.equal(result.preparedReports,1);assert.equal(payload(result).reports.length,1);
});

test('queues are isolated by project and conversation, with project-scoped manual reports',t=>{
 const f=fixture(t),other=fixture(t),otherProject=f.engine.enable(other.root);
 const mine=publish(f),anotherSession=publish(f,{sessionId:'other-session'}),anotherProject=publish(f,{projectId:otherProject.id}),manual=publish(f,{sessionId:'manual'});
 const batch=payload(deliveredHook(f.engine,event(f.root,'UserPromptSubmit','next',{prompt:'继续'})));
 assert.deepEqual(batch.reports.map(r=>r.reviewId),[mine.id,manual.id]);
 assert.deepEqual(f.store.state.adviceQueue.map(q=>q.runId),[anotherSession.id,anotherProject.id]);
});

test('pending queue survives restart and old undelivered stale reports migrate into it',async t=>{
 const f=fixture(t),old=publish(f,{staleAt:new Date().toISOString()}),clean=publish(f,{findings:[]});
 delete f.store.state.adviceQueue;f.store.save();
 const recovered=new Engine({store:new Store(f.store.dir)});
 const result=deliveredHook(recovered,event(f.root,'UserPromptSubmit','next',{prompt:'继续'}));
 assert.deepEqual(payload(result).reports.map(r=>r.reviewId),[old.id,clean.id]);
 await recovered.close();
 const again=new Engine({store:new Store(f.store.dir)});
 assert.deepEqual(again.state.adviceQueue,[]);await again.close();
});

test('history pruning preserves unconsumed reports and full backlog applies backpressure',t=>{
 const f=fixture(t);
 for(let i=0;i<MAX_PENDING_REPORTS;i++)publish(f,{createdAt:new Date(0).toISOString()});
 f.engine.collect();assert.equal(f.store.state.runs.length,MAX_PENDING_REPORTS);
 assert.equal(f.engine.prune(0).removed,0);
 assert.throws(()=>f.engine.manual(f.project.id,'检查代码'),/200/);
 assert.equal(f.store.state.adviceQueue.length,MAX_PENDING_REPORTS);
 assert.deepEqual(fs.readdirSync(path.join(f.store.dir,'blobs')),[]);
});

test('verbose reviewer output is rejected instead of truncated into incomplete advice',async t=>{
 const f=fixture(t,{audit:async()=>({...structuredClone(report),findings:[{...structuredClone(report.findings[0]),suggestion:'建议'.repeat(200)}]})});
 const {runId}=enqueue(f);await f.engine.drain();assert.equal(f.engine.run(runId).status,'failed');assert.deepEqual(f.store.state.adviceQueue,[]);
});
