// build.mjs — portable build backend.
//
// µVision drives armcc/armclang through UV4.exe. When Keil is not installed we cannot
// reproduce that toolchain, but "compile" is a baseline capability, so this module builds
// a Cortex-M image with whatever cross compiler the machine actually has:
//
//   armclang (AC6)  -> clang-compatible driver shipped with MDK
//   armcc   (AC5)   -> legacy driver shipped with MDK
//   gcc             -> arm-none-eabi-gcc
//   clang           -> stock LLVM with the ARM backend (what this machine has)
//
// The input is a µVision project (so the device, defines, include paths and memory map come
// from the same model the rest of the server uses); the output is a real ELF plus .hex/.bin
// and a .map. Byte-for-byte parity with armcc is explicitly NOT claimed — the backend is
// reported in every result so callers can tell which compiler produced the image.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLANG_CANDIDATES = [
  process.env.KEIL_CLANG,
  'C:/Program Files/LLVM/bin/clang.exe',
  'C:/Program Files/LLVM/bin/clang',
  '/usr/bin/clang',
  '/usr/local/opt/llvm/bin/clang',
];
const GCC_CANDIDATES = [
  process.env.ARM_NONE_EABI_GCC,
  'arm-none-eabi-gcc',
  'C:/Program Files (x86)/GNU Arm Embedded Toolchain/10 2021.10/bin/arm-none-eabi-gcc.exe',
  'C:/ProgramData/chocolatey/bin/arm-none-eabi-gcc.exe',
];

function whichSync(exe) {
  if (!exe) return null;
  if (path.isAbsolute(exe)) return fs.existsSync(exe) ? exe : null;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d, exe + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

function sibling(dir, name) {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? p : whichSync(name);
}

function run(exe, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, ...(opts.env || {}) } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, opts.timeoutMs || 180000);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message || e) }); });
  });
}

/**
 * Every cross compiler usable without a licence, best first.
 *
 * MDK's armclang/armcc are deliberately excluded: they are licence-gated (Error #601) and
 * link through armlink scatter files, which is the very dependency this path exists to
 * avoid. They stay reachable through uv4_build when an installation is present; here the
 * contract is "open toolchain only". clang is preferred over gcc because it is a single
 * download on every platform and ships its own freestanding headers.
 */
export async function detectBackends() {
  const backends = [];

  // Stock clang with the ARM backend (needs lld + llvm-objcopy beside it).
  for (const cand of CLANG_CANDIDATES) {
    const exe = whichSync(cand);
    if (!exe) continue;
    const dir = path.dirname(exe);
    const objcopy = sibling(dir, 'llvm-objcopy.exe') || sibling(dir, 'llvm-objcopy');
    const lld = sibling(dir, 'ld.lld.exe') || sibling(dir, 'ld.lld') || sibling(dir, 'lld.exe') || sibling(dir, 'lld');
    if (!objcopy || !lld) continue;
    const v = await run(exe, ['--version']);
    if (v.code !== 0) continue;
    const ver = (v.out.split('\n')[0] || '').trim();
    const targets = await run(exe, ['--print-targets']);
    if (!/\barm\b/.test(targets.out)) continue;
    backends.push({ id: 'clang', exe, dir, family: 'arm', kind: 'clang', linker: lld, objcopy, version: ver, licence: 'none' });
    break;
  }

  // arm-none-eabi-gcc
  for (const cand of GCC_CANDIDATES) {
    const exe = whichSync(cand);
    if (!exe) continue;
    const dir = path.dirname(exe);
    backends.push({
      id: 'gcc', exe, dir, family: 'arm', kind: 'gcc',
      linker: sibling(dir, 'arm-none-eabi-ld.exe') || sibling(dir, 'arm-none-eabi-gcc.exe'),
      objcopy: sibling(dir, 'arm-none-eabi-objcopy.exe'),
      licence: 'none',
    });
    break;
  }

  return backends;
}

/** MDK compilers, reported for information only (they are licence-gated). */
export function detectMdkCompilers() {
  const out = [];
  const mdk = process.env.KEIL_MDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Keil_v5') : null);
  if (!mdk) return out;
  const arm = path.join(mdk, 'ARM');
  for (const [dirName, exe] of [['ARMCLANG', 'armclang.exe'], ['ARMCC', 'armcc.exe']]) {
    const bin = path.join(arm, dirName, 'bin');
    const exePath = path.join(bin, exe);
    if (fs.existsSync(exePath)) {
      out.push({ id: dirName === 'ARMCLANG' ? 'armclang' : 'armcc', exe: exePath, licence: 'MDK (armlm, Error #601 gate)' });
    }
  }
  return out;
}

