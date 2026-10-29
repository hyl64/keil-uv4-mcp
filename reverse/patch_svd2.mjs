import fs from "node:fs";
const f = new URL("../src/tools/gdbstub.mjs", import.meta.url);
let t = fs.readFileSync(f, "utf8");
if (!t.includes("const coreName")) {
  t = t.replace("  const dev = childElem(doc, 'device');",
    "  const dev = childElem(doc, 'device');\n  const cpuEl = childElem(dev, 'cpu');\n  const coreName = (cpuEl && (cpuEl.attr('name') || textOf(cpuEl)) || '').trim();");
  t = t.replace("return { name: dev.attr('name') || (childElem(dev, 'name') && textOf(childElem(dev, 'name'))), peripherals };",
    "return { name: dev.attr('name') || (childElem(dev, 'name') && textOf(childElem(dev, 'name'))), core: coreName || null, peripherals };");
  t = t.replace("const rdi = svdToRdi(svd, dev.core || 'Cortex-M3');", "const rdi = svdToRdi(svd, svd.core || dev.core || 'Cortex-M3');");
  t = t.replace("ok: true, device: dev.name, core: dev.core, svd: svdPath, saved,", "ok: true, device: dev.name, core: svd.core || dev.core, svd: svdPath, saved,");
  fs.writeFileSync(f, t);
}
console.log("svd core patch applied");
