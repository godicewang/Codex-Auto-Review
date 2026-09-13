#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWidget, showWidget } from '../plugins/autoreview/src/widget.mjs';
import {activateIntegration} from '../plugins/autoreview/src/control.mjs';
import { installLauncher, installAction } from '../plugins/autoreview/src/entry.mjs';
import { locateCodex, sync, openURL, writeJSON, gitRoot } from '../plugins/autoreview/src/util.mjs';
import { ensureService, request, dashboardURL, stopService } from '../plugins/autoreview/src/client.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), index=args.indexOf('--project'), project=index>=0?args[index+1]:null;
const help=`AutoReview setup / 安装\n\n  npm run setup                        安装；随后在目标项目的新 Codex 任务中开启\n  npm run setup -- --project "/path"    安装并开启指定 Git 项目\n  npm run setup -- --no-open            安装但不打开面板\n  npm run setup -- --uninstall          卸载并保留审计历史\n\nRequires Node.js 20.11+, Git, and a logged-in Codex with plugins/hooks/App Server.\n需要 Node.js 20.11+、Git 和已登录的 Codex；无需 npm install。`;
try {
  if(args.includes('--help')||args.includes('-h')){console.log(help);process.exit(0);}
  const [major, minor] = process.versions.node.split('.').map(Number);
  if(major<20 || (major===20 && minor<11))throw new Error('Node.js 20.11+ is required.');
  if(index>=0 && (!project || project.startsWith('--')))throw new Error('--project needs a Git repository path.');
  for(let i=0;i<args.length;i++){
    if(args[i]==='--project'){if(i!==index)throw new Error('--project may only be specified once.');i++;continue;}
    if(!['--no-open','--uninstall'].includes(args[i]))throw new Error(`Unknown option: ${args[i]}. Use --help.`);
  }
  if(args.includes('--uninstall')&&(project||args.includes('--no-open')))throw new Error('--uninstall cannot be combined with installation options.');
  const codex=locateCodex();
  const catalog=JSON.parse(fs.readFileSync(path.join(repo,'.agents/plugins/marketplace.json'),'utf8'));
  if(args.includes('--uninstall')) {
    await stopService();
    console.log(sync(codex,['plugin','remove',`autoreview@${catalog.name}`]).trim());
    console.log('Plugin removed. Review history is retained in ~/.autoreview. / 插件已卸载，本地历史记录保留。');
  } else {
    sync('git',['--version']);
    console.log(`Codex: ${sync(codex,['--version']).trim()}`);
    try{sync(codex,['login','status']);}catch{throw new Error('Codex is not logged in. Run codex login, then retry. / 请先登录 Codex，再重新安装。');}
    if(!/^hooks\s+\S+\s+true$/m.test(sync(codex,['features','list'])))throw new Error('Codex hooks are unavailable or disabled. Use a compatible Codex with hooks enabled. / 当前 Codex 未开启 hooks，请先检查版本和功能设置。');
    // Validate the selected project before registering or replacing a plugin.
    const projectRoot=project?gitRoot(path.resolve(project)):null;
    // Preserve unrelated marketplaces. Only this downloaded repository's catalog is renamed.
    const configured=JSON.parse(sync(codex,['plugin','marketplace','list','--json'])).marketplaces || [];
    const existing=configured.find(m=>m.name===catalog.name);
    const canonical = root => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } };
    if(existing && canonical(existing.root)!==canonical(repo)) {
      let candidate='autoreview', suffix=2;
      while(configured.some(m=>m.name===candidate && canonical(m.root)!==canonical(repo))) candidate=`autoreview-${suffix++}`;
      catalog.name=candidate;
      writeJSON(path.join(repo,'.agents/plugins/marketplace.json'),catalog);
      console.log(`Using marketplace "${candidate}"; the existing marketplace was preserved.`);
    }
    console.log(sync(codex,['plugin','marketplace','add',repo],{timeout:60000}).trim());
    const installed=sync(codex,['plugin','add',`autoreview@${catalog.name}`],{timeout:60000}).trim();console.log(installed);
    const installedRoot=installed.match(/Installed plugin root: (.+)/)?.[1] || path.join(repo,'plugins','autoreview');
    installLauncher(installedRoot,{marketplacePath:path.join(repo,'.agents/plugins/marketplace.json')});
    await stopService();
    const integration=await activateIntegration(projectRoot||repo,{pluginRoot:installedRoot});
    console.log(`AutoReview 配置已写入并核对：${integration.hookCount} 个事件。当前 GUI 任务是否接入，以实际收到事件为准。`);
    const service=await ensureService({pluginRoot:installedRoot});
    if(projectRoot){await request(service,'/api/desktop/connect',{root:projectRoot},'POST',30000);console.log(`Connected project: ${projectRoot}`);const action=installAction(projectRoot);console.log(action.status==='installed'?`Codex 顶部 Actions 已配置：AutoReview（${action.file}）`:`${action.message}\n${action.command}`);}
    const url=dashboardURL(service);
    let widget;
    try {widget=installWidget(installedRoot);}
    catch(error){console.log(`悬浮窗未构建：${error.message}。可使用网页入口。`);}
    console.log(`\n审计面板：${url}\n${widget?'原生面板：'+widget+'\n':''}\n下一步：打开你要审计的项目，新建 Codex 任务，发送：\n“使用 AutoReview，打开悬浮窗，并开启当前项目的只读审计。”\nNext: open your project in a new Codex task and ask:\n“Use AutoReview to open the panel and enable read-only review for this project.”\n\n连接后也可使用项目顶部 Actions → AutoReview。原生面板随 Codex 前台显示，各项目开关独立。\n继续旧任务时，在面板点“接入帮助”，打开 Codex 插件页面，将 AutoReview 关闭再开启一次以刷新桌面宿主。无需 CLI 信任操作。\n后台仅审计 Codex 工具产生的可归因改动，不修改代码。`);
    if(!args.includes('--no-open')){if(widget)await showWidget(widget);else openURL(url);}
  }
}catch(error){console.error(`Setup: ${error.message}\nRun: node plugins/autoreview/bin/autoreview.mjs doctor`);process.exitCode=1;}
