import path from 'node:path';

// Conservative shell lexer, not an executor. Keep quoted arguments as data and
// attach heredoc bodies to their actual command, so searches are never mistaken
// for the writing APIs they print. Unsupported shell grammar is left unclaimed.
function commands(source) {
  const out=[],pending=[];let tokens=[],word='',hasWord=false,quote='';
  const flush=()=>{if(hasWord){tokens.push({word});word='';hasWord=false;}};
  const finish=()=>{
    flush();if(!tokens.length)return;
    const command={tokens,stdin:[]};out.push(command);tokens=[];
    for(let i=0;i<command.tokens.length;i++)if(['<<','<<-'].includes(command.tokens[i].op)){
      const delimiter=command.tokens[i+1]?.word;if(!delimiter)throw new Error('Missing heredoc delimiter');
      pending.push({command,delimiter,tabs:command.tokens[i].op==='<<-'});
    }
  };
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quote){
      if(c===quote){quote='';continue;}
      if(c==='\\'&&quote==='"'&&/["\\$`\n]/.test(source[i+1]||'')){word+=source[++i];continue;}
      word+=c;continue;
    }
    if(c==='\\'){hasWord=true;if(i+1>=source.length)return null;const next=source[++i];if(next!=='\n')word+=next;continue;}
    if(c==='"'||c==="'"){quote=c;hasWord=true;continue;}
    if(c==='#'&&!hasWord){while(i<source.length&&source[i]!=='\n')i++;i--;continue;}
    if(c==='\n'){
      finish();
      for(const here of pending.splice(0)){
        const body=[];let found=false;
        while(i+1<source.length){
          const start=i+1,end=source.indexOf('\n',start),line=source.slice(start,end<0?source.length:end);i=end<0?source.length:end;
          if((here.tabs?line.replace(/^\t+/,''):line)===here.delimiter){found=true;break;}body.push(line);
        }
        if(!found)return null;here.command.stdin.push(body.join('\n'));
      }
      continue;
    }
    if(/\s/.test(c)){flush();continue;}
    if(c==='>'||c==='<'){
      flush();let op=c;if(source[i+1]===c||source[i+1]==='&'||(c==='<'&&source[i+1]==='>'))op+=source[++i];
      if(op==='<<'&&source[i+1]==='-')op+=source[++i];tokens.push({op});continue;
    }
    if(';|&'.includes(c)){finish();if(source[i+1]===c)i++;continue;}
    if('()`'.includes(c))return null;
    hasWord=true;word+=c;
  }
  if(quote)return null;finish();return pending.length?null:out;
}

function scriptWrites(source) {
  const code=source.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/g,m=>' '.repeat(m.length));
  if(/\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|write_text|write_bytes|unlink(?:Sync)?|rename(?:Sync)?|mkdir(?:Sync)?|rmdir(?:Sync)?|remove|rmtree)\s*\(/.test(code))return true;
  // Preserve the location of literals, then inspect a literal write mode only
  // for an actual open(...) call, not a printed string or a source-code search.
  for(const m of code.matchAll(/\bopen\s*\(/g)){
    let depth=1;
    for(let i=m.index+m[0].length;i<code.length&&depth;i++){
      if('([{'.includes(code[i]))depth++;else if(')]}'.includes(code[i]))depth--;
      else if(code[i]===','&&depth===1){
        const mode=source.slice(i+1).match(/^\s*(?:mode\s*=\s*)?['"]([rwaxbt+]+)['"]/);
        if(mode&&/[wax+]/.test(mode[1]))return true;
        break;
      }
    }
  }
  return false;
}

export function shellMayWrite(source) {
  let parsed;try{parsed=commands(source);}catch{return false;}if(!parsed)return false;
  for(const command of parsed){
    const args=[];
    for(let i=0;i<command.tokens.length;i++){
      const token=command.tokens[i];
      if(token.op){const target=command.tokens[++i]?.word;if(['>','>>','<>'].includes(token.op)&&target&&!/^\/dev\//.test(target))return true;continue;}
      args.push(token.word);
    }
    while(args.length&&/^[A-Za-z_]\w*=/.test(args[0]))args.shift();
    if(args[0]==='env'){args.shift();while(args.length&&/^[A-Za-z_]\w*=/.test(args[0]))args.shift();}
    const name=path.basename(args.shift()||'');
    if(['rm','mv','cp','touch','truncate','tee','mkdir','rmdir','install','apply_patch'].includes(name))return true;
    if(['sed','perl'].includes(name)&&args.some(a=>/^-[^-]*i/.test(a)||a==='--in-place'||a.startsWith('--in-place=')))return true;
    const node=/^node(?:js)?$/.test(name),python=/^python(?:[23](?:\.\d+)?)?$/.test(name);
    if(node||python){
      const flag=args.findIndex(a=>(node?['-e','--eval','-p','--print']:['-c']).includes(a));
      if(flag>=0&&scriptWrites(args[flag+1]||''))return true;
      if(args.includes('-')&&command.stdin.some(scriptWrites))return true;
    }
  }
  return false;
}
