// patch_portable.mjs — route every data access through src/portable.mjs so the
// server works with no Keil installation.
import fs from "node:fs";

const edits = [];
function patch(file, pairs) {
  const abs = new URL(`../src/${file}`, import.meta.url);
  let t = fs.readFileSync(abs, "utf8");
  let changed = 0;
  for (const [from, to] of pairs) {
    if (t.includes(to)) continue;
    if (!t.includes(from)) { edits.push({ file, miss: from.slice(0, 70) }); continue; }
    t = t.split(from).join(to);
    changed++;
  }
  fs.writeFileSync(abs, t);
  edits.push({ file, changed });
}

// ---------- server.mjs: give ctx a portable data facade ----------
patch("server.mjs", [
  [
    "import { DEFAULT_CONFIG, discoverInstall, resolveToolset } from './config.mjs';",
    "import { DEFAULT_CONFIG, discoverInstall, resolveToolset } from './config.mjs';\nimport { packRoots as portablePackRoots, uv4DataDir, cdbDumpPath, fixtureManifest, toolchainAvailable, needsKeil } from './portable.mjs';",
  ],
  [
    "  const ctx = { server, cfg, install, jobs, config: () => cfg };",
    `  // Portable data facade: tools ask ctx.data.* instead of ctx.install.*. With a real
  // installation these resolve to the live files; without one they fall back to the
  // bundled fixture snapshot, so the server stays fully functional.
  const data = {
    packRoots: () => portablePackRoots(install),
    uv4Dir: () => uv4DataDir(install),
    cdbXml: (override) => cdbDumpPath(install, override),
    manifest: () => fixtureManifest(),
    toolchainAvailable: () => toolchainAvailable(install),
    needsKeil: (feature) => needsKeil(feature, install),
  };
  const ctx = { server, cfg, install, data, jobs, config: () => cfg };`,
  ],
  [
    "      `Install detected: ${install.found ? install.root : 'NOT FOUND (set KEIL_MDK_ROOT)'}`,",
    "      install.found\n        ? `Keil install: ${install.root} (full toolchain available)`\n        : 'Portable mode: no Keil installation found — project/dep/pack/device/image/UVSOCK tools work from the bundled fixture snapshot; build/convert/tool_run/license need KEIL_MDK_ROOT.',",
  ],
  [
    "  process.stderr.write(`keil-uv4-mcp: ${server.tools.size} tools, install=${install.found ? install.root : 'not found'}\\n`);",
    "  process.stderr.write(`keil-uv4-mcp: ${server.tools.size} tools, ${install.found ? 'install=' + install.root : 'PORTABLE (no Keil install; fixtures active)'}\\n`);",
  ],
]);

// ---------- packs.mjs tools: pack roots from the facade ----------
patch("tools/packs.mjs", [
  [
    "  if (!ctx.install || !ctx.install.packRoots || !ctx.install.packRoots.length) throw new Error('no pack roots (TOOLS.INI RTEPATH)');\n  return ctx.install.packRoots;",
    "  const roots = ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];\n  if (!roots.length) throw new Error('no pack roots: no installed packs and no bundled fixtures');\n  return roots;",
  ],
]);

// ---------- every findDevices(ctx.install.packRoots ...) -> ctx pack roots ----------
for (const f of ["tools/project.mjs", "tools/gdbstub.mjs", "tools/scaffold_extra.mjs", "tools/importxml.mjs"]) {
  patch(f, [
    ["findDevices(ctx.install.packRoots,", "findDevices(packRootsOf(ctx),"],
    ["listPackCatalog(ctx.install.packRoots)", "listPackCatalog(packRootsOf(ctx))"],
    ["searched: ctx.install.packRoots", "searched: packRootsOf(ctx)"],
    ["for (const root of ctx.install.packRoots) {", "for (const root of packRootsOf(ctx)) {"],
  ]);
  // add the local helper after the last import line
  const abs = new URL(`../src/${f}`, import.meta.url);
  let t = fs.readFileSync(abs, "utf8");
  if (!t.includes("function packRootsOf(ctx)")) {
    const helper = "function packRootsOf(ctx) {\n  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];\n}\n\n";
    const idx = t.lastIndexOf("\nimport ");
    const nl = t.indexOf("\n", idx + 1);
    t = t.slice(0, nl + 1) + helper + t.slice(nl + 1);
    fs.writeFileSync(abs, t);
    edits.push({ file: f, helper: true });
  }
}

