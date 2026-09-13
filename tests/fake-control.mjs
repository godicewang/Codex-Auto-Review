import readline from 'node:readline';
process.on('SIGTERM',()=>{});
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line);
 if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\n');
 if(m.method==='test/pid')process.stdout.write(JSON.stringify({id:m.id,result:process.pid})+'\n');
}
// A stubborn control server must be reaped even after its stdin closes.
setInterval(()=>{},1000);
