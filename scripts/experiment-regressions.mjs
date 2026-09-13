// Deterministic lifecycle replay, no real model and no GUI hook invocation.
// Can run unchanged against the retained pre-experiment source and current tree.
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {dashboard,nodeText} from '../tests/ui-harness.mjs';
import {dispatchChunks,httpChunks,splitChinese} from '../tests/input-harness.mjs';
import {releaseContents} from '../tests/release-harness.mjs';
import {pathToFileURL} from 'node:url';
const source=path.resolve(process.argv[2]||'.');
const {fixture,event,report,enqueue}=await import(pathToFileURL(path.join(source,'tests/helpers.mjs')));
const results={source,kind:'synthetic-lifecycle-and-DOM-with-real-git-http-processes-archive',cases:[]};
for(const pendingTool of [false,true]){
 const cleanups=[];let calls=0;
 const f=fixture({after:fn=>cleanups.push(fn)},{completionCheck:async()=>false,audit:async()=>{calls++;return structuredClone(report);}});
 try{
  f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'完成全部修改和回答之后才审计'}));
  f.write('main.js','export const value = 2;\n');
  if(pendingTool)f.engine.hook(event(f.root,'PreToolUse','one',{tool_use_id:'pending',tool_name:'apply_patch',tool_input:{command:'*** Update File: main.js\n'}}));
  const stop=f.engine.hook(event(f.root,'Stop'));await f.engine.drain();
  results.cases.push({name:pendingTool?'stop_with_unfinished_tool':'stop_before_host_completion',reviewerCalls:calls,passed:calls===0,stopOutcome:stop.skipped||'candidate_queued'});
 }finally{for(const fn of cleanups)await fn();}
}
for(const nested of [false,true]){
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)},{completionCheck:async()=>false});
 try{
  const cwd=nested?path.join(f.root,'src'):f.root;if(nested){fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'local.js'),'before');}
  const hook=(type,extra={})=>f.engine.hook(event(cwd,type,'scope',{prompt:'检查真实 Codex 改动',...extra}));
  hook('UserPromptSubmit');
  const input={tool_use_id:'scope',tool_name:nested?'apply_patch':'Bash',tool_input:{command:nested?'*** Update File: local.js\n*** Update File: ../main.js\n':"rg -n 'writeFileSync|write_text|foo > bar' src"}};
  hook('PreToolUse',input);fs.writeFileSync(path.join(f.root,'main.js'),'after');if(nested)fs.writeFileSync(path.join(cwd,'local.js'),'after');hook('PostToolUse',input);
  const stop=hook('Stop'),changedPaths=stop.runId?f.engine.run(stop.runId).changedPaths:[];
  results.cases.push({name:nested?'nested_relative_patch':'read_only_search_during_manual_edit',passed:nested?JSON.stringify(changedPaths)===JSON.stringify(['main.js','src/local.js']):!stop.runId,changedPaths,stopOutcome:stop.skipped||'candidate_queued'});
 }finally{for(const fn of cleanups)await fn();}
}
for(const brokenPipe of [false,true]){
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)},{completionCheck:async()=>true});let app;
 try{
  const {runId}=enqueue(f);await f.engine.drain();let exitCode;
  if(brokenPipe){
   const {serve}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/server.mjs')));app=await serve({dir:f.store.dir,engine:f.engine});
   exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(source,'plugins/autoreview/hooks/dispatch.mjs')],{cwd:f.root,env:{...process.env,AUTOREVIEW_HOME:f.store.dir,AUTOREVIEW_WORKER:'0'},stdio:['pipe','pipe','pipe']});
    child.stdout.destroy();child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',resolve);child.stdin.end(JSON.stringify(event(f.root,'UserPromptSubmit','next',{prompt:'继续'})));
   });
  }else f.engine.hook(event(f.root,'UserPromptSubmit','next',{prompt:'继续'})); // Deliberately lose this response.
  const retained=f.store.state.adviceQueue.some(q=>q.runId===runId);
  results.cases.push({name:brokenPipe?'broken_hook_stdout':'lost_hook_response',passed:retained,reportsRetained:retained?1:0,...(brokenPipe?{dispatcherExitCode:exitCode}:{})});
 }finally{if(app)await app.close();for(const fn of cleanups)await fn();}
}
{
 const cleanups=[];let queryStarted=false,aborted=false,calls=0;
 const f=fixture({after:fn=>cleanups.push(fn)},{completionCheck:(run,{signal}={})=>new Promise(resolve=>{
  queryStarted=true;const timer=setTimeout(()=>resolve(false),150);
  signal?.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);resolve(false);},{once:true});
 }),audit:async()=>{calls++;return structuredClone(report);}});
 try{
  const {runId}=enqueue(f),work=f.engine.drain();await new Promise(resolve=>setImmediate(resolve));
  if(runId)f.engine.cancel(runId);await work;
  results.cases.push({name:'cancel_completion_query',passed:queryStarted&&aborted&&calls===0,queryStarted,aborted,reviewerCalls:calls});
 }finally{for(const fn of cleanups)await fn();}
}
{
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});let app,finish;
 try{
  const {serve}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/server.mjs')));
  const {request}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/client.mjs')));
  let begin;const ready=new Promise(resolve=>begin=resolve);f.engine.configure(f.project.id,{enabled:false});
  app=await serve({dir:f.store.dir,engine:f.engine,activate:()=>new Promise(resolve=>{finish=resolve;begin();})});
  const connect=request(app,'/api/desktop/connect',{root:f.root}).then(()=>true,()=>false);await ready;
  const shutdown=app.close();finish({ready:true,hookCount:6});const accepted=await connect;await shutdown;
  const enabled=f.engine.project(f.project.id).enabled;
  results.cases.push({name:'connection_finishes_after_shutdown',passed:!accepted&&!enabled,connectionAccepted:accepted,projectEnabled:enabled});
 }finally{finish?.({ready:true});if(app)await app.close();for(const fn of cleanups)await fn();}
}
{
 const cleanups=[],a=fixture({after:fn=>cleanups.push(fn)}),b=fixture({after:fn=>cleanups.push(fn)});let app;
 try{
  const {serve}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/server.mjs')));
  app=await serve({dir:a.store.dir,engine:a.engine});let errorCode;
  try{await serve({dir:b.store.dir,engine:b.engine,port:app.server.address().port});}catch(error){errorCode=error.code;}
  const retainedLock=fs.existsSync(path.join(b.store.dir,'service.lock'));
  results.cases.push({name:'failed_listen_releases_lock',passed:errorCode==='EADDRINUSE'&&!retainedLock,errorCode,retainedLock});
 }finally{if(app)await app.close();for(const fn of cleanups)await fn();}
}
{
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});
 try{
  const log=path.join(f.store.dir,'hook-errors.log');fs.writeFileSync(log,'old log\n'.repeat(150000));const beforeBytes=fs.statSync(log).size;
  const exitCode=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.join(source,'plugins/autoreview/hooks/dispatch.mjs')],{cwd:f.root,env:{...process.env,AUTOREVIEW_HOME:f.store.dir,AUTOREVIEW_WORKER:'0'},stdio:['pipe','pipe','pipe']});
   child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',resolve);child.stdin.end('{');
  });
  const afterBytes=fs.statSync(log).size;
  results.cases.push({name:'bounded_hook_error_log',passed:exitCode===0&&afterBytes<=1024*1024,beforeBytes,afterBytes,dispatcherExitCode:exitCode});
 }finally{for(const fn of cleanups)await fn();}
}
for(const namedProject of [false,true]){
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});
 try{
  const {installAction}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/entry.mjs')));
  const dir=path.join(f.root,'.codex/environments');fs.mkdirSync(dir,{recursive:true});
  const original=namedProject?'version = 1\nname = "AutoReview"\n[setup]\nscript = ""\n':'version = 1\nname = "Custom"\n[setup]\nscript = """\necho setup\n"""\n';
  fs.writeFileSync(path.join(dir,'environment.toml'),original);const result=installAction(f.root);
  results.cases.push({name:namedProject?'project_name_not_an_existing_action':'multiline_setup_automatic_action',passed:result.status==='installed',actionStatus:result.status,originalPreserved:fs.readFileSync(result.file,'utf8').startsWith(original)});
 }finally{for(const fn of cleanups)await fn();}
}
for(const kind of ['settings','manual']){
 const ui=await dashboard(path.join(source,'plugins/autoreview/web'));ui.nodes.get(kind).onclick();await ui.switchByAction(1);await ui.submit(kind);
 const request=ui.requests.find(r=>kind==='settings'?r.method==='PATCH':r.route.endsWith('/review'));
 results.cases.push({name:kind+'_dialog_project_binding',passed:request?.route.startsWith(`/api/projects/${ui.ids[0]}`)||false,targetProject:request?.route.includes(ui.ids[0])?'A':'B',fixture:'DOM/event harness, not browser'});
}
{
 const result=releaseContents(path.join(source,'scripts/release.mjs'));
 const includesExperiment=result.entries.some(name=>name.startsWith('docs/experiments'));
 const includesMacMetadata=result.entries.some(name=>path.basename(name).startsWith('._'));
 results.cases.push({name:'release_excludes_local_experiment',passed:!includesExperiment,includesExperiment});
 results.cases.push({name:'release_excludes_macos_metadata',passed:!includesMacMetadata,includesMacMetadata,xattrAttached:result.xattrAttached,checksumCorrect:result.checksumCorrect});
}
for(const transport of ['HTTP','stdin']){
 const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});let app;
 try{
  const {serve}=await import(pathToFileURL(path.join(source,'plugins/autoreview/src/server.mjs')));
  app=await serve({dir:f.store.dir,engine:f.engine});
  const input=event(f.root,'UserPromptSubmit','unicode',{prompt:'中文需求：修复空数组处理 🧪'});let received;
  const hook=f.engine.hook.bind(f.engine);f.engine.hook=payload=>{received=payload;return hook(payload);};
  const response=transport==='HTTP'?await httpChunks(app,splitChinese(input)):await dispatchChunks(f,splitChinese(input),source);
  results.cases.push({name:transport.toLowerCase()+'_split_chinese_input',passed:response.consumed===2&&received?.prompt===input.prompt,chunksConsumed:response.consumed,promptPreserved:received?.prompt===input.prompt});
  const malformed=transport==='HTTP'?await httpChunks(app,[Buffer.from('SECRET_INPUT_PRIVATE')]):await dispatchChunks(f,[Buffer.from('SECRET_INPUT_PRIVATE')],source);
  const log=path.join(f.store.dir,'hook-errors.log');const output=(malformed.body||malformed.stdout)+(fs.existsSync(log)?fs.readFileSync(log,'utf8'):'');
  results.cases.push({name:transport.toLowerCase()+'_malformed_input_privacy',passed:!output.includes('SECRET_INPUT_PRIVATE'),payloadCopiedToError:output.includes('SECRET_INPUT_PRIVATE')});
 }finally{if(app)await app.close();for(const fn of cleanups)await fn();}
}
{
 const ui=await dashboard(path.join(source,'plugins/autoreview/web'));
 results.cases.push({name:'first_review_empty_state',passed:nodeText(ui.nodes.get('result')).includes('等待首次审计'),fixture:'DOM/event harness'});
 await ui.publish({runs:[{id:'failed',projectId:ui.ids[0],status:'failed',message:'审计超时',createdAt:new Date().toISOString()}]});
 results.cases.push({name:'failed_review_visible',passed:nodeText(ui.nodes.get('result')).includes('上次审计失败，未生成报告')&&nodeText(ui.nodes.get('result')).includes('审计超时'),fixture:'DOM/event harness'});
}
console.log(JSON.stringify(results,null,2));
