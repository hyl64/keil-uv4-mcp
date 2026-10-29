import fs from "node:fs";
const f = new URL("../src/tools/deps.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");
// 1) include the RTE device include dir in the closure scan
s = s.replace("      const incDirs = String(t.c.includePath || '').split(';').filter(Boolean).map(d => path.resolve(pr.dir, d));\n      const entries = all.map(f => {",
  "      const incDirs = String(t.c.includePath || '').split(';').filter(Boolean).map(d => path.resolve(pr.dir, d));\n      const rteDirs = rteIncludeDirs(ctx, t);\n      const scanDirs = [...incDirs, ...rteDirs];\n      const entries = all.map(f => {");
s = s.replace("          const scan = scanIncludes(abs, incDirs);", "          const scan = scanIncludes(abs, scanDirs);");
// 2) a changed source file is itself a root that must be recompiled
s = s.replace("      const r = impacted(g, args.changed, all.map(f => path.resolve(pr.dir, f.filePath || '')));\n      return { ok: true, project: pr.file, target: t.name, changed: args.changed, seeds: r.seeds, affectedTotal: r.affected.length, recompile: r.needCompile, unknownChanged: r.unknownChanged, note: 'recompile lists translation units of the target; headers appear only in affectedTotal' };",
  "      const r = impacted(g, args.changed, all.map(f => path.resolve(pr.dir, f.filePath || '')));\n      // A changed translation unit is always recompiled, even when nothing includes it.\n      const roots = new Set(all.map(f => path.resolve(pr.dir, f.filePath || '').toLowerCase()));\n      const recompile = [...new Set([...r.needCompile, ...r.seeds.filter(p => roots.has(p.toLowerCase()))])];\n      return { ok: true, project: pr.file, target: t.name, changed: args.changed, seeds: r.seeds, affectedTotal: r.affected.length, recompile, unknownChanged: r.unknownChanged, scannedIncludes: r.affected.length, note: 'recompile lists the translation units of the target that must be rebuilt (changed sources and sources including changed headers)' };");
// 3) shared helper
s = s.replace("function objBase(outDir, fileName) {",
  "/** RTE device include directories of the target's PackID (RTEPATH\\\\Vendor.Pack\\\\version\\\\Device\\\\Include). */\nfunction rteIncludeDirs(ctx, t) {\n  const out = [];\n  const m = /^([^.]+)\\.(.+?)\\.(\\d+(?:\\.\\d+)*)$/.exec((t && t.packId) || '');\n  if (!m) return out;\n  for (const root of (ctx.install && ctx.install.packRoots) || []) {\n    const dir = path.join(root, m[1], m[2], m[3], 'Device', 'Include');\n    if (fs.existsSync(dir)) out.push(dir);\n  }\n  return out;\n}\n\nfunction objBase(outDir, fileName) {");
fs.writeFileSync(f, s);
console.log("patched deps tool");
