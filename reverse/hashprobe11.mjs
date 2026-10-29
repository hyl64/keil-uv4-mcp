import fs from "node:fs";
const startup=fs.readFileSync("reverse/samples/Minimal/startup.s");
const main=fs.readFileSync("reverse/samples/Minimal/main.c");
const hx=h=>(h>>>0).toString(16).toUpperCase().padStart(8,"0");
function fnv1a(buf){let h=0x811c9dc5>>>0;for(const b of buf){h^=b;h=Math.imul(h,0x01000193)>>>0;}return h;}
console.log("startup fnv1a", hx(fnv1a(startup)), "target 6AE205A5 delta", ((0x6AE205A5>>>0)-fnv1a(startup))>>>0);
console.log("main fnv1a", hx(fnv1a(main)), "target 6AE203ED delta", ((0x6AE203ED>>>0)-fnv1a(main))>>>0);
console.log("startup FN", hx(fnv1a(startup)) >>> 0, "T", hx(0x6AE205A5));
