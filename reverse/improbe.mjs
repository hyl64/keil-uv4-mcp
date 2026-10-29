import { createServer } from "../src/server.mjs";
const { server } = createServer();
const call = async (n, a) => JSON.parse((await server.tools.get(n).handler(a)).content[0].text);
console.log("tools:", server.tools.size);
const xml = await call("import_xml_document", { device: "STM32F103C8", output: "reverse/samples/Import/imp.xml", outputName: "imp", outputPath: ".\\Objects\\", cDefines: "STM32F10X_MD", includePath: ".\\Inc", useSimulator: false });
console.log(xml.ok, xml.saved);
const r = await call("uv4_import", { project: "reverse/samples/Import/imp.uvprojx", importXml: "reverse/samples/Import/imp.xml", target: "Flash", timeoutMs: 120000 });
console.log(JSON.stringify({ exit: r.exitCode, err: r.error, log: (r.logTail||"").slice(0,400), summary: r.projectSummary }));
