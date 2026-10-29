import fs from "node:fs";
const main=fs.readFileSync("reverse/samples/Minimal/main.c");
console.log("main.c x 0x4B2D =", (BigInt(0x6AE203ED)/BigInt(0x4B2D)).toString(), "rem", (BigInt(0x6AE203ED)%BigInt(0x4B2D)).toString());
console.log("0x6AE203ED - 0x4B2D =", (0x6AE203ED-0x4B2D).toString(16), (0x6AE203ED-0x4B2D)>>>0);
console.log("0x6AE203ED >>> 16 =", (0x6AE203ED>>>16).toString(16), "low", (0x6AE203ED&0xffff).toString(16));
console.log("sum bytes main", [...main].reduce((a,b)=>a+b,0), "avg");
