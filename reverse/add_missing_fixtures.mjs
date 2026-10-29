// add_missing_fixtures.mjs — copy the artefacts the goal explicitly lists
// (.map/.axf/.uvguix/.dbgconf and build intermediates) into data/fixtures/samples.
// These are small files that make the portable test suite meaningful.
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("reverse/samples");
const DST = path.resolve("data/fixtures/samples");

const RULES = [
  // parsers need these
  { re: /\.(map|axf|hex)$/i, maxBytes: 400 * 1024 },
  { re: /\.(uvguix|dbgconf)$/i, maxBytes: 200 * 1024 },
  // dependency/build inputs
  { re: /\.(sct|lnp|BAT|__i|_ia|dep)$/i, maxBytes: 400 * 1024 },
  // symbol + listing outputs used by symbols_file/map_info
  { re: /\.(h|txt)$/i, maxBytes: 200 * 1024, onlyIn: /Objects|Listings/i },
];

let copied = 0, skipped = 0;
for (const rule of RULES) {
  const walk = (src, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(src, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(p, r); continue; }
      if (!rule.re.test(e.name)) continue;
      if (rule.onlyIn && !rule.onlyIn.test(rel)) { skipped++; continue; }
      const size = fs.statSync(p).size;
      if (size > rule.maxBytes) { skipped++; continue; }
      const dst = path.join(DST, r);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(p, dst);
      copied++;
    }
  };
  walk(SRC, "");
}

// Blinky carries the only real .uvguix + the RTE .dbgconf set used by the wizard test
const extra = [
  "Blinky/Blinky.uvguix",
  "Blinky/RTE/Device/STM32F107VC/STM32F101_102_103_105_107.dbgconf",
  "Blinky/RTE/RTE_Device.h",
  "Blinky/RTE/RTX_Conf_CM.c",
];
for (const rel of extra) {
  const s = path.join(SRC, rel);
  if (!fs.existsSync(s)) continue;
  const d = path.join(DST, rel);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
  copied++;
}

const total = (function count() {
  let n = 0, bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { n++; bytes += fs.statSync(p).size; }
    }
  };
  walk(DST);
  return { n, mb: +(bytes / 1048576).toFixed(2) };
})();

console.log(JSON.stringify({ copied, skipped, sampleFiles: total.n, sampleMB: total.mb }, null, 1));
