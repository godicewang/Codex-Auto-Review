#!/usr/bin/env node
import path from 'node:path';
import { ensureService, request } from '../src/client.mjs';
import { dataDir } from '../src/util.mjs';
import {appendDiagnostic} from '../src/diagnostics.mjs';
import { MAX_ADVICE_CHARS } from '../src/advice.mjs';
import { readJsonObject } from '../src/input.mjs';

if (process.env.AUTOREVIEW_WORKER === '1') process.exit(0);
const log=error=>{try{appendDiagnostic(path.join(dataDir(),'hook-errors.log'),error);}catch{}};
const writeOutput=value=>new Promise((resolve,reject)=>{
  process.stdout.once('error',reject);
  process.stdout.write(JSON.stringify(value)+'\n',error=>{if(error){reject(error);return;}process.stdout.off('error',reject);resolve();});
});
let outputWritten=false;
try {
  const payload = await readJsonObject(process.stdin);
  // Do not send transcript paths or assistant messages to the reviewer service.
  const event = Object.fromEntries(['hook_event_name','session_id','turn_id','cwd','prompt','stop_hook_active','tool_name','tool_use_id','tool_input'].filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
  const service = await ensureService();
  const result = await request(service, '/api/hook', event, 'POST', 20000);
  if (result.additionalContext && (typeof result.additionalContext !== 'string' || result.additionalContext.length > MAX_ADVICE_CHARS)) throw new Error('审计上下文超过 48000 字符限制');
  const output = result.additionalContext ? {hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:result.additionalContext}} : {};
  await writeOutput(output);outputWritten=true;
  if(result.deliveryId){
    const receipt={deliveryId:result.deliveryId,sessionId:event.session_id,turnId:event.turn_id};
    // The receipt confirms stdout handoff, not that Codex interpreted or acted
    // on the advice. Retry only the same receipt; never emit a second JSON line.
    let lastError;
    for(let attempt=0;attempt<2;attempt++)try{await request(service,'/api/hook/ack',receipt,'POST',1500);lastError=null;break;}catch(error){lastError=error;}
    if(lastError)log(lastError);
  }
} catch (error) {
  log(error);
  // Hooks fail open: never block the user's main Codex task because the reviewer is unavailable.
  if(!outputWritten&&!process.stdout.destroyed)try{await writeOutput({systemMessage:`AutoReview：${error.message}。请打开审计面板检查状态。`});}catch{}
}
