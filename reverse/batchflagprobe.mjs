import { createServer } from "../src/server.mjs";
const { server } = createServer();
const call = async (n, a) => JSON.parse((await server.tools.get(n).handler(a)).content[0].text);
const flags = await call("project_batch_flags", { projects: ["reverse/samples/Minimal/minimal.uvprojx", "reverse/samples/Gen2/app.uvprojx"], set: true, enabled: true });
console.log(JSON.stringify(flags));
const mp = await call("project_multi_read", { multi: "reverse/samples/Multi2/multi.uvmpw" });
console.log(JSON.stringify(mp.targets.map(t => [t.project, t.target, t.batchBuild])));
