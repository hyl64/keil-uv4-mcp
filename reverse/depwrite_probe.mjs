import { createServer } from "../src/server.mjs";
const { server } = createServer();
const call = async (n, a) => JSON.parse((await server.tools.get(n).handler(a)).content[0].text);
const dw = await call("dep_write", { project: "reverse/samples/Minimal/minimal.uvprojx", dryRun: true });
console.log(dw.preview);
const b = await call("uv4_rebuild", { project: "reverse/samples/Minimal/minimal.uvprojx", async: false, outputLog: "reverse/u4dep.log" });
console.log("build exit", b.exitCode, b.summary && b.summary.bvr);
const after = await call("dep_write", { project: "reverse/samples/Minimal/minimal.uvprojx", dryRun: true });
console.log("---- uvision dep again ----"); console.log(after.preview);
