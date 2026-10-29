// tests/pack_test.mjs — the release gate.
//
// Everything else in tests/ runs against the *working tree*. This one runs against what
// `npm pack` actually ships: it unpacks the tarball into a temp directory outside the
// checkout, starts the server there with no Keil installation visible, and drives the
// tools over stdio. It exists because two release-only defects are invisible from the
// checkout:
//
//   1. data the server reads at import time must be inside `files:` (module_catalog.json
//      used to live in reverse/ and the published package died on startup);
//   2. "am I the main module?" must compare canonical paths, because npm's bin shim and
//      8.3 short paths spell the same file differently — a silent no-op server otherwise.
//
// Run with: node tests/pack_test.mjs     (or: npm run test:pack)
import { spawn, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ', name); }
  else { fail++; console.log('FAIL ', name, detail === undefined ? '' : '->', detail); }
};
const section = (t) => console.log(`\n--- ${t} ---`);

// ---------------------------------------------------------------- pack & unpack
section('package contents');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-packtest-'));
const packDest = path.join(tmp, 'tgz');
fs.mkdirSync(packDest, { recursive: true });

let tgz = null;
try {
  // npm is npm.cmd on Windows, which Node refuses to execFile directly (EINVAL since the
  // CVE-2024-27980 fix), so go through the command processor there.
  const raw = execSync(`npm pack --json --pack-destination "${packDest}"`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw.trim());
  const info = Array.isArray(parsed) ? parsed[0] : parsed;
  tgz = path.join(packDest, info.filename);
  ok('npm pack produced a tarball', fs.existsSync(tgz), tgz);
} catch (e) {
  ok('npm pack produced a tarball', false, String(e.message || e).slice(0, 400));
}

if (!tgz || !fs.existsSync(tgz)) {
  console.log('\nCannot continue without a tarball.');
  process.exit(1);
}

const ex = path.join(tmp, 'unpacked');
fs.mkdirSync(ex, { recursive: true });
execFileSync('tar', ['-xzf', tgz, '-C', ex], { stdio: ['ignore', 'ignore', 'pipe'] });
const PKG = path.join(ex, 'package');
const has = (rel) => fs.existsSync(path.join(PKG, rel));
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const allFiles = walk(PKG);
const rel = allFiles.map(f => path.relative(PKG, f).replace(/\\/g, '/'));

ok('src/server.mjs is shipped', has('src/server.mjs'));
ok('every src module is shipped', rel.filter(r => r.startsWith('src/')).length >= 30, rel.filter(r => r.startsWith('src/')).length);
ok('LICENSE is shipped', has('LICENSE'));
ok('CHANGELOG / CONTRIBUTING / SECURITY are shipped',
  has('CHANGELOG.md') && has('CONTRIBUTING.md') && has('SECURITY.md'),
  ['CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md'].filter(f => !has(f)).join(','));
ok('README.md and README.zh-CN.md are shipped', has('README.md') && has('README.zh-CN.md'));
ok('data/fixtures/cdb/uv4_cdb.xml is shipped', has('data/fixtures/cdb/uv4_cdb.xml'));
const unpackedBytes = walk(PKG).reduce((n, f) => n + fs.statSync(f).size, 0);
ok('unpacked package carries the full fixture snapshot (>= 6 MiB)', unpackedBytes > 6 * 1024 * 1024, Math.round(unpackedBytes / 1024) + ' KiB');
ok('data/fixtures/catalog/module_catalog.json is shipped (import-time dependency)',
  has('data/fixtures/catalog/module_catalog.json'));
ok('3 .pdsc device packs are shipped', rel.filter(r => r.endsWith('.pdsc')).length === 3, rel.filter(r => r.endsWith('.pdsc')).length);
ok('DFP device headers are shipped (Device/Include/stm32f10x.h)',
  has('data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/Device/Include/stm32f10x.h'));
ok('DFP startup + system sources are shipped',
  has('data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/Device/Source/ARM/startup_stm32f10x_md.s') &&
  has('data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/Device/Source/system_stm32f10x.c'));
ok('flash algorithms (.FLM) are shipped',
  has('data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/Flash/STM32F10x_128.FLM'));
