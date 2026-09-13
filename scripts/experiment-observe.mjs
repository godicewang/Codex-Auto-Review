// Read-only experiment observation. Never dispatches hooks or consumes advice.
import fs from 'node:fs';
import path from 'node:path';
import {dataDir,sha} from '../plugins/autoreview/src/util.mjs';
const root=process.cwd(),projectId=sha(root).slice(0,20),dir=dataDir();
const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
const runs=(state.runs||[]).filter(r=>r.projectId===projectId);
const result={observedAt:new Date().toISOString(),project:state.projects[projectId],integration:state.integration,hookStatsGlobal:state.hookStats||null,hookReceipts:(state.hookReceipts||[]).filter(r=>r.sessionId===process.env.CODEX_THREAD_ID),pendingRunIds:(state.adviceQueue||[]).filter(r=>r.projectId===projectId).map(r=>r.runId),runs:runs.map(r=>({id:r.id,sessionId:r.sessionId,turnId:r.turnId,status:r.status,message:r.message,createdAt:r.createdAt,completionConfirmedAt:r.completionConfirmedAt,modelStartedAt:r.modelStartedAt,finishedAt:r.finishedAt,deliveredAt:r.deliveredAt,transportAckAt:r.transportAckAt,deliveredTurnId:r.deliveredTurnId,report:r.report,findings:r.findings,limitations:r.limitations,retainsSnapshot:!!r.snapshot,workspaceExists:fs.existsSync(path.join(dir,'runs',r.id,'workspace'))})),cleanupError:state.cleanupError||null,interpretation:'hook receipt 仅证明服务收到事件；contextReports 仅证明准备了 hook 响应；transportAckReports 仅证明 stdout 交接确认。主对话是否实际看到注入，须在每轮笔记独立记录。'};
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv[2])fs.writeFileSync(process.argv[2],output);else console.log(output);