/** Parse the µVision Cpu: string into the numbers a linker script needs. */
export function parseCpuString(cpu) {
  const s = String(cpu || '');
  const num = (m) => {
    if (!m) return null;
    const parts = m[1].split(',').map(x => x.trim());
    const start = Number(parts[0]);
    const size = Number(parts[1]);
    return Number.isFinite(start) && Number.isFinite(size) ? { start, size } : null;
  };
  const irom = num(/IROM\s*\(([^)]*)\)/i.exec(s));
  const iram = num(/IRAM\s*\(([^)]*)\)/i.exec(s));
  const cpuType = (/CPUTYPE\s*\(\s*"?([A-Za-z0-9+_-]+)"?\s*\)/i.exec(s) || [])[1] || '';
  const clock = Number((/CLOCK\s*\(\s*(\d+)/i.exec(s) || [])[1] || 0);
  return { irom, iram, cpuType, clock };
}

export function clangCpuName(cpuType) {
  // Normalise, then match longest-first: 'cortexm33' must not be taken as 'cortexm3'.
  const t = String(cpuType || '').toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
  const table = [
    ['cortexm0plus', 'cortex-m0plus'], ['cortexm35p', 'cortex-m35p'],
    ['cortexm85', 'cortex-m85'], ['cortexm55', 'cortex-m55'],
    ['cortexm33', 'cortex-m33'], ['cortexm23', 'cortex-m23'],
    ['cortexm7', 'cortex-m7'], ['cortexm4', 'cortex-m4'],
    ['cortexm3', 'cortex-m3'], ['cortexm1', 'cortex-m1'],
    ['cortexm0', 'cortex-m0'],
    ['cortexa5', 'cortex-a5'], ['cortexa7', 'cortex-a7'], ['cortexa9', 'cortex-a9'],
  ];
  for (const [key, name] of table) if (t === key || t.startsWith(key)) return name;
  return 'cortex-m3';
}

const STARTUP_S = `@ Generated by keil-uv4-mcp: minimal GNU-syntax vector table.
    .syntax unified
    .cpu {CPU}
    .thumb

    .global __Vectors
    .global Reset_Handler
    .global _estack

    .section .isr_vector,"a",%progbits
    .type __Vectors, %object
__Vectors:
    .word _estack
{VECTORS}

    .section .text.Reset_Handler,"ax",%progbits
    .type Reset_Handler, %function
    .weak Reset_Handler
Reset_Handler:
    ldr r0, =_sidata
    ldr r1, =_sdata
    ldr r2, =_edata
1:  cmp r1, r2
    bcs 2f
    ldr r3, [r0], #4
    str r3, [r1], #4
    b 1b
2:  ldr r0, =_sbss
    ldr r1, =_ebss
    movs r3, #0
3:  cmp r0, r1
    bcs 4f
    str r3, [r0], #4
    b 3b
4:
    bl main
5:  b 5b
    .size Reset_Handler, .-Reset_Handler

    .weak Default_Handler
    .type Default_Handler, %function
Default_Handler:
    b Default_Handler
    .size Default_Handler, .-Default_Handler
`;

function startupSource(cpuName, vectorCount) {
  const vectors = [];
  for (let i = 0; i < Math.max(vectorCount, 1); i++) vectors.push(`    .word Default_Handler`);
  return STARTUP_S.replace('{CPU}', cpuName).replace('{VECTORS}', vectors.join('\n'));
}

function linkerScript({ irom, iram }) {
  const rom = irom || { start: 0x08000000, size: 0x10000 };
  const ram = iram || { start: 0x20000000, size: 0x5000 };
  const hex = (n) => '0x' + Number(n).toString(16).toUpperCase();
  return `/* Generated by keil-uv4-mcp from the project's Cpu: string (IROM/IRAM). */
MEMORY
{
  ROM (rx)  : ORIGIN = ${hex(rom.start)}, LENGTH = ${hex(rom.size)}
  RAM (rwx) : ORIGIN = ${hex(ram.start)}, LENGTH = ${hex(ram.size)}
}
_estack = ORIGIN(RAM) + LENGTH(RAM);
ENTRY(Reset_Handler)
SECTIONS
{
  .isr_vector : { KEEP(*(.isr_vector)) } > ROM
  .text : {
    *(.text*)
    *(.rodata*)
    . = ALIGN(4);
  } > ROM
  _sidata = LOADADDR(.data);
  .data : {
    _sdata = .;
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } > RAM AT > ROM
  .bss : {
    _sbss = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
  } > RAM
  .ARM.exidx : { *(.ARM.exidx*) } > ROM
  /DISCARD/ : { *(.comment) *(.note*) }
}
`;
}

function listSources(projectFiles) {
  const c = [], asm = [];
  for (const f of projectFiles) {
    const ext = path.extname(String(f.path || f)).toLowerCase();
    if (ext === '.c') c.push(f.path || f);
    else if (ext === '.s' || ext === '.asm') asm.push(f.path || f);
  }
  return { c, asm };
}

