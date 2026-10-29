import fs from "node:fs";
const main=fs.readFileSync("reverse/samples/Minimal/main.c");
const stdint=fs.readFileSync("C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h");
const startup=fs.readFileSync("reverse/samples/Minimal/startup.s");
const T={main:0x6AE203ED>>>0,startup:0x6AE205A5>>>0,stdint:0x6939538B>>>0};
const hx=h=>(h>>>0).toString(16).toUpperCase().padStart(8,"0");
function fnv1a(buf){let h=0x811c9dc5>>>0;for(const b of buf){h^=b;h=Math.imul(h,0x01000193)>>>0;}return h;}
function fnv1a_64_to32(buf,salt){let h=(0xcbf29ce484222325n ^ BigInt(salt))&0xffffffffffffffffn;const p=0x100000001b3n;for(const b of buf){h=(h^BigInt(b))&0xffffffffffffffffn;h=(h*p)&0xffffffffffffffffn;}return h;}
for (const salt of [0,0x1n]) {
  const h=fnv1a_64_to32(main,salt);
  console.log("64bit salt",salt.toString(),h.toString(16),"lo",hx(Number(h&0xffffffffn)),"hi",hx(Number(h>>32n)));
}
// Two-level: fnv1a(fnv1a(chunk)) etc - skip
// String::Hash? boost hash_range
function boost(buf){let h=0; for(const c of buf){h=(h ^ ((c+0x9e3779b9+(h<<6)+(h>>>2))>>>0))>>>0;} return h;}
console.log("boost main",hx(boost(main)),"startup",hx(boost(startup)),"stdint",hx(boost(stdint)));
// modified FNV where xor with byte happens after IMUL with prime 16777619 but on 8-bit signed chars
function fnv1aSigned(buf){let h=0x811c9dc5>>>0;for(const b0 of buf){const b=b0>127?b0-256:b0; h=(h^b)>>>0; h=Math.imul(h,0x01000193)>>>0;}return h;}
console.log("fnv1a signed",hx(fnv1aSigned(main)),hx(fnv1aSigned(stdint)));
// CRC-32 with byte-wise 8-bit table but init per-file? skip
