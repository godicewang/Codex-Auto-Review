import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.2.0';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = () => path.resolve(process.env.AUTOREVIEW_HOME || path.join(os.homedir(), '.autoreview'));
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function mkdir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export function atomic(file, value) {
  mkdir(path.dirname(file));
  const tmp = `${file}.${id()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
export const writeJSON = (file, value) => atomic(file, `${JSON.stringify(value, null, 2)}\n`);
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}
export function sync(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, env: cleanEnv(), ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || `${command} exited ${result.status}`);
  return result.stdout;
}
export const git = (cwd, args, options) => sync('git', ['-c', 'core.hooksPath=', '-C', cwd, ...args], options);
export function gitRoot(cwd) { return fs.realpathSync(git(path.resolve(cwd), ['rev-parse', '--show-toplevel']).trim()); }
export function locateCodex() {
  if (process.env.AUTOREVIEW_CODEX_BIN) return process.env.AUTOREVIEW_CODEX_BIN;
  const probe = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (!probe.error && probe.status === 0) return 'codex';
  for (const file of ['/Applications/Codex.app/Contents/Resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex']) {
    if (fs.existsSync(file)) return file;
  }
  throw new Error('Codex CLI not found. Install Codex, run codex login, then retry. / 请安装 Codex CLI 并登录。');
}
export async function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch {} }
  if (process.platform === 'win32') return;
  const deadline = Date.now() + 1500;
  for (;;) {
    try { process.kill(-child.pid, 0); } catch { return; }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  // Escalate the entire process group, including a tool that outlived its parent.
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
export function openURL(url) {
  const [exe, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}
export function safeRelative(rel) {
  return typeof rel === 'string' && rel.length > 0 && !path.isAbsolute(rel) && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some(p => p === '..' || p === '.' || p === '' || p.toLowerCase() === '.git');
}
export function regularPath(root, rel) {
  if (!safeRelative(rel)) throw new Error(`Unsafe path: ${rel}`);
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${rel}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
