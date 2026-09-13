import path from 'node:path';
import fs from 'node:fs';
import {changes} from './snapshot.mjs';
import {safeRelative,regularPath,sha} from './util.mjs';
import {shellMayWrite} from './shell-writes.mjs';

function patchFile(root,cwd,name) {
  // Accept external aliases of the checkout (including macOS /var), then
  // inspect every component inside it. Start at the OUTERMOST root match:
  // an internal link pointing back to root must never become a new anchor.
  // Preserve raw cwd and '..' until checked, so normalization cannot erase
  // a traversed internal symlink. Missing components allow additions/deletions.
  const absolute=path.isAbsolute(name)?name:`${cwd}${path.sep}${name}`;
  let current=path.parse(absolute).root,anchored=false;const relative=[];
  const parts=absolute.slice(current.length).split(process.platform==='win32'?/[\\/]/:/\//);
  try{
    // Native canonicalization expands Windows 8.3 aliases such as RUNNER~1.
    // The JS realpath implementation may leave those aliases unchanged.
    anchored=fs.realpathSync.native(current)===root;
    for(const part of parts){
      if(!part||part==='.')continue;
      if(!anchored){
        current+=`${current.endsWith(path.sep)?'':path.sep}${part}`;
        try{anchored=fs.realpathSync.native(current)===root;}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
      }else if(part==='..'){
        if(!relative.length)return null;relative.pop();
      }else{
        relative.push(part);regularPath(root,relative.join('/'));
      }
    }
    const file=relative.join('/');return anchored&&safeRelative(file)?file:null;
  }catch{return null;}
}

export function mutationScope(event,root) {
  const name=event.tool_name,input=event.tool_input||{};
  if(['apply_patch','Edit','Write'].includes(name)) {
    const command=typeof input==='string'?input:input.command||input.patch||'';
    if(typeof command!=='string')return null;
    const names=[...command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(m=>m[1]);
    if(input.file_path)names.push(input.file_path);
    const cwd=event.cwd||root;try{root=fs.realpathSync.native(root);}catch{return null;}
    const files=names.filter(n=>typeof n==='string').map(n=>patchFile(root,cwd,n)).filter(Boolean);
    return files.length?new Set(files):null;
  }
  // Shell writes are conservatively scoped to the tool execution window.
  // Read-only commands do not claim concurrent manual edits as their own.
  if(name==='Bash'&&typeof input.command==='string'&&shellMayWrite(input.command))return '*';
  return null;
}

// Some Codex versions emit PreToolUse but no PostToolUse when apply_patch
// rejects a hunk. An obviously impossible single-file hunk cannot write, so
// don't leave a live write baseline for it. This never blocks or rewrites the
// tool. Unknown/complex patches keep the normal conservative pairing rules.
export function impossiblePatch(event,scope,before,store) {
  if(event.tool_name!=='apply_patch'||!(scope instanceof Set)||scope.size!==1)return false;
  const input=event.tool_input,patch=typeof input==='string'?input:input?.command||input?.patch;
  if(typeof patch!=='string')return false;
  const lines=patch.trim().split(/\r?\n/);
  if(lines[0]!=='*** Begin Patch'||lines.at(-1)!=='*** End Patch'||!lines[1]?.startsWith('*** Update File: '))return false;
  const body=lines.slice(2,-1);
  if(!body[0]?.startsWith('@@')||body.slice(1).some(line=>!/^[-+ ]/.test(line)&&line!=='*** End of File'))return false;
  const entry=before.files[[...scope][0]];if(!entry)return false;
  // Deliberately broader than whitespace/punctuation fuzzy matching: only
  // compare ASCII identifier characters, ignoring case and everything else.
  // Empty keys and ambiguous matches cannot prove a rejection.
  const key=line=>line.replace(/[^A-Za-z0-9_]/g,'').toLowerCase();
  const existing=new Set(store.bytes(entry.hash).toString('utf8').split(/\r?\n/).map(key));
  return body.slice(1).filter(line=>line.startsWith('-')).some(line=>{
    const removed=key(line.slice(1));return removed.length>0&&!existing.has(removed);
  });
}
const equal=(a,b)=>a?.hash===b?.hash&&a?.mode===b?.mode;
export function recordMutation(turn,before,after,scope) {
  turn.authored ||= {};
  for(const file of changes(before,after)) {
    if(scope!=='*'&&!scope.has(file))continue;
    const prev=turn.authored[file];
    if(prev&&!equal(prev.after,before.files[file])){prev.ambiguous=true;continue;}
    turn.authored[file]={before:prev?prev.before:before.files[file]||null,after:after.files[file]||null,ambiguous:prev?.ambiguous||false};
  }
}
export function attributedBaseline(turn,snapshot) {
  const files={...snapshot.files},eligible=[];
  for(const [file,entry]of Object.entries(turn.authored||{})) {
    if(entry.ambiguous||!equal(entry.after,snapshot.files[file])||equal(entry.before,entry.after))continue;
    eligible.push(file);if(entry.before)files[file]=entry.before;else delete files[file];
  }
  return {before:{...snapshot,files,digest:sha(JSON.stringify(files))},eligible};
}
