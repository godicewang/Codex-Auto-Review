import fs from 'node:fs';
import path from 'node:path';
import {mkdir,now} from './util.mjs';

export const MAX_LOG_BYTES=1024*1024;
const RETAIN_BYTES=MAX_LOG_BYTES/2;

// Trim in place: an already-open daemon stdout descriptor must continue writing
// to the retained file. Logs are best-effort diagnostics, never report storage.
export function trimDiagnostic(file){
  let fd;try{fd=fs.openSync(file,'r+');}catch(error){if(error.code==='ENOENT')return;throw error;}
  try{
    const size=fs.fstatSync(fd).size;if(size<=MAX_LOG_BYTES)return;
    const tail=Buffer.alloc(RETAIN_BYTES),count=fs.readSync(fd,tail,0,tail.length,size-tail.length);
    const firstLine=tail.indexOf(10),kept=tail.subarray(firstLine<0?count:firstLine+1,count);
    fs.ftruncateSync(fd,0);fs.writeSync(fd,kept,0,kept.length,0);
  }finally{fs.closeSync(fd);}
}

export function appendDiagnostic(file,error){
  mkdir(path.dirname(file));trimDiagnostic(file);
  fs.appendFileSync(file,`${now()} ${String(error.message||error).slice(0,16000)}\n`,{mode:0o600});
  trimDiagnostic(file);
}
