import fs from "node:fs";
const p = new URL("../tests/run_tests.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
if (t.includes("uv4_console")) { console.log("already added"); process.exit(0); }
const marker = "// ------------------------------------------------------------------ source lint";
const block = [
  "// ---- round 3 gap closures ----",
  "const ucRef = await c.callTool('uvision_com_reference', {});",
  "check('uvision.com contract: 3 PID pipes + uVisionLauncher + uv4.exe child',",
  "  ucRef.data.ok && ucRef.data.pipes.length === 3 && ucRef.data.class === 'uVisionLauncher' && ucRef.data.child === 'uv4.exe' && ucRef.data.imports.KERNEL32 === 90,",
  "  ucRef.data && { pipes: ucRef.data.pipes, cls: ucRef.data.class });",
  "const ucRun = await c.callTool('uv4_console', { args: ['-b', path.join(samples, 'Minimal', 'minimal.uvprojx'), '-j0', '-sg'], timeoutMs: 180000 });",
  "check('uv4_console forwards argv and propagates ERRORLEVEL 0', ucRun.data.exitCode === 0 && ucRun.data.forwardedArgv.length === 4,",
  "  { exit: ucRun.data.exitCode, argv: ucRun.data.forwardedArgv });",
  "const ucBad = await c.callTool('uv4_console', { args: ['-b', 'C:/definitely_missing_project.uvprojx', '-j0'], timeoutMs: 90000 });",
  "check('uv4_console propagates failure code (15) for a missing project', ucBad.data.exitCode === 15, ucBad.data.exitCode);",
  "const uccEx = await c.callTool('module_catalog', { module: 'UvCC' });",
  "check('UvCC catalogued as 320 all-clang exports (libclang)',",
  "  uccEx.data.modules['UvCC.dll'].exports === 320 && uccEx.data.modules['UvCC.dll'].exportsAreAllClangCAPI === true && uccEx.data.modules['UvCC.dll'].nonClangExports === 0,",
  "  uccEx.data.modules['UvCC.dll'].exportFamilies);",
  "const uvs2 = await c.callTool('uvsock_service_table', {});",
  "check('0x2021 named PowerScale (no longer unresolved)',",
  "  uvs2.data.services.DBG_STRUCT_2021 === 0x2021 && /PowerScale/.test(uvs2.data.evidence || '') === false,",
  "  Object.keys(uvs2.data.services).length);",
  "",
  marker,
].join("\n");
t = t.replace(marker, block);
fs.writeFileSync(p, t);
console.log("round-3 tests added");
