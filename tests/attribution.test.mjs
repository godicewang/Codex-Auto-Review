import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,event} from './helpers.mjs';
import {mutationScope} from '../plugins/autoreview/src/attribution.mjs';
const raw=(f,name,text)=>fs.writeFileSync(path.join(f.root,name),text);
const prompt=f=>f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'只检查 Codex 改动'}));
const tool=(f,type,name='apply_patch',command='*** Update File: main.js\n')=>f.engine.hook(event(f.root,type,'one',{tool_use_id:'call-1',tool_name:name,tool_input:{command}}));

test('a rejected single-file patch without PostToolUse does not strand a successful retry',async t=>{
 const f=fixture(t);prompt(f);
 const patch=old=>`*** Begin Patch\n*** Update File: main.js\n@@\n-${old}\n+export const value = 2;\n*** End Patch`;
 const first=tool(f,'PreToolUse','apply_patch',patch('const value = 1;'));
 assert.equal(first.skipped,'patch_context_not_found');
 const edit=type=>f.engine.hook(event(f.root,type,'one',{tool_use_id:'retry',tool_name:'apply_patch',tool_input:{command:patch('export const value = 1;')}}));
 edit('PreToolUse');raw(f,'main.js','export const value = 2;\n');edit('PostToolUse');
 const {runId}=f.engine.hook(event(f.root,'Stop'));assert.ok(runId);await f.engine.drain();assert.equal(f.engine.run(runId).status,'completed');
});

test('patch preflight preserves fuzzy matches and conservatively tracks complex hunks',t=>{
 for(const command of [
  '*** Begin Patch\n*** Update File: main.js\n@@\n-  export const value = 1;  \n+export const value = 2;\n*** End Patch',
  '*** Begin Patch\n*** Update File: main.js\n@@\n-no such line\n+other\n@@\n-another\n+more\n*** End Patch'
 ]){
  const f=fixture(t);prompt(f);tool(f,'PreToolUse','apply_patch',command);
  assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'tools_still_running');
 }
});
test('manual edits during a Codex conversation without a writing tool never start automatic review',t=>{
 const f=fixture(t);prompt(f);raw(f,'main.js','manual edit');assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');assert.equal(f.engine.state.runs.length,0);
});
test('read-only shell calls cannot claim manual edits as Codex changes',t=>{
 const f=fixture(t);prompt(f);tool(f,'PreToolUse','Bash','cat main.js');raw(f,'main.js','manual edit');tool(f,'PostToolUse','Bash','cat main.js');assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');
});
test('patch attribution excludes unrelated manual changes before, during and after a tool call',t=>{
 const f=fixture(t);prompt(f);raw(f,'before.js','manual before');tool(f,'PreToolUse');raw(f,'main.js','export const value = 2;\n');raw(f,'during.js','manual during');tool(f,'PostToolUse');raw(f,'after.js','manual after');const {runId}=f.engine.hook(event(f.root,'Stop'));
 const run=f.engine.run(runId);assert.deepEqual(run.changedPaths,['main.js']);assert.equal(run.attribution,'codex_tool_windows');assert.ok(run.snapshot.files['during.js']);
});
test('manual overwrite of an authored file before Stop invalidates its attribution',t=>{
 const f=fixture(t);prompt(f);f.write('main.js','codex edit');raw(f,'main.js','manual overwrite');assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');
});
test('external edits between two tool writes invalidate ambiguous shared files',t=>{
 const f=fixture(t);prompt(f);f.write('main.js','codex first');raw(f,'main.js','manual middle');f.write('main.js','codex second');assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');
});
test('explicit shell writes are captured and unmatched completion events cannot manufacture attribution',t=>{
 const f=fixture(t);prompt(f);tool(f,'PostToolUse');tool(f,'PreToolUse','Bash',"node -e 'fs.writeFileSync(...)'");raw(f,'main.js','shell edit');tool(f,'PostToolUse','Bash',"node -e 'fs.writeFileSync(...)'");assert.ok(f.engine.hook(event(f.root,'Stop')).runId);
});
test('multiple enabled projects keep independent tool baselines and pausing one leaves the other active',async t=>{
 const a=fixture(t),b=fixture(t);const other=a.engine.enable(b.root);prompt(a);a.engine.hook(event(b.root,'UserPromptSubmit','b',{prompt:'项目 B'}));
 a.engine.hook(event(b.root,'PreToolUse','b',{tool_name:'apply_patch',tool_use_id:'b',tool_input:{command:'*** Update File: main.js\n'}}));raw(b,'main.js','export const value = 2;\n');
 a.engine.hook(event(b.root,'PostToolUse','b',{tool_name:'apply_patch',tool_use_id:'b',tool_input:{command:'*** Update File: main.js\n'}}));
 a.engine.configure(a.project.id,{enabled:false});const {runId}=a.engine.hook(event(b.root,'Stop','b'));assert.equal(a.engine.run(runId).projectId,other.id);await a.engine.drain();assert.equal(a.engine.run(runId).status,'completed');
});
test('relative patches from a nested task directory review the actual files including in-project parent paths',t=>{
 const f=fixture(t),cwd=path.join(f.root,'src');fs.mkdirSync(cwd);raw(f,'src/local.js','before');
 const hook=(type,extra={})=>f.engine.hook(event(cwd,type,'nested',{prompt:'修改 src/local.js 和根目录 main.js',...extra}));
 hook('UserPromptSubmit');const input={tool_use_id:'nested-edit',tool_name:'apply_patch',tool_input:{command:'*** Update File: local.js\n*** Update File: ../main.js\n'}};
 hook('PreToolUse',input);raw(f,'src/local.js','after');raw(f,'main.js','export const value = 2;\n');hook('PostToolUse',input);
 const stop=hook('Stop');assert.ok(stop.runId);assert.deepEqual(f.engine.run(stop.runId).changedPaths,['main.js','src/local.js']);
 assert.equal(mutationScope({cwd,tool_name:'apply_patch',tool_input:{command:'*** Add File: ../../outside.js\n'}},f.root),null);
});
test('searching source for writing APIs must not claim concurrent manual edits',t=>{
 const f=fixture(t);prompt(f);
 const command="rg -n 'writeFileSync|write_text|foo > bar' src";
 tool(f,'PreToolUse','Bash',command);raw(f,'main.js','manual during search');tool(f,'PostToolUse','Bash',command);
 assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');
});

