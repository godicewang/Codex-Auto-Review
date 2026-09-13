import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, dataDir, atomic, writeJSON, readJSON, regularPath, gitRoot, locateCodex } from './util.mjs';
import {canAppendAction} from './environment.mjs';

export const LAUNCH_COMMAND = `node -e "require(require('node:os').homedir()+'/.autoreview/launcher.cjs')"`;
const BEGIN = '# BEGIN AUTOREVIEW LAUNCHER';
const END = '# END AUTOREVIEW LAUNCHER';

export function installLauncher(pluginRoot = ROOT, { home = os.homedir(), runtimeDir = dataDir(), codex = locateCodex(), marketplacePath } = {}) {
  const dir = path.join(home, '.autoreview');
  marketplacePath ||= readJSON(path.join(dir,'installation.json'),{}).marketplacePath;
  writeJSON(path.join(dir, 'installation.json'), {
    cli: path.join(pluginRoot, 'bin', 'autoreview.mjs'), node: process.execPath,
    runtimeDir, codex, path: process.env.PATH || '',...(marketplacePath?{marketplacePath}:{})
  });
  atomic(path.join(dir, 'launcher.cjs'), `// AutoReview stable launcher; installation.json changes on plugin upgrades.\nconst fs = require('node:fs'), path = require('node:path');\nconst cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'installation.json'), 'utf8'));\nconst result = require('node:child_process').spawnSync(cfg.node, [cfg.cli, 'desktop', process.cwd()], {stdio:'inherit', env:{...process.env, PATH:cfg.path, AUTOREVIEW_HOME:cfg.runtimeDir, AUTOREVIEW_CODEX_BIN:cfg.codex}});\nif (result.error) console.error(result.error.message);\nprocess.exitCode = result.status ?? 1;\n`);
}

export function pluginSettingsURL({home=os.homedir()}={}) {
  const file=readJSON(path.join(home,'.autoreview/installation.json'),{}).marketplacePath;
  if(typeof file!=='string'||!path.isAbsolute(file)||path.basename(file)!=='marketplace.json'||!fs.existsSync(file))throw new Error('安装来源已移动，请从 Codex 的插件列表打开 AutoReview。');
  return `codex://plugins/autoreview?marketplacePath=${encodeURIComponent(file)}`;
}

export function installAction(cwd) {
  const root = gitRoot(cwd), file = regularPath(root, '.codex/environments/environment.toml');
  const block = `${BEGIN}\n[[actions]]\nname = "AutoReview"\nicon = "tool"\ncommand = ${JSON.stringify(LAUNCH_COMMAND)}\n${END}\n`;
  if (!fs.existsSync(file)) {
    atomic(file, `version = 1\nname = ${JSON.stringify(path.basename(root))}\n\n[setup]\nscript = ""\n\n${block}`);
    return { status: 'installed', file, command: LAUNCH_COMMAND };
  }
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(block)) return { status: 'installed', file, command: LAUNCH_COMMAND };
  // Preserve setup and custom actions, including ordinary multiline scripts.
  // Conflicting/ambiguous action declarations stay under the user's control.
  if (source.includes(BEGIN) || !canAppendAction(source)) {
    return { status: 'manual', file, command: LAUNCH_COMMAND, message: '已有自定义本地环境，请在 Codex 顶部 Actions → 添加动作中粘贴打开命令。原配置已保留。' };
  }
  atomic(file, `${source}${source.endsWith('\n')?'\n':'\n\n'}${block}`);
  return { status: 'installed', file, command: LAUNCH_COMMAND };
}
