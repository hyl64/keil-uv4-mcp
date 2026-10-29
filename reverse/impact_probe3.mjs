import { impacted, buildGraph } from "../src/deps.mjs";
const g = {
  projectDir: "C:\\p",
  nodes: [
    { path: "C:\\p\\main.c", deps: ["C:\\p\\h.h"], usedBy: [] },
    { path: "C:\\p\\h.h", deps: [], usedBy: ["C:\\p\\main.c"] },
  ],
};
const r = impacted(g, ["C:\\p\\h.h"], ["C:\\p\\main.c"]);
console.log("A", JSON.stringify(r));
const r2 = impacted(g, ["h.h"], ["main.c"]);
console.log("B", JSON.stringify(r2));
const r3 = impacted(g, ["C:\\p\\MAIN.C"], ["c:\\p\\main.c"]);
console.log("C", JSON.stringify(r3));
