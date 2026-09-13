import fs from 'node:fs';
import path from 'node:path';
import {trimDiagnostic} from './diagnostics.mjs';

const LIVE = new Set(['queued', 'reviewing']);
export const MAX_REPORTS = 100;
export const MAX_INACTIVE_TURNS = 200;
const remove = file => fs.rmSync(file, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });

// Only the daemon calls this, after a complete synchronous state transition.
// An aborted worker still owns its snapshots until its process has exited.
export function collectArtifacts(store, protectedRuns = new Set(), startup = false) {
  const state = store.state;
  const live = run => LIVE.has(run.status) || protectedRuns.has(run.id);
  for (const turn of Object.values(state.turns)) if (!turn.active&&!turn.awaitingCompletion) {delete turn.before;delete turn.toolCalls;delete turn.authored;}
  for (const run of state.runs) {
    if (run.legacy || live(run)) continue;
    remove(path.join(store.runDir(run.id), 'workspace'));
    run.snapshotDigest ||= run.snapshot?.digest;
    delete run.before;
    delete run.snapshot;
    delete run.repaired;
    delete run.requirements;
  }

  // Keep small, bounded history. Active baselines and legacy recovery evidence
  // are never evicted by the history cap.
  const pending = new Set((state.adviceQueue || []).map(item => item.runId));
  const completed = state.runs.filter(run => !run.legacy && !live(run) && !pending.has(run.id));
  const expired = new Set(completed.slice(0, Math.max(0, completed.length - MAX_REPORTS)));
  for (const run of expired) remove(store.runDir(run.id));
  state.runs = state.runs.filter(run => !expired.has(run));
  const sessions = new Map();
  let inactive = 0;
  for (const [key, turn] of Object.entries(state.turns).sort((a, b) => b[1].startedAt.localeCompare(a[1].startedAt))) {
    const session = JSON.stringify([turn.projectId, turn.sessionId]);
    const recent = sessions.get(session) || [];
    if (!turn.active && !turn.awaitingCompletion && (++inactive > MAX_INACTIVE_TURNS || recent.length >= 12)) {
      delete state.turns[key];
      if (recent.length) recent.at(-1).truncated = true;
    } else { recent.push(turn); sessions.set(session, recent); }
  }

  // Persist released references before collecting bytes; a crash can leave an
  // orphan blob, never a persisted reference to a deliberately deleted blob.
  store.save();
  const used = new Set();
  const keep = snapshot => { for (const file of Object.values(snapshot?.files || {})) used.add(file.hash); };
  for (const run of state.runs) { keep(run.before); keep(run.snapshot); keep(run.repaired); }
  for (const turn of Object.values(state.turns)) {keep(turn.before);for(const call of Object.values(turn.toolCalls||{}))keep(call.before);for(const entry of Object.values(turn.authored||{})){if(entry.before)used.add(entry.before.hash);if(entry.after)used.add(entry.after.hash);}}
  const blobs = path.join(store.dir, 'blobs');
  if (fs.existsSync(blobs)) for (const name of fs.readdirSync(blobs)) {
    if (/^[a-f0-9]{64}$/.test(name) && !used.has(name)) remove(path.join(blobs, name));
    if (/^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name)) remove(path.join(blobs, name));
  }
  if (startup) {
    for (const name of fs.readdirSync(store.dir)) if (/^state\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) remove(path.join(store.dir, name));
    const known = new Set(state.runs.map(run => run.id)), runs = path.join(store.dir, 'runs');
    if (fs.existsSync(runs)) for (const name of fs.readdirSync(runs)) {
      if (/^[a-f0-9-]{36}$/.test(name) && !known.has(name)) remove(path.join(runs, name));
    }
  }
  // Diagnostic retention failures must not prevent workspace/blob cleanup.
  for(const file of ['service.log','hook-errors.log'])trimDiagnostic(path.join(store.dir,file));
}
