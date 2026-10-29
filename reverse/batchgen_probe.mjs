import { createServer } from "../src/server.mjs";
const { server } = createServer();
console.log("tools:", server.tools.size);
const r = JSON.parse((await server.tools.get("batch_generate").handler({ project: "reverse/samples/Minimal/minimal.uvprojx", target: "Flash", write: false })).content[0].text);
console.log(r.ok);
console.log("---- BAT"); console.log(r.content.bat);
console.log("---- LNP"); console.log(r.content.lnp);
console.log("---- VIA main"); console.log(r.content.vias.find(v => /main/.test(v.file)).text);
