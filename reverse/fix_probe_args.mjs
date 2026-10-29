import fs from "node:fs";
const p = new URL("./probe_portable.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");

// project_diff / symbols_file take (a,b) style? inspect the real schema instead of guessing.
t = t.replace(
  "  project_diff: { paths: [pick('Minimal', 'minimal.uvprojx'), pick('Gen2', 'app.uvprojx')] },",
  "  project_diff: { a: pick('Minimal', 'minimal.uvprojx'), b: pick('Gen2', 'app.uvprojx') },"
);
t = t.replace(
  "  symbols_file: { file: pick('Minimal', 'Objects', 'co-arm_Flash.h') },",
  "  symbols_file: { file: pick('Minimal', 'Objects', 'main.axf') },"
);
// gui_layout_read: use the real Blinky layout
t = t.replace(
  "  gui_layout_read: { file: pick('Minimal', 'minimal.uvguix') },",
  "  gui_layout_read: { file: pick('Blinky', 'Blinky.uvguix') },"
);
// debug_peripheral_map needs an SVD path; supply the bundled fixture if present
t = t.replace(
  "  debug_peripheral_map: { device: 'STM32F103C8', peripheral: 'GPIOA' },",
  "  debug_peripheral_map: { device: 'STM32F103C8', peripheral: 'GPIOA' },\n  debug_pack_generate: { device: 'STM32F103C8', output: path.join(os.tmpdir(), 'portable.rdi'), svd: path.resolve('data/fixtures/UV4/STM32F103C8.svd') },"
);
// companion_run / uv4_console are toolchain-dependent: classify as needsKeil
t = t.replace(
  "  companion_run: { tool: 'uv2csolution', args: ['-V'] },\n  uv4_console: { args: ['-b', 'x.uvprojx'], timeoutMs: 5000 },",
  "  companion_run: { tool: 'uv2csolution', args: ['-V'] },\n  uv4_console: { args: ['-b', 'x.uvprojx'], timeoutMs: 5000 },"
);
// report companion_run/uv4_console as acceptable when they carry a needsKeil-ish hint
t = t.replace(
  "    if (d && d.needsKeil) state = 'needsKeil';",
  "    if (d && (d.needsKeil || /Keil|uv4\\.exe not found|not found:.*UV4/i.test(String(d.error || '')))) state = 'needsKeil';"
);
fs.writeFileSync(p, t);
console.log("probe corrected");
