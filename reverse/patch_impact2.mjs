import fs from "node:fs";
const f = new URL("../src/tools/deps.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");
const before = s;
// Resolve caller-supplied paths against the MCP server process cwd first (and keep the
// absolute-form check), so relative inputs are not mistaken for "unknown" changed files.
s = s.replace("      const g = buildGraph(pr.dir, entries, {});\n      const r = impacted(g, args.changed, all.map(f => path.resolve(pr.dir, f.filePath || '')));",
  "      const changedAbs = (args.changed || []).map(p => (path.isAbsolute(p) ? path.normalize(p) : path.resolve(process.cwd(), p)));\n      const g = buildGraph(pr.dir, entries, {});\n      const r = impacted(g, changedAbs, all.map(f => path.resolve(pr.dir, f.filePath || '')));");
if (s === before) console.log("impact path patch NOT applied"); else { fs.writeFileSync(f, s); console.log("impact path patch applied"); }