/**
 * Build one µVision target with a portable backend.
 * @param {object} spec { files:[{path}], defines:[], includes:[], cpu, cpuType, outDir, outputName, backend }
 */
export async function portableCompile(spec) {
  const backends = spec.backend
    ? (await detectBackends()).filter(b => b.id === spec.backend)
    : await detectBackends();
  if (!backends.length) {
    return {
      ok: false,
      error: 'no portable C compiler found',
      need: ['armclang (MDK)', 'armcc (MDK)', 'arm-none-eabi-gcc', 'clang + lld + llvm-objcopy'],
      hint: 'install one of the above (on Windows: winget install LLVM.LLVM, or arm-none-eabi-gcc from developer.arm.com) and re-run',
    };
  }
  const backend = backends[0];
  const mem = parseCpuString(spec.cpu || '');
  const cpuName = spec.cpuType || mem.cpuType || 'Cortex-M3';
  const target = clangCpuName(cpuName);
  const outDir = path.resolve(spec.outDir || path.join(os.tmpdir(), 'keil-uv4-build'));
  fs.mkdirSync(outDir, { recursive: true });
  const name = spec.outputName || 'Target';
  const elf = path.join(outDir, `${name}.elf`);
  const hex = path.join(outDir, `${name}.hex`);
  const bin = path.join(outDir, `${name}.bin`);
  const map = path.join(outDir, `${name}.map`);

  const { c, asm } = listSources(spec.files || []);
  // Startup: use the project's own .s when it is GNU-compatible, otherwise synthesise one.
  let startupPath = null;
  let synthesised = false;
  for (const s of asm) {
    try {
      const text = fs.readFileSync(s, 'utf8');
      if (/\bAREA\b/.test(text) && !/\.syntax\s+unified/.test(text)) continue; // armasm syntax
      startupPath = s; break;
    } catch { /* skip */ }
  }
  if (!startupPath) {
    startupPath = path.join(outDir, '_startup_gnu.s');
    fs.writeFileSync(startupPath, startupSource(target, 16 + 60), 'utf8');
    synthesised = true;
  }
  const ldPath = path.join(outDir, `${name}.ld`);
  fs.writeFileSync(ldPath, linkerScript(mem), 'utf8');

  const log = [];
  const common = [
    `-target`, 'arm-none-eabi',
    `-mcpu=${target}`, '-mthumb', '-Os', '-g', '-ffreestanding', '-fno-builtin', '-fno-common',
    '-Wall', '-Wno-unused-command-line-argument',
  ];
  for (const d of spec.defines || []) if (d) common.push(`-D${d}`);
  for (const i of spec.includes || []) if (i) common.push('-I', i);

  // Real clang needs its own freestanding headers (<stdint.h> etc.).
  if (backend.kind === 'clang') {
    const r = await run(backend.exe, ['-print-resource-dir']);
    if (r.code === 0 && r.out.trim()) common.push('-isystem', path.join(r.out.trim(), 'include'));
  }

  const objs = [];
  const failures = [];
  for (const src of [...c, startupPath]) {
    const isAsm = src === startupPath;
    const obj = path.join(outDir, path.basename(src).replace(/\.(c|s|asm)$/i, '') + (isAsm ? '_startup' : '') + '.o');
    const args = [...common, '-c', src, '-o', obj];
    if (isAsm) args.push('-x', 'assembler-with-cpp');
    const r = await run(backend.exe, args);
    log.push({ step: 'cc', file: src, code: r.code, out: r.out.trim(), err: r.err.trim() });
    if (r.code !== 0) failures.push({ file: src, err: (r.err || r.out).trim().split('\n').slice(0, 6).join(' | ') });
    else objs.push(obj);
  }
  if (failures.length) {
    return { ok: false, backend: backend.id, stage: 'compile', failures, log, outDir };
  }

  const link = backend.kind === 'clang'
    ? [backend.exe, ['-target', 'arm-none-eabi', `-mcpu=${target}`, '-mthumb', '-nostdlib', '-nostartfiles',
        '-Wl,-T,' + ldPath, '-Wl,-Map,' + map, '-Wl,--gc-sections', '-Wl,--entry=Reset_Handler',
        '-o', elf, ...objs]]
    : [backend.exe, ['-mcpu=' + target, '-mthumb', '-nostdlib', '-nostartfiles', '-Wl,-T,' + ldPath,
        '-Wl,-Map,' + map, '-Wl,--gc-sections', '-o', elf, ...objs]];
  const lr = await run(link[0], link[1]);
  log.push({ step: 'link', code: lr.code, out: lr.out.trim(), err: lr.err.trim() });
  if (lr.code !== 0) {
    return { ok: false, backend: backend.id, stage: 'link', log, err: (lr.err || lr.out).trim().split('\n').slice(0, 8), outDir };
  }

  const hexR = await run(backend.objcopy, ['-O', 'ihex', elf, hex]);
  const binR = await run(backend.objcopy, ['-O', 'binary', elf, bin]);
  log.push({ step: 'objcopy-hex', code: hexR.code }, { step: 'objcopy-bin', code: binR.code });

  const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  return {
    ok: true,
    backend: backend.id,
    backendExe: backend.exe,
    cpu: target,
    entry: 'Reset_Handler',
    memory: { irom: mem.irom, iram: mem.iram },
    outputs: {
      elf: fs.existsSync(elf) ? { path: elf, bytes: size(elf) } : null,
      hex: fs.existsSync(hex) ? { path: hex, bytes: size(hex) } : null,
      bin: fs.existsSync(bin) ? { path: bin, bytes: size(bin) } : null,
      map: fs.existsSync(map) ? { path: map, bytes: size(map) } : null,
    },
    startup: synthesised ? 'generated (GNU as)' : startupPath,
    log,
    fidelity: 'portable backend: object code is NOT byte-identical to armcc/armclang output',
  };
}

