import fs from "node:fs";
const f = new URL("../src/tools/gdbstub.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");
// The device name is derivable from the .pdsc record; pass it explicitly.
s = s.replace("const rdi = svdToRdi(svd, svd.core || dev.core || 'Cortex-M3');",
  "const coreName = svd.core || dev.core || (/STM32F10[0-5]/.test(dev.name) ? 'Cortex-M3' : 'Cortex-M3');\n      const rdi = svdToRdi(svd, coreName);");
s = s.replace("ok: true, device: dev.name, core: svd.core || dev.core, svd: svdPath, saved,",
  "ok: true, device: dev.name, core: coreName, svd: svdPath, saved,");
fs.writeFileSync(f, s);
console.log("core fallback patched");
