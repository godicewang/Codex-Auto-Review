import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {fixture,event} from './helpers.mjs';import {serve} from '../plugins/autoreview/src/server.mjs';import {request} from '../plugins/autoreview/src/client.mjs';
test('shutdown response waits for worker cleanup and releases the service lock',async t=>{
 let begin,finished=false;const started=new Promise(resolve=>begin=resolve);
 const f=fixture(t,{audit:({signal})=>new Promise((resolve,reject)=>{
  begin();signal.addEventListener('abort',()=>setTimeout(()=>{finished=true;reject(new Error('cancelled'));},25),{once:true});
 })});
 const app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());
 f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'改代码'}));f.write('main.js','changed');
 const {runId}=f.engine.hook(event(f.root,'Stop')),work=f.engine.drain();await started;
 assert.equal((await request(app,'/api/shutdown',{})).ok,true);
 assert.equal(finished,true);assert.equal(fs.existsSync(path.join(f.store.runDir(runId),'workspace')),false);
 assert.equal(fs.existsSync(path.join(f.store.dir,'service.lock')),false);await work;
});
test('HTTP authenticates, rejects foreign origins and malformed tokens, and serves the compact panel',async t=>{const f=fixture(t),app=await serve({dir:f.store.dir,engine:f.engine,persist:false});t.after(()=>app.close());assert.equal((await fetch(app.url+'/api/state')).status,401);assert.equal((await fetch(app.url+'/api/state',{headers:{Authorization:`Bearer ${app.token}`,Origin:'https://other.test'}})).status,403);assert.equal((await fetch(app.url+'/events?token='+encodeURIComponent('é'.repeat(64)))).status,401);assert.equal((await request(app,'/api/health')).version,'0.2.0');assert.match(await(await fetch(app.url)).text(),/开启审计/);});
test('plugin settings opener requires authentication and cannot take a URL from the browser request',async t=>{
 const f=fixture(t),calls=[],app=await serve({dir:f.store.dir,engine:f.engine,persist:false,openSettings:(...args)=>calls.push(args)});t.after(()=>app.close());
 const route='/api/integration/settings';
 assert.equal((await fetch(app.url+route,{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(app.url+route,{method:'POST',headers:{Authorization:`Bearer ${app.token}`,Origin:'https://other.test'},body:'{}'})).status,403);
 assert.equal(calls.length,0);
 assert.deepEqual(await request(app,route,{url:'file:///unexpected',marketplacePath:'/unexpected'}),{opened:true});
 assert.deepEqual(calls,[[]]);
});
test('hook-to-SSE review delivers advice and exposes no repair endpoints',async t=>{const f=fixture(t),app=await serve({dir:f.store.dir,engine:f.engine,persist:false});t.after(()=>app.close());const c=new AbortController();t.after(()=>c.abort());const stream=await fetch(`${app.url}/events?token=${app.token}`,{signal:c.signal}),reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: state/);await request(app,'/api/hook',event(f.root,'UserPromptSubmit','one',{prompt:'将数值改为三。'}));f.write('main.js','export const value = 2;\n');const {runId}=await request(app,'/api/hook',event(f.root,'Stop'));await f.engine.drain();assert.match((await request(app,'/api/hook',event(f.root,'UserPromptSubmit','two',{prompt:'新的需求'}))).additionalContext,/修改|主对话|返回值/);await assert.rejects(request(app,`/api/runs/${runId}/apply`,{}),/Not found/);await assert.rejects(request(app,`/api/runs/${runId}/undo`,{}),/Not found/);await reader.cancel();});

test('a failed listen releases its owned lock and event listeners so startup can be retried',async t=>{
 const a=fixture(t),b=fixture(t),app=await serve({dir:a.store.dir,engine:a.engine});t.after(()=>app.close());
 await assert.rejects(serve({dir:b.store.dir,engine:b.engine,port:app.server.address().port}),{code:'EADDRINUSE'});
 assert.equal(fs.existsSync(path.join(b.store.dir,'service.lock')),false);
 assert.equal(b.engine.listenerCount('state'),0);assert.equal(b.engine.listenerCount('event'),0);
 const retry=await serve({dir:b.store.dir});await retry.close();
 assert.equal((await request(app,'/api/health')).ok,true);
});

test('state initialization and service metadata write failures both roll back their startup lock',async t=>{
 const a=fixture(t);fs.writeFileSync(a.store.file,JSON.stringify({version:999}));
 await assert.rejects(serve({dir:a.store.dir}),/Unsupported AutoReview state/);
 assert.equal(fs.existsSync(path.join(a.store.dir,'service.lock')),false);a.store.save();
 const b=fixture(t);fs.mkdirSync(path.join(b.store.dir,'service.json'));
 await assert.rejects(serve({dir:b.store.dir,engine:b.engine}));
 assert.equal(fs.existsSync(path.join(b.store.dir,'service.lock')),false);assert.equal(b.engine.listenerCount('state'),0);
});

test('a request finishing its body after shutdown cannot write to the stopped service',async t=>{
 const http=await import('node:http');const f=fixture(t);f.engine.configure(f.project.id,{enabled:false});
 const app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());
 let arrived;const ready=new Promise(resolve=>arrived=resolve);
 app.server.on('request',req=>{if(req.url==='/api/projects')arrived();});
 const req=http.request(app.url+'/api/projects',{method:'POST',headers:{Authorization:`Bearer ${app.token}`,'Content-Type':'application/json'}});
 const response=new Promise((resolve,reject)=>{req.on('response',res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
 req.write('{');await ready;await app.close();
 req.end(JSON.stringify({root:f.root,options:{enabled:true}}).slice(1));
 assert.equal(await response,503);assert.equal(f.engine.project(f.project.id).enabled,false);
 assert.equal(JSON.parse(fs.readFileSync(f.store.file)).projects[f.project.id].enabled,false);
});

test('shutdown finishes its own HTTP connection instead of leaving the daemon waiting on keep-alive',async t=>{
 const f=fixture(t),app=await serve({dir:f.store.dir,engine:f.engine});t.after(()=>app.close());
 const response=await fetch(app.url+'/api/shutdown',{method:'POST',headers:{Authorization:`Bearer ${app.token}`,'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.headers.get('connection'),'close');assert.equal((await response.json()).ok,true);
});
