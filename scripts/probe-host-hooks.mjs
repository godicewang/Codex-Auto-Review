// Real ephemeral Codex CLI host, isolated plugin data, no synthetic hook events.
// Measures lifecycle delivery only; this is not a GUI injection test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {serve} from '../plugins/autoreview/src/server.mjs';
import {git,locateCodex,killTree,cleanEnv} from '../plugins/autoreview/src/util.mjs';

const base=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-host-probe-')),root=path.join(base,'project'),dir=path.join(base,'data');
fs.mkdirSync(root);git(root,['init','--quiet']);
const engine=new Engine({store:new Store(dir),completionCheck:async()=>false});engine.enable(root);
let app,child;let timedOut=false;let stdout='',stderr='';
try{
 app=await serve({dir,engine});
 const env=cleanEnv({AUTOREVIEW_HOME:dir});delete env.AUTOREVIEW_WORKER;
 child=spawn(locateCodex(),['exec','--ephemeral','--json','-C',root,'--skip-git-repo-check','--sandbox','read-only','请只回复“探针完成”，不要调用工具，不要读取或修改文件。'],{env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{stdout=(stdout+b).slice(-16000);});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
 const timer=setTimeout(()=>{timedOut=true;void killTree(child);},120000);
 let code;try{code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 const receipts=engine.state.hookReceipts||[];
 const result={at:new Date().toISOString(),kind:'real-ephemeral-cli-host-isolated-data',exitCode:code,timedOut,hookEvents:receipts.map(r=>({event:r.event,outcome:r.outcome})),userPromptObserved:receipts.some(r=>r.event==='UserPromptSubmit'),stopObserved:receipts.some(r=>r.event==='Stop'),guiInjectionVerified:false,modelReplyObserved:stdout.includes('探针完成'),...(code?{stderr}:{})};
 console.log(JSON.stringify(result,null,2));if(code||!result.userPromptObserved||!result.stopObserved)process.exitCode=1;
}finally{await killTree(child);if(app)await app.close();else await engine.close();fs.rmSync(base,{recursive:true,force:true});}
