import fs from "node:fs";
const p = new URL("../src/tools/system.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
let n = 0;
// upgrade the two plain diagnostics to the structured shape
t = t.replace(/if \(!inst\.found\) return \{ ok: false, error: 'Keil installation not found' \};/g,
  (m) => { n++; return "if (!inst.found) return needsKeilDiagnostic(ctx, 'toolchain');"; });
// tool_run guard: find its handler start and insert a check
if (!t.includes("needsKeilDiagnostic(ctx, 'tool_run')")) {
  t = t.replace(/(name: 'tool_run',[\s\S]*?handler: async \(args\) => \{)/, (m) => {
    n++;
    return m + "\n      if (!ctx.install || !ctx.install.found) return needsKeilDiagnostic(ctx, 'tool_run');";
  });
}
fs.writeFileSync(p, t);
console.log(JSON.stringify({ upgraded: n, hasHelper: t.includes("function needsKeilDiagnostic") }));
