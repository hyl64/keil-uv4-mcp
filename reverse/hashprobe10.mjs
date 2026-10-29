import fs from "node:fs";
const stdint=fs.readFileSync("C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h");
const T=0x6939538B>>>0;
const hx=h=>(h>>>0).toString(16).toUpperCase().padStart(8,"0");
function fnv1a(buf){let h=0x811c9dc5>>>0;for(const b of buf){h^=b;h=Math.imul(h,0x01000193)>>>0;}return h;}
console.log("full", hx(fnv1a(stdint)));
for (let n=1;n<=64;n+=1) {
  const h=fnv1a(stdint.subarray(0,n));
  if(h===T) console.log("MATCH prefix", n);
}
// maybe hash includes length prefix / filename
function fnv1aStr(s){return fnv1a(Buffer.from(s,"latin1"));}
const names=["stdint.h","STDINT.H","C:\\Users\\ERDAN.DESKTOP-MVAKHCO\\AppData\\Local\\Keil_v5\\ARM\\ARMCC\\Bin\\..\\include\\stdint.h"];
for(const n of names){const b=Buffer.from(n,"latin1"); console.log(n, hx(fnv1a(b)));}
// filename + content
for(const n of names){ const b=Buffer.concat([Buffer.from(n,"latin1"),stdint]); const h=fnv1a(b); if(h===T) console.log("MATCH name+content", n); else console.log("name+content", n, hx(h)); }
