import { createServer } from "../src/server.mjs";
import fs from "node:fs";
const { server } = createServer();
const call = async (n, a) => JSON.parse((await server.tools.get(n).handler(a)).content[0].text);
const w = await call("dep_write", { project: "reverse/samples/Minimal/minimal.uvprojx", output: "reverse/regenerated.dep" });
const mine = fs.readFileSync("reverse/regenerated.dep", "latin1");
const keil = fs.readFileSync("reverse/samples/Minimal/Objects/minimal_Flash.dep", "latin1");
// normalise: UV4 emits multi-line commands folded with bare CR; compare record by record
const f = (s) => [...s.matchAll(/^F \(([^)]*)\)\((0x[0-9A-F]+)\)\(([\s\S]*?)\)(?=\r\n[FI] \(|\r\n*$)/gm)].map(m => [m[1], m[2], m[3].replace(/\s+/g, " ").trim()]);
const i = (s) => [...s.matchAll(/^I \(([^)]*)\)\((0x[0-9A-F]+)\)/gm)].map(m => [m[1], m[2]]);
const fm = f(mine), fk = f(keil);
console.log("F count", fm.length, fk.length);
for (let k = 0; k < Math.max(fm.length, fk.length); k++) {
  console.log(k, "path", fm[k] && fm[k][0] === fk[k][0], "stamp", fm[k] && fm[k][1] === fk[k][1], "cmd", fm[k] && fm[k][2] === fk[k][2]);
  if (fm[k] && fk[k] && fm[k][2] !== fk[k][2]) { console.log("  mine:", fm[k][2]); console.log("  uv4 :", fk[k][2]); }
}
console.log("I equal", JSON.stringify(i(mine)) === JSON.stringify(i(keil)));
console.log("bytes", w.bytes);
