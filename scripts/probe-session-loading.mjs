// Real Codex App Server with an isolated CODEX_HOME and a local fake Responses
// endpoint. No account credentials, real model, GUI task, or production config.
// Compares a session created before plugin installation with a fresh session.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import readline from 'node:readline';import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Engine} from '../plugins/autoreview/src/engine.mjs';import {Store} from '../plugins/autoreview/src/store.mjs';
import {serve} from '../plugins/autoreview/src/server.mjs';import {ownHooks} from '../plugins/autoreview/src/control.mjs';
import {git,locateCodex,killTree} from '../plugins/autoreview/src/util.mjs';

const base=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-session-probe-')),root=path.join(base,'project'),home=path.join(base,'codex'),dir=path.join(base,'data');
fs.mkdirSync(root);fs.mkdirSync(home);git(root,['init','--quiet']);fs.writeFileSync(path.join(root,'main.js'),'export const value = 1;\n');
const marker='AUTOREVIEW-'+crypto.randomBytes(12).toString('hex');let phase='';const requests=[];const externalReload=process.argv.includes('--external-reload');
const api=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const text=Buffer.concat(chunks).toString();
 if(req.method!=='POST'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"data":[]}');return;}
 requests.push({phase,path:req.url,containsMarker:text.includes(marker)});
 const item={id:'msg_probe',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'探针完成。',annotations:[]}]};
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const event of [
  {type:'response.created',response:{id:'resp_probe',status:'in_progress',output:[]}},
  {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
  {type:'response.output_text.delta',item_id:'msg_probe',output_index:0,content_index:0,delta:'探针完成。'},
  {type:'response.output_item.done',output_index:0,item},
  {type:'response.completed',response:{id:'resp_probe',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}
 ])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
 res.end();
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
fs.writeFileSync(path.join(home,'config.toml'),`model_provider = "fixture"\nmodel = "fixture-model"\nmodel_context_window = 32000\n[model_providers.fixture]\nname = "Local test fixture"\nbase_url = "http://127.0.0.1:${api.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
const env={...process.env,CODEX_HOME:home,AUTOREVIEW_HOME:dir};delete env.AUTOREVIEW_WORKER;
const engine=new Engine({store:new Store(dir),audit:async()=>({summary:'未发现有充分证据的 Bug。',findings:[],limitations:[`传输测试校验词：${marker}`]})});engine.enable(root);
let app,child,lines;const pending=new Map();let seq=0;const waits=new Map();const diagnostics=[];
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const turn=async(threadId,label)=>{phase=label;const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Turn timed out: '+label)),45000);waits.set(threadId,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});done.catch(()=>{});await call('turn/start',{threadId,input:[{type:'text',text:'仅回复探针完成，不调用工具。',text_elements:[]}]});return done;};
let result;
try{
 app=await serve({dir,engine});
 child=spawn(locateCodex(),['app-server','--listen','stdio://'],{env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 child.stderr.on('data',b=>{diagnostics.push(b.toString());if(diagnostics.length>20)diagnostics.shift();});
 lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{
  let m;try{m=JSON.parse(line);}catch{return;}
  const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
  if(m.method==='turn/completed')waits.get(m.params.threadId)?.resolve(m.params.turn.status);
  if(m.id!==undefined&&m.method)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32000,message:'No unattended approvals in this probe'}})+'\n');
 });
 await call('initialize',{clientInfo:{name:'autoreview_session_probe',version:'0.2.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const start=()=>call('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
 const old=await start();
 for(const args of [['plugin','marketplace','add',process.cwd()],['plugin','add','autoreview@personal']]){
  const installed=spawnSync(locateCodex(),args,{env,encoding:'utf8',timeout:30000});if(installed.status)throw new Error(installed.stderr);
 }
 const cache=path.join(home,'plugins/cache/personal/autoreview');const installedRoot=path.join(cache,fs.readdirSync(cache)[0]);
 const hooks=ownHooks(await call('hooks/list',{cwds:[root]}),installedRoot);
 const update={edits:hooks.map(h=>({keyPath:`hooks.state.${JSON.stringify(h.key)}`,value:{enabled:true,trusted_hash:h.currentHash},mergeStrategy:'upsert'})),reloadUserConfig:true};
 if(externalReload){const code=`import {withControl} from ${JSON.stringify(pathToFileURL(path.resolve('plugins/autoreview/src/control.mjs')).href)};await withControl(call=>call('config/batchWrite',${JSON.stringify(update)}));`;const applied=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',timeout:30000});if(applied.status)throw new Error(applied.stderr);}
 else await call('config/batchWrite',update);
 engine.manual(engine.list().projects[0].id,'传输测试');await engine.drain();
 const oldStatus=await turn(old.thread.id,'existing-session');
 const oldReceipts=(engine.state.hookReceipts||[]).filter(r=>r.sessionId===old.thread.id).length;
 engine.manual(engine.list().projects[0].id,'传输测试');await engine.drain();
 const fresh=await start();const freshStatus=await turn(fresh.thread.id,'fresh-session');
 const freshReceipts=(engine.state.hookReceipts||[]).filter(r=>r.sessionId===fresh.thread.id).length;
 await call('config/batchWrite',{edits:[],reloadUserConfig:true});engine.manual(engine.list().projects[0].id,'传输测试');await engine.drain();
 const reloadedStatus=await turn(old.thread.id,'existing-session-after-same-server-reload');
 result={at:new Date().toISOString(),kind:'real-codex-with-local-model-protocol-fixture',initialReload:externalReload?'separate-server':'same-server',hooksDiscoveredAfterInstall:hooks.length,oldStatus,freshStatus,reloadedStatus,oldSessionReceipts:oldReceipts,freshSessionReceipts:freshReceipts,oldSessionReceiptsAfterReload:(engine.state.hookReceipts||[]).filter(r=>r.sessionId===old.thread.id).length,requests,realModel:false,guiVerified:false};
}catch(error){result={error:error.message,requests,diagnostics:diagnostics.join('').slice(-2500)};process.exitCode=1;}
finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Probe closed'));}for(const w of waits.values())w.reject(new Error('Probe closed'));lines?.close();await killTree(child);if(app)await app.close();else await engine.close();api.close();api.closeAllConnections();fs.rmSync(base,{recursive:true,force:true});}
result.temporaryDirectoryRemoved=!fs.existsSync(base);console.log(JSON.stringify(result,null,2));
