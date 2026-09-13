// A real CLI host and real model, with a deliberately synthetic queued report.
// Verifies receipt of a random context marker plus real code-write hooks.
// This is not a real reviewer-quality or desktop-GUI test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {serve} from '../plugins/autoreview/src/server.mjs';
import {git,locateCodex,killTree,cleanEnv} from '../plugins/autoreview/src/util.mjs';

const base=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-transport-probe-')),root=path.join(base,'project'),dir=path.join(base,'data');
const marker='AUTOREVIEW-'+crypto.randomBytes(12).toString('hex');
const codeMode=!process.argv.includes('--no-code-mode');
fs.mkdirSync(root);git(root,['init','--quiet']);fs.writeFileSync(path.join(root,'main.js'),'export const value = 1;\n');
const engine=new Engine({store:new Store(dir),debounceMs:60000,completionCheck:async()=>false,audit:async()=>({summary:'未发现有充分证据的 Bug。',findings:[],limitations:[`传输测试的校验词：${marker}`]})});
const project=engine.enable(root);let app,child,result;const stdout=[],stderr=[];let timedOut=false;
const toolInputs=[];const originalHook=engine.hook.bind(engine);engine.hook=event=>{if(event.tool_name)toolInputs.push({event:event.hook_event_name,name:event.tool_name,input:event.tool_input});return originalHook(event);};
try{
 const report=engine.manual(project.id,'传输测试，不评价审计质量。');await engine.drain();
 app=await serve({dir,engine});
 const env=cleanEnv({AUTOREVIEW_HOME:dir});delete env.AUTOREVIEW_WORKER;
 child=spawn(locateCodex(),['exec','--ephemeral','--json','-C',root,'--skip-git-repo-check','--sandbox','workspace-write','-c',`features.code_mode_host=${codeMode}`,
  '请把 main.js 中 value 从 1 改为 2。若本轮附加上下文的 AutoReview 报告中有 AUTOREVIEW- 开头的校验词，在最终回复中原样写出该词；没有则写“未收到”。不要读取 AutoReview 的状态文件、环境变量或调用其 MCP 工具；只修改 main.js。'],
  {env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));
 const timer=setTimeout(()=>{timedOut=true;void killTree(child);},180000);
 let code;try{code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 const events=Buffer.concat(stdout).toString().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text||'');
 const receipts=engine.state.hookReceipts||[];
 result={at:new Date().toISOString(),kind:'real-cli-model-with-synthetic-queued-report',codeModeHost:codeMode,exitCode:code,timedOut,actualAgentMessageContainsMarker:messages.some(text=>text.includes(marker)),sourceChanged:fs.readFileSync(path.join(root,'main.js'),'utf8').includes('value = 2'),
  reportAcknowledged:!!engine.run(report.id).transportAckAt,hookEvents:receipts.map(r=>({event:r.event,outcome:r.outcome,contextReports:r.contextReports})),toolInputs,agentMessages:messages,itemTypes:[...new Set(events.map(e=>e.item?.type).filter(Boolean))],
  commandItems:events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>({command:e.item.command,exitCode:e.item.exit_code})),
  guiVerified:false,reviewerQualityVerified:false,...(code?{stderr:Buffer.concat(stderr).toString().slice(-4000)}:{})};
 if(code||!result.actualAgentMessageContainsMarker||!result.sourceChanged||!result.reportAcknowledged||!receipts.some(r=>r.event==='Stop'&&r.runId))process.exitCode=1;
}finally{await killTree(child);if(app)await app.close();else await engine.close();fs.rmSync(base,{recursive:true,force:true});}
result.temporaryDirectoryRemoved=!fs.existsSync(base);console.log(JSON.stringify(result,null,2));
