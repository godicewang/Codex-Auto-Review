import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

// Wait until the consumer has processed each chunk before sending the next.
// This makes a split inside a Chinese UTF-8 character reproducible, even if
// the OS would otherwise combine consecutive writes.
export async function dispatchChunks(f, chunks, source = path.resolve('.')) {
  const preload = `const original=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of original()){yield chunk;process.send({consumed:true});}};`;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), path.join(source, 'plugins/autoreview/hooks/dispatch.mjs')], {
    cwd: f.root, env: { ...process.env, AUTOREVIEW_HOME: f.store.dir, AUTOREVIEW_WORKER: '0' }, stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  const stdout = [], stderr = []; let sent = 0, consumed = 0;
  child.stdout.on('data', b => stdout.push(b)); child.stderr.on('data', b => stderr.push(b));
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000); timer.unref();
  const send = () => { if (sent < chunks.length) child.stdin.write(chunks[sent++]); else child.stdin.end(); };
  child.on('message', () => { consumed++; send(); });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), consumed })); });
  send();
  try { return await done; } finally { clearTimeout(timer); }
}

export async function httpChunks(app, chunks) {
  let sent = 0, consumed = 0;
  const req = http.request(app.url + '/api/hook', { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' } });
  const send = () => { if (sent < chunks.length) req.write(chunks[sent++]); else req.end(); };
  const observe = incoming => {
    if (incoming.url !== '/api/hook') return;
    const original = incoming[Symbol.asyncIterator].bind(incoming);
    incoming[Symbol.asyncIterator] = async function* () { for await (const chunk of original()) { yield chunk; consumed++; send(); } };
  };
  app.server.prependListener('request', observe);
  const done = new Promise((resolve, reject) => { req.on('error', reject); req.on('response', res => { const output = []; res.on('data', b => output.push(b)); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(output).toString(), consumed })); }); });
  const timer = setTimeout(() => req.destroy(new Error('Chunk test timed out')), 15000); timer.unref();
  send();
  try { return await done; } finally { clearTimeout(timer); app.server.off('request', observe); req.destroy(); }
}

export function splitChinese(value) {
  const bytes = Buffer.from(JSON.stringify(value)); const cut = bytes.indexOf(Buffer.from('中')) + 1;
  if (cut < 1) throw new Error('Fixture must contain 中');
  return [bytes.subarray(0, cut), bytes.subarray(cut)];
}
