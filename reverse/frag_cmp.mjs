import fs from "node:fs";
import { findDevices, deviceToTargetOptions } from "../src/packs.mjs";
const [d] = findDevices(["C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs"], "STM32F103C8");
const o = deviceToTargetOptions(d);
const migrated = fs.readFileSync(new URL("../reverse/samples/Legacy/legacy.uvprojx", import.meta.url), "utf8");
const pick = (tag) => { const m = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">").exec(migrated); return m ? m[1] : undefined; };
for (const [k, v] of [["FlashDriverDll", o.flashDriver], ["RegisterFile", o.registerFile], ["SFDFile", o.svd], ["Cpu", o.cpu]]) {
  const u = pick(k);
  console.log(k, "equal:", v === u);
  if (v !== u) { console.log("  gen:", JSON.stringify(v)); console.log("  uv4:", JSON.stringify(u)); }
}
