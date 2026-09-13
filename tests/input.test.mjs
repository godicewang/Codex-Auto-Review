import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonObject, MAX_INPUT_BYTES } from '../plugins/autoreview/src/input.mjs';
import { serve } from '../plugins/autoreview/src/server.mjs';
import { fixture, event } from './helpers.mjs';
import { dispatchChunks, httpChunks, splitChinese } from './input-harness.mjs';

test('JSON input enforces a byte limit, rejects malformed UTF-8/objects, and keeps diagnostics free of payloads', async () => {
  const exact = Buffer.from(JSON.stringify({ text: 'x'.repeat(MAX_INPUT_BYTES - 11) }));
  assert.equal(exact.length, MAX_INPUT_BYTES);
  assert.equal((await readJsonObject([exact])).text.length, MAX_INPUT_BYTES - 11);
  for (const chunks of [[Buffer.from('{SECRET_INPUT_PRIVATE')], [Buffer.from([123,34,120,34,58,34,0xff,34,125])], [Buffer.from('null')], [Buffer.from('[]')], []]) {
    await assert.rejects(readJsonObject(chunks), { message: '输入不是有效的 UTF-8 JSON 对象。' });
  }
  await assert.rejects(readJsonObject([exact, Buffer.from(' ')]), /256000/);
  await assert.rejects(readJsonObject([Buffer.from(JSON.stringify({ text: '中'.repeat(90000) }))]), /256000/);
  assert.deepEqual(await readJsonObject([], { allowEmpty: true }), {});
});

for (const transport of ['HTTP', 'stdin']) test(`${transport} preserves Chinese when chunks split a UTF-8 code point`, async t => {
  const f = fixture(t), app = await serve({ dir: f.store.dir, engine: f.engine }); t.after(() => app.close());
  const input = event(f.root, 'UserPromptSubmit', 'unicode', { prompt: '中文需求：修复空数组处理 🧪' });
  let received; const hook = f.engine.hook.bind(f.engine); f.engine.hook = payload => { received = payload; return hook(payload); };
  const result = transport === 'HTTP' ? await httpChunks(app, splitChinese(input)) : await dispatchChunks(f, splitChinese(input));
  assert.equal(result.consumed, 2); assert.equal(result.status ?? result.code, transport === 'HTTP' ? 200 : 0);
  assert.equal(received.prompt, input.prompt);
});

test('malformed hook input fails open without copying a prompt snippet to stdout or the diagnostic log', async t => {
  const f = fixture(t), sentinel = 'SECRET_INPUT_PRIVATE';
  const result = await dispatchChunks(f, [Buffer.from(sentinel)]);
  assert.equal(result.code, 0); assert.match(JSON.parse(result.stdout).systemMessage, /有效的 UTF-8 JSON/);
  const log = fs.readFileSync(path.join(f.store.dir, 'hook-errors.log'), 'utf8');
  assert.equal((result.stdout + result.stderr + log).includes(sentinel), false);
  assert.equal(fs.existsSync(path.join(f.store.dir, 'service.json')), false);
});

test('malformed HTTP input returns a safe error without invoking the engine', async t => {
  const f = fixture(t), app = await serve({ dir: f.store.dir, engine: f.engine }); t.after(() => app.close());
  let calls = 0; f.engine.hook = () => { calls++; return {}; };
  const result = await httpChunks(app, [Buffer.from('SECRET_INPUT_PRIVATE')]);
  assert.equal(result.status, 400); assert.equal(calls, 0); assert.equal(result.body.includes('SECRET_INPUT_PRIVATE'), false);
});
