import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, enqueue, event, report } from './helpers.mjs';
import { Engine } from '../plugins/autoreview/src/engine.mjs';
import { Store } from '../plugins/autoreview/src/store.mjs';
import { materialize } from '../plugins/autoreview/src/snapshot.mjs';
import { MAX_REPORTS, MAX_INACTIVE_TURNS } from '../plugins/autoreview/src/cleanup.mjs';
import { git, id } from '../plugins/autoreview/src/util.mjs';

const blobs = store => fs.existsSync(path.join(store.dir, 'blobs')) ? fs.readdirSync(path.join(store.dir, 'blobs')) : [];
function released(f, run) {
  assert.equal(fs.existsSync(path.join(f.store.runDir(run.id), 'workspace')), false);
  assert.equal(run.snapshot, undefined);
  assert.equal(run.before, undefined);
  assert.equal(run.requirements, undefined);
  assert.match(run.snapshotDigest, /^[a-f0-9]{64}$/);
  assert.equal(f.engine.state.cleanupError, undefined);
}

test('queued and running review reads frozen bytes despite later edits, deletions, and new files', async t => {
  let begin, finish, cwd;
  const started = new Promise(resolve => begin = resolve);
  const f = fixture(t, { audit: options => {
    cwd = options.cwd; begin(); return new Promise(resolve => finish = resolve);
  } });
  const worktrees = git(f.root, ['worktree', 'list', '--porcelain']);
  const { runId } = enqueue(f), run = f.engine.run(runId);
  f.write('main.js', 'edited before worker started');
  f.write('new.js', 'this is not part of the reviewed turn');
  const work = f.engine.drain(); await started;
  assert.equal(fs.readFileSync(path.join(cwd, 'main.js'), 'utf8'), 'export const value = 2;\n');
  assert.equal(fs.existsSync(path.join(cwd, 'new.js')), false);
  fs.unlinkSync(path.join(f.root, 'main.js'));
  f.write('.gitignore', 'different ignore rules');
  assert.equal(fs.readFileSync(path.join(cwd, 'main.js'), 'utf8'), 'export const value = 2;\n');
  assert.equal(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'), 'node_modules/\nignored.txt\n');
  finish(structuredClone(report)); await work;
  assert.equal(run.status, 'completed'); released(f, run);
  assert.deepEqual(blobs(f.store), []);
  assert.equal(fs.existsSync(path.join(f.root, 'main.js')), false);
  assert.equal(git(f.root, ['worktree', 'list', '--porcelain']), worktrees);
  const next = f.engine.hook(event(f.root, 'UserPromptSubmit', 'next', { prompt: '继续' }));
  f.engine.acknowledgeAdvice({deliveryId:next.deliveryId,sessionId:'session-1',turnId:'next'});
  assert.match(next.additionalContext, /"sourceChanged":true/);
  assert.ok(run.sourceChangedAtDelivery);
});

test('completion deletes source copies but keeps report and digest for next-turn advice', async t => {
  const f = fixture(t), { runId } = enqueue(f), run = f.engine.run(runId);
  await f.engine.drain(); released(f, run);
  assert.deepEqual(blobs(f.store), []);
  assert.ok(f.store.events(runId).length);
  assert.match(f.engine.hook(event(f.root, 'UserPromptSubmit', 'next', { prompt: '继续' })).additionalContext, /main.js/);
});

test('failure, readonly violation, and timeout collect workspaces and unreferenced content', async t => {
  for (const audit of [
    async () => { throw new Error('unavailable'); },
    async ({ cwd }) => { fs.writeFileSync(path.join(cwd, 'main.js'), 'unexpected write'); return structuredClone(report); },
    ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))
  ]) {
    const f = fixture(t, { audit }), { runId } = enqueue(f), run = f.engine.run(runId);
    run.config.timeoutSeconds = 0.1;
    await f.engine.drain(); assert.equal(run.status, 'failed'); released(f, run);
    assert.deepEqual(blobs(f.store), []);
  }
});

test('partial materialization is removed even when a stored snapshot file is missing', async t => {
  const f = fixture(t), { runId } = enqueue(f), run = f.engine.run(runId);
  fs.unlinkSync(path.join(f.store.dir, 'blobs', run.snapshot.files['main.js'].hash));
  await f.engine.drain(); assert.equal(run.status, 'failed'); released(f, run);
  assert.deepEqual(blobs(f.store), []);
});

