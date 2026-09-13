// Opt-in end-to-end test: real CLI hooks, completion metadata, reviewer, and
// next-prompt model consumption. Uses the installed plugin and existing account.
// This creates a CLI test conversation; it does not verify desktop GUI delivery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {serve} from '../plugins/autoreview/src/server.mjs';
import {git, locateCodex, cleanEnv, killTree, sha} from '../plugins/autoreview/src/util.mjs';

const base=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-cli-smoke-'));
const root=path.join(base,'project'),dir=path.join(base,'data');
fs.mkdirSync(root);
git(root,['init','--quiet']);
fs.writeFileSync(path.join(root,'main.js'),'export const value = 1;\n');
git(root,['add','.']);
git(root,['-c','user.name=AutoReview','-c','user.email=test@localhost','-c','commit.gpgsign=false','commit','--quiet','-m','fixture']);
const engine=new Engine({store:new Store(dir)});
engine.enable(root,{timeoutSeconds:240});
const toolEvents=[];
const originalHook=engine.hook.bind(engine);
engine.hook=event=>{
  const result=originalHook(event);
  toolEvents.push({event:event.hook_event_name,name:event.tool_name,id:event.tool_use_id,input:event.tool_input,outcome:result.skipped||'ok'});
  return result;
};
const env=cleanEnv({AUTOREVIEW_HOME:dir});delete env.AUTOREVIEW_WORKER;
let app,child;

async function cli(args){
  const stdout=[],stderr=[];
  child=spawn(locateCodex(),args,{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));
  const timer=setTimeout(()=>void killTree(child),180000);
  let code;
  try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
  finally{clearTimeout(timer);}
  assert.equal(code,0,Buffer.concat(stderr).toString().slice(-2000));
  return Buffer.concat(stdout).toString().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
}

try{
  app=await serve({dir,engine});
  console.log('Checking real CLI write → completed turn → independent review…');
  const first=await cli(['exec','--json','--sandbox','workspace-write','-C',root,
    '请只用 apply_patch 把 main.js 的 value 从 1 改为 2，不修改其他文件，不运行测试，不调用 AutoReview 工具。最终回复“改动完成”。']);
  const sessionId=first.find(e=>e.type==='thread.started')?.thread_id;
  assert.ok(sessionId,'CLI did not return a session ID.');
  assert.match(fs.readFileSync(path.join(root,'main.js'),'utf8'),/value = 2/);
  const sourceHash=sha(fs.readFileSync(path.join(root,'main.js'))),index=git(root,['write-tree']);
  assert.ok(engine.state.runs.some(r=>r.sessionId===sessionId),JSON.stringify({reason:'No automatic review queued',toolEvents,items:first.filter(e=>e.type==='item.completed')},null,2));
  const deadline=Date.now()+365000;
  let run;
  while(Date.now()<deadline){
    run=engine.state.runs.find(r=>r.sessionId===sessionId);
    if(run&&!['queued','reviewing'].includes(run.status))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(run,'No automatic review was queued by the real Stop hook.');
  assert.equal(run.status,'completed',run.message);
  assert.ok(run.completionConfirmedAt,'Real turn completion was not confirmed.');
  assert.equal(engine.state.adviceQueue.length,1);
  assert.equal(sha(fs.readFileSync(path.join(root,'main.js'))),sourceHash);
  assert.equal(git(root,['write-tree']),index);
  assert.equal(fs.existsSync(path.join(engine.store.runDir(run.id),'workspace')),false);
  console.log('Checking report delivery to the next real CLI prompt…');
  const second=await cli(['exec','--json','--sandbox','read-only','-C',root,'resume',sessionId,
    '本次只核对上下文，不调用任何工具、不读文件、不修改代码。如果本次附加上下文中有 AutoReview 报告，请原样写出报告的 reviewId 和结论；没有则只回复“未收到审计报告”。']);
  const messages=second.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text||'');
  assert.ok(messages.some(text=>text.includes(run.id)),'The receiving model did not echo the report ID supplied only by the hook.');
  assert.ok(run.transportAckAt);
  assert.equal(engine.state.adviceQueue.length,0);
  assert.equal(sha(fs.readFileSync(path.join(root,'main.js'))),sourceHash);
  assert.equal(git(root,['write-tree']),index);
  console.log(JSON.stringify({status:'passed',realCliHooks:true,realTurnCompletion:true,realReviewer:true,
    nextPromptModelReceivedReport:true,sourceUnchangedByReview:true,snapshotRemoved:true,
    guiVerified:false,report:run.report,findings:run.findings.length},null,2));
}finally{
  await killTree(child);
  if(app)await app.close();else await engine.close();
  fs.rmSync(base,{recursive:true,force:true});
  console.log('Temporary fixture and plugin data removed.');
}
