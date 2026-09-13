import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const files=[...walk('plugins'),...walk('scripts'),...walk('tests')];
for(const file of files){
  if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'));
  if(/\.(mjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);}
}
const root='plugins/autoreview';const manifest=JSON.parse(fs.readFileSync(`${root}/.codex-plugin/plugin.json`));
if(manifest.name!=='autoreview')throw new Error('Invalid plugin name');
for(const file of ['.mcp.json','hooks/hooks.json','hooks/dispatch.mjs','bin/mcp.mjs','bin/autoreview.mjs','web/index.html','web/app.js','web/style.css','skills/autoreview/SKILL.md','prompts/reviewer.md','native/AutoReview.swift'])if(!fs.existsSync(`${root}/${file}`))throw new Error(`Missing ${file}`);
const market=JSON.parse(fs.readFileSync('.agents/plugins/marketplace.json'));if(!fs.existsSync(market.plugins[0].source.path))throw new Error('Broken marketplace path');
console.log(`Checked ${files.length} source/config files and plugin packaging.`);
