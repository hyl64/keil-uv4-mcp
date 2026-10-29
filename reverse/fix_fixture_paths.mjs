// fix_fixture_paths.mjs — place artefacts where the probes/tests expect them.
// Real µVision puts .map in Listings/ and the debug config under RTE/Device or
// DebugConfig; the portable fixture tree mirrors both locations so either works.
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("reverse/samples");
const DST = path.resolve("data/fixtures/samples");

function copyOne(relFrom, relTo) {
  const s = path.join(SRC, relFrom);
  const d = path.join(DST, relTo);
  if (!fs.existsSync(s)) return { from: relFrom, ok: false, why: "source missing" };
  fs.mkdirSync(path.dirname(d), { recursive: true });
  try {
    fs.copyFileSync(s, d);
    return { from: relFrom, to: relTo, ok: true, bytes: fs.statSync(d).size };
  } catch (e) {
    return { from: relFrom, ok: false, why: String(e.message || e).slice(0, 60) };
  }
}

const jobs = [
  // .map really lives in Listings/ — mirror it to both places
  ["Minimal/Listings/main.map", "Minimal/Listings/main.map"],
  ["Minimal/Listings/main.map", "Minimal/Objects/main.map"],
  ["Gen2/Listings/app.map", "Gen2/Listings/app.map"],
  ["Gen2/Listings/app.map", "Gen2/Objects/app.map"],
  ["Gen/Listings/gen.map", "Gen/Listings/gen.map"],
  ["Gen/Listings/gen.map", "Gen/Objects/gen.map"],
  ["Scaffold/pre/Listings/pre.map", "Scaffold/pre/Listings/pre.map"],
  ["Scaffold/pre/Listings/pre.map", "Scaffold/pre/Objects/pre.map"],
  // debug config: the wizard test reads the RTE copy
  ["Minimal/RTE/Device/STM32F103C8/STM32F101_102_103_105_107.dbgconf", "Minimal/RTE/Device/STM32F103C8/STM32F101_102_103_105_107.dbgconf"],
  ["Gen2/RTE/Device/STM32F103C8/STM32F101_102_103_105_107.dbgconf", "Gen2/RTE/Device/STM32F103C8/STM32F101_102_103_105_107.dbgconf"],
  ["Blinky/RTE/Device/STM32F107VC/STM32F101_102_103_105_107.dbgconf", "Blinky/RTE/Device/STM32F107VC/STM32F101_102_103_105_107.dbgconf"],
  // debugconfig variants (UV4 writes these per target)
  ["Minimal/DebugConfig/Flash_STM32F103C8_1.0.0.dbgconf", "Minimal/DebugConfig/Flash_STM32F103C8_1.0.0.dbgconf"],
  ["Blinky/DebugConfig/STM32F107_Flash_STM32F107VC_1.0.0.dbgconf", "Blinky/DebugConfig/STM32F107_Flash_STM32F107VC_1.0.0.dbgconf"],
  // linker/batch intermediates the goal lists explicitly
  ["Minimal/Objects/main.sct", "Minimal/Objects/main.sct"],
  ["Minimal/Objects/main.lnp", "Minimal/Objects/main.lnp"],
  ["Minimal/Objects/main.__i", "Minimal/Objects/main.__i"],
  ["Minimal/Flash.BAT", "Minimal/Flash.BAT"],
  ["Minimal/Objects/dv.d", "Minimal/Objects/dv.d"],
];

const results = jobs.map(([a, b]) => copyOne(a, b));
const ok = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ copied: ok, failed: failed.length, failures: failed }, null, 1));