ok('SVD files are shipped', has('data/fixtures/Packs/Keil/STM32F1xx_DFP/2.4.1/SVD/STM32F103xx.svd'));
ok('CMSIS-Core headers are shipped',
  has('data/fixtures/Packs/ARM/CMSIS/6.2.0/CMSIS/Core/Include/core_cm3.h') &&
  has('data/fixtures/Packs/ARM/CMSIS/6.2.0/CMSIS/Core/Include/cmsis_compiler.h'));
ok('the algorithm dossier is shipped (docs/algorithms.md)', has('docs/algorithms.md'));
ok('sample artefacts (.axf/.map/.hex/.uvprojx) are shipped',
  rel.some(r => r.endsWith('.axf')) && rel.some(r => r.endsWith('.map')) && rel.some(r => r.endsWith('.hex')) && rel.some(r => r.endsWith('.uvprojx')));
ok('the development tree is NOT shipped (reverse/)', !rel.some(r => r.startsWith('reverse/')));
ok('the test suite is NOT shipped (tests/)', !rel.some(r => r.startsWith('tests/')));
ok('no node_modules in the tarball', !rel.some(r => r.startsWith('node_modules/')));

const cdb = path.join(PKG, 'data/fixtures/cdb/uv4_cdb.xml');
let cdbText = '';
try { cdbText = fs.readFileSync(cdb, 'utf8'); } catch {}
const deviceTags = (cdbText.match(/<device\s/g) || []).length;
const vendorTags = (cdbText.match(/<vendor\s+name="/g) || []).length;
ok('device DB keeps all 2831 devices', deviceTags === 2831, deviceTags);
ok('device DB keeps all 33 vendors', vendorTags === 33, vendorTags);

// ---------------------------------------------------------------- cold start, no Keil
section('cold start without Keil');

function start(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { cwd: tmp, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 1;
  const stderr = [];
  child.stderr.on('data', d => stderr.push(d.toString()));
  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); }
  });
  const req = (method, params, ms = 60000) => new Promise((res, rej) => {
    const myId = id++;
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), ms);
    pending.set(myId, (m) => { clearTimeout(t); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const r = await req('tools/call', { name, arguments: args || {} });
    const text = r.result && r.result.content && r.result.content[0] && r.result.content[0].text;
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { isError: !!(r.result && r.result.isError), data, rpcError: r.error };
  };
  const stop = () => { try { child.stdin.end(); } catch {} try { child.kill(); } catch {} };
  return { child, req, call, stop, stderr: () => stderr.join('') };
}

const noKeil = {
  ...process.env,
  LOCALAPPDATA: path.join(tmp, 'no-keil-here'),
  KEIL_MDK_ROOT: '',
  KEIL_ROOT: '',
  KEIL_MCP_AUTOSTART: '',
  KEIL_MCP_REVERSE_DIR: '',
};

