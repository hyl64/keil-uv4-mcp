import fs from 'node:fs';
function fnv1a(buf,init=0x811c9dc5,prime=0x01000193,textOnly=false){
  let h=init>>>0;
  for(let i=0;i<buf.length;i++){
    if(textOnly && buf[i]===0x1A) break;
    h^=buf[i]; h=Math.imul(h,prime)>>>0;
  }
  return h;
}
const main=fs.readFileSync('reverse/samples/Minimal/main.c');
const sh=fs.readFileSync('C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h');
const hex=h=>h.toString(16).toUpperCase().padStart(8,'0');
const crlf=Buffer.from(main.toString('latin1').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'),'latin1');
for (const [n,b] of [['main raw',main],['main crlf',crlf],['stdint',sh]]) {
  console.log(n, 'fnv1a', hex(fnv1a(b)), 'fnv1a(text)', hex(fnv1a(b,0x811c9dc5,0x01000193,true)), 'len', b.length);
}
function fnv1(buf,init=0x811c9dc5,prime=0x01000193){let h=init>>>0; for(const x of buf){h=Math.imul(h,prime)>>>0; h^=x;} return h;}
console.log('fnv1 main', hex(fnv1(main)));
// Try FNV-1a 64 but take low32 vs high32
function fnv1a64(buf){let h=0xcbf29ce484222325n; const p=0x100000001b3n; for(const x of buf){h=(h^BigInt(x))&0xffffffffffffffffn; h=(h*p)&0xffffffffffffffffn;} return h;}
const h64=fnv1a64(main); console.log('fnv1a64', h64.toString(16), 'lo', hex(Number(h64&0xffffffffn)), 'hi', hex(Number(h64>>32n)));
console.log('targets main 6AE203ED stdint 6939538B');
