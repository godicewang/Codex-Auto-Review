import fs from 'node:fs';
import path from 'node:path';
import { dataDir, mkdir, readJSON, writeJSON, sha, now, atomic } from './util.mjs';

export class Store {
  constructor(dir = dataDir()) {
    this.dir = dir; mkdir(dir);
    this.file = path.join(dir, 'state.json');
    this.state = readJSON(this.file, { version: 2, projects: {}, turns: {}, runs: [] });
    if (this.state.version === 1) {
      if (!fs.existsSync(path.join(dir, 'state-v1-backup.json'))) writeJSON(path.join(dir, 'state-v1-backup.json'), this.state);
      this.state.version = 2;
      for (const p of Object.values(this.state.projects)) {p.enabled=false; for (const key of ['mode','setupCommands','testCommands','commandTimeoutSeconds']) delete p[key];}
      for (const r of this.state.runs) { r.legacy = true; r.status = 'legacy'; r.message = '旧版修复记录，仅保留历史，不会重新执行。'; }
      this.state.turns = {};
    }
    if (this.state.version !== 2) throw new Error('Unsupported AutoReview state version.');
  }
  save() { writeJSON(this.file, this.state); }
  hookReceipt(event, result) {
    // Bounded transport diagnostics, never store prompts, source, or transcripts.
    // Returning context proves only our response, not that a host consumed it.
    const short = value => typeof value === 'string' ? value.slice(0,128) : undefined;
    const row = {at:now(),event:short(event?.hook_event_name),sessionId:short(event?.session_id),turnId:short(event?.turn_id),outcome:result?.skipped || (result ? 'ok' : 'error'),runId:result?.runId,contextReports:result?.preparedReports || 0,contextChars:result?.additionalContext?.length || 0};
    const stats = this.state.hookStats ||= {received:0,contextResponses:0,contextReports:0};
    stats.received++;stats.contextResponses += row.contextChars > 0 ? 1 : 0;stats.contextReports += row.contextReports;stats.lastAt=row.at;
    this.state.hookReceipts = [...(this.state.hookReceipts || []),row].slice(-256);
  }
  blob(bytes) {
    const hash = sha(bytes), file = path.join(this.dir, 'blobs', hash);
    if (!fs.existsSync(file)) atomic(file, bytes);
    return hash;
  }
  bytes(hash) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid blob hash'); return fs.readFileSync(path.join(this.dir, 'blobs', hash)); }
  runDir(runId) { if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid run ID'); return path.join(this.dir, 'runs', runId); }
  event(run, type, data) {
    const event = { seq: (run.eventCount || 0) + 1, at: now(), type, ...data };
    run.eventCount = event.seq;
    const file = path.join(this.runDir(run.id), 'events.jsonl'); mkdir(path.dirname(file));
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  }
  events(runId, after = 0) {
    const file = path.join(this.runDir(runId), 'events.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { const row = JSON.parse(line); return row.seq > after ? [row] : []; } catch { return []; }
    });
  }
  summary(run) {
    const { before, snapshot, repaired, requirements, ...rest } = run;
    return rest;
  }
}
