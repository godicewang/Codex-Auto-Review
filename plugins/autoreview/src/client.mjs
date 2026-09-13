import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir, ROOT, mkdir, readJSON, locateCodex } from './util.mjs';
import {trimDiagnostic} from './diagnostics.mjs';

export async function request(info, route, body, method = body === undefined ? 'GET' : 'POST', timeoutMs = 30000) {
  const response = await fetch(`${info.url}${route}`, { method, headers: { Authorization: `Bearer ${info.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || response.statusText); return value;
}
export async function findService() {
  let info;
  try { info = readJSON(path.join(dataDir(), 'service.json'), null); } catch { return null; }
  if (!info || !/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url) || typeof info.token !== 'string') return null;
  try {const health=await request(info, '/api/health', undefined, 'GET', 700);return {...info,hookProtocol:health.hookProtocol||1};} catch { return null; }
}
export async function stopService() {
  const service = await findService();
  if (!service) return { ok: true, running: false };
  await request(service, '/api/shutdown', {});
  // Older installations acknowledged shutdown before releasing their lock.
  for (let i = 0; i < 100; i++) {
    if (readJSON(path.join(dataDir(), 'service.lock'), {}).pid !== service.pid) return { ok: true };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('AutoReview is still shutting down. Please retry after its review worker exits.');
}
export async function ensureService({ pluginRoot = ROOT } = {}) {
  const existing = await findService();
  if(existing?.hookProtocol>=2)return existing;
  // Never send a new hook to an old daemon that consumes advice before stdout.
  // Upgrade our own service through its shutdown API, preserving queued reports.
  if(existing)await stopService();
  mkdir(dataDir());
  trimDiagnostic(path.join(dataDir(),'service.log'));
  const output = fs.openSync(path.join(dataDir(), 'service.log'), 'a', 0o600);
  let executable; try { executable = locateCodex(); } catch {} // Dashboard remains usable for diagnosis before login/install.
  const child = spawn(process.execPath, [path.join(pluginRoot, 'bin', 'autoreview.mjs'), 'serve'], {
    detached: true, stdio: ['ignore', output, output], windowsHide: true,
    env: { ...process.env, ...(executable ? { AUTOREVIEW_CODEX_BIN: executable } : {}) }
  });
  let failure;
  child.on('error', e => { failure = e; }); child.unref(); fs.closeSync(output);
  for (let i = 0; i < 60; i++) {
    if (failure) throw failure;
    await new Promise(resolve => setTimeout(resolve, 100));
    const service = await findService(); if (service?.hookProtocol>=2) return service;
  }
  throw new Error(`AutoReview could not start. See ${path.join(dataDir(), 'service.log')}`);
}
export const dashboardURL = info => `${info.url}/#token=${info.token}`;
