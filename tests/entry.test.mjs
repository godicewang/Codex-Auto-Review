import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './helpers.mjs';
import {installAction,installLauncher,pluginSettingsURL,LAUNCH_COMMAND} from '../plugins/autoreview/src/entry.mjs';

test('official project action is portable, idempotent and preserves existing setup and actions',t=>{
 const f=fixture(t),dir=path.join(f.root,'.codex','environments');fs.mkdirSync(dir,{recursive:true});
 const original='version = 1\nname = "Existing"\n[setup]\nscript = "npm ci"\n[[actions]]\nname = "Test"\ncommand = "npm test"\n';
 fs.writeFileSync(path.join(dir,'environment.toml'),original);
 const result=installAction(f.root),text=fs.readFileSync(result.file,'utf8');
 assert.equal(result.status,'installed');assert.ok(text.startsWith(original));assert.ok(!text.includes(f.root));
 assert.equal(text.split('name = "AutoReview"').length-1,1);assert.equal(JSON.parse(text.match(/command = (".*")\n# END/)[1]),LAUNCH_COMMAND);
 installAction(f.root);assert.equal(fs.readFileSync(result.file,'utf8'),text);
});

test('multiline custom environments install the action while preserving the complete setup script',t=>{
 const f=fixture(t),dir=path.join(f.root,'.codex','environments');fs.mkdirSync(dir,{recursive:true});
 const original='version = 1\nname = "Custom"\n[setup]\nscript = """\necho hello\n"""\n';
 const file=path.join(dir,'environment.toml');fs.writeFileSync(file,original);
 const result=installAction(f.root);assert.equal(result.status,'installed');assert.equal(result.command,LAUNCH_COMMAND);assert.ok(fs.readFileSync(file,'utf8').startsWith(original));
});

test('stable launcher follows an upgraded plugin path containing spaces without changing the toolbar action',t=>{
 const f=fixture(t),home=path.join(f.dir,'user space'),first=path.join(f.dir,'plugin one'),second=path.join(f.dir,'plugin two');
 for(const [root,text]of [[first,'one'],[second,'two']]){fs.mkdirSync(path.join(root,'bin'),{recursive:true});fs.writeFileSync(path.join(root,'bin','autoreview.mjs'),`console.log(${JSON.stringify(text)} + ':' + process.argv[2]);`);}
 const run=()=>spawnSync(process.execPath,[path.join(home,'.autoreview','launcher.cjs')],{encoding:'utf8'});
 installLauncher(first,{home,runtimeDir:f.store.dir,codex:process.execPath});assert.equal(run().stdout.trim(),'one:desktop');
 installLauncher(second,{home,runtimeDir:f.store.dir,codex:process.execPath});assert.equal(run().stdout.trim(),'two:desktop');
});

test('plugin settings link preserves and encodes the installed marketplace across launcher upgrades',t=>{
 const f=fixture(t),home=path.join(f.dir,'user'),marketplacePath=path.join(f.dir,'中文 source # &','.agents/plugins/marketplace.json');
 fs.mkdirSync(path.dirname(marketplacePath),{recursive:true});fs.writeFileSync(marketplacePath,'{}');
 installLauncher(f.root,{home,runtimeDir:f.store.dir,codex:process.execPath,marketplacePath});
 installLauncher(path.join(f.dir,'upgrade'),{home,runtimeDir:f.store.dir,codex:process.execPath});
 const link=new URL(pluginSettingsURL({home}));
 assert.equal(link.protocol,'codex:');assert.equal(link.hostname,'plugins');assert.equal(link.pathname,'/autoreview');
 assert.deepEqual([...link.searchParams],[['marketplacePath',marketplacePath]]);assert.equal(link.hash,'');
 fs.rmSync(marketplacePath);assert.throws(()=>pluginSettingsURL({home}),/安装来源已移动/);
});

test('plugin settings refuses missing, relative or non-marketplace installation sources',t=>{
 const f=fixture(t),home=path.join(f.dir,'user');assert.throws(()=>pluginSettingsURL({home}),/安装来源已移动/);
 for(const marketplacePath of ['marketplace.json','https://example.test/marketplace.json',path.join(f.root,'main.js')]){
  installLauncher(f.root,{home,runtimeDir:f.store.dir,codex:process.execPath,marketplacePath});
  assert.throws(()=>pluginSettingsURL({home}),/安装来源已移动/);
 }
});

test('project names, comments and script contents are not mistaken for existing AutoReview actions',t=>{
 for(const script of ['script = """\n[[actions]]\nname = "AutoReview"\n"""','script = \'\'\'\nname = "AutoReview"\n\'\'\'']){
  const f=fixture(t),dir=path.join(f.root,'.codex/environments');fs.mkdirSync(dir,{recursive:true});
  const original=`version = 1\nname = "AutoReview"\n# name = "AutoReview"\n[setup]\n${script}\n`,file=path.join(dir,'environment.toml');fs.writeFileSync(file,original);
  assert.equal(installAction(f.root).status,'installed');assert.ok(fs.readFileSync(file,'utf8').startsWith(original));
 }
});

test('conflicting action arrays/tables, existing custom actions and incomplete TOML are left unchanged',t=>{
 for(const original of [
  'actions = []\n','"actions" = []\n','"ac\\u0074ions" = []\n','[actions]\nname = "Custom"\n','[actions.env]\nKEY = "value"\n',
  '[[actions]]\nname = "AutoReview"\ncommand = "custom"\n',
  '[["actions"]]\n"name" = "AutoReview"\ncommand = "custom"\n',
  '[setup]\nscript = """\nincomplete','[setup]\nenv = [\n"unfinished"\n'
 ]){
  const f=fixture(t),dir=path.join(f.root,'.codex/environments');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'environment.toml');fs.writeFileSync(file,original);
  assert.equal(installAction(f.root).status,'manual',original);assert.equal(fs.readFileSync(file,'utf8'),original);
 }
});

test('unrelated arrays, inline tables and quoted table names can coexist with a new toolbar action',t=>{
 const f=fixture(t),dir=path.join(f.root,'.codex/environments');fs.mkdirSync(dir,{recursive:true});
 const original='version = 1\nname = "Custom"\n[setup]\nenv = { note = "[actions] # ignored", enabled = true }\ncommands = [\n"echo one",\n"echo two"\n]\n[[actions]]\nname = "Test"\ncommand = "npm test"\n[actions.env]\nDEBUG = "1"\n["quoted.table"]\nname = "AutoReview"\n';
 const file=path.join(dir,'environment.toml');fs.writeFileSync(file,original);assert.equal(installAction(f.root).status,'installed');assert.ok(fs.readFileSync(file,'utf8').startsWith(original));
});
