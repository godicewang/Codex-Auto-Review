// Uses the existing Codex account. No API key is read, no source repair is allowed.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {Engine} from '../plugins/autoreview/src/engine.mjs';import {Store} from '../plugins/autoreview/src/store.mjs';import {git} from '../plugins/autoreview/src/util.mjs';import {capture} from '../plugins/autoreview/src/snapshot.mjs';
const base=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-readonly-real-')),root=path.join(base,'fixture');fs.mkdirSync(root);git(root,['init','--quiet']);
fs.writeFileSync(path.join(root,'total.mjs'),'export function total(prices) { return prices.reduce((sum, price) => sum + price, 0); }\n');
fs.writeFileSync(path.join(root,'README.md'),'total(prices) 对数字数组求和，空数组必须返回 0。\n');git(root,['add','.']);git(root,['-c','user.name=AutoReview','-c','user.email=test@localhost','-c','commit.gpgsign=false','commit','--quiet','-m','fixture']);
// Synthetic host lifecycle, real reviewer model. This does not verify GUI hooks
// or the GUI's turn-completion metadata: those are measured separately.
const engine=new Engine({store:new Store(path.join(base,'data')),completionCheck:async()=>true,debounceMs:60000});engine.enable(root,{timeoutSeconds:240});
const event=(type,turn='one',prompt='实现 total(prices) 数组求和。空数组必须返回 0；检查潜在错误。')=>({hook_event_name:type,cwd:root,session_id:'real-smoke',turn_id:turn,prompt});
try{
 engine.hook(event('UserPromptSubmit'));const edit=type=>engine.hook({...event(type),tool_use_id:'edit',tool_name:'apply_patch',tool_input:{command:'*** Update File: total.mjs\n'}});edit('PreToolUse');fs.writeFileSync(path.join(root,'total.mjs'),'export function total(prices) { return prices.reduce((sum, price) => sum + price); }\n');edit('PostToolUse');const before=capture(root,engine.store),index=git(root,['write-tree']);
 const {runId}=engine.hook(event('Stop'));console.log('Running one silent, read-only real Codex review…');await engine.drain();const run=engine.run(runId);
 assert.equal(run.status,'completed',run.message);assert.ok(run.findings.length>0);assert.match(run.findings[0].title,/\p{Script=Han}/u);assert.equal(capture(root,engine.store).digest,before.digest);assert.equal(git(root,['write-tree']),index);
 assert.equal(fs.existsSync(path.join(engine.store.runDir(runId),'workspace')),false);assert.equal(run.snapshot,undefined);engine.collect();assert.deepEqual(fs.readdirSync(path.join(engine.store.dir,'blobs')),[]);
 const next=engine.hook(event('UserPromptSubmit','two','接下来添加一个平均值函数。'));assert.match(next.additionalContext,/total.mjs/);assert.match(next.additionalContext,/建议|修复/);
 assert.equal(engine.state.adviceQueue.length,1);engine.acknowledgeAdvice({deliveryId:next.deliveryId,sessionId:'real-smoke',turnId:'two'});assert.equal(engine.state.adviceQueue.length,0);
 console.log(JSON.stringify({status:run.status,summary:run.report,findings:run.findings,sourceUnchanged:true,nextPromptAdvice:true},null,2));console.log('PASS: real Chinese readonly review → source unchanged → next-turn advice.');
}finally{await engine.close();fs.rmSync(base,{recursive:true,force:true});console.log('Temporary fixture and source snapshots removed.');}
