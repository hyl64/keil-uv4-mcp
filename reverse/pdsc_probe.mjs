import fs from "node:fs";
import { parseXml, childElem, childElems } from "../src/xml.mjs";
const p="C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/ARM/CMSIS/6.2.0/ARM.CMSIS.pdsc";
const doc=parseXml(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const pkg=childElem(doc,"package");
const comps=childElem(pkg,"components");
const kids=childElems(comps,"component").slice(0,5).map(c=>c.attr("Cclass")+"|"+c.attr("Cgroup")+"|"+c.attr("Csub")+"|kids="+childElems(c,"component").length);
console.log("direct component children:", childElems(comps,"component").length, kids);
console.log("package children:", pkg.children.filter(c=>c.type==="elem").map(c=>c.name).join(","));
console.log("components children kinds:", comps.children.filter(c=>c.type==="elem").length);

