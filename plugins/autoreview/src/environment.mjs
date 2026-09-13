// Inspect TOML structure without rewriting its contents. Strings (including
// multiline setup scripts) and comments cannot masquerade as action headers.
// This is a conservative append check, not a general-purpose TOML parser.
function structuralText(source){
  let out='';
  for(let i=0;i<source.length;){
    const c=source[i];
    if(c==='#'){while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(c!=="'"&&c!=='"'){out+=c;i++;continue;}
    const multi=source.slice(i,i+3)===c.repeat(3),width=multi?3:1;let content='',closed=false;i+=width;
    while(i<source.length){
      if(c==='"'&&source[i]==='\\'){content+=source.slice(i,i+2);i+=2;continue;}
      if(source.slice(i,i+width)===c.repeat(width)){
        i+=width;
        if(multi)for(let n=0;n<2&&source[i]===c;n++,i++)content+=c;
        closed=true;break;
      }
      if(!multi&&source[i]==='\n')return null;
      content+=source[i++];
    }
    if(!closed)return null;out+=JSON.stringify(content);
  }
  return out;
}

export function canAppendAction(source){
  if(source.length>1024*1024)return false;
  const text=structuralText(source);if(text===null)return false;
  let section=[],action=false,actionDefined=false;const stack=[];
  for(const row of text.split(/\r?\n/)){
    const line=row.trim();if(!line)continue;
    if(!stack.length&&line.startsWith('[')){
      const array=line.startsWith('[['),match=line.match(array?/^\[\[(.*)\]\]$/:/^\[(.*)\]$/);if(!match)return false;
      const key=match[1].trim();
      if(!/^(?:[A-Za-z0-9_-]+|"[^"\\]*")(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"\\]*"))*$/.test(key))return false;
      section=[...key.matchAll(/"[^"\\]*"|[A-Za-z0-9_-]+/g)].map(([part])=>part.startsWith('"')?JSON.parse(part):part);
      if(section.length===1&&section[0]==='actions'&&!array)return false;
      action=array&&section.length===1&&section[0]==='actions';
      if(section[0]==='actions'&&!action&&!actionDefined)return false;
      actionDefined ||= action;continue;
    }
    if(!stack.length){
      // Escaped keys may decode to "actions"; leave those uncommon forms to
      // Codex's environment editor rather than risk redefining a static array.
      if(line.slice(0,line.indexOf('=')).includes('\\'))return false;
      if(!section.length&&/^(?:actions|"actions")\s*(?:=|\.)/.test(line))return false;
      if(action&&/^(?:name|"name")\s*=/.test(line)){
        let name;try{name=JSON.parse(line.slice(line.indexOf('=')+1).trim());}catch{return false;}
        if(typeof name!=='string'||name.includes('\\')||name==='AutoReview')return false;
      }
      if(!line.includes('='))return false;
    }
    const structural=line.replace(/"(?:\\.|[^"\\])*"/g,'""');
    for(const c of structural){
      if(c==='['||c==='{')stack.push(c);
      if((c===']'&&stack.pop()!=='[')||(c==='}'&&stack.pop()!=='{'))return false;
    }
  }
  return !stack.length;
}
