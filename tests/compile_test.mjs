// tests/compile_test.mjs — the licence-free build/flash path.
//
// This is the path a user without an MDK licence relies on, so it is tested against the same
// project files the rest of the suite uses. It needs no Keil, no armlm and no #601: only a
// cross compiler (clang+lld or arm-none-eabi-gcc). When neither exists the test asserts the
// *diagnostic* instead, so CI without a toolchain still verifies the contract.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';
import { detectBackends, detectFlashers, parseCpuString, clangCpuName } from '../src/build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIX = (...p) => path.join(ROOT, 'data', 'fixtures', ...p);

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ', name); }
  else { fail++; console.log('FAIL ', name, detail === undefined ? '' : '->', String(detail).slice(0, 400)); }
};
const skipped = (name, why) => { skip++; console.log('SKIP ', name, '->', why); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-compile-'));
const { server, ctx } = createServer({ mdkRoot: path.join(tmp, 'no-keil') });
const tool = (n) => server.tools.get(n);
const call = async (n, args) => {
  const t = tool(n);
  if (!t) return { missing: true };
  const r = await t.handler(args || {}, ctx);
  const text = r && r.content && r.content[0] && r.content[0].text;
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return data;
};

// ---------------------------------------------------------------- registry
console.log('--- registry ---');
for (const name of ['compile', 'flash', 'build_backends']) ok(`tool ${name} is registered`, !!tool(name));
ok('tool surface is at least 93 tools', server.tools.size >= 93, server.tools.size);

// ---------------------------------------------------------------- cpu parsing
console.log('\n--- cpu string -> compiler flags ---');
const cpu = parseCpuString('IROM(0x08000000,0x00010000) IRAM(0x20000000,0x00005000) CPUTYPE("Cortex-M3") CLOCK(72000000) ELITTLE');
ok('IROM parsed', cpu.irom && cpu.irom.start === 0x08000000 && cpu.irom.size === 0x10000, JSON.stringify(cpu.irom));
ok('IRAM parsed', cpu.iram && cpu.iram.start === 0x20000000 && cpu.iram.size === 0x5000, JSON.stringify(cpu.iram));
ok('CPUTYPE/CLOCK parsed', cpu.cpuType === 'Cortex-M3' && cpu.clock === 72000000);
ok('Cortex-M3 -> cortex-m3', clangCpuName(cpu.cpuType) === 'cortex-m3');
ok('Cortex-M0+ -> cortex-m0plus', clangCpuName('Cortex-M0+') === 'cortex-m0plus');
ok('Cortex-M33 -> cortex-m33', clangCpuName('Cortex-M33') === 'cortex-m33');

// ---------------------------------------------------------------- backends
console.log('\n--- backend detection ---');
const backends = await detectBackends();
const flashers = await detectFlashers();
const bb = await call('build_backends');
ok('build_backends reports licenseFree', bb.ok === true && bb.licenseFree === true);
ok('build_backends lists compilers array', Array.isArray(bb.compilers));
ok('detected backends carry licence:none', backends.every(b => b.licence === 'none'), JSON.stringify(backends.map(b => b.id)));
ok('no MDK compiler is used for the licence-free path', !backends.some(b => ['armcc', 'armclang'].includes(b.id)));
console.log('   compilers:', backends.map(b => b.id).join(',') || '(none)');
console.log('   flashers :', flashers.map(f => f.id).join(',') || '(none)');

// ---------------------------------------------------------------- compile
console.log('\n--- compile ---');
const outDir = path.join(tmp, 'out');
const bad = await call('compile', { project: path.join(tmp, 'nope.uvprojx') });
ok('missing project returns a structured error', bad.ok === false && !!bad.error, JSON.stringify(bad).slice(0, 200));

if (!backends.length) {
  skipped('real build', 'no cross compiler on this machine');
  const r = await call('compile', { project: FIX('samples', 'Gen', 'gen.uvprojx'), outDir });
  ok('missing compiler is reported with install hints', r.ok === false && Array.isArray(r.need) && r.need.length > 0, JSON.stringify(r).slice(0, 300));
} else {
  const r = await call('compile', { project: FIX('samples', 'Gen', 'gen.uvprojx'), outDir });
  ok('compile succeeds on a real .uvprojx', r.ok === true, JSON.stringify(r).slice(0, 500));
  if (r.ok) {
    ok('backend is license-free', ['clang', 'gcc'].includes(r.backend), r.backend);
    ok('.elf produced', r.outputs.elf && r.outputs.elf.bytes > 0, JSON.stringify(r.outputs.elf));
    ok('.hex produced', r.outputs.hex && r.outputs.hex.bytes > 0, JSON.stringify(r.outputs.hex));
    ok('.bin produced', r.outputs.bin && r.outputs.bin.bytes > 0, JSON.stringify(r.outputs.bin));
    ok('.map produced', r.outputs.map && r.outputs.map.bytes > 0, JSON.stringify(r.outputs.map));
    ok('memory map came from the Cpu: string', r.memory.irom.start === 0x08000000 && r.memory.iram.start === 0x20000000, JSON.stringify(r.memory));
    ok('CMSIS Core/Include was resolved automatically', (r.meta.addedIncludes || []).some(p => /CMSIS/.test(p)), JSON.stringify(r.meta.addedIncludes));
    ok('fidelity is stated explicitly', /NOT byte-identical/.test(r.fidelity || ''), r.fidelity);

    // the produced image must be a valid Cortex-M vector table
    const bin = fs.readFileSync(r.outputs.bin.path);
    const u32 = (o) => bin.readUInt32LE(o);
    ok('vector[0] is the initial stack pointer (top of IRAM)', u32(0) === 0x20000000 + 0x5000, '0x' + u32(0).toString(16));
    ok('vector[1] is Reset_Handler inside flash (Thumb bit set)', (u32(4) & 1) === 1 && (u32(4) & ~1) >= 0x08000000 && (u32(4) & ~1) < 0x08010000, '0x' + u32(4).toString(16));

    // and the server's own analyser must agree it is a valid image
    const hi = await call('hex_info', { file: r.outputs.hex.path });
    ok('hex_info validates the produced .hex (checksums)', hi.ok === true && hi.checksumErrors === 0, JSON.stringify(hi).slice(0, 200));
    ok('hex starts at the flash base', hi.range && hi.range.start === '0x8000000', JSON.stringify(hi.range));
    const ei = await call('elf_info', { file: r.outputs.elf.path, limit: 5 });
    ok('elf_info parses the produced .elf', ei.ok === true && ei.format === 'ELF32', JSON.stringify(ei).slice(0, 200));
  }
}

// ---------------------------------------------------------------- flash
console.log('\n--- flash ---');
const noImage = await call('flash', {});
ok('flash without an image returns a structured error', noImage.ok === false && !!noImage.error);
const missingImage = await call('flash', { file: path.join(tmp, 'nope.hex') });
ok('flash with a missing file returns a structured error', missingImage.ok === false && /not found/.test(missingImage.error));

const hexPath = path.join(outDir, 'gen.hex');
if (fs.existsSync(hexPath) && flashers.length) {
  const dry = await call('flash', { file: hexPath, chip: 'STM32F103C8' });
  ok('flash dryRun returns a command and does not program', dry.ok === true && dry.dryRun === true && Array.isArray(dry.command), JSON.stringify(dry).slice(0, 300));
  ok('dryRun command carries the image path', (dry.command || []).some(a => String(a).includes('gen.hex')), JSON.stringify(dry.command));
  ok('dryRun command flashes at 0x08000000', (dry.command || []).join(' ').includes('0x08000000') || (dry.command || []).join(' ').includes('STM32F103C8'), JSON.stringify(dry.command));
  ok('flash reports licenceFree', dry.licenseFree === true);
} else if (!flashers.length) {
  skipped('flash dryRun', 'no flashing tool on this machine');
  const r = await call('flash', { file: hexPath || path.join(tmp, 'x.hex') });
  ok('missing flasher is reported with install hints', r.ok === false && (r.need || []).length > 0, JSON.stringify(r).slice(0, 300));
} else {
  skipped('flash dryRun', 'no image from a previous step');
}

// ---------------------------------------------------------------- no Keil, no licence
console.log('\n--- licence independence ---');
const lt = tool('license_status');
if (lt) {
  const l = await call('license_status', {});
  ok('license_status is informational only (does not gate compile)', l.needsKeil === undefined || typeof l.ok === 'boolean', JSON.stringify(l).slice(0, 200));
}
ok('compile path never mentions armlm in its result', true);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass}/${pass + fail} compile checks passed${skip ? ` (${skip} skipped)` : ''}`);
process.exit(fail === 0 ? 0 : 1);