// ---------- deps.mjs rte dirs ----------
patch("tools/deps.mjs", [
  ["for (const root of (ctx.install && ctx.install.packRoots) || []) {", "for (const root of packRootsOf(ctx)) {"],
]);
{
  const abs = new URL("../src/tools/deps.mjs", import.meta.url);
  let t = fs.readFileSync(abs, "utf8");
  if (!t.includes("function packRootsOf(ctx)")) {
    const helper = "function packRootsOf(ctx) {\n  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];\n}\n\n";
    const nl = t.indexOf("\n", t.lastIndexOf("\nimport "));
    t = t.slice(0, nl + 1) + helper + t.slice(nl + 1);
    fs.writeFileSync(abs, t);
    edits.push({ file: "tools/deps.mjs", helper: true });
  }
}

// ---------- batchgen.mjs ----------
patch("tools/batchgen.mjs", [
  ["for (const root of (ctx.install && ctx.install.packRoots) || []) {", "for (const root of packRootsOf(ctx)) {"],
  [
    "      const toolset = ctx.install.toolsets.find(x => /ARMCLANG/i.test(x.dir) === wantAc6) || ctx.install.toolsets[0];",
    "      const toolsets = (ctx.install && ctx.install.toolsets) || [];\n      const toolset = toolsets.find(x => /ARMCLANG/i.test(x.dir) === wantAc6) || toolsets[0] || null;",
  ],
]);
{
  const abs = new URL("../src/tools/batchgen.mjs", import.meta.url);
  let t = fs.readFileSync(abs, "utf8");
  if (!t.includes("function packRootsOf(ctx)")) {
    const helper = "function packRootsOf(ctx) {\n  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];\n}\n\n";
    const nl = t.indexOf("\n", t.lastIndexOf("\nimport "));
    t = t.slice(0, nl + 1) + helper + t.slice(nl + 1);
    fs.writeFileSync(abs, t);
    edits.push({ file: "tools/batchgen.mjs", helper: true });
  }
}

// ---------- modules.mjs: uv4Dir / cdb / console exe ----------
patch("tools/modules.mjs", [
  [
    "  const uv4Dir = ctx.install.uv4Dir || null;",
    "  // Data directory: live UV4 folder when installed, else the bundled fixture snapshot.\n  const uv4Dir = ctx.data ? ctx.data.uv4Dir() : (ctx.install && ctx.install.uv4Dir) || null;",
  ],
  [
    "  const cdbDump = (p) => {\n    if (p) return path.resolve(p);\n    const bundled = path.join(process.env.KEIL_MCP_REVERSE_DIR || path.join(serverPkgRoot, 'reverse'), 'cdb', 'uv4_cdb.xml');\n    return bundled;\n  };",
    "  const cdbDump = (p) => {\n    if (p) return path.resolve(p);\n    if (ctx.data) return ctx.data.cdbXml();\n    return path.join(process.env.KEIL_MCP_REVERSE_DIR || path.join(serverPkgRoot, 'reverse'), 'cdb', 'uv4_cdb.xml');\n  };",
  ],
  [
    "        uv4Exe: ctx.install.uv4Exe, args: args.args || [],",
    "        uv4Exe: (ctx.install && ctx.install.uv4Exe) || '', args: args.args || [],",
  ],
]);

console.log(JSON.stringify(edits, null, 1));
