import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Engine } from './engine.mjs';
import { Store } from './store.mjs';
import { dataDir, ROOT, VERSION, mkdir, writeJSON, readJSON, now, openURL } from './util.mjs';
import {activateIntegration} from './control.mjs';
import { installLauncher, installAction, LAUNCH_COMMAND, pluginSettingsURL } from './entry.mjs';
import { readJsonObject } from './input.mjs';

export async function serve({ dir = dataDir(), port = 0, engine, persist = true, activate = activateIntegration, openSettings=()=>openURL(pluginSettingsURL()) } = {}) {
  mkdir(dir);
  const lockPath = path.join(dir, 'service.lock');
  let lock;const lockId=crypto.randomUUID();
  const releaseLock=()=>{if(persist&&readJSON(lockPath,{}).id===lockId)fs.rmSync(lockPath,{force:true});};
  if (persist) {
    try { lock = fs.openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readJSON(lockPath, {});
      let live = false; try { process.kill(owner.pid, 0); live = true; } catch {}
      if (live) throw new Error('AutoReview service is already running.');
      fs.rmSync(lockPath, { force: true }); lock = fs.openSync(lockPath, 'wx', 0o600);
    }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, id:lockId })); fs.closeSync(lock);
  }
  try{engine ||= new Engine({ store: new Store(dir) });}catch(error){releaseLock();throw error;}
  const token = crypto.randomBytes(32).toString('hex'), clients = new Set();
  let origin = '', closing = false;
  const activationController=new AbortController(),activations=new Set();
  const activateProject=async project=>{
    const work=Promise.resolve().then(()=>activate(project.root,{signal:activationController.signal}));activations.add(work);
    try{const result=await work;if(closing)throw new Error('AutoReview is shutting down.');return result;}
    finally{activations.delete(work);}
  };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',...(closing?{Connection:'close'}:{}) }); res.end(JSON.stringify(value)); };
  const broadcast = (event, data) => { for (const client of clients) { if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); } else client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } };
  const stateListener = value => broadcast('state', value), eventListener = value => broadcast('run_event', value);
  engine.on('state', stateListener); engine.on('event', eventListener);
  const server = http.createServer(async (req, res) => {
    if (closing) return json(res, 503, { error: 'AutoReview is shutting down.' });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'");
    if (req.headers.host !== origin.slice('http://'.length) || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: 'Local origin required.' });
    const url = new URL(req.url, origin);
    const protectedRoute = url.pathname.startsWith('/api/') || url.pathname === '/events';
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') || (url.pathname === '/events' ? url.searchParams.get('token') : '');
    if (protectedRoute && (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))) return json(res, 401, { error: 'Open the dashboard using autoreview dashboard to authenticate.' });
    try {
      let body = {};
      if (req.method === 'POST' || req.method === 'PATCH') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'application/json required' });
        body = await readJsonObject(req, { allowEmpty: true });
      }
      // Reading a request body yields to shutdown; never mutate a stopped
      // engine when a slow/in-flight client finishes uploading afterward.
      if(closing)return json(res,503,{error:'AutoReview is shutting down.'});
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, version: VERSION, pid: process.pid, hookProtocol:2 });
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, engine.list());
      if (req.method === 'POST' && url.pathname === '/api/hook') return json(res, 200, engine.hook(body));
      if (req.method === 'POST' && url.pathname === '/api/hook/ack') return json(res, 200, engine.acknowledgeAdvice(body));
      if (req.method === 'POST' && url.pathname === '/api/desktop/connect') {
        if(typeof body.root!=='string'||!path.isAbsolute(body.root))throw new Error('请点击当前 Codex 任务顶部的 AutoReview 动作，自动传入项目。');
        const p=engine.connect(body.root);
        try{engine.state.integration=await activateProject(p);}catch(error){if(!closing){engine.state.integration={ready:false,error:error.message};engine.save();}throw error;}
        engine.enable(p.root);engine.state.desktopContext={projectId:p.id,root:p.root,name:p.name,connectedAt:now(),source:'codex_action'};engine.save();
        return json(res,200,engine.project(p.id));
      }
      if (req.method === 'POST' && url.pathname === '/api/integration/activate') {
        const p=engine.project(body.projectId);
        try{engine.state.integration=await activateProject(p);}catch(error){if(!closing){engine.state.integration={ready:false,error:error.message};engine.save();}throw error;}
        engine.save();return json(res,200,engine.state.integration);
      }
      if (req.method === 'POST' && url.pathname === '/api/integration/settings') {await openSettings();return json(res,200,{opened:true});}
      if (req.method === 'POST' && url.pathname === '/api/projects') return json(res, 200, engine.connect(body.root, body.options || {}));
      if (req.method === 'POST' && url.pathname === '/api/prune') return json(res, 200, engine.prune(body.days ?? 30));
      if (req.method === 'POST' && url.pathname === '/api/shutdown') { await close(); json(res, 200, { ok: true }); return; }
      if (req.method === 'GET' && url.pathname === '/api/entry') return json(res, 200, {command: LAUNCH_COMMAND});
      const project = url.pathname.match(/^\/api\/projects\/([a-f0-9]{20})(?:\/(review|entry))?$/);
      if (project) {
        if (req.method === 'PATCH' && !project[2]) return json(res, 200, engine.configure(project[1], body));
        if (req.method === 'POST' && project[2] === 'review') return json(res, 200, engine.manual(project[1], body.requirement));
        if (req.method === 'POST' && project[2] === 'entry') {installLauncher();return json(res, 200, installAction(engine.project(project[1]).root));}
      }
      const runRoute = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(events|cancel))?$/);
      if (runRoute) {
        const run = engine.run(runRoute[1]);
        if (req.method === 'GET' && !runRoute[2]) return json(res, 200, engine.store.summary(run));
        if (req.method === 'GET' && runRoute[2] === 'events') return json(res, 200, engine.store.events(run.id, Number(url.searchParams.get('after')) || 0));
        if (req.method === 'POST' && ['cancel'].includes(runRoute[2])) return json(res, 200, engine[runRoute[2]](run.id));
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(engine.list())}\n\n`); clients.add(res);
        req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET') {
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
        if (assets[url.pathname]) {
          const [file, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(fs.readFileSync(path.join(ROOT, 'web', file))); return;
        }
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) { json(res, closing?503:400, { error: error.message }); }
  });
  server.requestTimeout = 30000;
  const rollbackStartup=async()=>{engine.off('state',stateListener);engine.off('event',eventListener);server.close();try{await engine.close();}finally{releaseLock();}};
  try{await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });}
  catch(error){await rollbackStartup();throw error;}
  origin = `http://127.0.0.1:${server.address().port}`;
  const info = { url: origin, token, pid: process.pid, version: VERSION, startedAt: now() };
  try{if (persist) writeJSON(path.join(dir, 'service.json'), info);}catch(error){await rollbackStartup();throw error;}
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
  const maintenance = setInterval(() => engine.collect(), 15 * 60 * 1000); maintenance.unref();
  let shutdown;
  function close() {
    if (closing) return shutdown; closing = true; clearInterval(heartbeat); clearInterval(maintenance);
    activationController.abort();
    engine.off('state', stateListener); engine.off('event', eventListener);
    for (const client of clients) client.end(); clients.clear();
    server.close(); server.closeIdleConnections();
    return shutdown = Promise.all([engine.close(),Promise.allSettled([...activations])]).then(() => {
      if (persist) {
        if (readJSON(path.join(dir, 'service.json'), {}).token === token) fs.rmSync(path.join(dir, 'service.json'), { force: true });
        releaseLock();
      }
    });
  }
  return { ...info, server, engine, close };
}
