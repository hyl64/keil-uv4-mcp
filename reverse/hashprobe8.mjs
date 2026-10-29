import fs from "node:fs";
const files = {
  main: fs.readFileSync("reverse/samples/Minimal/main.c"),
  startup: fs.readFileSync("reverse/samples/Minimal/startup.s"),
  stdint: fs.readFileSync("C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h"),
};
const targets = { main: 0x6AE203ED>>>0, startup: 0x6AE205A5>>>0, stdint: 0x6939538B>>>0 };
const hx = h => (h>>>0).toString(16).toUpperCase().padStart(8,"0");
function rs1(buf, init, mul, add) { let h=init>>>0; for (const b of buf) h=(Math.imul(h,mul)+add+b)>>>0; return h; }
const muls=[31,33,37,65599,131,16777619,2654435761,0x01000193,1103515245,69069];
const inits=[0,1,5381,0x811c9dc5,0x9E3779B9,0xffffffff];
const adds=[0,1,0x811c9dc5,0x9E3779B9];
for (const name of Object.keys(files)) {
  const buf = files[name];
  const tgt = targets[name];
  const hits=[];
  for (const m of muls) for (const i of inits) for (const a of adds) {
    const h = rs1(buf,i,m,a);
    if (h===tgt) hits.push(`${m.toString(16)}/${i.toString(16)}/${a.toString(16)}`);
    // also xor variant
    let h2=i>>>0; for (const b of buf) h2=(Math.imul(h2,m)^b)>>>0; if(h2===tgt) hits.push(`xor ${m.toString(16)}/${i.toString(16)}`);
    let h3=i>>>0; for (const b of buf) h3=((h3^b)>>>0)+a; h3=(Math.imul(h3,m))>>>0; if(h3===tgt) hits.push(`xoradd ${m.toString(16)}/${i.toString(16)}/${a.toString(16)}`);
  }
  console.log(name, "hits", hits);
}
