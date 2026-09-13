import { reviewerInstructions } from './prompts.mjs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { locateCodex, cleanEnv, killTree, VERSION } from './util.mjs';

export const auditSchema = {
  type:'object',additionalProperties:false,
  properties:{summary:{type:'string',maxLength:160},findings:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,
    properties:{title:{type:'string',maxLength:80},severity:{type:'string',enum:['P0','P1','P2']},file:{type:'string'},line:{type:'integer'},endLine:{type:'integer'},evidence:{type:'string',maxLength:260},impact:{type:'string',maxLength:160},suggestion:{type:'string',maxLength:260},confidence:{type:'string',enum:['high']}},
    required:['title','severity','file','line','endLine','evidence','impact','suggestion','confidence']}},limitations:{type:'array',maxItems:5,items:{type:'string',maxLength:240}}},
  required:['summary','findings','limitations']
};

export class CodexClient {
  constructor({ executable = locateCodex(), prefixArgs = [], cwd, signal, onEvent = () => {} } = {}) {
    this.pending = new Map(); this.seq = 0; this.closed = false; this.onEvent = onEvent;
    this.process = spawn(executable, [...prefixArgs, 'app-server', '--listen', 'stdio://', '-c', 'features.hooks=false', '-c', 'features.memories=false', '-c', 'features.plugins=false', '-c', 'features.apps=false', '-c', 'features.multi_agent=false'], {
      cwd, env: cleanEnv({ AUTOREVIEW_WORKER: '1' }), detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    this.exited = new Promise(resolve => this.process.once('close', resolve));
    this.process.stdin.on('error', () => {});
    this.lines = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.lines.on('line', line => { try { this.receive(JSON.parse(line)); } catch (error) { this.fail(new Error(`Invalid Codex event: ${error.message}`)); } });
    this.process.stderr.on('data', chunk => onEvent({ type: 'diagnostic', text: chunk.toString().slice(0, 16000) }));
    this.process.on('error', error => this.fail(error));
    this.process.on('close', code => this.fail(new Error(`Codex process exited (${code}). Check login, model access, and CLI compatibility.`)));
    this.signal = signal; this.abort = () => this.close(new Error('Review cancelled'));
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  send(value) { if (this.closed) throw new Error('Codex connection closed'); this.process.stdin.write(`${JSON.stringify(value)}\n`); }
  request(method, params = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  receive(message) {
    if (message.method && message.id !== undefined) {
      // A background review never silently grants an escalation, supplies credentials, or answers a user question.
      this.onEvent({ type: 'approval', text: `Codex requested ${message.method}; unattended review cannot approve it.` });
      this.send({ id: message.id, error: { code: -32000, message: 'AutoReview cannot approve this request. Continue within the existing sandbox or report the limitation.' } });
    } else if (message.id !== undefined) {
      const p = this.pending.get(message.id); if (!p) return;
      this.pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
    } else if (message.method) {
      this.onEvent({ type: 'codex', method: message.method, params: message.params });
      this.listener?.(message);
    }
  }
  fail(error) {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
    this.failTurn?.(error);
  }
  async initialize() {
    const result = await this.request('initialize', { clientInfo: { name: 'autoreview', title: 'AutoReview', version: VERSION } });
    this.send({ method: 'initialized', params: {} }); return result;
  }
  async audit({ cwd, prompt, model }) {
    await this.initialize();
    const account = await this.request('account/read', { refreshToken: false });
    if (account.requiresOpenaiAuth && !account.account) throw new Error('Codex is not logged in. Run codex login, then retry.');
    const result = await this.request('thread/start', {
      cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: reviewerInstructions,
      ...(model ? { model } : {}), config: { 'features.hooks': false, 'features.memories': false, 'features.plugins': false, 'features.apps': false, 'features.multi_agent': false }
    });
    this.threadId = result.thread.id;
    let final = '';
    const completion = new Promise((resolve, reject) => {
      this.failTurn = reject;
      this.listener = msg => {
        if (msg.params?.threadId && msg.params.threadId !== this.threadId) return;
        if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage') final = msg.params.item.text || final;
        if (msg.method === 'turn/completed') {
          const turn = msg.params.turn;
          if (turn.status !== 'completed') reject(new Error(turn.error?.message || `Codex turn ${turn.status}`));
          else resolve(final);
        }
      };
    });
    completion.catch(() => {});
    await this.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], outputSchema: auditSchema });
    const text = await completion;
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('Codex did not return a valid review report. No changes were applied.'); }
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.findings) || !Array.isArray(parsed.limitations)) throw new Error('Invalid review report schema.');
    return parsed;
  }
  close(error = new Error('Codex connection closed')) {
    if (this.shutdown) return this.shutdown;
    this.signal?.removeEventListener('abort', this.abort);
    this.fail(error); this.lines.close();
    this.listener = null; this.failTurn = null;
    this.process.stdin.destroy();
    return this.shutdown = (async () => {
      await killTree(this.process);
      await this.exited;
      this.process.stdout.destroy(); this.process.stderr.destroy();
    })();
  }
}

export async function runAudit(options) {
  const client = new CodexClient(options);
  try { return await client.audit(options); } finally { await client.close(); }
}
