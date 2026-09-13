import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from './store.mjs';
import { collectArtifacts } from './cleanup.mjs';
import { capture, changes, materialize } from './snapshot.mjs';
import { projectConfig, updateConfig } from './config.mjs';
import { runAudit } from './codex.mjs';
import { languageOf, buildAuditInput, validateReport } from './prompts.mjs';
import { initializeAdviceQueue, queueAdvice, prepareAdvice, acknowledgeAdvice, MAX_PENDING_REPORTS, MAX_REPORT_CHARS } from './advice.mjs';
import {mutationScope,impossiblePatch,recordMutation,attributedBaseline} from './attribution.mjs';
import {isTurnComplete} from './completion.mjs';
import { gitRoot, id, now, sha } from './util.mjs';
const LIVE=new Set(['queued','reviewing']);
export class Engine extends EventEmitter {
  constructor({store=new Store(),audit=runAudit,completionCheck=isTurnComplete,completionWaitMs=120000,debounceMs=800}={}) {
    super();Object.assign(this,{store,audit,completionCheck,completionWaitMs,debounceMs,busy:false,stopping:false,controllers:new Map(),completionControllers:new Map()});
    initializeAdviceQueue(this.state);
    for(const turn of Object.values(this.state.turns)){turn.active=false;turn.awaitingCompletion=false;}
    for(const run of this.state.runs)if(LIVE.has(run.status)){run.status='cancelled';run.message='服务已重启，未自动重试审计。';run.finishedAt=now();}
    this.collect(true);
  }
  get state(){return this.store.state;}
  list(){return {version:2,desktopContext:this.state.desktopContext,integration:this.state.integration,cleanupError:this.state.cleanupError,adviceQueue:this.state.adviceQueue,projects:Object.values(this.state.projects),runs:this.state.runs.map(r=>this.store.summary(r)).reverse()};}
  project(key){const p=this.state.projects[key];if(!p)throw new Error('项目未连接。');return p;}
  run(key){const r=this.state.runs.find(r=>r.id===key);if(!r)throw new Error('审计记录不存在。');return r;}
  save(){this.store.save();this.emit('state',this.list());}
  collect(startup=false){
    try{collectArtifacts(this.store,new Set(this.controllers.keys()),startup);delete this.state.cleanupError;}
    catch(error){this.state.cleanupError=`临时数据清理未完成，将在下次维护或重启时重试：${error.message}`;}
    this.save();
  }
  status(run,status,message){run.status=status;run.message=message;run.updatedAt=now();if(!LIVE.has(status))run.finishedAt=now();this.store.event(run,'status',{status,text:message});this.save();}
  connect(cwd,options={}){const root=gitRoot(cwd),key=sha(root).slice(0,20);this.state.projects[key]=this.state.projects[key]?updateConfig(this.state.projects[key],options):projectConfig(root,options);this.save();return this.state.projects[key];}
  enable(cwd,options={}){return this.connect(cwd,{enabled:true,...options});}
  configure(key,options){const next=updateConfig(this.project(key),options);this.cancelProject(key,'项目设置已更改。');this.state.projects[key]=next;for(const turn of Object.values(this.state.turns))if(turn.projectId===key){turn.active=false;turn.stopped=true;}this.collect();return next;}
  cancelProject(key,reason){for(const run of this.state.runs)if(run.projectId===key&&LIVE.has(run.status))this.cancel(run.id,reason,false);}
  cancel(key,reason='审计已取消。',collect=true){const run=this.run(key);if(LIVE.has(run.status)){this.controllers.get(key)?.abort();this.completionControllers.get(key)?.abort();this.releaseCompletion(run);this.status(run,'cancelled',reason);}if(collect)this.collect();return this.store.summary(run);}
  activeAny(){return Object.values(this.state.turns).some(t=>t.active||t.awaitingCompletion);}
  releaseCompletion(run){
    run.awaitingTurnCompletion=false;delete run.nextCompletionCheck;
    for(const turn of Object.values(this.state.turns))if(turn.stopRunId===run.id){turn.awaitingCompletion=false;delete turn.stopRunId;}
  }
  resumeAfterStop(turn){
    const run=this.state.runs.find(r=>r.id===turn.stopRunId);
    if(run?.status==='queued')this.cancel(run.id,'Codex 本轮仍在继续，等待最终结束。',false);
    turn.awaitingCompletion=false;delete turn.stopRunId;turn.active=true;turn.stopped=false;
  }
  hook(event){
    let result;
    try{result=this.handleHook(event);return result;}
    finally{this.store.hookReceipt(event,result);this.collect();}
  }
  acknowledgeAdvice(receipt){const result=acknowledgeAdvice(this.state,receipt);this.collect();return result;}
  handleHook(event){
    if(!event||!['UserPromptSubmit','PreToolUse','PostToolUse','Stop','Interrupt','SessionEnd'].includes(event.hook_event_name))return {skipped:'unsupported_event'};
    if(typeof event.cwd!=='string'||typeof event.session_id!=='string')throw new Error('无效的 hook 参数。');
    let root;try{root=gitRoot(event.cwd);}catch{return {skipped:'not_a_git_project'};}
    if(root.startsWith(path.join(this.store.dir,'runs')+path.sep))return {skipped:'review_worker'};
    const project=this.state.projects[sha(root).slice(0,20)];if(!project?.enabled)return {skipped:'project_not_enabled'};
    const sessionId=event.session_id,turnId=event.turn_id;
    project.lastHookAt=now();project.lastHook=event.hook_event_name;
    if(event.hook_event_name==='SessionEnd'){for(const turn of Object.values(this.state.turns))if(turn.projectId===project.id&&turn.sessionId===sessionId)turn.active=false;this.save();return {ok:true};}
    if(typeof turnId!=='string'||!turnId)return {skipped:'missing_turn_id_update_codex'};
    const key=sha(`${project.id}\0${sessionId}\0${turnId}`),prior=this.state.turns[key];
    if(event.hook_event_name==='UserPromptSubmit'){
      if(typeof event.prompt!=='string')throw new Error('hook 缺少用户需求。');
      const prompt=event.prompt.slice(0,24000);
      const language=languageOf(event.prompt);
      if(prior?.awaitingCompletion)this.resumeAfterStop(prior);
      for(const turn of Object.values(this.state.turns))if(turn!==prior&&turn.projectId===project.id&&turn.sessionId===sessionId)turn.active=false;
      const snapshot=capture(root,this.store,project);
      const turn=prior?.active?prior:{projectId:project.id,sessionId,turnId,prompts:[],before:snapshot,active:true,stopped:false,startedAt:now(),truncated:false};
      turn.prompts.push(prompt);turn.truncated ||= turn.prompts.length>12||prompt.length<event.prompt.length;turn.prompts=turn.prompts.slice(-12);
      this.state.turns[key]=turn;
      // Prepare completed reports, then wait for the dispatcher's stdout ACK.
      const batch=prepareAdvice(this.state,{projectId:project.id,sessionId,turnId,language,currentDigest:snapshot.digest});
      this.save();return {ok:true,...batch};
    }
    if(['PreToolUse','PostToolUse'].includes(event.hook_event_name)) {
      if(prior?.awaitingCompletion&&event.hook_event_name==='PreToolUse')this.resumeAfterStop(prior);
      if(!prior?.active||prior.stopped)return {skipped:'no_active_codex_turn'};
      const scope=mutationScope(event,root),callId=event.tool_use_id;
      if(!scope||typeof callId!=='string'||!callId)return {skipped:'not_an_identifiable_write'};
      prior.toolCalls ||= {};
      if(event.hook_event_name==='PreToolUse') {
        if(Object.keys(prior.toolCalls).length>=16)return {skipped:'too_many_pending_tools'};
        const before=capture(root,this.store,project);
        if(impossiblePatch(event,scope,before,this.store))return {skipped:'patch_context_not_found'};
        prior.toolCalls[callId]={before};
      } else {
        const call=prior.toolCalls[callId];if(!call)return {skipped:'missing_tool_baseline'};
        const after=capture(root,this.store,project);recordMutation(prior,call.before,after,scope);delete prior.toolCalls[callId];
      }
      this.save();return {ok:true};
    }
    if(event.hook_event_name==='Interrupt'){if(prior){if(prior.awaitingCompletion){this.resumeAfterStop(prior);}prior.active=false;prior.stopped=true;}this.save();return {ok:true};}
    if(!prior||prior.stopped||!prior.before)return {skipped:prior?.stopped?'duplicate_stop':'missing_prompt_baseline'};
    // A tool completion records bytes only; it must never launch the audit.
    // If a long-running write is still outstanding, require a subsequent Stop.
    if(Object.keys(prior.toolCalls||{}).length)return {skipped:'tools_still_running'};
    prior.active=false;prior.stopped=true;
    const snapshot=capture(root,this.store,project),changed=changes(prior.before,snapshot);
    const {before,eligible}=attributedBaseline(prior,snapshot);
    if(!changed.length){this.save();return {skipped:'no_changes'};}
    if(!eligible.length){this.save();return {skipped:'no_attributed_codex_changes'};}
    const history=Object.values(this.state.turns).filter(t=>t.projectId===project.id&&t.sessionId===sessionId&&t.startedAt<=prior.startedAt).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
    for(const run of this.state.runs)if(run.projectId===project.id&&run.sessionId===sessionId&&run.status==='queued')this.cancel(run.id,'已由更新的代码快照替代。',false);
    const run=this.enqueue(project,before,snapshot,{sessionId,turnId,attribution:'codex_tool_windows',requirements:history.slice(-12).flatMap(t=>t.prompts),historyTruncated:history.length>12||history.some(t=>t.truncated),prompt:prior.prompts.at(-1)});
    prior.awaitingCompletion=true;prior.stopRunId=run.id;
    run.awaitingTurnCompletion=true;run.completionDeadline=Date.now()+this.completionWaitMs;
    run.message='等待 Codex 完成本轮工作和回答。';this.save();
    return {runId:run.id};
  }
  manual(projectId,requirement=''){
    try{return this.manualSnapshot(projectId,requirement);}finally{this.collect();}
  }
  manualSnapshot(projectId,requirement){
    if(typeof requirement!=='string'||requirement.length>24000)throw new Error('需求过长或格式错误。');
    const project=this.project(projectId),snapshot=capture(project.root,this.store,project);
    const prompt=requirement.trim()||'检查当前项目中的明确功能性 Bug，仅提供有证据的问题和修改建议。';
    return this.store.summary(this.enqueue(project,{files:{},digest:sha('{}'),omitted:[],bytes:0},snapshot,{sessionId:'manual',turnId:id(),requirements:[prompt],prompt}));
  }
  enqueue(project,before,snapshot,context){
    if(this.state.runs.filter(r=>r.status==='queued').length>=20)throw new Error('后台审计队列已满，请稍后重试。');
    if(this.state.adviceQueue.length+this.state.runs.filter(r=>LIVE.has(r.status)).length>=MAX_PENDING_REPORTS)throw new Error('待传达报告已达 200 份，请先在对应主对话发送消息以领取报告。已有报告均保留。');
    const run={id:id(),projectId:project.id,projectName:project.name,root:project.root,status:'queued',message:'等待后台只读审计。',createdAt:now(),...context,before,snapshot,snapshotDigest:snapshot.digest,changedPaths:changes(before,snapshot),language:languageOf(context.prompt),findings:[],limitations:[],config:{...project}};
    this.state.runs.push(run);this.save();this.schedule();return run;
  }
  schedule(){
    clearTimeout(this.timer);
    const queued=this.state.runs.filter(r=>r.status==='queued');
    if(!this.stopping&&queued.length){const next=Math.min(...queued.map(r=>r.nextCompletionCheck||0));this.timer=setTimeout(()=>this.drain(),Math.max(this.debounceMs,next-Date.now()));this.timer.unref?.();}
  }
  async drain(){
    if(this.busy||this.stopping)return;
    const run=this.state.runs.find(r=>r.status==='queued'&&(!r.nextCompletionCheck||r.nextCompletionCheck<=Date.now()));
    if(!run){this.schedule();return;}
    this.busy=true;
    try{this.activeExecution=this.startWhenComplete(run);await this.activeExecution;}
    finally{this.activeExecution=null;this.busy=false;this.schedule();}
  }
  async startWhenComplete(run){
    if(run.awaitingTurnCompletion){
      let complete=false;const controller=new AbortController();this.completionControllers.set(run.id,controller);
      try{if(Date.now()<run.completionDeadline)complete=await this.completionCheck(run,{signal:controller.signal,timeoutMs:Math.min(20000,Math.max(1,run.completionDeadline-Date.now()))});}catch(error){run.completionError=error.message;}
      finally{this.completionControllers.delete(run.id);}
      if(this.stopping||run.status!=='queued')return;
      if(!complete){
        if(Date.now()>=run.completionDeadline){this.releaseCompletion(run);this.status(run,'cancelled','未能确认 Codex 本轮已结束，已跳过审计。');this.collect();}
        else{run.nextCompletionCheck=Date.now()+2000;this.save();}
        return;
      }
      run.awaitingTurnCompletion=false;run.completionConfirmedAt=now();delete run.nextCompletionCheck;delete run.completionError;
      this.releaseCompletion(run);this.save();
    }
    await this.execute(run);
  }
  async execute(run){
    const controller=new AbortController();this.controllers.set(run.id,controller);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},run.config.timeoutSeconds*1000);
    const workspace=path.join(this.store.runDir(run.id),'workspace');
    try{
      materialize(run.snapshot,workspace,this.store);
      this.status(run,'reviewing',run.language==='zh'?'后台静默审计中，可继续主对话。':'Reviewing silently. You can continue working.');
      run.modelStartedAt=now();this.save();
      const report=await this.audit({cwd:workspace,prompt:buildAuditInput(run,this.store),model:run.config.model,language:run.language,signal:controller.signal,onEvent:()=>{}});
      controller.signal.throwIfAborted();
      if(capture(workspace,this.store,run.config).digest!==run.snapshot.digest)throw new Error('只读审计者改动了快照，报告已拒绝。原项目未被改动。');
      const checked=validateReport(report,run,this.store);
      if(run.snapshot.omitted.length||run.before.omitted.length)checked.limitations.push(run.language==='zh'?'部分文件因大小或类型限制未纳入快照。':'Some files were omitted due to size or type limits.');
      if(JSON.stringify(checked).length>MAX_REPORT_CHARS)throw new Error('审计报告超过 6000 字符上限，未将冗长报告入队。');
      Object.assign(run,{findings:checked.findings,report:checked.summary,limitations:checked.limitations});
      run.finishedAt=now();queueAdvice(this.state,run);this.status(run,'completed',checked.summary);
    }catch(error){if(run.status!=='cancelled')this.status(run,controller.signal.aborted&&!timedOut?'cancelled':'failed',timedOut?'后台审计超时，未传入未完成的意见。':error.message);}
    finally{clearTimeout(timer);this.controllers.delete(run.id);this.collect();}
  }
  prune(days=30){
    if(!Number.isInteger(days)||days<0)throw new Error('days 必须为非负整数。');
    if(this.busy||this.activeAny())throw new Error('请等待活动任务结束后清理。');
    if(this.state.runs.some(r=>r.recoveryConflict))throw new Error('旧版本存在未处理的恢复记录，请先保留数据并检查工作区。');
    const pending=new Set(this.state.adviceQueue.map(item=>item.runId));
    const cutoff=Date.now()-days*86400000,removed=this.state.runs.filter(r=>!LIVE.has(r.status)&&!pending.has(r.id)&&Date.parse(r.createdAt)<cutoff);
    this.state.runs=this.state.runs.filter(r=>!removed.includes(r));
    for(const [key,turn]of Object.entries(this.state.turns))if(!turn.active&&Date.parse(turn.startedAt)<cutoff)delete this.state.turns[key];this.save();
    for(const run of removed)fs.rmSync(this.store.runDir(run.id),{recursive:true,force:true});
    this.collect();return {removed:removed.length};
  }
  close(){
    if(this.shutdown)return this.shutdown;
    this.stopping=true;clearTimeout(this.timer);
    for(const turn of Object.values(this.state.turns)){turn.active=false;turn.awaitingCompletion=false;}
    for(const run of this.state.runs)if(LIVE.has(run.status))this.cancel(run.id,'服务已停止。',false);
    this.collect();
    return this.shutdown=Promise.resolve(this.activeExecution).finally(()=>this.collect());
  }
}
