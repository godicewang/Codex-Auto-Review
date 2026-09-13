import readline from 'node:readline';
import { spawn } from 'node:child_process';
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
let tool;
if (process.argv.includes('--stubborn')) {
 process.on('SIGTERM', () => {});
 tool = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
 await new Promise(resolve => tool.once('message', resolve)); tool.disconnect();
}
send({method:'test/workerStarted',params:{pid:process.pid,toolPid:tool?.pid}});
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{userAgent:'test'}});
 else if(m.method==='account/read')send({id:m.id,result:{account:{type:'chatgpt'},requiresOpenaiAuth:true}});
 else if(m.method==='thread/start'){
  if(m.params.sandbox!=='read-only'||!m.params.ephemeral||m.params.config['features.memories']!==false||m.params.config['features.hooks']!==false||!m.params.developerInstructions.includes('全程静默'))send({id:m.id,error:{message:'Isolation or prompt contract missing'}});
  else send({id:m.id,result:{thread:{id:'fake-thread'}}});
 }else if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'fake-turn'}}});const prompt=m.params.input[0].text;
  if(prompt==='hang')continue;
  if(prompt==='fail'){send({method:'turn/completed',params:{threadId:'fake-thread',turn:{status:'failed',error:{message:'Test failure'}}}});continue;}
  send({method:'item/agentMessage/delta',params:{threadId:'fake-thread',itemId:'noise',delta:'A progress event that the product must suppress.'}});
  const report={summary:'明确问题。',findings:[{title:'数值不正确',severity:'P2',file:'main.js',line:1,endLine:1,evidence:'要求数值 3，但代码返回 2。',impact:'返回错误结果。',suggestion:'由主对话改为 3。',confidence:'high'}],limitations:[]};
  send({method:'item/completed',params:{threadId:'fake-thread',item:{id:'final',type:'agentMessage',text:JSON.stringify(report)}}});
  send({method:'turn/completed',params:{threadId:'fake-thread',turn:{status:'completed'}}});
 }
}
