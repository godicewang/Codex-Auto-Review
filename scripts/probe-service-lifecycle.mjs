// Real local daemon/process probe in a private temporary store. No models,
// project registration, hook events, account reads, or GUI claims.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from '../plugins/autoreview/src/client.mjs';
import {killTree} from '../plugins/autoreview/src/util.mjs';
const exec=promisify(execFile),dir=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-startup-probe-'));
const client=pathToFileURL(path.resolve('plugins/autoreview/src/client.mjs')).href;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const result={kind:'real-temporary-daemon-no-hooks-no-model',startedAt:new Date().toISOString(),clients:8};let info,failure;
try{
 const starts=await Promise.allSettled(Array.from({length:result.clients},()=>exec(process.execPath,['--input-type=module','-e','const {ensureService}=await import(process.argv[1]);const info=await ensureService();console.log(info.pid);',client],{env:{...process.env,AUTOREVIEW_HOME:dir,AUTOREVIEW_WORKER:'1'},timeout:20000,maxBuffer:16000})));
 info=JSON.parse(fs.readFileSync(path.join(dir,'service.json'),'utf8'));
 const failures=starts.filter(s=>s.status==='rejected');assert.equal(failures.length,0,failures.map(s=>s.reason.message).join('\n'));
 const pids=[...new Set(starts.map(s=>Number(s.value.stdout.trim())))];assert.deepEqual(pids,[info.pid]);
 assert.equal((await request(info,'/api/health')).pid,info.pid);result.distinctDaemonPids=pids.length;
 await request(info,'/api/shutdown',{});
 for(let i=0;i<100&&alive(info.pid);i++)await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(alive(info.pid),false);assert.equal(fs.existsSync(path.join(dir,'service.lock')),false);
 result.processExited=true;result.lockReleased=true;
 const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));assert.equal(state.runs.length,0);result.modelRuns=0;
}catch(error){failure=error;result.failure=error.message;if(info)result.processState=(await exec('ps',['-o','pid=,ppid=,stat=,command=','-p',String(info.pid)]).catch(()=>({stdout:''}))).stdout.trim();}
finally{
 if(!info){try{info=JSON.parse(fs.readFileSync(path.join(dir,'service.json'),'utf8'));}catch{}}
 if(info&&alive(info.pid))await killTree({pid:info.pid});
 if(!info||!alive(info.pid)){fs.rmSync(dir,{recursive:true,force:true});result.temporaryStoreRemoved=true;}
 else throw new Error(`Probe process has not exited; retained its temporary store: ${dir}`);
}
result.finishedAt=new Date().toISOString();console.log(JSON.stringify(result,null,2));if(failure)process.exitCode=1;
