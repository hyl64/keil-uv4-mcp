import fs from "node:fs";
const p = new URL("../tests/run_tests.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
if (t.includes("module_catalog")) { console.log("already added"); process.exit(0); }
const marker = "// ------------------------------------------------------------------ source lint";
t = t.replace(marker, `const mcAll = await c.callTool('module_catalog', {});
check('module_catalog: 26 binaries incl UVSCWrapper 275 exports', mcAll.data.ok && mcAll.data.moduleCount === 26 && mcAll.data.modules['UVSCWrapper.dll'].exports === 275, mcAll.data.moduleCount);
const mcF = await c.callTool('module_catalog', { module: 'armlm' });
check('module_catalog filter armlm (>=4 entries)', mcF.data.ok && mcF.data.moduleCount >= 4 && Object.keys(mcF.data.modules).some(k => k.includes('armlmdiag')), mcF.data.moduleCount);

` + marker);
fs.writeFileSync(p, t);
console.log("catalog tests added");