const srv = start(path.join(PKG, 'src', 'server.mjs'), noKeil);
let tools = [];
try {
  const init = await srv.req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack_test', version: '1' } });
  ok('initialize answers', !!init.result && init.result.serverInfo && init.result.serverInfo.name === 'keil-uv4-mcp', JSON.stringify(init.error));
  ok('server announces portable mode (no Keil found)', /Portable mode/.test(String(init.result && init.result.instructions)), init.result && init.result.instructions);
  srv.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await srv.req('tools/list', {});
  tools = (list.result && list.result.tools) || [];
  ok('tools/list returns the full surface (>= 80 tools)', tools.length >= 80, tools.length);
  for (const required of ['uv4_build', 'project_create', 'pack_devices', 'pack_device_detail', 'cdb_devices', 'cdb_vendors', 'module_catalog', 'elf_info', 'map_info', 'hex_info', 'dep_graph', 'batch_generate', 'uvsock_service_table', 'compile', 'flash', 'build_backends']) {
    ok(`tool ${required} is registered`, tools.some(t => t.name === required));
  }

  // STM32 device data straight out of the packed snapshot
  const pd = await srv.call('pack_devices', { query: 'STM32F103', limit: 50 });
  ok('pack_devices finds STM32F103 parts', pd.data.ok && pd.data.count > 0, JSON.stringify(pd.data).slice(0, 200));
  const detail = await srv.call('pack_device_detail', { name: 'STM32F103C8' });
  const dev = detail.data.device || {};
  ok('pack_device_detail resolves STM32F103C8', detail.data.ok && dev.name === 'STM32F103C8', JSON.stringify(detail.data).slice(0, 200));
  ok('  ... with 64 KiB flash / 20 KiB RAM from the .pdsc',
    (dev.memory || []).some(m => m.id === 'IROM1' && m.size === '0x00010000') &&
    (dev.memory || []).some(m => m.id === 'IRAM1' && m.size === '0x00005000'),
    JSON.stringify(dev.memory));
  ok('  ... with the STM32F10X_MD define', dev.define === 'STM32F10X_MD', dev.define);
  ok('  ... with a flash algorithm', !!(dev.flashAlgorithm && /\.FLM$/.test(dev.flashAlgorithm.name)), JSON.stringify(dev.flashAlgorithm));
  ok('  ... with the SVD path', dev.svd === 'SVD/STM32F103xx.svd', dev.svd);

  const cd = await srv.call('cdb_devices', { query: 'STM32F103C8', limit: 5 });
  const leg = (cd.data.devices || [])[0] || {};
  ok('cdb_devices hits the legacy DB', cd.data.ok && leg.name === 'STM32F103C8', JSON.stringify(cd.data).slice(0, 200));
  ok('  ... with the vendor id UV4 stores (13 = STMicroelectronics)', String(leg.vendorId) === '13', leg.vendorId);
  ok('  ... with the legacy startup file', /startup_stm32f10x_md\.s$/.test(String(leg.startup)), leg.startup);
  const cv = await srv.call('cdb_vendors', {});
  ok('cdb_vendors lists 33 vendors', cv.data.ok && (cv.data.vendors || []).length === 33, (cv.data.vendors || []).length);

  const pl = await srv.call('pack_list', {});
  const packs = (pl.data.packs || []);
  ok('pack_list sees the 3 bundled packs', packs.length === 3, packs.map(p => `${p.name}@${p.version}`).join(','));
  ok('  ... STM32F1xx_DFP 2.4.1 declares 95 devices',
    packs.some(p => p.name === 'STM32F1xx_DFP' && p.version === '2.4.1' && p.devices === 95), JSON.stringify(packs.map(p => [p.name, p.version, p.devices])));

  const mc = await srv.call('module_catalog', { module: 'UVSC' });
  ok('module_catalog loads from the packed copy', mc.data.ok === true, JSON.stringify(mc.data).slice(0, 300));
  ok('  ... and reports the packaged path, not reverse/',
    typeof mc.data.catalogFile === 'string' && /data[\\/]fixtures[\\/]catalog[\\/]module_catalog\.json$/.test(mc.data.catalogFile) && !/reverse/.test(mc.data.catalogFile),
    mc.data.catalogFile);
  ok('  ... UVSC.dll export count from the decompilation (103)', mc.data.modules && mc.data.modules['UVSC.dll'] && mc.data.modules['UVSC.dll'].exports === 103);

  // image analysis on the packed sample artefacts
  const axf = path.join(PKG, 'data/fixtures/samples/Gen2/Objects/app.axf');
  const ei = await srv.call('elf_info', { file: axf, limit: 3 });
  ok('elf_info parses the packed app.axf', ei.data.ok && ei.data.format === 'ELF32', JSON.stringify(ei.data).slice(0, 200));
  const mi = await srv.call('map_info', { file: path.join(PKG, 'data/fixtures/samples/Gen2/Objects/app.map') });
  ok('map_info parses the packed map', mi.data.ok && mi.data.imageTotals && mi.data.imageTotals.ro.bytes === 644, JSON.stringify(mi.data && mi.data.imageTotals));
  const hi = await srv.call('hex_info', { file: path.join(PKG, 'data/fixtures/samples/Gen2/Objects/app.hex') });
  ok('hex_info verifies the packed hex', hi.data.ok && hi.data.checksumErrors === 0 && hi.data.range.start === '0x8000000', JSON.stringify(hi.data).slice(0, 200));

  // fidelity: what genuinely needs UV4.exe must say so, never pretend
  const b = await srv.call('uv4_build', { project: path.join(PKG, 'data/fixtures/samples/Gen/gen.uvprojx') });
  ok('uv4_build reports needsKeil instead of faking a build', b.isError === true && b.data.needsKeil === true, JSON.stringify(b.data).slice(0, 200));
  ok('  ... and names the searched roots', Array.isArray(b.data.searched) && b.data.searched.length >= 3);

  // the licence-free path must work from the packed copy, with no MDK licence in sight
  const buildOut = path.join(tmp, 'packed-build');
  const cmp = await srv.call('compile', { project: path.join(PKG, 'data/fixtures/samples/Gen/gen.uvprojx'), outDir: buildOut });
  if (cmp.data.ok) {
    ok('licence-free compile works from the packed copy', cmp.data.ok === true, JSON.stringify(cmp.data).slice(0, 300));
    ok('  ... backend is clang or gcc (no armlm)', ['clang', 'gcc'].includes(cmp.data.backend), cmp.data.backend);
    ok('  ... it produced .hex on disk', !!cmp.data.outputs.hex && fs.existsSync(cmp.data.outputs.hex.path) && cmp.data.outputs.hex.bytes > 0, JSON.stringify(cmp.data.outputs.hex));
    ok('  ... CMSIS headers came from the packed copy', (cmp.data.meta.addedIncludes || []).some(p => p.startsWith(PKG)), JSON.stringify(cmp.data.meta.addedIncludes));
  } else {
    ok('licence-free compile reports missing compiler with install hints (no MDK needed)',
      cmp.data.ok === false && Array.isArray(cmp.data.need) && cmp.data.need.length > 0, JSON.stringify(cmp.data).slice(0, 300));
  }
  if (cmp.data.ok) {
    const fl = await srv.call('flash', { file: path.join(buildOut, 'gen.hex') });
    const flashersThere = fl.data.ok === true || /no flashing tool/.test(String(fl.data.error || ''));
    ok('flash dryRun returns a command without programming (or names the missing tool)',
      flashersThere && (fl.data.ok !== true || (fl.data.dryRun === true && Array.isArray(fl.data.command))), JSON.stringify(fl.data).slice(0, 300));
  } else {
    console.log('SKIP  flash dryRun -> no image (compiler missing)');
  }
} catch (e) {
  ok('cold-start scenario ran to completion', false, String(e.message || e).slice(0, 400));
} finally {
  srv.stop();
}

