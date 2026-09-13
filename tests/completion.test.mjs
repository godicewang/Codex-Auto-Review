import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,event,enqueue,report} from './helpers.mjs';
import {isTurnComplete} from '../plugins/autoreview/src/completion.mjs';

test('many write tools cannot start audit before the final Stop and confirmed turn completion',async t=>{
 let calls=0,complete=false;const f=fixture(t,{audit:async()=>{calls++;return structuredClone(report);},completionCheck:async()=>complete});
 f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'实现并完成整轮回答'}));
 for(let i=0;i<3;i++){f.write('main.js',`export const value = ${i+2};\n`);await f.engine.drain();assert.equal(calls,0);assert.equal(f.engine.state.runs.length,0);}
 const {runId}=f.engine.hook(event(f.root,'Stop'));await f.engine.drain();assert.equal(calls,0);assert.equal(f.engine.run(runId).awaitingTurnCompletion,true);
 complete=true;f.engine.run(runId).nextCompletionCheck=0;await f.engine.drain();assert.equal(calls,1);assert.equal(f.engine.run(runId).status,'completed');assert.ok(f.engine.run(runId).completionConfirmedAt);
});
test('Stop with an outstanding write does not freeze or launch a partial round',async t=>{
 const f=fixture(t);f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'改代码'}));
 const edit=type=>f.engine.hook(event(f.root,type,'one',{tool_use_id:'long-write',tool_name:'apply_patch',tool_input:{command:'*** Update File: main.js\n'}}));
 edit('PreToolUse');fs.writeFileSync(path.join(f.root,'main.js'),'export const value = 2;\n');
 assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'tools_still_running');await f.engine.drain();assert.equal(f.engine.state.runs.length,0);
 edit('PostToolUse');await f.engine.drain();assert.equal(f.engine.state.runs.length,0);assert.ok(f.engine.hook(event(f.root,'Stop')).runId);
});
test('continued work after a Stop invalidates the candidate and final Stop freezes all changes',async t=>{
 const f=fixture(t,{completionCheck:async()=>false}),{runId}=enqueue(f);
 const edit=type=>f.engine.hook(event(f.root,type,'one',{tool_use_id:'continued-edit',tool_name:'apply_patch',tool_input:{command:'*** Add File: second.js\n'}}));
 edit('PreToolUse');fs.writeFileSync(path.join(f.root,'second.js'),'export const second = 2;\n');edit('PostToolUse');assert.equal(f.engine.run(runId).status,'cancelled');
 const next=f.engine.hook(event(f.root,'Stop'));assert.notEqual(next.runId,runId);assert.deepEqual(f.engine.run(next.runId).changedPaths,['main.js','second.js']);
});
test('completion lookup failure never starts a model and releases snapshots at its deadline',async t=>{
 let calls=0;const f=fixture(t,{completionCheck:async()=>{throw new Error('host unavailable');},audit:async()=>{calls++;return report;}}),{runId}=enqueue(f);
 f.engine.run(runId).completionDeadline=0;await f.engine.drain();assert.equal(calls,0);assert.equal(f.engine.run(runId).status,'cancelled');assert.equal(f.engine.activeAny(),false);assert.deepEqual(fs.readdirSync(path.join(f.store.dir,'blobs')),[]);
});
test('waiting for one project completion does not block a ready project',async t=>{
 const a=fixture(t,{completionCheck:async run=>run.sessionId==='other'}),b=fixture(t);enqueue(a);const p=a.engine.enable(b.root);
 const run=a.engine.manual(p.id,'检查项目 B');await a.engine.drain();await a.engine.drain();assert.equal(a.engine.run(run.id).status,'completed');
});
test('completion query requests metadata only and accepts only the matching completed turn',async()=>{
 const seen=[];const run={sessionId:'thread',turnId:'target'};
 const control=fn=>fn(async(method,params)=>{seen.push({method,params});return {data:[{id:'target',status:'inProgress'}]};});
 assert.equal(await isTurnComplete(run,{control}),false);assert.equal(seen[0].params.itemsView,'notLoaded');assert.equal(seen[0].method,'thread/turns/list');
 assert.equal(await isTurnComplete(run,{control:fn=>fn(async()=>({data:[{id:'other',status:'completed'}]}))}),false);
 assert.equal(await isTurnComplete(run,{control:fn=>fn(async()=>({data:[{id:'target',status:'completed'}]}))}),true);
});

test('pause, cancel, and shutdown abort completion queries without starting the reviewer',async t=>{
 for(const action of ['pause','cancel','close']){
  let begin,aborted=false,modelCalls=0;const ready=new Promise(resolve=>begin=resolve);
  const f=fixture(t,{completionCheck:(run,{signal}={})=>new Promise(resolve=>{
   const timer=setTimeout(()=>resolve(false),500);begin();
   signal?.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);resolve(false);},{once:true});
  }),audit:async()=>{modelCalls++;return report;}});
  const {runId}=enqueue(f),work=f.engine.drain();await ready;
  if(action==='pause')f.engine.configure(f.project.id,{enabled:false});else if(action==='cancel')f.engine.cancel(runId);else await f.engine.close();
  await work;assert.equal(aborted,true,action);assert.equal(modelCalls,0);assert.equal(f.engine.run(runId).status,'cancelled');
  assert.deepEqual(fs.readdirSync(path.join(f.store.dir,'blobs')),[]);
 }
});
test('expired completion candidates never spawn another control process and queries use the remaining deadline',async t=>{
 let calls=0,timeout;
 const f=fixture(t,{completionCheck:async(run,options)=>{calls++;timeout=options.timeoutMs;return false;}}),{runId}=enqueue(f);
 const run=f.engine.run(runId);run.completionDeadline=Date.now()+1000;await f.engine.drain();assert.ok(timeout>0&&timeout<=1000);assert.equal(calls,1);
 run.nextCompletionCheck=0;run.completionDeadline=0;await f.engine.drain();assert.equal(calls,1);assert.equal(run.status,'cancelled');
});
