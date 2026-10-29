import fs from "node:fs";
const p = new URL("./probe_portable.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
const before = t;
t = t.replace(
  "project_diff: { a: pick('Minimal', 'minimal.uvprojx'), b: pick('Gen2', 'app.uvprojx') },",
  "project_diff: { left: pick('Minimal', 'minimal.uvprojx'), right: pick('Gen2', 'app.uvprojx') },"
);
t = t.replace(
  "symbols_file: { file: pick('Minimal', 'Objects', 'main.axf') },",
  "symbols_file: { project: pick('Minimal', 'minimal.uvprojx') },"
);
if (t === before) {
  // fall back: show what the two lines currently look like
  const lines = before.split("\n").filter(l => /project_diff|symbols_file/.test(l));
  console.log("NO MATCH. current lines:\n" + lines.join("\n"));
} else {
  fs.writeFileSync(p, t);
  console.log("args fixed");
}
