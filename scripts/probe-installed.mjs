// Read-only capability probe. No model turn, credentials inspection, or hook trust changes.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { locateCodex, killTree } from '../plugins/autoreview/src/util.mjs';
const child = spawn(locateCodex(), ['app-server', '--listen', 'stdio://'], {
  detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  env: {...process.env, AUTOREVIEW_WORKER: '1'}
});
const pending = new Map(); let seq = 0;
const fail = error => { for (const p of pending.values()) p.reject(error); pending.clear(); };
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, {resolve, reject});
  child.stdin.write(JSON.stringify({id, method, params}) + '\n');
});
const lines = readline.createInterface({input: child.stdout});
lines.on('line', line => {
  try {
    const m = JSON.parse(line), p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  } catch (error) { fail(error); }
});
child.stdin.on('error', fail); child.stderr.on('data', () => {});
child.on('error', fail); child.on('close', () => fail(new Error('Codex closed before the probe completed.')));
const timer = setTimeout(() => { fail(new Error('Plugin probe timed out.')); killTree(child); }, 25000);
try {
  await call('initialize', {clientInfo:{name:'autoreview_install_check',version:'0.1.0'}, capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'}) + '\n');
  const hooks = await call('hooks/list', {cwds:[process.cwd()]});
  const ownHooks = (hooks.data || []).flatMap(x => x.hooks || []).filter(h => h.pluginId?.startsWith('autoreview@'));
  console.log('AutoReview hooks:', JSON.stringify(ownHooks.map(h => ({event:h.eventName,trust:h.trustStatus,enabled:h.enabled})), null, 2));
  const found = new Set(ownHooks.map(h => h.eventName));
  for (const event of ['userPromptSubmit','preToolUse','postToolUse','stop','interrupt','sessionEnd']) if (!found.has(event)) throw new Error(`Missing installed hook: ${event}`);
  const thread = await call('thread/start', {cwd:process.cwd(),ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
  const mcp = await call('mcpServerStatus/list', {threadId:thread.thread.id,limit:100});
  const server = mcp.data?.find(x => x.name === 'autoreview');
  console.log('AutoReview MCP:', JSON.stringify(server ? {status:server.runtimeStatus,tools:Object.keys(server.tools || {}),error:server.toolsError} : {error:'not found'}, null, 2));
  if (!server || !['ready','connected'].includes(server.runtimeStatus) || Object.keys(server.tools || {}).length !== 6) throw new Error('Expected six connected AutoReview tools.');
  if(ownHooks.some(h=>h.trustStatus!=='trusted'||!h.enabled))throw new Error('AutoReview integration is not ready; run the installer.');
  console.log('PASS: installed hooks are enabled and trusted; no manual CLI setup needed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { clearTimeout(timer); lines.close(); await killTree(child); }
