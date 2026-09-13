// Enumerate explicitly: Windows shells and Node 20 do not expand test globs consistently.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = fs.readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
