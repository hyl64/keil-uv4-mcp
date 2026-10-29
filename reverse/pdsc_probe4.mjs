import fs from "node:fs";
import { parseXml, childElem, childElems, findAll } from "../src/xml.mjs";
for (const p of ["C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/Keil/STM32F1xx_DFP/2.4.1/Keil.STM32F1xx_DFP.pdsc","C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/ARM/CMSIS/6.2.0/ARM.CMSIS.pdsc"]) {
  const raw=fs.readFileSync(p,"utf8").replace(/^\uFEFF/,"");
  const doc=parseXml(raw);
  const pkg=childElem(doc,"package");
  const comps=childElem(pkg,"components");
  console.log(p.split("/").pop(), "raw <component:", (raw.match(/<component /g)||[]).length, "parsed:", findAll(doc,n=>n.name==="component").length, "componentsEl:", !!comps, comps && childElems(comps,"component").length);
  const c=comps && childElems(comps,"component")[0];
  if (c) console.log("  first attrs", JSON.stringify(c.attrs), "children", c.children.filter(x=>x.type==="elem").map(x=>x.name+"("+x.children.length+")").join(","));
}
