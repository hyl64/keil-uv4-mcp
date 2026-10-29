import { createServer } from "../src/server.mjs";
import fs from "node:fs";
const { server } = createServer();
const call = async (n, a) => JSON.parse((await server.tools.get(n).handler(a)).content[0].text);
const dir = "reverse/samples/Gen2";
// drop the DFP system file and add a self-contained SystemInit
fs.rmSync(dir + "/system_stm32f10x.c", { force: true });
fs.writeFileSync(dir + "/sysinit.c", "/* минимальный SystemInit: HSE off, default HSI */\r\n#include <stdint.h>\r\nextern unsigned long SystemCoreClock;\r\nunsigned long SystemCoreClock = 8000000UL;\r\nvoid SystemInit(void) { SystemCoreClock = 8000000UL; }\r\n", "utf8");
const pr = await call("project_read", { project: dir + "/app.uvprojx", target: "Flash", includeFiles: false });
console.log("before", pr.ok, pr.targets[0].files);
await call("project_file_remove", { project: dir + "/app.uvprojx", filePath: "system_stm32f10x.c" });
const added = await call("project_file_add", { project: dir + "/app.uvprojx", group: "Application", filePath: "sysinit.c", fileType: 1 });
console.log("add", added.ok, added.saved);
const r = await call("uv4_rebuild", { project: dir + "/app.uvprojx", async: false, outputLog: "reverse/gen2_fixed.log" });
console.log("exit", r.exitCode, r.logTail);
