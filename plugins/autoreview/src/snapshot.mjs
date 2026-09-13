import fs from 'node:fs';
import path from 'node:path';
import { git, sha, mkdir, regularPath, safeRelative } from './util.mjs';

const EXCLUDED = /(^|\/)(\.git|\.codex|\.agents|\.ssh|\.aws|\.azure|\.gcloud|node_modules|\.venv|venv|__pycache__|\.next|coverage)(\/|$)|(^|\/)(\.npmrc|\.netrc|\.pypirc|auth\.json|credentials\.json|secrets\.json|id_rsa|id_ed25519)$|(^|\/)\.env($|\.)|\.(pem|key|p12|pfx)$/i;
export const excluded = (name, ignores = []) => EXCLUDED.test(name) || ignores.some(p => name === p || name.startsWith(`${p.replace(/\/$/, '')}/`));
export function capture(root, store, config = {}) {
  const names = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  const files = {}, omitted = [];
  let bytes = 0, count = 0;
  for (const name of names) {
    if (!safeRelative(name)) { omitted.push(`${name}: unsupported path`); continue; }
    if (excluded(name, config.ignore || [])) continue;
    if (count >= (config.maxFiles || 10000)) { omitted.push('File limit reached'); break; }
    try {
      const file = regularPath(root, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) { omitted.push(`${name}: not a regular file (submodules require their own project)`); continue; }
      if (stat.size > (config.maxFileBytes || 2 * 1024 * 1024) || bytes + stat.size > (config.maxSnapshotBytes || 64 * 1024 * 1024)) { omitted.push(`${name}: size limit`); continue; }
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      let content;
      try { content = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
      const after = fs.lstatSync(file);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) throw new Error(`File changed during snapshot: ${name}`);
      bytes += content.length;
      count++;
      files[name] = { hash: store.blob(content), mode: (stat.mode & 0o111) ? 0o755 : 0o644, size: content.length };
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      if (/Symbolic link/.test(e.message)) omitted.push(`${name}: symbolic link`);
      else throw e;
    }
  }
  return { files, digest: sha(JSON.stringify(files)), omitted, bytes };
}
export function changes(before, after) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort().filter(name => {
    const a = before.files[name], b = after.files[name];
    return a?.hash !== b?.hash || a?.mode !== b?.mode;
  });
}
export function materialize(snapshot, target, store) {
  mkdir(target);
  for (const [name, value] of Object.entries(snapshot.files)) {
    const file = regularPath(target, name); mkdir(path.dirname(file));
    fs.writeFileSync(file, store.bytes(value.hash), { mode: value.mode }); fs.chmodSync(file, value.mode);
  }
  git(target, ['init', '--quiet']);
  git(target, ['config', 'core.autocrlf', 'false']);
  const names = Object.keys(snapshot.files);
  for (let i = 0; i < names.length; i += 100) git(target, ['--literal-pathspecs', 'add', '--force', '--', ...names.slice(i, i + 100)]);
  git(target, ['-c', 'user.name=AutoReview', '-c', 'user.email=autoreview@localhost', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--quiet', '-m', 'AutoReview isolated snapshot']);
}
export function requirementDiff(before, after, store, max = 90000) {
  let text = '';
  for (const name of changes(before, after)) {
    const a = before.files[name], b = after.files[name];
    const read = v => { if (!v) return '(absent)'; const buf = store.bytes(v.hash); return buf.includes(0) ? '(binary)' : buf.toString('utf8'); };
    const section = `\nFILE ${JSON.stringify(name)}\nBEFORE:\n${read(a)}\nAFTER:\n${read(b)}\n`;
    if (text.length + section.length > max) { text += '\n[Change context truncated. Inspect the listed files in the snapshot.]'; break; }
    text += section;
  }
  return text;
}
