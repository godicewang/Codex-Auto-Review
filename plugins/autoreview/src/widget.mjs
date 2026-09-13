import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, sync, writeJSON, locateCodex, VERSION, dataDir } from './util.mjs';
export function installWidget(pluginRoot=ROOT) {
  if(process.platform!=='darwin')return null;
  const app=path.join(os.homedir(),'Applications','AutoReview.app');
  const resources=path.join(app,'Contents','Resources'),macos=path.join(app,'Contents','MacOS');
  if(fs.existsSync(app)&&!fs.existsSync(path.join(resources,'bootstrap.json')))throw new Error(`已有非 AutoReview 管理的应用：${app}`);
  const compiler=sync('xcrun',['--find','swiftc']).trim();
  fs.mkdirSync(resources,{recursive:true});fs.mkdirSync(macos,{recursive:true});
  writeJSON(path.join(resources,'bootstrap.json'),{node:process.execPath,cli:path.join(pluginRoot,'bin','autoreview.mjs'),path:process.env.PATH||'/usr/bin:/bin',codex:locateCodex(),dataDir:dataDir()});
  const executable=path.join(macos,'AutoReview'),source=path.join(pluginRoot,'native','AutoReview.swift');
  const copied=path.join(resources,'AutoReview.swift');
  if(!fs.existsSync(executable)||!fs.existsSync(copied)||fs.readFileSync(copied,'utf8')!==fs.readFileSync(source,'utf8')){
    const tmp=executable+'.new';
    sync(compiler,['-sdk',sync('xcrun',['--sdk','macosx','--show-sdk-path']).trim(),'-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx13.0`,'-swift-version','5','-O',source,'-o',tmp,'-framework','AppKit','-framework','WebKit'],{timeout:120000});
    fs.renameSync(tmp,executable);fs.copyFileSync(source,copied);
    // Restart only this managed companion after a successful native rebuild.
    for(const line of sync('ps',['-axo','pid=,comm=']).split('\n')){
      const match=line.trim().match(/^(\d+)\s+(.+)$/);
      if(match?.[2]===executable)try{process.kill(Number(match[1]),'SIGTERM');}catch{}
    }
  }
  fs.writeFileSync(path.join(app,'Contents','Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.autoreview.widget</string><key>CFBundleExecutable</key><string>AutoReview</string><key>CFBundleName</key><string>AutoReview</string><key>CFBundleVersion</key><string>${VERSION}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`);
  return app;
}
export async function showWidget(app){
  // Launch Services can briefly retain the terminated process during an update.
  for(const delay of [0,200,500,1000]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    try{sync('open',[app]);return;}catch(error){if(delay===1000)throw error;}
  }
}
export async function openWidget(pluginRoot=ROOT){const app=installWidget(pluginRoot);if(app)await showWidget(app);return app;}
