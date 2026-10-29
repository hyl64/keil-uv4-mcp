import fs from "node:fs";
const f = new URL("../src/tools/deps.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");
const bad = "fs.writeFileSync(tmp, scan.includes.slice(1).map(i => `${abs.replace(/\\\\/g, '\\\\')}: ${i}\\r\\n`).join(''), 'latin1');";
const good = "fs.writeFileSync(tmp, scan.includes.slice(1).map(i => `${abs}: ${i}` + '\\r\\n').join(''), 'latin1');";
if (!s.includes(bad)) {
  console.log("pattern not found; current line:");
  console.log(s.split("\n").find(l => l.includes("scan.includes.slice(1)")));
} else {
  s = s.replace(bad, good);
  fs.writeFileSync(f, s);
  console.log("patched");
}
