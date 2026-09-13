import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {locateCodex,killTree,ROOT} from './util.mjs';

// Short-lived official App Server client: no model turn or transcript access.
export async function withControl(fn,{executable=locateCodex(),prefixArgs=[],timeoutMs=20000,signal}={}) {
  signal?.throwIfAborted();
  const child=spawn(executable,[...prefixArgs,'app-server','--listen','stdio://'],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,AUTOREVIEW_WORKER:'1'}});
  const exited=new Promise(resolve=>child.once('close',resolve));
  const pending=new Map();let seq=0,terminal,shutdown;
  const fail=e=>{terminal ||= e;for(const p of pending.values())p.reject(terminal);pending.clear();};
  const terminate=error=>{fail(error);return shutdown ||= (async()=>{child.stdin.destroy();await killTree(child);await exited;child.stdout.destroy();child.stderr.destroy();})();};
  const call=(method,params={})=>new Promise((resolve,reject)=>{if(terminal){reject(terminal);return;}const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{try{const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}catch(e){fail(e);}});
  child.stdin.on('error',fail);child.on('error',fail);child.stderr.on('data',()=>{});child.on('close',()=>fail(new Error('Codex 连接已结束。')));
  const abort=()=>{void terminate(new Error('Codex 查询已取消。'));};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{void terminate(new Error('Codex 集成配置超时。'));},timeoutMs);
  try {await call('initialize',{clientInfo:{name:'autoreview_setup',version:'0.2.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return await fn(call);}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);lines.close();await terminate(new Error('Codex 连接已结束。'));}
}

export const REQUIRED_EVENTS=['userPromptSubmit','preToolUse','postToolUse','stop','interrupt','sessionEnd'];
export function ownHooks(result,pluginRoot=ROOT) {
  const source=fs.realpathSync(path.join(pluginRoot,'hooks','hooks.json'));
  const hooks=(result.data||[]).flatMap(x=>x.hooks||[]).filter(h=>h.pluginId?.startsWith('autoreview@')&&h.source==='plugin'&&path.resolve(h.sourcePath)===source);
  const unique=[...new Map(hooks.map(h=>[h.key,h])).values()];
  for(const h of unique) {
    const command=`node "${path.join(fs.realpathSync(pluginRoot),'hooks','dispatch.mjs')}"`;
    if(h.isManaged||h.handlerType!=='command'||h.command!==command||!h.key||!(/^sha256:[a-f0-9]{64}$/i.test(h.currentHash)))throw new Error('AutoReview 安装定义不匹配，未更改 Codex 配置。');
  }
  for(const name of REQUIRED_EVENTS)if(!unique.some(h=>h.eventName===name))throw new Error(`AutoReview 集成缺少 ${name}，请重新运行安装器。`);
  return unique;
}

// Trust only this installed plugin's exact definitions using Codex's config API.
// No global bypass, managed policy, project trust, or other plugin state is changed.
export async function activateIntegration(cwd,{pluginRoot=ROOT,control=withControl,signal}={}) {
  return control(async call=>{
    const hooks=ownHooks(await call('hooks/list',{cwds:[cwd]}),pluginRoot);
    const edits=hooks.filter(h=>h.trustStatus!=='trusted'||!h.enabled).map(h=>({keyPath:`hooks.state.${JSON.stringify(h.key)}`,value:{enabled:true,trusted_hash:h.currentHash},mergeStrategy:'upsert'}));
    if(edits.length)await call('config/batchWrite',{edits,reloadUserConfig:true});
    const verified=ownHooks(await call('hooks/list',{cwds:[cwd]}),pluginRoot);
    if(verified.some(h=>h.trustStatus!=='trusted'||!h.enabled))throw new Error('Codex 尚未接受 AutoReview 的集成配置，请重新连接。');
    return {ready:true,hookCount:verified.length,scope:'configuration',existingSessionRefresh:'new_task_or_same_host_config_reload'};
  },{signal});
}
