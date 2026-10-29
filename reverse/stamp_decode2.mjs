import fs from "node:fs";
// Decode the UV4 F-record value as DOS time (h<<11 | m<<5 | s/2) versus other layouts.
const raw = fs.readFileSync(new URL("../reverse/samples/Minimal/Objects/minimal_Flash.dep", import.meta.url), "latin1");
for (const m of raw.matchAll(/^F \(([^)]*)\)\((0x[0-9A-F]+)\)/gm)) {
  const v = parseInt(m[2], 16) >>> 0;
  const h = (v >> 11) & 0x1f, mi = (v >> 5) & 0x3f, s = (v & 0x1f) * 2;
  console.log(m[1], m[2], "dos-time", `${h}:${mi}:${s}`, "hhmmss-hex", ((v >> 16) & 0xff) + ":" + ((v >> 8) & 0xff) + ":" + (v & 0xff));
}
