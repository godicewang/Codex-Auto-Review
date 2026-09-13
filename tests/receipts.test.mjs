import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,event,enqueue} from './helpers.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';

test('hook diagnostics count returned context without retaining payloads or claiming host consumption',async t=>{
 const f=fixture(t);enqueue(f);await f.engine.drain();
 f.engine.hook(event(f.root,'UserPromptSubmit','two',{prompt:'private requirement',transcript_path:'/private/transcript',tool_input:{secret:'private source'}}));
 const {hookStats,hookReceipts}=f.store.state;
 assert.equal(hookStats.received,5);assert.equal(hookStats.contextResponses,1);assert.equal(hookStats.contextReports,1);
 assert.equal(hookReceipts.at(-1).contextReports,1);assert.ok(hookReceipts.at(-1).contextChars>0);
 assert.doesNotMatch(JSON.stringify(hookReceipts),/private|additionalContext|hostConsumed/);
 assert.deepEqual(new Store(f.store.dir).state.hookStats,hookStats);
});
test('diagnostic history remains bounded while cumulative counters survive eviction',t=>{
 const f=fixture(t);
 for(let i=0;i<300;i++)f.store.hookReceipt({hook_event_name:'Stop',session_id:'s'.repeat(1000),turn_id:String(i)},{skipped:'missing_prompt_baseline'});
 assert.equal(f.store.state.hookStats.received,300);assert.equal(f.store.state.hookReceipts.length,256);assert.equal(f.store.state.hookReceipts[0].turnId,'44');assert.equal(f.store.state.hookReceipts[0].sessionId.length,128);
});
