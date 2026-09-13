import test from 'node:test';
import assert from 'node:assert/strict';
import {shellMayWrite} from '../plugins/autoreview/src/shell-writes.mjs';

test('read-only shell searches and printed code never establish writing attribution',()=>{
 const commands=[
  "rg -n 'writeFileSync|write_text|foo > bar' src",
  "grep 'rm -rf output' log.txt",
  "echo 'text > file'",'cat main.js # writeFileSync(x)',
  'cat main.js 2>/dev/null',"sed -n '1,20p' main.js",
  "node -e 'console.log(\"fs.writeFileSync(x)\")'",
  "python3 -c 'print(\"Path(p).write_text(x)\")'",
  "cat <<'EOF'\nrm main.js\nnode -e 'fs.writeFileSync(x)'\nEOF\n",
  "python3 - <<'PY'\nprint('write_text(x)')\n# Path(p).write_text(x)\nPY\n",
  "python3 -c 'open(path.join(\"dir\", \"w\"), \"r\").read()'",
  "python3 -c 'open(build_name(\"name\", \"w\")).read()'",
  'echo "unterminated', 'some_unrecognized_script.sh'
 ];
 for(const command of commands)assert.equal(shellMayWrite(command),false,command);
});
test('actual writing commands, output redirects and interpreter scripts establish tool windows',()=>{
 const commands=[
  'rm main.js','cp before.js after.js','touch new.js','cat template > main.js',
  "rg 'abc' src | tee results.txt",'sed --in-place s/a/b/ main.js',
  "node -e 'fs.writeFileSync(\"main.js\", \"text\")'",
  "node --eval 'fs.promises.appendFile(\"main.js\", \"text\")'",
  "python3 -c 'Path(\"main.js\").write_text(\"text\")'",
  "python3 - <<'PY'\nfrom pathlib import Path\nPath('main.js').write_text('text')\nPY\n",
  "python3 -c 'open(path.join(\"dir\", \"main.js\"), \"w\").write(\"x\")'",
  "python3 -c 'open(\"file\", mode=\"r+\").write(\"x\")'",
  "env MODE=test node -e 'fs.writeFileSync(\"main.js\", \"text\")'",
  "cat <<'EOF'\nreadonly text\nEOF\ntouch new.js"
 ];
 for(const command of commands)assert.equal(shellMayWrite(command),true,command);
});
