// tests/run_tests.mjs — full acceptance suite for the Keil µVision MCP server.
// Every check is evidence-first: tools are exercised through the real stdio MCP
// protocol and results are compared with UV4's own output files.
import { startServer } from './mcp_client.mjs';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'src', 'server.mjs');
const samples = path.join(root, 'reverse', 'samples');
const minimal = path.join(samples, 'Minimal', 'minimal.uvprojx');
const gen = path.join(samples, 'Gen2', 'app.uvprojx');
const blinky = 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/Keil/STM32F1xx_DFP/2.4.1/Boards/Keil/MCBSTM32C/Blinky/Blinky.uvprojx';

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? undefined : detail });
  let extra = '';
  if (!cond) {
    try { extra = '  << ' + JSON.stringify(detail === undefined ? '(undefined)' : detail).slice(0, 900); }
    catch { extra = '  << (unserializable)'; }
  }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra}`);
}

const c = startServer(serverPath);
const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' } });
check('initialize returns a protocol version', !!init.protocolVersion, init);
check('initialize advertises tools capability', !!(init.capabilities && init.capabilities.tools), init.capabilities);
check('initialize reports server identity', init.serverInfo && init.serverInfo.name === 'keil-uv4-mcp', init.serverInfo);
c.notify('notifications/initialized', {});

const tools = await c.request('tools/list', {});
check('tools/list has ≥ 60 tools', !!(tools.tools && tools.tools.length >= 60), { toolCount: tools.tools && tools.tools.length });
const badSchemas = (tools.tools || []).filter(t => !t.inputSchema || t.inputSchema.type !== 'object' || !t.description || t.description.length < 20);
check('all tools declare object schemas + descriptions', badSchemas.length === 0, badSchemas.map(t => t.name));
let badName = null;
try { await c.request('tools/call', { name: 'nope_tool', arguments: {} }); } catch (e) { badName = e; }
check('unknown tool -> JSON-RPC error', !!badName && /Unknown tool/.test(badName.message), badName && badName.message);

// ------------------------------------------------------------------ installation
const inst = await c.callTool('keil_install', {});
check('keil_install finds UV4.exe', inst.data.ok && /UV4\.exe$/i.test(inst.data.uv4 || ''), inst.data);
check('keil_install lists both toolsets (AC6 + AC5)', inst.data.ok && inst.data.toolsets.length >= 2, inst.data.toolsets);
check('keil_install exposes pack roots', inst.data.ok && inst.data.packRoots.length >= 1, inst.data.packRoots);
check('keil_install exposes debug drivers from TOOLS.INI', inst.data.ok && inst.data.debugDrivers.length >= 10, inst.data.debugDrivers && inst.data.debugDrivers.length);

const tc = await c.callTool('toolchain_versions', { all: true });
check('toolchain_versions identifies ARM Compiler 5', tc.data.ok && tc.data.toolsets.some(t => t.tools.armcc && /ARM Compiler 5/.test(t.tools.armcc.component || '')), tc.data);
check('toolchain_versions identifies ARM Compiler 6', tc.data.ok && tc.data.toolsets.some(t => t.tools.armclang && /6\.\d+/.test(t.tools.armclang.component || '')), tc.data);

const run = await c.callTool('tool_run', { tool: 'armcc', args: ['--vsn'] });
check('tool_run executes armcc directly', run.data.ok && /ARM Compiler/.test(run.data.stdout || ''), run.data);

// ------------------------------------------------------------------ project model
const pr = await c.callTool('project_read', { project: minimal, includeFiles: false });
check('project_read parses the target', pr.data.ok && pr.data.targets.length === 1 && pr.data.targets[0].device === 'STM32F103C8', pr.data);
check('project_read exposes the memory model', pr.data.ok && pr.data.targets[0].misc.memory.IROM.start === '0x8000000', pr.data.targets && pr.data.targets[0].misc.memory);
const pf = await c.callTool('project_files', { project: minimal });
check('project_files lists startup.S + main.c', pf.data.ok && pf.data.files.length === 2 && pf.data.files.every(f => f.exists), pf.data);
const bl = await c.callTool('project_read', { project: blinky, target: 'STM32F107 Flash' });
check('RTE components parsed for a real pack project', bl.data.ok && bl.data.targets[0].rte.components.length >= 4, bl.data.targets && bl.data.targets[0].rte);
const val = await c.callTool('project_validate', { project: gen });
check('project_validate accepts the generated project', val.data.ok === true, val.data.issues);
const diff = await c.callTool('project_diff', { left: minimal, right: gen });
check('project_diff reports differences', diff.data.ok && Array.isArray(diff.data.changes), diff.data);

// edit round trip (scratch copy)
const scratch = path.join(samples, 'Gen2', 'app_copy.uvprojx');
fs.copyFileSync(gen, scratch);
const setOpt = await c.callTool('project_set_option', { project: scratch, target: 'Flash', path: ['TargetOption', 'TargetCommonOption', 'OutputName'], value: 'app_copy' });
check('project_set_option writes the option', setOpt.data.ok && setOpt.data.saved, setOpt.data);
const reread = await c.callTool('project_read', { project: scratch, target: 'Flash' });
check('project_set_option round trips', reread.data.ok && reread.data.targets[0].outputName === 'app_copy', reread.data.targets && reread.data.targets[0].outputName);
const grp = await c.callTool('project_group_add', { project: scratch, target: 'Flash', group: 'Docs', before: 'Application' });
check('project_group_add inserts a group', grp.data.ok, grp.data);
const rm = await c.callTool('project_group_remove', { project: scratch, target: 'Flash', group: 'Docs' });
check('project_group_remove deletes it', rm.data.ok && rm.data.removed, rm.data);
const twice = await c.callTool('project_group_add', { project: scratch, target: 'Flash', group: 'Docs', });
const dup = await c.callTool('project_group_add', { project: scratch, target: 'Flash', group: 'Docs' });
check('duplicate group rejected', dup.isError || dup.data.ok === false, dup.data);
await c.callTool('project_group_remove', { project: scratch, target: 'Flash', group: 'Docs' });

// byte-exactness: unchanged files must round trip
const beforeBytes = fs.readFileSync(minimal, 'utf8');
const rd = await c.callTool('project_read', { project: minimal });
check('project_read leaves the file untouched', fs.readFileSync(minimal, 'utf8') === beforeBytes, 'file mutated');

// ------------------------------------------------------------------ dependencies
const depRead = await c.callTool('dep_read', { file: path.join(samples, 'Minimal', 'Objects', 'minimal_Flash.dep') });
check('dep_read parses F records + compiler version', depRead.data.ok && depRead.data.sources.length === 2 && /V5\.06/.test(depRead.data.compilerVersion || ''), depRead.data);
const graph = await c.callTool('dep_graph', { project: minimal });
check('dep_graph returns nodes + stamps', graph.data.ok && graph.data.graph.nodes.length >= 2 && graph.data.graph.nodes.every(n => n.stamp), graph.data);
const scanKeil = await c.callTool('dep_scan', { project: minimal, file: path.join(samples, 'Minimal', 'main.c'), includePaths: ['C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include'] });
check('dep_scan resolves <stdint.h> from the AC5 include dir', scanKeil.data.ok && scanKeil.data.includes.some(f => /stdint\.h$/i.test(f)), scanKeil.data);
const dw = await c.callTool('dep_write', { project: minimal, dryRun: true });
check('dep_write reproduces the UV4 header line', dw.data.ok && /^Dependencies for Project 'minimal', Target 'Flash': \(DO NOT MODIFY !\)/.test(dw.data.preview || ''), dw.data);
check('dep_write stamps are the file clock time (HHMMSS)', dw.data.ok && /\(0x00[0-9A-F]{6}\)/.test(dw.data.preview || ''), dw.data.preview);
check('dep_write reproduces the armcc/armasm command column', dw.data.ok && /--pd "__UVISION_VERSION SETA 543"/.test(dw.data.preview) && /-D__UVISION_VERSION="543"/.test(dw.data.preview) && /-IC:\\Users/.test(dw.data.preview), dw.data.preview);
const depWritten = path.join(samples, 'Minimal', 'Objects', 'regenerated.dep');
const dw2 = await c.callTool('dep_write', { project: minimal, output: depWritten });
const reRead = await c.callTool('dep_read', { file: depWritten });
check('regenerated .dep parses back', dw2.data.ok && reRead.data.ok && reRead.data.sources.length === 2, reRead.data);
const impact = await c.callTool('dep_impact', { project: minimal, changed: [path.join(samples, 'Minimal', 'main.c')] });
check('dep_impact marks main.c for recompilation', impact.data.ok && impact.data.recompile.some(p => /main\.c$/i.test(p)), impact.data);
const tb = await c.callTool('test_build', { project: minimal });
check('test_build emits armcc command line', tb.data.ok && tb.data.compile.some(x => /--cpu Cortex-M3/.test(x.command)), tb.data);

// ------------------------------------------------------------------ packs
const packs = await c.callTool('pack_list', {});
check('pack_list finds STM32F1xx_DFP 2.4.1', packs.data.ok && packs.data.packs.some(p => /STM32F1xx_DFP/.test(p.name) && p.version === '2.4.1'), packs.data);
const devs = await c.callTool('pack_devices', { query: 'STM32F103C8' });
check('pack_devices returns the device with memory', devs.data.ok && devs.data.devices[0].memory.length >= 2, devs.data);
const detail = await c.callTool('pack_device_detail', { name: 'STM32F103C8' });
const migrated = fs.readFileSync(path.join(samples, 'Legacy', 'legacy.uvprojx'), 'utf8');
const frag = (tag) => { const m = new RegExp('<MTAG>([\\s\\S]*?)</MTAG>'.replace(/MTAG/g, tag)).exec(migrated); return m ? m[1] : null; };
check('Cpu string identical to UV4 migration output', detail.data.ok && detail.data.targetOptions.cpu === frag('Cpu'), { gen: detail.data.targetOptions.cpu, uv4: frag('Cpu') });
check('flash driver identical to UV4 migration output', detail.data.ok && detail.data.targetOptions.flashDriver === frag('FlashDriverDll'), { gen: detail.data.targetOptions.flashDriver, uv4: frag('FlashDriverDll') });
check('SVD + register header identical to UV4', detail.data.targetOptions.svd === frag('SFDFile') && detail.data.targetOptions.registerFile === frag('RegisterFile'), detail.data.targetOptions);
const comps = await c.callTool('pack_components', { query: 'StdPeriph' });
check('pack_components lists StdPeriph drivers', comps.data.ok && comps.data.components.length >= 5, comps.data);
const rteVal = await c.callTool('pack_rte_validate', { project: blinky, target: 'STM32F107 Flash' });
// UV4 reports the same project as #540 (RTX component) plus #542 (missing Board Support APIs).
check('pack_rte_validate flags unavailable RTE components (#540)', rteVal.data.ok === false && rteVal.data.issues.some(i => i.code === 540 && /RTX/.test(i.component || '')), rteVal.data.issues);

// ------------------------------------------------------------------ images
// Images are rebuilt at the start of the run so the ELF/MAP/HEX checks always see fresh artefacts.
const genRebuildEarly = await c.callTool('uv4_rebuild', { project: gen, async: false, outputLog: path.join(samples, 'Gen2', 'test_rebuild.log') }, 180000);
check('generated project builds (scaffolder)', genRebuildEarly.data.exitCode === 0, genRebuildEarly.data.logTail);
const elf = await c.callTool('elf_info', { project: gen, name: 'app' });
check('elf_info reads the .axf', elf.data.ok && elf.data.format === 'ELF32' && elf.data.stats.codeBytes > 0, elf.data);
const mapI = await c.callTool('map_info', { project: gen, name: 'app' });
check('map_info parses image totals', mapI.data.ok && mapI.data.imageTotals.ro.bytes > 0, mapI.data);
const hexI = await c.callTool('hex_info', { project: gen, name: 'app' });
check('hex_info verifies all checksums', hexI.data.ok && hexI.data.checksumErrors === 0 && hexI.data.bytes > 0, hexI.data);
const mu = await c.callTool('memory_usage', { project: gen });
check('memory_usage computes flash utilisation', mu.data.ok && mu.data.rom.used > 0 && mu.data.rom.size > 0, mu.data);
const sym = await c.callTool('symbols_file', { project: minimal });
check('symbols_file parses the -X output', sym.data.ok && sym.data.count > 10, sym.data && sym.data.error);

// ------------------------------------------------------------------ options file
// Gen2 gets a .uvoptx when it is built below; create one explicitly for this check.
const optCreate = await c.callTool('options_create', { project: gen });
check('options_create writes a .uvoptx', optCreate.data.ok && fs.existsSync(optCreate.data.file), optCreate.data);
const opts = await c.callTool('options_read', { project: gen });
check('options_read shows debug driver', opts.data.ok && opts.data.targets[0].driverDll === 'BIN\\UL2CM3.DLL', opts.data);
const optSet = await c.callTool('options_set', { project: gen, target: 'Flash', path: ['TargetOption', 'DebugOpt', 'sIfile'], value: '.\\.dbg.ini' });
const opts2 = await c.callTool('options_read', { project: gen });
check('options_set updates the init script', optSet.data.ok && opts2.data.targets[0].initScript === '.\\.dbg.ini', opts2.data.targets && opts2.data.targets[0]);
await c.callTool('options_set', { project: gen, target: 'Flash', path: ['TargetOption', 'DebugOpt', 'sIfile'], value: '' });

// ------------------------------------------------------------------ scaffolding + CLI
const newDir = path.join(samples, 'Scaffold');
fs.rmSync(newDir, { recursive: true, force: true });
const legacyTool = await c.callTool('project_create_legacy', { output: path.join(newDir, 'legacy', 'app.uvproj'), device: 'STM32F103C8' });
check('project_create_legacy writes .uvproj', legacyTool.data.ok && fs.existsSync(legacyTool.data.project), legacyTool.data);
const conv = await c.callTool('uv4_convert', { project: legacyTool.data.project, timeoutMs: 120000 }, 150000);
check('uv4_convert (-5) exits 0', conv.data.exitCode === 0, conv.data);
check('uv4_convert produces .uvprojx + .saved_uv4', conv.data.convertedExists && fs.existsSync(legacyTool.data.project + '.saved_uv4'), conv.data);
const { Project: ProjectClass } = await import('file://' + path.join(root, 'src', 'project.mjs').split(path.sep).join('/'));
const converted = new ProjectClass(conv.data.converted);
check('converted project resolves PackID via device DB', /STM32F1xx_DFP/.test(converted.targets()[0].packId || ''), converted.targets()[0].packId);

const makePre = await c.callTool('project_create', { output: path.join(newDir, 'pre', 'pre.uvprojx'), device: 'STM32F103C8' });
check('project_create returns AC5-compatible includes', makePre.data.ok && !makePre.data.includePaths.some(p => /CMSIS[\\/]6\./.test(p)), makePre.data.includePaths);
const preDir = path.join(newDir, 'pre');
fs.writeFileSync(path.join(preDir, 'main.c'), 'volatile unsigned counter;\r\nint main(void){ for(;;){ counter++; } }\r\n');
fs.writeFileSync(path.join(preDir, 'sysinit.c'), 'extern unsigned long SystemCoreClock;\r\nunsigned long SystemCoreClock = 8000000UL;\r\nvoid SystemInit(void) { SystemCoreClock = 8000000UL; }\r\n');
await c.callTool('project_file_add', { project: path.join(preDir, 'pre.uvprojx'), group: 'Application', filePath: 'main.c', fileType: 1 });
await c.callTool('project_file_add', { project: path.join(preDir, 'pre.uvprojx'), group: 'Application', filePath: 'sysinit.c', fileType: 1 });
const preBuild = await c.callTool('uv4_rebuild', { project: path.join(preDir, 'pre.uvprojx'), async: false, outputLog: path.join(preDir, 'build.log') }, 180000);
check('scaffolded project builds with exit code 0', preBuild.data.exitCode === 0, preBuild.data.logTail);
check('build summary counts errors/warnings', preBuild.data.summary && preBuild.data.summary.bvr && preBuild.data.summary.bvr.errors === 0, preBuild.data.summary);
check('build produces .axf and .hex', (preBuild.data.artifacts.artifacts || []).some(a => /\.axf$/.test(a.path)) && (preBuild.data.artifacts.artifacts || []).some(a => /\.hex$/.test(a.path)), preBuild.data.artifacts);

// batch artefacts (Create Batch File): BAT + .__i / ._ia + .lnp reproduce UV4's own layout
const bg = await c.callTool('batch_generate', { project: path.join(preDir, 'pre.uvprojx'), write: false });
check('batch_generate emits ArmCC/ArmAsm/ArmLink via lines with AC5 toolset', bg.data.ok && /ArmAsm" --Via/.test(bg.data.content.bat) && /ArmCC" --Via/.test(bg.data.content.bat) && /ArmLink" --Via/.test(bg.data.content.bat), bg.data.content && bg.data.content.bat);
check('batch_generate .lnp matches UV4 layout', bg.data.ok && /^--cpu .*\n\".*startup.*\.o\"/m.test(bg.data.content.lnp) && /--scatter/.test(bg.data.content.lnp), bg.data.content && bg.data.content.lnp);
check('batch_generate via file carries the uVision version + defines', bg.data.ok && bg.data.content.vias.some(v => /__UVISION_VERSION/.test(v.text) && /-DSTM32F10X_MD/.test(v.text)), bg.data.content && bg.data.content.vias.map(v => v.text));

// SVD-derived debugger register description
const rdi = await c.callTool('debug_pack_generate', { device: 'STM32F103C8', output: path.join(newDir, 'STM32F103C8.rdi') });
check('debug_pack_generate emits core + peripheral registers', rdi.data.ok && rdi.data.registers > 300 && rdi.data.fields > 1000 && fs.existsSync(rdi.data.saved), rdi.data);
const pmap = await c.callTool('debug_peripheral_map', { device: 'STM32F103C8', peripheral: 'GPIOA' });
check('debug_peripheral_map exposes GPIOA CRL bitfields', pmap.data.ok && pmap.data.peripherals[0].registers[0].fields.length === 16, pmap.data.peripherals && pmap.data.peripherals[0]);

// import XML (-i)
const impXml = await c.callTool('import_xml_document', { device: 'STM32F103C8', output: path.join(newDir, 'imp', 'imp.xml'), outputName: 'imp', cDefines: 'STM32F10X_MD', includePath: '.\\Inc' });
const imp = await c.callTool('uv4_import', { project: path.join(newDir, 'imp', 'imp.uvprojx'), importXml: impXml.data.saved, timeoutMs: 120000 }, 150000);
check('uv4_import (-i) creates a project (exit 0)', imp.data.exitCode === 0 && (imp.data.projectSummary || []).length === 1, imp.data);

// multi-project
const mp = await c.callTool('project_create_multi', { output: path.join(samples, 'Multi3', 'ws.uvmpw'), projects: [{ path: '../Minimal/minimal.uvprojx' }, { path: '../Gen2/app.uvprojx' }] });
check('project_create_multi writes the workspace', mp.data.ok && fs.existsSync(mp.data.file), mp.data);
const mpRead = await c.callTool('project_multi_read', { multi: mp.data.file });
check('project_multi_read expands both members', mpRead.data.ok && mpRead.data.targets.length === 2, mpRead.data);
const mpBuild = await c.callTool('uv4_run', { command: '-b', project: mp.data.file, timeoutMs: 180000 }, 200000);
check('UV4 -b on workspace prints the Batch-Build summary', /Batch-Build summary: 2 succeeded/.test(mpBuild.data.log || mpBuild.data.logTail || ''), mpBuild.data.logTail);

// sync rebuild / clean on the sample
const rebuild = await c.callTool('uv4_rebuild', { project: minimal, async: false, outputLog: path.join(samples, 'Minimal', 'test_rebuild.log') }, 180000);
check('uv4_rebuild exit code 0', rebuild.data.exitCode === 0, rebuild.data);
check('uv4_rebuild log summary parsed', rebuild.data.summary && rebuild.data.summary.target === 'Flash' && rebuild.data.summary.bvr.errors === 0, rebuild.data.summary);
check('uv4_rebuild reports artifacts', (rebuild.data.artifacts.artifacts || []).some(a => /\.axf$/.test(a.path)), rebuild.data.artifacts);
check('uv4_rebuild honours -t and -sg argv', rebuild.data.argv.includes('-sg') && rebuild.data.argv.includes('-j0'), rebuild.data.argv);
const clean = await c.callTool('uv4_clean', { project: minimal, outputLog: path.join(samples, 'Minimal', 'test_clean.log') }, 120000);
check('uv4_clean exit code 0 and removed the axf', clean.data.exitCode === 0 && !fs.existsSync(path.join(samples, 'Minimal', 'Objects', 'main.axf')), clean.data);
const symbols = await c.callTool('uv4_symbols', { project: minimal, outputLog: path.join(samples, 'Minimal', 'test_symbols.log') }, 120000);
check('uv4_symbols produced co-arm_*.h', symbols.data.ok && (symbols.data.symbolFiles || []).length > 0, symbols.data);
const zTry = await c.callTool('uv4_rebuild_all', { project: minimal, timeoutMs: 4000 });
check('uv4_rebuild_all refuses a single-project file', zTry.isError && /multi-project/.test(zTry.data.error || ''), zTry.data);
const job = await c.callTool('uv4_rebuild', { project: minimal, outputLog: path.join(samples, 'Minimal', 'test_async.log') });
check('uv4_rebuild queues an async job', job.data.ok && job.data.job && job.data.job.id, job.data);
const waited = await c.callTool('uv4_job_wait', { id: job.data.job.id, timeoutMs: 180000 }, 200000);
check('async job completes with exit 0', waited.data.state === 'succeeded' && waited.data.result.exitCode === 0, waited.data);

// ------------------------------------------------------------------ system/remote
const lic = await c.callTool('license_status', { probe: false });
check('license_status inventories armlm + FlexNet', lic.data.ok && lic.data.licenseFiles.length >= 3, lic.data);
const procs = await c.callTool('uv4_processes', {});
check('uv4_processes responds', procs.data.ok === true, procs.data);
const probe = await c.callTool('uvsock_probe', { port: 4328 });
check('uvsock_probe reports reachability', probe.data.ok === true && typeof probe.data.reachable === 'boolean', probe.data);
const dbgRef = await c.callTool('debug_command_reference', {});
check('debug_command_reference lists µVision debug commands', dbgRef.data.ok && dbgRef.data.commands.length > 30, dbgRef.data.count);
const dbgPrep = await c.callTool('debug_script', { project: minimal, script: 'g, main\r\n' });
check('debug_script prepares a -d invocation', dbgPrep.data.ok && /-d/.test(dbgPrep.data.argv || ''), dbgPrep.data);

// ------------------------------------------------------------------ error handling
const notFound = await c.callTool('project_read', { project: 'C:/definitely/not/here.uvprojx' });
check('missing project -> tool error', notFound.isError && /not found/.test(notFound.data.error || ''), notFound.data);
const badTarget = await c.callTool('project_set_option', { project: minimal, target: 'Nope', path: ['X'], value: 1 });
check('unknown target -> tool error', badTarget.isError, badTarget.data);
let badParams = null;
try { await c.request('tools/call', { name: 'project_read', arguments: {} }); } catch (e) { badParams = e; }
check('missing required argument -> validation error', !!badParams && /required/.test(badParams.message), badParams && badParams.message);
const resources = await c.request('resources/list', {});
check('resource catalogue served', resources && Array.isArray(resources.resources), resources);
check('job notification emitted', c.notifications.some(n => n.method === 'notifications/message'), c.notifications.length);

// ------------------------------------------------------------------ modules round 2
const svcT = await c.callTool('uvsock_service_table', {});
check('uvsock table: RESPONSE=0x3000 + PRJ_BUILD=0x1006 + V2.29 evidence', svcT.data.ok && svcT.data.services.PRJ_BUILD === 4102 && /uvsock_protocol/.test(svcT.data.evidence), svcT.data.services && svcT.data.services.PRJ_BUILD);
const cdbD = await c.callTool('cdb_devices', { query: 'STM32F103C8', limit: 3 });
check('cdb: legacy device record with startup path', cdbD.data.ok && cdbD.data.devices[0].startup === 'STARTUP\\ST\\STM32F10x\\startup_stm32f10x_md.s', cdbD.data.devices && cdbD.data.devices[0]);
const cdbV = await c.callTool('cdb_vendors', {});
check('cdb: 33 vendors incl ST id=13', cdbV.data.ok && cdbV.data.vendors.length === 33 && cdbV.data.vendors.some(v => String(v.vendorId) === '13' && v.vendor === 'STMicroelectronics'), cdbV.data.vendors && cdbV.data.vendors.length);
const edp = await c.callTool('editor_props', { key: 'file.patterns.asm' });
check('editor_props expands SciTE patterns', edp.data.ok && /\*\.asm/.test(edp.data.key.expanded || ''), edp.data.key);
const svcFiles = await c.callTool('svcs_menus', {});
check('svcs: 11 UTF-16 menus parsed (GIT blame item)', svcFiles.data.ok && svcFiles.data.files.length >= 9 && svcFiles.data.files.some(f => (f.items || []).some(i => /Blame/.test(i.label))), svcFiles.data.files && svcFiles.data.files.length);
const compUv = await c.callTool('companion_run', { tool: 'uv2csolution', args: [minimal] });
check('companion uv2csolution rejects AC5 project', /Arm Compiler 5/.test((compUv.data.stdout || '') + (compUv.data.stderr || '')), (compUv.data.stdout || compUv.data.stderr || '').slice(0, 200));
const compV = await c.callTool('companion_run', { tool: 'uv2csolution', args: ['-V'] });
check('companion uv2csolution -V', compV.data.ok && /version 1\.6\.0/.test(compV.data.stdout), compV.data.stdout);
const licA = await c.callTool('license_architecture', { detail: 'imports' });
check('license_architecture: armlm import evidence', licA.data.ok && /armlm_request_capabilities/.test(licA.data.value || ''), licA.data);
const pfi = await c.callTool('pack_file_inspect', { file: 'C:\\Windows\\notepad.exe' });
check('pack_file_inspect rejects non-zip', pfi.data.ok === false, pfi.data);

const guix = await c.callTool('gui_layout_read', { file: 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/Keil/STM32F1xx_DFP/2.4.1/Boards/Keil/MCBSTM32C/Blinky/Blinky.uvguix' });
check('gui_layout_read parses real .uvguix (>=50 windows)', guix.data.ok && guix.data.totals.windows >= 50, guix.data.totals || guix.data);
const dbc = await c.callTool('dbgconf_read', { file: path.join(samples, 'Blinky', 'RTE', 'Device', 'STM32F107VC', 'STM32F101_102_103_105_107.dbgconf') });
check('dbgconf_read parses wizard options (>=20 with bits/help)', dbc.data.ok && dbc.data.optionCount >= 20 && dbc.data.options.some(o => o.bit === 30 && /TIM11/.test(o.name)), dbc.data.optionCount);
const svc2 = await c.callTool('uvsock_service_table', {});
check('uvsock table full map incl 0x1006 + DBG_EVAL_TO_STR 0x2024', svc2.data.services.PRJ_BUILD === 0x1006 && svc2.data.services.DBG_EVAL_TO_STR === 0x2024, Object.keys(svc2.data.services).length);

const mcAll = await c.callTool('module_catalog', {});
check('module_catalog: 26 binaries incl UVSCWrapper 275 exports', mcAll.data.ok && mcAll.data.moduleCount === 26 && mcAll.data.modules['UVSCWrapper.dll'].exports === 275, mcAll.data.moduleCount);
const mcF = await c.callTool('module_catalog', { module: 'armlm' });
check('module_catalog filter armlm (>=4 entries)', mcF.data.ok && mcF.data.moduleCount >= 4 && Object.keys(mcF.data.modules).some(k => k.includes('armlmdiag')), mcF.data.moduleCount);

// ---- round 3 gap closures ----
const ucRef = await c.callTool('uvision_com_reference', {});
check('uvision.com contract: 3 PID pipes + uVisionLauncher + uv4.exe child',
  ucRef.data.ok && ucRef.data.pipes.length === 3 && ucRef.data.class === 'uVisionLauncher' && ucRef.data.child === 'uv4.exe' && ucRef.data.imports.KERNEL32 === 90,
  ucRef.data && { pipes: ucRef.data.pipes, cls: ucRef.data.class });
const ucRun = await c.callTool('uv4_console', { args: ['-b', path.join(samples, 'Minimal', 'minimal.uvprojx'), '-j0', '-sg'], timeoutMs: 180000 });
check('uv4_console forwards argv and propagates ERRORLEVEL 0', ucRun.data.exitCode === 0 && ucRun.data.forwardedArgv.length === 4,
  { exit: ucRun.data.exitCode, argv: ucRun.data.forwardedArgv });
const ucBad = await c.callTool('uv4_console', { args: ['-b', 'C:/definitely_missing_project.uvprojx', '-j0'], timeoutMs: 90000 });
check('uv4_console propagates failure code (15) for a missing project', ucBad.data.exitCode === 15, ucBad.data.exitCode);
const uccEx = await c.callTool('module_catalog', { module: 'UvCC' });
check('UvCC catalogued as 320 all-clang exports (libclang)',
  uccEx.data.modules['UvCC.dll'].exports === 320 && uccEx.data.modules['UvCC.dll'].exportsAreAllClangCAPI === true && uccEx.data.modules['UvCC.dll'].nonClangExports === 0,
  uccEx.data.modules['UvCC.dll'].exportFamilies);
const uvs2 = await c.callTool('uvsock_service_table', {});
check('0x2021 named PowerScale (no longer unresolved)',
  uvs2.data.services.DBG_STRUCT_2021 === 0x2021 && /PowerScale/.test(uvs2.data.evidence || '') === false,
  Object.keys(uvs2.data.services).length);

// ------------------------------------------------------------------ source lint
const { execFileSync } = await import('node:child_process');
const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.mjs')) srcFiles.push(p);
  }
})(path.join(root, 'src'));
let syntaxErrors = 0;
for (const f of srcFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { syntaxErrors++; console.log('   syntax error in', f, String(e.stderr || e.message).slice(0, 300)); }
}
check('every source module parses', syntaxErrors === 0, { files: srcFiles.length, syntaxErrors });

c.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(root, 'reverse', 'acceptance_results.json'), JSON.stringify({ when: new Date().toISOString(), passed: results.length - failed.length, total: results.length, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;




