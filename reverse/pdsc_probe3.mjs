import fs from "node:fs";
const p="C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/ARM/CMSIS/6.2.0/ARM.CMSIS.pdsc";
const raw=fs.readFileSync(p,"utf8");
const start=raw.indexOf("<components>");
console.log("raw component count:", (raw.match(/<component /g)||[]).length);
console.log(raw.slice(start, start+1200));
