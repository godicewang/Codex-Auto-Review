const $ = selector => document.querySelector(selector);
let lang = localStorage.getItem('autoreview-language') || 'zh';
let state = {projects:[],runs:[],adviceQueue:[]}, projectId = localStorage.getItem('autoreview-project') || '', selected = '', view = 'pending', online = false;
const words = {
 zh:{on:'已开启 · 暂停',off:'开启审计',idle:'等待下一轮代码改动',awaitingHost:'已开启，等待 Codex 会话接入',paused:'后台审计已暂停',busy:'在冻结副本中静默审计',finishing:'等待 Codex 完成本轮回答',offline:'连接已断开，请重新打开',noProject:'连接一个 Git 项目',queued:'排队中',reviewing:'审计中',completed:'已完成',failed:'失败',cancelled:'已取消',legacy:'旧版记录',waiting:'等待对应主对话的下一条消息',delivered:'已发送，待主 Codex 核对',changed:'基于此前快照，主 Codex 会重新核对位置和结论',manual:'手动快照 · 由当前项目的下一条消息领取',cancel:'取消本次审计',evidence:'证据与触发条件',impact:'影响',suggestion:'修改建议',noHook:'尚未收到 Codex 事件；首次安装后，请在新任务中使用。',hook:'最近连接 ',none:'当时未发现有充分证据的 Bug。',pending:'待传达',history:'全部记录',emptyTitle:'队列已清空，继续专注。',emptyBody:'新的报告会在这里等你。下次发消息时，一并交给主 Codex。',noHistory:'还没有审计记录',noHistoryBody:'开启后正常开发。有代码改动的一轮结束时，后台会自动审计。'},
 en:{on:'On · Pause',off:'Enable review',idle:'Waiting for the next code change',awaitingHost:'Enabled; waiting for a Codex session',paused:'Background review paused',busy:'Reviewing the frozen snapshot',finishing:'Waiting for Codex to finish its turn',offline:'Disconnected. Reopen AutoReview.',noProject:'Connect a Git project',queued:'Queued',reviewing:'Reviewing',completed:'Complete',failed:'Failed',cancelled:'Cancelled',legacy:'Legacy',waiting:'Waiting for the next message in its conversation',delivered:'Sent for Codex to verify',changed:'Based on an earlier snapshot; Codex will recheck locations and conclusions',manual:'Manual snapshot · next message in this project',cancel:'Cancel review',evidence:'Evidence & trigger',impact:'Impact',suggestion:'Suggested fix',noHook:'No Codex events received yet. Use a new task after first installation.',hook:'Last connected ',none:'No substantiated bugs found in that snapshot.',pending:'Pending',history:'All reviews',emptyTitle:'All caught up. Keep your focus.',emptyBody:'New reports will wait here and accompany your next message to Codex.',noHistory:'No reviews yet',noHistoryBody:'Enable review, then keep coding. Changed turns are reviewed automatically.'}
};
const t = key => words[lang][key] || key;
Object.assign(words.zh,{failedReview:'上次审计失败，未生成报告',failedBody:'请查看失败原因，再决定是否手动重试。',firstReview:'等待首次审计',firstBody:'尚无审计结论。收到 Codex 代码改动并确认本轮完成后，才会开始检查。',showFailure:'查看失败记录'});
Object.assign(words.en,{failedReview:'Last review failed; no report generated',failedBody:'Check the failure before deciding whether to retry manually.',firstReview:'Waiting for the first review',firstBody:'No review result yet. Review starts after a Codex code change and confirmed turn completion.',showFailure:'View failed review'});
Object.assign(words.zh,{noHook:'尚未收到此项目的 Codex 事件。旧任务请查看接入帮助。',hook:'此项目最近事件 ',configurationChecked:'安装与信任配置已核对。旧任务仍需在 Codex 插件页关闭再开启 AutoReview，或使用新任务。',settingsOpened:'已请求打开插件页。请关闭再开启 AutoReview，然后回到原任务继续；打开页面本身不会刷新配置。'});
Object.assign(words.en,{noHook:'No Codex events for this project yet. See connection help for existing tasks.',hook:'Last project event ',configurationChecked:'Installation and trust verified. For an existing task, toggle AutoReview off and on in Codex, or use a new task.',settingsOpened:'Requested the plugin page. Toggle AutoReview off and on, then return to your task. Opening the page alone does not refresh configuration.'});
const native = message => window.webkit?.messageHandlers?.autoreview?.postMessage(message);
const params = new URLSearchParams(location.hash.slice(1));
let token = params.get('token') || sessionStorage.getItem('autoreview-token') || '';
if(token){sessionStorage.setItem('autoreview-token',token);history.replaceState(null,'',location.pathname);}
const el = (tag, cls, text) => {const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function error(text){$('#error').textContent=text;$('#error').hidden=!text;}
async function safe(fn){try{error('');await fn();}catch(e){error(e.message);}}
async function api(route,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(route,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await r.json();if(!r.ok)throw new Error(value.error||r.statusText);return value;
}
const project=()=>state.projects.find(p=>p.id===projectId);
const pendingIds=()=>new Set((state.adviceQueue||[]).filter(q=>q.projectId===projectId).map(q=>q.runId));
const projectRuns=()=>state.runs.filter(r=>r.projectId===projectId);
let desktopStamp='';
function receive(next){if(next.desktopContext?.connectedAt&&next.desktopContext.connectedAt!==desktopStamp){desktopStamp=next.desktopContext.connectedAt;projectId=next.desktopContext.projectId;selected='';}if(state.cleanupError||next.cleanupError)error(next.cleanupError||'');state=next;if(!project())projectId=state.projects[0]?.id||'';render();}
function render(){
 const p=project(),runs=projectRuns(),pending=pendingIds(),busy=runs.filter(r=>['reviewing','queued'].includes(r.status));
 const failed=runs[0]?.status==='failed'?runs[0]:null;
 const awaiting=busy.length>0&&busy.every(r=>r.awaitingTurnCompletion);
 const visible=view==='pending'?runs.filter(r=>pending.has(r.id)).reverse():runs;
 if(!visible.some(r=>r.id===selected))selected=visible[0]?.id||'';
 const run=visible.find(r=>r.id===selected),zh=lang==='zh';
 document.documentElement.lang=zh?'zh-CN':'en';$('#language').textContent=zh?'EN':'中文';
 const labels={'tagline':zh?'安静审计，继续专注。':'A quiet second pair of eyes.','project-label':zh?'查看项目':'PROJECTS','auto-label':zh?'自动审计':'Auto review','pending-label':zh?'待传达报告':'Pending reports','finding-label':zh?'待复核问题':'Issues to verify','running-label':zh?'审计任务':'Review jobs','entry-title':zh?'关了，也能随时打开':'Always within reach','entry-hint':zh?'随 Codex 显示 · 多项目独立运行':'Follows Codex · Independent projects','entry':zh?'添加打开按钮 ↗':'Add launcher ↗','repair':zh?'重新连接':'Reconnect','manual':zh?'＋ 手动审计':'+ Review snapshot','footer':zh?'冻结副本 · 后台只读 · 完成自动清理':'Frozen snapshot · Read only · Automatic cleanup'};
 for(const [key,value] of Object.entries(labels))$('#'+key).textContent=value;
 $('#projects').replaceChildren(...state.projects.map(p=>{const o=el('option','',`${p.enabled?'●':'○'} ${p.name}`);o.value=p.id;return o;}));if(!p)$('#projects').append(el('option','',t('noProject')));$('#projects').value=projectId;
 $('#project-path').textContent=p?.root||'';$('#project-path').title=p?.root||'';
 $('#toggle').disabled=!p||!online;$('#toggle').textContent=t(p?.enabled?'on':'off');$('#toggle').setAttribute('aria-checked',String(!!p?.enabled));$('#toggle').classList.toggle('enabled',!!p?.enabled);
 $('#status').textContent=t(!online?'offline':!p?'noProject':busy.length?(awaiting?'finishing':'busy'):p.enabled?(failed?'failedReview':p.lastHookAt?'idle':'awaitingHost'):'paused');$('#dot').className=`dot ${online&&p?.enabled?(busy.length?'busy':'on'):''}`;
 $('#connect-hint').textContent=zh?`在 Codex 顶部点击 AutoReview，连接并开启当前任务的项目。已开启 ${state.projects.filter(p=>p.enabled).length} 个项目，切换查看不会暂停其他项目。`:`Click AutoReview in the Codex toolbar to connect its current project. ${state.projects.filter(p=>p.enabled).length} projects enabled; changing this view does not pause them.`;
 $('#repair').hidden=!p;$('#repair').disabled=!p||!online;$('#repair').textContent=zh?'接入帮助':'Connection help';
 const integrationLabels=zh?{'title':'让当前任务接入','explanation':'安装配置完成后，新任务会加载插件。继续使用原来的任务时，请打开 Codex 中的 AutoReview 插件页，将插件关闭再开启一次，让桌面宿主刷新配置。无需进入 CLI。','boundary':'“核对配置”只能核对安装与信任设置，不能刷新正在运行的 GUI 任务。最近事件属于此项目，不一定来自当前显示的任务；收到真实事件后才能确认接入。','check':'核对配置','settings':'打开 Codex 插件页 ↗','close':'完成'}:{'title':'Connect your current task','explanation':'New tasks load the installed plugin. To keep using an existing task, open AutoReview in Codex and toggle the plugin off and on once to refresh the desktop host. No CLI setup is needed.','boundary':'Verify configuration checks installation and trust; it cannot refresh a running GUI task. Project events may come from a different task. Actual received events are the connection evidence.','check':'Verify configuration','settings':'Open plugin in Codex ↗','close':'Done'};
 for(const [key,value] of Object.entries(integrationLabels))$('#integration-'+key).textContent=value;
 $('#hook-hint').textContent=p?.lastHookAt?`${t('hook')}${new Date(p.lastHookAt).toLocaleTimeString()}`:t('noHook');
 $('#pending-count').textContent=pending.size;$('#finding-count').textContent=runs.filter(r=>pending.has(r.id)).reduce((n,r)=>n+(r.findings?.length||0),0);$('#running-count').textContent=busy.length;
 for(const key of ['settings','manual','entry'])$('#'+key).disabled=!p||!online;
 $('#pending-tab').textContent=`${t('pending')} ${pending.size}`;$('#history-tab').textContent=t('history');$('#pending-tab').setAttribute('aria-selected',String(view==='pending'));$('#history-tab').setAttribute('aria-selected',String(view==='history'));
 $('#queue-note').textContent=zh?'下次消息批量传达。每次最多 48,000 字符，超出部分保留到下次。各会话领取自己的报告；传达失败保留重试。':'Delivered in batches with the next message, up to 48,000 characters. Overflow stays queued. Each conversation receives its own reports; failed handoffs stay queued.';
 $('#run-list').replaceChildren(...visible.map(r=>{const b=el('button','run-row'+(r.id===selected?' selected':''));const title=el('span','run-name',r.prompt?.slice(0,60)||(zh?'审计报告':'Review'));title.append(el('small','',new Date(r.finishedAt||r.createdAt).toLocaleString()));b.append(title,el('span','badge',pending.has(r.id)?`${r.findings?.length||0} ${zh?'个问题':'issues'}`:t(r.awaitingTurnCompletion?'finishing':r.status)));b.onclick=()=>{selected=r.id;render();};return b;}));
 const out=$('#result');
 if(!run){const empty=el('div','empty');empty.append(el('span','empty-icon',busy.length||!runs.length?'◌':failed?'!':'✓'),el('h2','',busy.length?(awaiting?t('finishing'):(zh?'正在后台检查…':'Reviewing in the background…')):failed?t('failedReview'):!runs.length?t('firstReview'):t(view==='pending'?'emptyTitle':'noHistory')),el('p','',busy.length?(zh?'你可以继续主对话。完成后报告会加入队列。':'Keep working in Codex. Completed reports will join the queue.'):failed?(failed.message||t('failedBody')):!runs.length?t('firstBody'):t(view==='pending'?'emptyBody':'noHistoryBody')));out.replaceChildren(empty);}
 else{
  const head=el('div','report-head');head.append(el('p','summary',run.report||run.message||t(run.status)),el('span','report-time',new Date(run.finishedAt||run.createdAt).toLocaleTimeString()));const nodes=[head];
  if(run.status==='completed')nodes.push(el('p','delivery',pending.has(run.id)?t(run.sessionId==='manual'?'manual':'waiting'):run.deliveredAt?t('delivered'):t(run.status)));
  if(run.status==='completed'&&(run.sourceChangedAtDelivery||run.staleAt||pending.has(run.id)))nodes.push(el('p','delivery',t('changed')));
  for(const f of run.findings||[]){const card=el('article','finding'),title=el('h3');title.append(el('span','severity',f.severity),document.createTextNode(f.title));card.append(title,el('code','location',`${f.file}:${f.line}${f.endLine>f.line?`–${f.endLine}`:''}`));for(const key of ['evidence','impact','suggestion']){const row=el('p',key==='suggestion'?'suggestion':'');row.append(el('label','',t(key)),document.createTextNode(f[key]));card.append(row);}nodes.push(card);}
  for(const note of run.limitations||[])nodes.push(el('p','limitation',note));
  if(['queued','reviewing'].includes(run.status)){const b=el('button','cancel',t('cancel'));b.onclick=()=>safe(()=>api(`/api/runs/${run.id}/cancel`,{}));nodes.push(b);}
  out.replaceChildren(...nodes);
 }
 if(view==='pending'&&failed){const notice=el('div','limitation');notice.setAttribute('role','status');if(run)notice.append(el('p','',t('failedReview')),el('p','',failed.message||t('failedBody')));const open=el('button','',t('showFailure'));open.onclick=()=>{view='history';selected=failed.id;render();};notice.append(open);out.append(notice);}
 native({action:'status',pending:(state.adviceQueue||[]).length,reviewing:state.runs.some(r=>r.status==='reviewing')});
}
$('#projects').onchange=e=>{projectId=e.target.value;selected='';localStorage.setItem('autoreview-project',projectId);render();};
$('#pending-tab').onclick=()=>{view='pending';selected='';render();};$('#history-tab').onclick=()=>{view='history';selected='';render();};
$('#toggle').onclick=()=>safe(async()=>{const p=project();if(!p.enabled)await api('/api/integration/activate',{projectId:p.id});receive(await api(`/api/projects/${p.id}`,{enabled:!p.enabled},'PATCH').then(()=>api('/api/state')));});
function openProjectDialog(kind){const p=project();if(!p)return;const dialog=$('#'+kind+'-dialog');dialog.dataset.projectId=p.id;$('#'+kind+'-project').textContent=p.name;$('#'+kind+'-project').title=p.root;if(kind==='settings'){$('#settings-form').elements.model.value=p.model;$('#settings-form').elements.timeoutSeconds.value=p.timeoutSeconds;}dialog.showModal();}
$('#settings').onclick=()=>openProjectDialog('settings');
$('#manual').onclick=()=>openProjectDialog('manual');
$('#language').onclick=()=>{lang=lang==='zh'?'en':'zh';localStorage.setItem('autoreview-language',lang);render();};
$('#collapse').onclick=()=>{if(window.webkit?.messageHandlers?.autoreview){native({action:'collapse'});return;}$('#details').hidden=!$('#details').hidden;$('#collapse').textContent=$('#details').hidden?'+':'−';};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();
$('#settings-form').onsubmit=e=>{e.preventDefault();const target=$('#settings-dialog').dataset.projectId;safe(async()=>{const f=e.target.elements;await api(`/api/projects/${target}`,{model:f.model.value.trim(),timeoutSeconds:Number(f.timeoutSeconds.value)},'PATCH');$('#settings-dialog').close();});};
$('#manual-form').onsubmit=e=>{e.preventDefault();const target=$('#manual-dialog').dataset.projectId;safe(async()=>{const r=await api(`/api/projects/${target}/review`,{requirement:e.target.elements.requirement.value});if(projectId===target){selected=r.id;view='history';}$('#manual-dialog').close();receive(await api('/api/state'));});};
$('#repair').onclick=()=>{$('#integration-result').textContent='';openProjectDialog('integration');};
$('#integration-check').onclick=()=>safe(async()=>{const target=$('#integration-dialog').dataset.projectId;await api('/api/integration/activate',{projectId:target});$('#integration-result').textContent=t('configurationChecked');receive(await api('/api/state'));});
$('#integration-settings').onclick=()=>safe(async()=>{await api('/api/integration/settings',{});$('#integration-result').textContent=t('settingsOpened');});
async function copy(selector,button){try{await navigator.clipboard.writeText($(selector).value);button.textContent=lang==='zh'?'已复制':'Copied';}catch{$(selector).focus();$(selector).select();}}
$('#copy-entry').onclick=e=>copy('#entry-command',e.target);
$('#entry').onclick=()=>safe(async()=>{const result=await api(`/api/projects/${projectId}/entry`,{});$('#entry-result').textContent=result.status==='installed'?'已为当前项目配置官方 AutoReview 打开动作。':result.message;$('#entry-command').value=result.command;$('#entry-dialog').showModal();});
if(!token){render();error('请通过 AutoReview 打开入口或 npm start 打开。');}
else safe(async()=>{receive(await api('/api/state'));const stream=new EventSource(`/events?token=${encodeURIComponent(token)}`);stream.onopen=()=>{online=true;render();};stream.onerror=()=>{online=false;render();};stream.addEventListener('state',e=>receive(JSON.parse(e.data)));});