/** Flashing backends that can program a .hex/.bin without µVision. */
export async function detectFlashers() {
  const list = [];
  const add = (id, exe, args, note) => { if (exe) list.push({ id, exe, args, note }); };

  const pyocd = whichSync('pyocd');
  add('pyocd', pyocd, null, 'pyocd flash -t <target> <file> (CMSIS-DAP/ST-Link/J-Link probes)');

  // openocd: prefer the default board config the user names; we only generate the command.
  const openocd = whichSync('openocd');
  add('openocd', openocd, null, 'openocd -f interface/<probe>.cfg -f target/<chip>.cfg -c "program <file> verify reset exit"');

  if (process.platform === 'win32') {
    for (const p of [
      'C:/Program Files/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe',
      'C:/Program Files (x86)/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe',
      'C:/Program Files (x86)/STMicroelectronics/STM32 ST-LINK Utility/ST-LINK_CLI.exe',
      'C:/Program Files/STMicroelectronics/STM32 ST-LINK Utility/ST-LINK_CLI.exe',
    ]) if (fs.existsSync(p)) add(path.basename(p, '.exe').toLowerCase(), p, null, 'ST-LINK programmer (ST hardware)');
    for (const p of ['C:/Program Files/SEGGER/JLink/JLinkExe.exe', 'C:/Program Files (x86)/SEGGER/JLink/JLinkExe.exe']) {
      if (fs.existsSync(p)) add('jlink', p, null, 'J-Link Commander (SEGGER hardware)');
    }
  } else {
    const jl = whichSync('JLinkExe');
    add('jlink', jl, null, 'J-Link Commander (SEGGER hardware)');
  }
  return list;
}

/** Build the command line for one flasher without running it. */
export function flashCommand(flasher, { file, chip, probe, base, address }) {
  const f = `"${path.resolve(file)}"`;
  const addr = address || base || '0x08000000';
  switch (flasher.id) {
    case 'pyocd':
      return [flasher.exe, ['flash', '-t', chip || 'stm32f103c8', '-a', addr, file]];
    case 'openocd':
      return [flasher.exe, ['-f', `interface/${probe || 'cmsis-dap'}.cfg`, '-f', `target/${(chip || 'stm32f103c8').toLowerCase()}.cfg`,
        '-c', `program ${f} verify reset exit`]];
    case 'stm32_programmer_cli':
      return [flasher.exe, ['-c', 'port=SWD', '-w', file, addr, '-v', '-rst']];
    case 'st-link_cli':
      return [flasher.exe, ['-c', 'SWD', '-P', file, addr, '-V', '-Rst']];
    case 'jlink':
      return [flasher.exe, ['-device', chip || 'STM32F103C8', '-if', 'SWD', '-speed', '4000', '-autoconnect', '1',
        '-CommanderScript', '-'], { stdin: `loadfile ${file} ${addr}\nr\ng\nqc\n` }];
    default:
      return [flasher.exe, [file]];
  }
}

export async function runFlash(flasher, spec) {
  const [exe, args, extra] = flashCommand(flasher, spec);
  if (spec.dryRun !== false) {
    return { ok: true, dryRun: true, flasher: flasher.id, command: [exe, ...args], input: extra && extra.stdin ? extra.stdin : null };
  }
  const res = await new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    if (extra && extra.stdin) { try { child.stdin.write(extra.stdin); child.stdin.end(); } catch {} }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, spec.timeoutMs || 120000);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message || e) }); });
  });
  return { ok: res.code === 0, flasher: flasher.id, exitCode: res.code, stdout: res.out.slice(-4000), stderr: res.err.slice(-4000), command: [exe, ...args] };
}
