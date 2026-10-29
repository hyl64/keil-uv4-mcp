import fs from "node:fs";
const f = new URL("../src/tools/deps.mjs", import.meta.url);
let t = fs.readFileSync(f, "utf8");
t = t.replace("        // AF: the (0x%08X) field carries the time-of-day (FileTimeToDosDateTime packed HHMMSS).\n        const stamp = st ? uv4DosTime(st.mtimeMs) : 0;",
  "        // AF: the (0x%08X) field carries the file's clock time as decimal HHMMSS.\n        const stamp = st ? uv4TimeStamp(st.mtimeMs) : 0;");
t = t.replace("          lines.push(`I (${depEntry})(${(hs ? stampHex(uv4DosTime(hs.mtimeMs)) : '0x00000000')})`);",
  "          lines.push(`I (${depEntry})(${(hs ? uv4TimeStampHex(hs.mtimeMs) : '0x00000000')})`);");
fs.writeFileSync(f, t);
const g = new URL("../src/deps.mjs", import.meta.url);
let d = fs.readFileSync(g, "utf8");
if (!d.includes("export function uv4Stamp(")) {
  d = d.replace("/** Value as UV4 prints it: 0x + 8 hex digits of the decimal HHMMSS. */",
    "/** Unix seconds view of the same instant (staleness comparisons in the graph). */\nexport function uv4Stamp(mtimeMs) {\n  return Math.floor(mtimeMs / 1000) >>> 0;\n}\n\n/** Value as UV4 prints it: 0x + 8 hex digits of the decimal HHMMSS. */");
  fs.writeFileSync(g, d);
}
console.log("patched");
