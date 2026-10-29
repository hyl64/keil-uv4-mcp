import { createServer } from "../src/server.mjs";
const { server } = createServer();
const call = async (name, args) => JSON.parse((await server.tools.get(name).handler(args)).content[0].text);
const out = "reverse/samples/Multi2/multi.uvmpw";
const r = await call("project_create_multi", { output: out, projects: [{ path: "../Minimal/minimal.uvprojx" }, { path: "../Gen2/app.uvprojx" }] });
console.log(JSON.stringify(r));
if (r.ok) { const rr = await call("project_multi_read", { multi: out }); console.log(JSON.stringify(rr.targets)); }

