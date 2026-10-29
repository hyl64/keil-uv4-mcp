// probe_portable.mjs — with a fake empty install root, call every tool once and
// report how it behaves. Correct arguments matter: this probe must measure the
// product, not its own typos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.mjs';

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-keil-'));
process.env.KEIL_MDK_ROOT = empty;
process.env.LOCALAPPDATA = empty;
delete process.env.KEIL_ROOT;

const { server, install, ctx } = createServer();
console.log('install found =', install.found, '| tools =', server.tools.size);
console.log('packRoots =', JSON.stringify(ctx.data.packRoots()));
console.log('uv4Dir    =', ctx.data.uv4Dir());
console.log('cdbXml    =', ctx.data.cdbXml());
console.log('fixtures  =', JSON.stringify(ctx.data.manifest()));

const F = path.resolve('data/fixtures/samples');
const S = path.resolve('reverse/samples');   // live tree (may hold artefacts fixtures skip)
const pick = (...p) => {
  const a = path.join(F, ...p);
  if (fs.existsSync(a)) return a;
  return path.join(S, ...p);
};

const cases = {
  // --- pure data / no toolchain needed: must all be OK ---
  project_read: { project: pick('Minimal', 'minimal.uvprojx') },
  project_files: { project: pick('Minimal', 'minimal.uvprojx') },
  project_validate: { project: pick('Minimal', 'minimal.uvprojx') },
  project_diff: { left: pick('Minimal', 'minimal.uvprojx'), right: pick('Gen2', 'app.uvprojx') },
  project_multiproject: { project: pick('Multi2', 'multi.uvmpw') },
  dep_read: { file: pick('Minimal', 'Objects', 'minimal_Flash.dep') },
  dep_graph: { project: pick('Minimal', 'minimal.uvprojx') },
  dep_impact: { project: pick('Minimal', 'minimal.uvprojx'), changed: [pick('Minimal', 'main.c')] },
  dep_scan: { file: pick('Minimal', 'main.c') },
  dep_write: { project: pick('Minimal', 'minimal.uvprojx'), write: false },
  test_build: { project: pick('Minimal', 'minimal.uvprojx'), file: 'main.c' },
  pack_list: {},
  pack_devices: { query: 'STM32F103' },
  pack_device_detail: { name: 'STM32F103C8' },
  pack_components: { query: 'CMSIS' },
  cdb_devices: { query: 'STM32F103C8' },
  cdb_vendors: {},
  elf_info: { file: pick('Minimal', 'Objects', 'main.axf') },
  map_info: { file: pick('Minimal', 'Objects', 'main.map') },
  hex_info: { file: pick('Minimal', 'Objects', 'main.hex') },
  memory_usage: { project: pick('Minimal', 'minimal.uvprojx') },
  symbols_file: { project: pick('Minimal', 'minimal.uvprojx') },
  editor_props: {},
  svcs_menus: {},
  module_catalog: {},
  uvision_com_reference: {},
  uvsock_service_table: {},
  license_architecture: {},
  debug_command_reference: {},
  options_read: { project: pick('Minimal', 'minimal.uvprojx') },
  batch_generate: { project: pick('Minimal', 'minimal.uvprojx'), write: false },
  import_xml_from_project: { project: pick('Minimal', 'minimal.uvprojx') },
  debug_peripheral_map: { device: 'STM32F103C8', peripheral: 'GPIOA' },
  debug_pack_generate: { device: 'STM32F103C8', output: path.join(os.tmpdir(), 'portable.rdi'), svd: path.resolve('data/fixtures/UV4/STM32F103C8.svd') },
  gui_layout_read: { file: pick('Blinky', 'Blinky.uvguix') },
  dbgconf_read: { file: path.resolve('reverse/samples/Blinky/RTE/Device/STM32F107VC/STM32F101_102_103_105_107.dbgconf') },
  cli_reference: {},
  cli_table: {},
  uv4_processes: {},
  uvsock_probe: { port: 1, timeoutMs: 200 },
  // --- toolchain dependent: must return a clean needsKeil diagnostic ---
  uv4_build: { project: pick('Minimal', 'minimal.uvprojx'), async: false, timeoutMs: 15000 },
  uv4_convert: { project: pick('Minimal', 'minimal.uvprojx'), timeoutMs: 15000 },
  uv4_export_cprj: { project: pick('Minimal', 'minimal.uvprojx'), timeoutMs: 15000 },
  uv4_symbols: { project: pick('Minimal', 'minimal.uvprojx'), timeoutMs: 15000 },
  tool_run: { tool: 'armcc', args: ['--vsn'] },
  toolchain_versions: {},
  license_status: {},
  companion_run: { tool: 'uv2csolution', args: ['-V'] },
  uv4_console: { args: ['-b', 'x.uvprojx'], timeoutMs: 5000 },
};

const rows = [];
for (const [name, args] of Object.entries(cases)) {
  const tool = server.tools.get(name);
  if (!tool) { rows.push({ name, state: 'NO-SUCH-TOOL' }); continue; }
  try {
    const r = await tool.handler(args);
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let d = null;
    try { d = JSON.parse(text); } catch {}
    let state;
    if (d && (d.needsKeil || /Keil|uv4\.exe not found|not found:.*UV4/i.test(String(d.error || '')))) state = 'needsKeil';
    else if (r.isError) state = 'toolError';
    else if (d && d.ok === false) state = 'ok:false';
    else state = 'OK';
    rows.push({ name, state, note: d ? String(d.error || d.reason || '').slice(0, 60) : '' });
  } catch (e) {
    rows.push({ name, state: 'THROW', note: String((e && e.message) || e).slice(0, 80) });
  }
}

const counts = rows.reduce((a, r) => (a[r.state] = (a[r.state] || 0) + 1, a), {});
console.log('\nsummary:', JSON.stringify(counts));
const bad = rows.filter(r => !['OK', 'needsKeil'].includes(r.state));
console.log('\n--- PROBLEMS (' + bad.length + '):');
for (const r of bad) console.log(`  ${r.state.padEnd(10)} ${r.name.padEnd(26)} ${r.note}`);
const okList = rows.filter(r => r.state === 'OK').map(r => r.name);
console.log('\n--- portable-OK (' + okList.length + '):', okList.join(', '));
const nk = rows.filter(r => r.state === 'needsKeil').map(r => r.name);
console.log('--- needsKeil (' + nk.length + '):', nk.join(', '));
process.exitCode = bad.length ? 1 : 0;
