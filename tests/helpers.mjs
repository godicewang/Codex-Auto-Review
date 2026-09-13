import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {git} from '../plugins/autoreview/src/util.mjs';
import {Store} from '../plugins/autoreview/src/store.mjs';
import {Engine} from '../plugins/autoreview/src/engine.mjs';
export const report={summary:'发现错误。',findings:[{title:'返回值与需求不符',severity:'P2',file:'main.js',line:1,endLine:1,evidence:'需求要求返回 3，但当前代码固定返回 2。',impact:'调用方得到错误数值。',suggestion:'将返回值改为 3，并在主对话中验证。',confidence:'high'}],limitations:[]};
export const goodAudit=async({onEvent})=>{onEvent?.({type:'codex',method:'item/agentMessage/delta',params:{delta:'This must not be shown.'}});return structuredClone(report);};
export function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autoreview-test-')),root=path.join(dir,'project');fs.mkdirSync(root);
 git(root,['init','--quiet']);git(root,['config','user.name','Test']);git(root,['config','user.email','test@localhost']);
 fs.writeFileSync(path.join(root,'main.js'),'export const value = 1;\n');fs.writeFileSync(path.join(root,'.gitignore'),'node_modules/\nignored.txt\n');
 git(root,['add','.']);git(root,['-c','commit.gpgsign=false','commit','--quiet','-m','initial']);
 const store=new Store(path.join(dir,'data')),engine=new Engine({store,audit:goodAudit,completionCheck:async()=>true,debounceMs:60000,...options}),project=engine.enable(root);
 t.after(async()=>{await engine.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,root,store,engine,project,write:(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});const turn=Object.values(engine.state.turns).filter(t=>t.active).at(-1);const hook=type=>engine.hook({cwd:root,session_id:turn.sessionId,turn_id:turn.turnId,hook_event_name:type,tool_use_id:'fixture-write',tool_name:'apply_patch',tool_input:{command:`*** Update File: ${name}\n`}});if(turn)hook('PreToolUse');fs.writeFileSync(file,text);if(turn)hook('PostToolUse');}};
}
export const event=(root,type,turn='one',extra={})=>({cwd:root,session_id:'session-1',turn_id:turn,hook_event_name:type,...extra});
// Simulate a successful host transport explicitly. Tests of lost responses and
// broken stdout call Engine.hook directly and deliberately omit this ACK.
export function deliveredHook(engine,payload){const result=engine.hook(payload);if(result.deliveryId)engine.acknowledgeAdvice({deliveryId:result.deliveryId,sessionId:payload.session_id,turnId:payload.turn_id});return result;}
export function enqueue(f){f.engine.hook(event(f.root,'UserPromptSubmit','one',{prompt:'将数值改为三。'}));f.write('main.js','export const value = 2;\n');return f.engine.hook(event(f.root,'Stop'));}
