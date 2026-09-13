#!/usr/bin/env node
import readline from 'node:readline';
import { ensureService, request, dashboardURL } from '../src/client.mjs';
import { gitRoot, sha, VERSION } from '../src/util.mjs';

const object = properties => ({ type: 'object', properties, additionalProperties: false });
const tool = (name, description, properties, write = false) => ({ name, description, inputSchema: object(properties), annotations: { readOnlyHint: !write, destructiveHint: write, openWorldHint: false } });
const tools = [
  tool('autoreview_status', 'Show AutoReview projects, findings, the persistent pending advice queue, and delivery state.', {}),
  tool('autoreview_dashboard', 'Get a local compact review panel URL. Open it with the host browser-panel tool when available, placement right. Do not send this local access URL to other services.', {}),
  tool('autoreview_enable', 'Enable automatic independent review for a user-requested Git project. Configure only AutoReview integration automatically. Use the current task workspace as root; do not ask the user to type a path.', { root: { type: 'string' } }, true),
  tool('autoreview_pause', 'Pause automatic reviews and cancel running reviews for a project.', { root: { type: 'string' } }, true),
  tool('autoreview_review', 'Run an independent review of the current project snapshot. Read-only and silent. Does not modify source. Completed manual reports join the project queue and accompany its next user message.', { root: { type: 'string' }, requirement: { type: 'string' } }, true),
  tool('autoreview_cancel', 'Cancel a queued or running review.', { runId: { type: 'string' } }, true)
];
async function call(name, args) {
  const service = await ensureService();
  if (name === 'autoreview_dashboard') return { url: dashboardURL(service), presentation: 'local-browser-panel', instruction: 'Use the available host open-in-app browser tool with placement right. Otherwise show this local link.' };
  if (name === 'autoreview_status') return request(service, '/api/state');
  if (name === 'autoreview_enable') return request(service, '/api/desktop/connect', { root: args.root }, 'POST', 30000);
  if (name === 'autoreview_cancel') return request(service, `/api/runs/${args.runId}/cancel`, {});
  if (['autoreview_pause','autoreview_review'].includes(name)) {
    const key = sha(gitRoot(args.root)).slice(0, 20);
    return name === 'autoreview_pause' ? request(service, `/api/projects/${key}`, { enabled: false }, 'PATCH') : request(service, `/api/projects/${key}/review`, { requirement: args.requirement || '' });
  }
  throw new Error('Unknown tool');
}
async function handle(msg) {
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: msg.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'autoreview', version: VERSION } };
  else if (msg.method === 'ping') result = {};
  else if (msg.method === 'tools/list') result = { tools };
  else if (msg.method === 'tools/call') {
    try { const value = await call(msg.params.name, msg.params.arguments || {}); result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }; }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
  return { jsonrpc: '2.0', id: msg.id, result };
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 256000) continue;
  try { const response = await handle(JSON.parse(line)); if (response) process.stdout.write(`${JSON.stringify(response)}\n`); }
  catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`); }
}
