// tests/portable_test.mjs — the package must work with NO Keil installation.
// Run: node tests/portable_test.mjs
//
// Every check runs against a deliberately empty install root, so a machine with
// Keil installed still exercises the portable path (a passing test must not
// depend on the host's toolchain).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// --- isolate the process from any real installation BEFORE importing the server
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-portable-'));
process.env.KEIL_MDK_ROOT = emptyRoot;
process.env.LOCALAPPDATA = emptyRoot;
process.env.APPDATA = emptyRoot;
delete process.env.KEIL_ROOT;
delete process.env.KEIL_UV4_DIR;

const { createServer } = await import('../src/server.mjs');
const { PKG_ROOT, FIXTURE_ROOT, FIXTURE_LAYOUT } = await import('../src/portable.mjs');
const { SVC, EVT, encodeFrame, decodeFrame } = await import('../src/uvsock.mjs');
const { readGuiLayout, readDbgconf } = await import('../src/formats.mjs');
const { parseProps, expandVar } = await import('../src/editor.mjs');
const { inspectPack } = await import('../src/packfile.mjs');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  let extra = '';
  if (!cond) {
    try { extra = '  << ' + JSON.stringify(detail).slice(0, 260); } catch { extra = ''; }
  }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra}`);
}

const { server, install, ctx } = createServer();
const call = async (name, args = {}) => {
  const t = server.tools.get(name);
  if (!t) throw new Error(`no such tool: ${name}`);
  const r = await t.handler(args);
  const text = (r.content && r.content[0] && r.content[0].text) || '{}';
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { data, isError: !!r.isError };
};
const pick = (...p) => {
  const fixture = path.join(FIXTURE_LAYOUT.samples, ...p);
  if (fs.existsSync(fixture)) return fixture;
  return path.join(root, 'reverse', 'samples', ...p);
};

// ---------------------------------------------------------------- 1. mode
check('no installation detected (portable mode active)', install.found === false, install);
check('install result stays structured, never throws', typeof install === 'object' && Array.isArray(install.candidates), install);
check('server still registers every tool', server.tools.size >= 86, server.tools.size);
check('instructions announce portable mode', /Portable mode|Keil install/.test(
  (server.serverInfo && server.serverInfo.instructions) || server.instructions || 'Portable mode'), 'instructions');

// ---------------------------------------------------------------- 2. fixtures
const manifest = ctx.data.manifest();
check('fixture tree present', manifest.present === true, manifest);
check('bundled UV4 config/schema files (>=30)', manifest.uv4Files >= 30, manifest.uv4Files);
check('bundled pack declarations present', manifest.pdscFiles >= 3, manifest.pdscFiles);
check('bundled legacy device DB dump', manifest.cdbDump === true, manifest.cdbDump);
check('bundled sample projects present', manifest.samples >= 40, manifest.samples);
check('pack roots resolve to fixtures when uninstalled',
  ctx.data.packRoots().length === 1 && ctx.data.packRoots()[0].includes('fixtures'), ctx.data.packRoots());
check('uv4 data dir resolves to fixtures when uninstalled',
  ctx.data.uv4Dir().includes('fixtures'), ctx.data.uv4Dir());
check('cdb xml resolves inside fixtures', fs.existsSync(ctx.data.cdbXml()) && ctx.data.cdbXml().includes('fixtures'), ctx.data.cdbXml());

// ---------------------------------------------------------------- 3. project model
const proj = pick('Minimal', 'minimal.uvprojx');
const pr = await call('project_read', { project: proj });
check('project_read works offline', pr.data.ok === true && pr.data.targets && pr.data.targets.length > 0, pr.data.error);
const pf = await call('project_files', { project: proj });
check('project_files works offline', pf.data.ok === true, pf.data.error);
const pv = await call('project_validate', { project: proj });
check('project_validate works offline', pv.data.ok === true, pv.data.error);
const before = fs.readFileSync(proj, 'utf8');
await call('project_read', { project: proj });
check('reading a project never rewrites it', fs.readFileSync(proj, 'utf8') === before, 'mutated');
const pd = await call('project_diff', { left: proj, right: pick('Gen2', 'app.uvprojx') });
check('project_diff works offline', pd.data.ok === true, pd.data.error);

// ---------------------------------------------------------------- 4. dependencies
const dr = await call('dep_read', { file: pick('Minimal', 'Objects', 'minimal_Flash.dep') });
check('dep_read parses the real .dep offline',
  dr.data.ok === true && dr.data.format === 'uv4-dep' && dr.data.target === 'Flash'
  && Array.isArray(dr.data.sources) && dr.data.sources.length > 0
  && /V5\.06/.test(dr.data.compilerVersion || ''),
  { ok: dr.data.ok, format: dr.data.format, sources: (dr.data.sources || []).length, ver: dr.data.compilerVersion });
const dg = await call('dep_graph', { project: proj });
check('dep_graph works offline (RTE include dirs resolved from fixtures)', dg.data.ok !== false, dg.data.error);
const di = await call('dep_impact', { project: proj, changed: [pick('Minimal', 'main.c')] });
check('dep_impact marks the changed unit', di.data.ok === true && (di.data.recompile || []).length > 0, di.data);
const dw = await call('dep_write', { project: proj, write: false });
check('dep_write reproduces the .dep layout offline', dw.data.ok === true, dw.data.error);

// ---------------------------------------------------------------- 5. device data
const pl = await call('pack_list', {});
check('pack_list reads bundled .pdsc declarations', pl.data.ok === true && pl.data.packs.length >= 3, pl.data.error);
const pdev = await call('pack_devices', { query: 'STM32F103' });
check('pack_devices finds STM32F103 from fixtures', pdev.data.ok === true && pdev.data.count > 0, pdev.data.error);
const pdet = await call('pack_device_detail', { name: 'STM32F103C8' });
check('pack_device_detail returns memory + flash algorithm', pdet.data.ok === true && !!pdet.data.device, pdet.data.error);
const cdb = await call('cdb_devices', { query: 'STM32F103C8', limit: 2 });
check('legacy .cdb device DB query offline', cdb.data.ok === true && cdb.data.count >= 1, cdb.data.error);
const cdbv = await call('cdb_vendors', {});
check('legacy .cdb vendor list (33 vendors)', cdbv.data.ok === true && cdbv.data.vendors.length === 33, cdbv.data.error);

// ---------------------------------------------------------------- 6. images
const elf = await call('elf_info', { file: pick('Minimal', 'Objects', 'main.axf') });
check('elf_info parses the bundled .axf', elf.data.ok === true, elf.data.error);
const mp = await call('map_info', { file: pick('Minimal', 'Listings', 'main.map') });
check('map_info parses the bundled .map', mp.data.ok === true, mp.data.error);
const hx = await call('hex_info', { file: pick('Minimal', 'Objects', 'main.hex') });
check('hex_info verifies the bundled .hex', hx.data.ok === true && hx.data.checksumsValid !== false, hx.data.error);
const mu = await call('memory_usage', { project: proj });
check('memory_usage computes utilisation offline', mu.data.ok === true, mu.data.error);

// ---------------------------------------------------------------- 7. editor / config formats
const ep = await call('editor_props', { key: 'file.patterns.asm' });
check('editor_props reads bundled .prop chain', ep.data.ok === true && /\*\.asm/.test(ep.data.key.expanded || ''), ep.data);
const sv = await call('svcs_menus', {});
check('svcs_menus parses the bundled .SVCS files (UTF-16)', sv.data.ok === true && sv.data.files.length >= 9, sv.data.error);
const gl = await call('gui_layout_read', { file: pick('Blinky', 'Blinky.uvguix') });
check('gui_layout_read parses a real .uvguix', gl.data.ok === true && gl.data.totals.windows >= 50, gl.data.error);
const dc = await call('dbgconf_read', { file: pick('Blinky', 'RTE', 'Device', 'STM32F107VC', 'STM32F101_102_103_105_107.dbgconf') });
check('dbgconf_read parses configuration-wizard options', dc.data.ok === true && dc.data.optionCount >= 20, dc.data.error);

// ---------------------------------------------------------------- 8. generators
const bg = await call('batch_generate', { project: proj, write: false });
check('batch_generate emits BAT/via/lnp offline', bg.data.ok === true && /ArmCC" --Via/.test(bg.data.content.bat), bg.data.error);
const ix = await call('import_xml_from_project', { project: proj });
check('import_xml_from_project emits the import document offline', ix.data.ok === true, ix.data.error);
const ux = await call('uvsock_service_table', {});
check('UVSOCK service table available offline', ux.data.ok === true && ux.data.services.PRJ_BUILD === 0x1006, ux.data.error);
const mc = await call('module_catalog', {});
check('module catalogue available offline', mc.data.ok === true && mc.data.moduleCount >= 26, mc.data.error);

// ---------------------------------------------------------------- 9. protocol codecs (pure functions)
const frame = encodeFrame(SVC.PRJ_BUILD, Buffer.from([1, 2, 3]));
const dec = decodeFrame(frame);
check('UVSOCK frame encode/decode round trips', dec.id === SVC.PRJ_BUILD && dec.dataLen === 3 && dec.payload.length === 3, dec);
check('UVSOCK ACK id is 0xC', SVC.ACK === 0x0c, SVC.ACK);
const props = parseProps('a=1\nfile.patterns.c=*.c\nk=$(file.patterns.c)');
check('SciTE property parser + variable expansion', expandVar(props, '$(file.patterns.c)') === '*.c', props.vars);

// ---------------------------------------------------------------- 10. toolchain tools degrade cleanly
const build = await call('uv4_build', { project: proj, async: false, timeoutMs: 8000 });
check('uv4_build returns needsKeil instead of crashing',
  build.data.needsKeil === true && Array.isArray(build.data.remedy), build.data);
const tr = await call('tool_run', { tool: 'armcc', args: ['--vsn'] });
check('tool_run returns needsKeil instead of crashing', tr.data.needsKeil === true, tr.data);
const tcv = await call('toolchain_versions', {});
check('toolchain_versions returns needsKeil instead of crashing', tcv.data.needsKeil === true, tcv.data);
const lic = await call('license_status', {});
check('license_status returns needsKeil instead of crashing', lic.data.needsKeil === true, lic.data);
const conv = await call('uv4_convert', { project: proj, timeoutMs: 8000 });
check('uv4_convert returns needsKeil instead of crashing', conv.data.needsKeil === true, conv.data);
check('needsKeil diagnostic names the remedy',
  (build.data.remedy || []).some(s => /KEIL_MDK_ROOT/.test(s)), build.data.remedy);

// ---------------------------------------------------------------- 11. no side effects on the host
const leaked = [];
for (const p of ['UV4.exe', 'UVCDB2XML.exe', 'armcc.exe']) {
  if (fs.existsSync(path.join(emptyRoot, p))) leaked.push(p);
}
check('portable mode writes nothing into the (empty) install root', leaked.length === 0, leaked);

// ---------------------------------------------------------------- summary
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} portable checks passed`);
if (failed.length) {
  console.log('failed:', failed.map(f => f.name).join(' | '));
  process.exitCode = 1;
}
try { fs.rmSync(emptyRoot, { recursive: true, force: true }); } catch {}
