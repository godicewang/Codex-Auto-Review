import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboard,nodeText,flush} from './ui-harness.mjs';

test('verified installation keeps connection help available without claiming an old task is refreshed',async()=>{
 const ui=await dashboard();await ui.publish({integration:{ready:true}});
 assert.equal(ui.nodes.get('repair').hidden,false);assert.match(ui.nodes.get('hook-hint').textContent,/尚未收到/);
 ui.nodes.get('repair').onclick();assert.equal(ui.nodes.get('integration-dialog').open,true);
 assert.equal(ui.nodes.get('integration-project').textContent,'项目 A');
 await ui.switchByAction(1);await ui.nodes.get('integration-check').onclick();await flush();
 const check=ui.requests.find(r=>r.route==='/api/integration/activate');assert.equal(check.body.projectId,ui.ids[0]);
 assert.match(ui.nodes.get('integration-result').textContent,/旧任务仍需/);assert.equal(ui.nodes.get('projects').value,ui.ids[1]);
});

test('connection help opens the fixed server settings action and describes the remaining host toggle',async()=>{
 const ui=await dashboard();ui.nodes.get('repair').onclick();await ui.nodes.get('integration-settings').onclick();
 assert.deepEqual(ui.requests.find(r=>r.route==='/api/integration/settings').body,{});
 assert.match(ui.nodes.get('integration-result').textContent,/打开页面本身不会刷新配置/);
 assert.match(ui.nodes.get('status').textContent,/等待 Codex 会话接入/);
});

test('settings retain the named project when a different Codex action changes the dashboard selection',async()=>{
 const ui=await dashboard();ui.nodes.get('settings').onclick();
 assert.equal(ui.nodes.get('settings-project').textContent,'项目 A');
 ui.nodes.get('settings-form').elements.model.value='example-model';await ui.switchByAction(1);await ui.submit('settings');
 const patch=ui.requests.find(r=>r.method==='PATCH');assert.equal(patch.route,`/api/projects/${ui.ids[0]}`);assert.equal(patch.body.model,'example-model');
 assert.equal(ui.nodes.get('projects').value,ui.ids[1]);assert.equal(ui.nodes.get('settings-dialog').open,false);
});

test('manual audit retains the named project when a different Codex action arrives while its dialog is open',async()=>{
 const ui=await dashboard();ui.nodes.get('manual').onclick();assert.equal(ui.nodes.get('manual-project').textContent,'项目 A');
 ui.nodes.get('manual-form').elements.requirement.value='检查项目 A 的边界条件';await ui.switchByAction(1);await ui.submit('manual');
 const review=ui.requests.find(r=>r.route.endsWith('/review'));assert.equal(review.route,`/api/projects/${ui.ids[0]}/review`);assert.equal(review.body.requirement,'检查项目 A 的边界条件');
 assert.equal(ui.nodes.get('projects').value,ui.ids[1]);assert.equal(ui.nodes.get('manual-dialog').open,false);
});

test('first review and failed review are distinct from an empty delivered queue',async()=>{
 const ui=await dashboard();assert.match(nodeText(ui.nodes.get('result')),/等待首次审计/);assert.doesNotMatch(nodeText(ui.nodes.get('result')),/✓|队列已清空/);
 const failed={id:'failed',projectId:ui.ids[0],status:'failed',message:'审计超时',createdAt:new Date().toISOString()};
 await ui.publish({runs:[failed]});assert.match(nodeText(ui.nodes.get('result')),/上次审计失败，未生成报告.*审计超时/);assert.doesNotMatch(nodeText(ui.nodes.get('result')),/✓|队列已清空/);
 const notice=ui.nodes.get('result').children.at(-1);notice.children.at(-1).onclick();assert.match(nodeText(ui.nodes.get('result')),/审计超时/);
});

test('failed latest review does not hide pending advice and an older failure does not overshadow later success',async()=>{
 const ui=await dashboard(),base={projectId:ui.ids[0],createdAt:new Date().toISOString()};
 const failed={...base,id:'failed',status:'failed',message:'审计超时'},completed={...base,id:'good',status:'completed',report:'未发现有充分证据的 Bug。',findings:[]};
 await ui.publish({runs:[failed,completed],adviceQueue:[{projectId:ui.ids[0],runId:completed.id}]});
 assert.match(nodeText(ui.nodes.get('result')),/未发现有充分证据的 Bug/);assert.match(nodeText(ui.nodes.get('result')),/上次审计失败/);
 await ui.publish({runs:[completed,failed],adviceQueue:[]});assert.doesNotMatch(nodeText(ui.nodes.get('result')),/上次审计失败/);assert.match(nodeText(ui.nodes.get('result')),/队列已清空/);
});
