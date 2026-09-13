import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Help and invalid input must not launch Codex, register plugins, or create data.
function setup(args){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-setup-options-'));
  try{
    const result=spawnSync(process.execPath,['scripts/setup.mjs',...args],{
      encoding:'utf8',timeout:10000,
      env:{...process.env,AUTOREVIEW_HOME:path.join(dir,'data'),AUTOREVIEW_CODEX_BIN:path.join(dir,'missing-codex')}
    });
    assert.deepEqual(fs.readdirSync(dir),[]);
    return result;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('setup help works without Codex and does not install anything',()=>{
  const result=setup(['--help']);assert.equal(result.status,0);assert.match(result.stdout,/npm run setup/);
});
test('setup rejects invalid arguments before touching installation state',()=>{
  for(const args of [['--project'],['--porject','/tmp'],['--project','/tmp','--project','/tmp'],['--uninstall','--project','/tmp']]){
    const result=setup(args);assert.equal(result.status,1);assert.doesNotMatch(result.stderr,/missing-codex/);
  }
});
