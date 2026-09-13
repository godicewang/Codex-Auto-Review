import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {activateIntegration,REQUIRED_EVENTS,ownHooks} from '../plugins/autoreview/src/control.mjs';
import {fixture} from './helpers.mjs';
const root=fs.realpathSync(path.resolve('plugins/autoreview'));
const metadata=()=>REQUIRED_EVENTS.map((eventName,i)=>({eventName,key:`autoreview@personal:hooks/hooks.json:${eventName}:0:0`,source:'plugin',sourcePath:path.join(root,'hooks/hooks.json'),pluginId:'autoreview@personal',handlerType:'command',command:`node "${path.join(root,'hooks/dispatch.mjs')}"`,currentHash:'sha256:'+String(i).repeat(64),trustStatus:'untrusted',enabled:true,isManaged:false}));
test('activation records only exact installed AutoReview hashes with the official config API',async()=>{
 const hooks=metadata(),other={...hooks[0],pluginId:'unrelated@personal',key:'unrelated-key'};let edits;
 const control=fn=>fn(async(method,params)=>{
  if(method==='hooks/list')return {data:[{hooks:[...hooks,other]}]};
  assert.equal(method,'config/batchWrite');edits=params.edits;hooks.forEach(h=>h.trustStatus='trusted');return {};
 });
 assert.deepEqual(await activateIntegration('/project',{pluginRoot:root,control}),{ready:true,hookCount:6,scope:'configuration',existingSessionRefresh:'new_task_or_same_host_config_reload'});assert.equal(edits.length,6);assert.ok(edits.every(e=>e.keyPath.startsWith('hooks.state."autoreview@personal:')));assert.equal(other.trustStatus,'untrusted');
 await activateIntegration('/project',{pluginRoot:root,control});assert.equal(edits.length,6);
});
test('missing or unexpected hook definitions fail without trusting other plugins or applying a bypass',async()=>{
 const hooks=metadata();hooks[0].command='node other-code.mjs';assert.throws(()=>ownHooks({data:[{hooks}]},root),/不匹配/);
 assert.throws(()=>ownHooks({data:[{hooks:metadata().slice(1)}]},root),/缺少/);
 let wrote=false;await assert.rejects(activateIntegration('/project',{pluginRoot:root,control:fn=>fn(async method=>{if(method==='hooks/list')return {data:[{hooks}]};wrote=true;return {};})}));assert.equal(wrote,false);
});
test('desktop action connects and enables the supplied project without affecting other project switches',async t=>{
 const f=fixture(t);const {serve}=await import('../plugins/autoreview/src/server.mjs');const {request}=await import('../plugins/autoreview/src/client.mjs');const calls=[];
 const app=await serve({dir:f.store.dir,engine:f.engine,persist:false,activate:async root=>{calls.push(root);return {ready:true,hookCount:6};}});t.after(()=>app.close());
 f.engine.configure(f.project.id,{enabled:false});await assert.rejects(request(app,'/api/desktop/connect',{}),/当前 Codex/);
 const p=await request(app,'/api/desktop/connect',{root:f.root});assert.equal(p.enabled,true);assert.deepEqual(calls,[fs.realpathSync(f.root)]);assert.equal(f.engine.list().desktopContext.projectId,p.id);assert.equal(f.engine.list().integration.ready,true);
});

test('cancelling an official control query rejects further calls and waits for the real process to exit',async()=>{
 const {withControl}=await import('../plugins/autoreview/src/control.mjs');
 const controller=new AbortController();let started,pid;
 const ready=new Promise(resolve=>started=resolve);
 const work=withControl(async call=>{
  pid=await call('test/pid');started();
  await assert.rejects(call('test/hang'),/取消/);
  await assert.rejects(call('test/late'),/取消/);
 },{executable:process.execPath,prefixArgs:[path.resolve('tests/fake-control.mjs')],signal:controller.signal});
 await ready;controller.abort();await work;
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 await assert.rejects(withControl(()=>assert.fail('must not initialize'),{executable:'nonexistent-autoreview-test',signal:controller.signal}),/abort/i);
});

test('an in-flight desktop connection cannot re-enable a project after service shutdown starts',async t=>{
 const f=fixture(t);const {serve}=await import('../plugins/autoreview/src/server.mjs');const {request}=await import('../plugins/autoreview/src/client.mjs');
 let begin,finish;const ready=new Promise(resolve=>begin=resolve);
 f.engine.configure(f.project.id,{enabled:false});
 const app=await serve({dir:f.store.dir,engine:f.engine,activate:()=>new Promise(resolve=>{finish=resolve;begin();})});t.after(()=>app.close());
 const connected=request(app,'/api/desktop/connect',{root:f.root});connected.catch(()=>{});await ready;
 let closed=false;const shutdown=app.close().then(()=>closed=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
 finish({ready:true,hookCount:6});await assert.rejects(connected,/shutting down/);await shutdown;
 assert.equal(f.engine.project(f.project.id).enabled,false);assert.equal(f.engine.list().desktopContext,undefined);
 assert.equal(JSON.parse(fs.readFileSync(f.store.file)).projects[f.project.id].enabled,false);
});