// ---------------------------------------------------------------- entry-point resolution
section('main-module detection');
if (process.platform === 'win32') {
  let short = null;
  try {
    // execSync keeps the whole `for` statement in one cmd.exe command line; going through
    // execFileSync('cmd', ['/c', ...]) lets Node's argument quoting break the inner quotes.
    short = execSync(`for %I in ("${path.join(PKG, 'src', 'server.mjs')}") do @echo %~sI`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not fatal */ }
  if (short && /~\d/.test(short)) {
    const s2 = start(short, noKeil);
    try {
      const init = await s2.req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'short', version: '1' } }, 30000);
      ok('server starts when invoked through an 8.3 short path', !!init.result, `${short} :: ${s2.stderr().slice(0, 300)}`);
    } catch (e) {
      ok('server starts when invoked through an 8.3 short path', false, `${short} :: ${String(e.message || e)} :: ${s2.stderr().slice(0, 300)}`);
    } finally { s2.stop(); }
  } else {
    console.log('SKIP  no 8.3 short path available for this location');
  }
  const s3 = start(path.join(PKG, 'src', 'server.mjs'), { ...noKeil, KEIL_MCP_AUTOSTART: '1' });
  try {
    const init = await s3.req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'auto', version: '1' } }, 30000);
    ok('KEIL_MCP_AUTOSTART=1 still starts the server when imported', !!init.result, JSON.stringify(init.error));
  } catch (e) {
    ok('KEIL_MCP_AUTOSTART=1 still starts the server when imported', false, String(e.message || e));
  } finally { s3.stop(); }
} else {
  console.log('SKIP  short-path check is Windows-specific');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\n${pass}/${pass + fail} release checks passed`);
process.exit(fail === 0 ? 0 : 1);


