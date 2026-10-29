import fs from "node:fs";
const w = "reverse/samples/Minimal/";
const base = fs.readFileSync(w + "Objects/main_new.d", "latin1").split("\r\n").filter(Boolean);
const v = fs.readFileSync(w + "Objects/main.__i", "latin1");
console.log("main.d lines", base.length);
console.log("via has same order:", base.every((l, i) => v.includes(l.split(": ").slice(1).join(": "))));
console.log(JSON.stringify(v));