test('absolute patches through a project-root alias retain updates, additions and deletions',t=>{
 const f=fixture(t),alias=path.join(f.dir,'project-alias');fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
 raw(f,'remove.js','remove');prompt(f);
 const command=`*** Begin Patch\n*** Update File: ${path.join(alias,'main.js')}\n*** Add File: ${path.join(alias,'new/deep.js')}\n*** Delete File: ${path.join(alias,'remove.js')}\n*** End Patch`;
 tool(f,'PreToolUse','apply_patch',command);raw(f,'main.js','changed');fs.mkdirSync(path.join(f.root,'new'));raw(f,'new/deep.js','new');fs.rmSync(path.join(f.root,'remove.js'));tool(f,'PostToolUse','apply_patch',command);
 const stop=f.engine.hook(event(f.root,'Stop'));assert.ok(stop.runId);assert.deepEqual(f.engine.run(stop.runId).changedPaths,['main.js','new/deep.js','remove.js']);
});

test('root alias normalization still rejects outside paths and symlinks within the repository',t=>{
 const f=fixture(t);fs.symlinkSync(path.join(f.root,'main.js'),path.join(f.root,'linked.js'));fs.symlinkSync(f.dir,path.join(f.root,'escape'),process.platform==='win32'?'junction':'dir');
 for(const file of [path.join(f.dir,'outside.js'),path.join(f.root,'linked.js'),path.join(f.root,'escape/outside.js')])assert.equal(mutationScope({cwd:f.root,tool_name:'apply_patch',tool_input:{command:`*** Add File: ${file}\n`}},f.root),null);
});

test('internal links back to the root are rejected for absolute patches, relative cwd, additions and deletions',t=>{
 const f=fixture(t),back=path.join(f.root,'back'),alias=path.join(f.dir,'external-alias');
 fs.symlinkSync(f.root,back,process.platform==='win32'?'junction':'dir');
 fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
 for(const action of ['Update File','Add File','Delete File'])for(const [cwd,file] of [
  [f.root,`${back}${path.sep}main.js`],
  [back,'main.js'],
  [alias,`back${path.sep}new${path.sep}missing.js`],
  [f.root,`back${path.sep}..${path.sep}main.js`]
 ])assert.equal(mutationScope({cwd,tool_name:'apply_patch',tool_input:{command:`*** ${action}: ${file}\n`}},f.root),null,`${cwd}: ${file}`);
 // A rejected link cannot turn a tool-window mutation into review evidence.
 prompt(f);const command=`*** Update File: ${back}${path.sep}main.js\n`;
 tool(f,'PreToolUse','apply_patch',command);raw(f,'main.js','changed through back');tool(f,'PostToolUse','apply_patch',command);
 assert.equal(f.engine.hook(event(f.root,'Stop')).skipped,'no_attributed_codex_changes');
});

test('external root aliases preserve valid relative patches and parent references without traversing internal links',t=>{
 const f=fixture(t),alias=path.join(f.dir,'alias');fs.mkdirSync(path.join(f.root,'src'));fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
 const scope=mutationScope({cwd:path.join(alias,'src'),tool_name:'apply_patch',tool_input:{command:'*** Update File: ../main.js\n*** Add File: new.js\n'}},f.root);
 assert.deepEqual([...scope],['main.js','src/new.js']);
});