test('cancelled worker retains its files until it actually finishes shutting down', async t => {
  let begin, finish, cwd;
  const started = new Promise(resolve => begin = resolve);
  const f = fixture(t, { audit: options => {
    cwd = options.cwd; begin(); return new Promise(resolve => finish = resolve);
  } });
  const { runId } = enqueue(f), run = f.engine.run(runId), work = f.engine.drain(); await started;
  f.engine.cancel(runId);
  assert.ok(fs.existsSync(path.join(cwd, 'main.js')));
  assert.ok(blobs(f.store).length);
  finish(structuredClone(report)); await work;
  assert.equal(run.status, 'cancelled'); released(f, run); assert.deepEqual(blobs(f.store), []);
});

test('collecting a replaced queue entry keeps shared content needed by its successor', async t => {
  const f = fixture(t), { runId } = enqueue(f), first = f.engine.run(runId);
  f.engine.hook(event(f.root, 'UserPromptSubmit', 'two', { prompt: '继续审计代码' }));
  f.write('related.js', 'new module');
  const next = f.engine.run(f.engine.hook(event(f.root, 'Stop', 'two')).runId);
  assert.equal(first.status, 'cancelled'); released(f, first);
  assert.ok(blobs(f.store).includes(next.snapshot.files['main.js'].hash));
  await f.engine.drain(); assert.equal(next.status, 'completed'); released(f, next);
  assert.deepEqual(blobs(f.store), []);
});

test('ending a baseline, cancelling queued work, and stopping the service release retained content', async t => {
  const f = fixture(t);
  for (const ending of ['Stop', 'Interrupt', 'SessionEnd']) {
    f.engine.hook(event(f.root, 'UserPromptSubmit', ending, { prompt: '读代码' }));
    assert.ok(blobs(f.store).length);
    f.engine.hook(event(f.root, ending, ending));
    assert.deepEqual(blobs(f.store), []);
  }
  const { runId } = enqueue(f); f.engine.cancel(runId); released(f, f.engine.run(runId));
  assert.deepEqual(blobs(f.store), []);
  f.engine.hook(event(f.root, 'UserPromptSubmit', 'last', { prompt: '继续' }));
  await f.engine.close(); assert.deepEqual(blobs(f.store), []);
});

test('restart cancels persisted work and sweeps both known and orphaned temporary copies', async t => {
  const f = fixture(t), { runId } = enqueue(f), run = f.engine.run(runId);
  materialize(run.snapshot, path.join(f.store.runDir(runId), 'workspace'), f.store);
  const orphan = f.store.runDir(id()); fs.mkdirSync(path.join(orphan, 'workspace', '.git'), { recursive: true });
  f.store.blob('unreferenced after interrupted capture');
  // Separate Store emulates daemon death, with no opportunity for its finally block.
  const recovered = new Engine({ store: new Store(f.store.dir) });
  assert.equal(recovered.run(runId).status, 'cancelled');
  assert.equal(fs.existsSync(path.join(f.store.runDir(runId), 'workspace')), false);
  assert.equal(fs.existsSync(orphan), false); assert.deepEqual(blobs(f.store), []);
  await recovered.close();
});

test('retained reports and inactive requirement history stay bounded', t => {
  const f = fixture(t);
  for (let i = 0; i < MAX_REPORTS + 5; i++) f.store.state.runs.push({
    id: id(), status: 'completed', createdAt: new Date(i).toISOString(), findings: [], snapshotDigest: 'a'.repeat(64)
  });
  for (let i = 0; i < MAX_INACTIVE_TURNS + 5; i++) f.store.state.turns[id()] = {
    projectId: f.project.id, sessionId: `session-${i}`, active: false, prompts: ['历史需求'], startedAt: new Date(i).toISOString()
  };
  f.engine.collect();
  assert.equal(f.store.state.runs.length, MAX_REPORTS);
  assert.equal(Object.keys(f.store.state.turns).length, MAX_INACTIVE_TURNS);
  assert.equal(f.store.state.cleanupError, undefined);
});
