#!/usr/bin/env node
import path from 'node:path';
import {ensureService,stopService,request,dashboardURL} from '../src/client.mjs';
import {serve} from '../src/server.mjs';
import {openWidget} from '../src/widget.mjs';
import {locateCodex,sync,VERSION,dataDir,openURL,gitRoot,sha} from '../src/util.mjs';
const [action='help',...args]=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1])throw new Error(`${name} 缺少参数。`);return args[i+1];};
const print=v=>console.log(typeof v==='string'?v:JSON.stringify(v,null,2));
try{
 if(action==='serve'){const app=await serve();print(`AutoReview ${VERSION} ${app.url}`);process.once('SIGTERM',app.close);process.once('SIGINT',app.close);}
 else if(action==='doctor'){
  const checks=[];for(const [name,fn]of [['Node',()=>process.version],['Git',()=>sync('git',['--version']).trim()],['Codex',()=>sync(locateCodex(),['--version']).trim()],['Codex 登录',()=>{sync(locateCodex(),['login','status']);return '已登录';}],['Hooks',()=>{if(!/^hooks\s+\S+\s+true$/m.test(sync(locateCodex(),['features','list'])))throw new Error('请启用 Codex features.hooks');return '已启用；安装器自动配置 AutoReview 集成';}]]){try{checks.push({name,ok:true,detail:fn()});}catch(e){checks.push({name,ok:false,detail:e.message});}}
  print({version:VERSION,checks,dataDirectory:dataDir(),mode:'只读、静默审计'});if(checks.some(x=>!x.ok))process.exitCode=1;
 }else if(action==='stop'){print(await stopService());}
 else if(['desktop','widget','dashboard','connect','enable','disable','status','review','cancel','config','prune'].includes(action)){
  const service=await ensureService();
  if(action==='desktop')await request(service,'/api/desktop/connect',{root:path.resolve(args[0]||process.cwd())},'POST',30000);
  if(action==='widget'||action==='desktop'){try{if(await openWidget())print('AutoReview 已就绪：面板随 Codex 前台显示，切换应用时自动隐藏。');else{openURL(dashboardURL(service));print(dashboardURL(service));}}catch(e){print(`原生悬浮窗不可用：${e.message}\n已使用浏览器面板。`);openURL(dashboardURL(service));}}
  else if(action==='dashboard'){print(dashboardURL(service));if(!args.includes('--no-open'))openURL(dashboardURL(service));}
  else if(action==='status')print(await request(service,'/api/state'));
  else if(action==='cancel'){if(!args[0])throw new Error('请提供审计 ID。');print(await request(service,`/api/runs/${args[0]}/cancel`,{}));}
  else if(action==='prune')print(await request(service,'/api/prune',{days:Number(flag('--days')??30)}));
  else{const root=gitRoot(args[0]&&!args[0].startsWith('--')?path.resolve(args[0]):process.cwd()),key=sha(root).slice(0,20);
   if(['enable','connect'].includes(action))print(await request(service,'/api/projects',{root,options:action==='enable'?{enabled:true}:{}}));
   else if(action==='disable')print(await request(service,`/api/projects/${key}`,{enabled:false},'PATCH'));
   else if(action==='config')print(flag('--json')?await request(service,`/api/projects/${key}`,JSON.parse(flag('--json')),'PATCH'):(await request(service,'/api/state')).projects.find(p=>p.id===key));
   else print(await request(service,`/api/projects/${key}/review`,{requirement:flag('--requirement')||''}));
  }
 }else{print(`AutoReview ${VERSION} — 静默、只读审计\n\n  widget              打开 macOS 悬浮窗（其他平台打开网页）\n  dashboard           打开网页面板，--no-open 只输出地址\n  connect [项目路径]   连接项目；随后在面板点击开启\n  enable [项目路径]    开启审计\n  disable [项目路径]   暂停审计\n  review [项目路径] --requirement "审计要求"\n  status              查看审计与意见传达状态\n  cancel 审计ID       取消审计\n  config [项目路径] --json '{"timeoutSeconds":300}'\n  doctor              检查本机环境\n  prune --days 30      清理旧历史\n  stop                停止后台服务\n\n安装：npm run setup -- --project /项目路径\n数据：${dataDir()}\n后台不会修复、回写、提交或推送代码。`);if(!['help','--help','-h'].includes(action))process.exitCode=1;}
}catch(error){console.error(`AutoReview：${error.message}`);process.exitCode=1;}
