import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

// BSD tar hides AppleDouble entries in its ordinary listing. Inspect the raw
// short-name headers of this controlled fixture so the check sees those files.
function memberNames(archive){
 const data=gunzipSync(fs.readFileSync(archive),{maxOutputLength:4*1024*1024}),names=[];
 for(let offset=0;offset+512<=data.length;){
  const header=data.subarray(offset,offset+512);if(header.every(byte=>byte===0))break;
  const field=(start,length)=>header.subarray(start,start+length).toString('utf8').split('\0')[0];
  const name=field(0,100),prefix=field(345,155),size=parseInt(field(124,12).trim()||'0',8);
  if(!Number.isSafeInteger(size)||size<0)throw new Error('Invalid fixture tar size');
  names.push(prefix?prefix+'/'+name:name);offset+=512+Math.ceil(size/512)*512;
 }
 return names;
}

export function releaseContents(script=path.resolve('scripts/release.mjs')){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-package-test-'));
 try{
  for(const file of ['AGENTS.md','README.md','README.en.md','README.zh-CN.md','LICENSE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','.gitignore'])fs.writeFileSync(path.join(dir,file),'Test release fixture\n');
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'0.2.0'}));
  for(const folder of ['.github','.agents','.codex','plugins','scripts','tests','docs/experiments'])fs.mkdirSync(path.join(dir,folder),{recursive:true});
  fs.writeFileSync(path.join(dir,'docs/experiments/private-fixture.json'),'LOCAL-ONLY-EXPERIMENT');
  fs.writeFileSync(path.join(dir,'plugins/._sidecar.json'),'APPLEDOUBLE-FIXTURE');
  fs.writeFileSync(path.join(dir,'plugins/source.json'),'{"source":true}');
  const xattrAttached=process.platform==='darwin'&&spawnSync('xattr',['-w','com.autoreview.test','test-only',path.join(dir,'plugins/source.json')]).status===0;
  const built=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});if(built.status!==0)throw new Error(built.error?.message||built.stderr);
  const archive=path.join(dir,'dist/autoreview-v0.2.0.tar.gz');
  const hash=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  return {entries:memberNames(archive),xattrAttached,checksumCorrect:fs.readFileSync(archive+'.sha256','utf8').startsWith(hash+'  ')};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
