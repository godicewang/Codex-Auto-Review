import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {releaseContents} from './release-harness.mjs';

test('release archives preserve source/checksums and exclude local experiment and macOS metadata files',()=>{
 const result=releaseContents();assert.equal(result.checksumCorrect,true);assert.ok(result.entries.includes('plugins/source.json'));
 assert.ok(result.entries.includes('README.en.md'));
 assert.ok(result.entries.every(name=>!name.startsWith('docs/experiments')&&!path.basename(name).startsWith('._')));
});
