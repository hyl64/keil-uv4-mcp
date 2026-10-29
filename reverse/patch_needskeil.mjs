// patch_needskeil.mjs — make every toolchain-dependent tool return a structured
// needsKeil diagnostic in portable mode instead of throwing.
import fs from "node:fs";

const log = [];
function read(f) { return fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"); }
function write(f, t) { fs.writeFileSync(new URL(`../src/${f}`, import.meta.url), t); }

// ---- 1) uv4.mjs: requireInstall -> diagnostic object, guard at each handler ----
{
  const f = "tools/uv4.mjs";
  let t = read(f);
  if (!t.includes("needsKeilDiagnostic")) {
    t = t.replace(
      `function requireInstall(ctx) {
  if (!ctx.install || !ctx.install.found) throw new Error('Keil installation not found (set KEIL_MDK_ROOT)');
  return ctx.install;
}`,
      `/** Portable mode: return a structured diagnostic instead of throwing. */
function needsKeilDiagnostic(ctx, feature) {
  if (ctx.data && typeof ctx.data.needsKeil === 'function') return ctx.data.needsKeil(feature);
  return {
    ok: false, needsKeil: true, feature, portableMode: true,
    reason: 'This operation drives the real Keil toolchain, which is not installed.',
    remedy: ['Install Keil MDK, or set KEIL_MDK_ROOT to the folder containing TOOLS.INI and UV4\\\\UV4.exe.'],
  };
}

function requireInstall(ctx) {
  if (!ctx.install || !ctx.install.found) return null;
  return ctx.install;
}`
    );
    log.push({ f, step: "requireInstall" });
  }
  write(f, t);
}

// ---- 2) every handler in uv4.mjs that used requireInstall: short-circuit ----
{
  const f = "tools/uv4.mjs";
  let t = read(f);
  // replace the call sites: const install = requireInstall(ctx);  ->  guard
  const before = (t.match(/requireInstall\(ctx\)/g) || []).length;
  t = t.replace(/const install = requireInstall\(ctx\);/g,
`const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, TOOL_NAME);`);
  // TOOL_NAME is unknown at that scope; use the enclosing register name instead.
  t = t.replace(/return needsKeilDiagnostic\(ctx, TOOL_NAME\);/g,
    "return needsKeilDiagnostic(ctx, 'uv4 command line');");
  write(f, t);
  log.push({ f, step: "guards", callSites: before });
}

// ---- 3) tool_run + toolchain_versions + license_status + companion_run ----
const guards = [
  ["tools/system.mjs", "toolchain_versions"],
  ["tools/system.mjs", "license_status"],
];
for (const [f] of guards) {
  let t = read(f);
  if (!t.includes("function needsKeilDiagnostic")) {
    const helper = `function needsKeilDiagnostic(ctx, feature) {
  if (ctx.data && typeof ctx.data.needsKeil === 'function') return ctx.data.needsKeil(feature);
  return { ok: false, needsKeil: true, feature, portableMode: true, reason: 'Keil toolchain not installed.' };
}

`;
    const nl = t.indexOf("\n", t.lastIndexOf("\nimport "));
    t = t.slice(0, nl + 1) + helper + t.slice(nl + 1);
    write(f, t);
    log.push({ f, helper: true });
  }
}
console.log(JSON.stringify(log, null, 1));
