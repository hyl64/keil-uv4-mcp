// tools/gdbstub.mjs — RDI/JTAG-level register description derived from the SVD/PDSC.
// Emitted in the classic "RDI armdbg" register/bitfield descriptor syntax that ARM
// debuggers and gdb stubs consume:
//   R=<index>,<name>,<bit size>,<group>,<basic type>,<description>
//   B=<index>,<name>,<bit offset>,<bit size>,<mask>,<description>
// Register layout comes from the CMSIS-SVD inside the pack (per device), so every
// peripheral is covered. Core registers are the architectural Cortex ones.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, bool, int } from './common.mjs';
import { parseXml, childElem, childElems, textOf, findAll } from '../xml.mjs';
import { findDevices } from '../packs.mjs';
function packRootsOf(ctx) {
  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
}


/** CMSIS-SVD numbers are decimal or 0x-prefixed hexadecimal. */
function parseSvdNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  return typeof v === 'number' ? v : Number(String(v).trim());
}

const CORE_REGS = {
  'Cortex-M0': ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'SP', 'LR', 'PC', 'xPSR', 'PRIMASK', 'CONTROL'],
  'Cortex-M0+': ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'SP', 'LR', 'PC', 'xPSR', 'PRIMASK', 'CONTROL'],
  'Cortex-M3': ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'SP', 'LR', 'PC', 'xPSR', 'PRIMASK', 'FAULTMASK', 'BASEPRI', 'CONTROL'],
  'Cortex-M4': ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'SP', 'LR', 'PC', 'xPSR', 'PRIMASK', 'FAULTMASK', 'BASEPRI', 'CONTROL'],
  'Cortex-M7': ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'SP', 'LR', 'PC', 'xPSR', 'PRIMASK', 'FAULTMASK', 'BASEPRI', 'CONTROL'],
};

const GRP_CORE = 1, GRP_SYS = 2, GRP_PERI = 3;
const UNSIGNED = 0x10, HEX = 0x20;

/** Parse the CMSIS-SVD of a device (returns peripherals with registers and bitfields). */
export function readSvd(file) {
  const doc = parseXml(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const dev = childElem(doc, 'device');
  const cpuEl = childElem(dev, 'cpu');
  const coreName = (cpuEl && (cpuEl.attr('name') || textOf(cpuEl)) || '').trim();
  const peripherals = [];
  for (const p of childElems(childElem(dev, 'peripherals'), 'peripheral')) {
    const regs = [];
    for (const r of findAll(p, n => n.name === 'register')) {
      const fields = findAll(r, n => n.name === 'field').map(f => ({
        name: f.attr('name') || textOf(childElem(f, 'name')),
        bitOffset: parseSvdNumber(f.attr('bitOffset') ?? textOf(childElem(f, 'bitOffset')) ?? 0),
        bitWidth: parseSvdNumber(f.attr('bitWidth') ?? textOf(childElem(f, 'bitWidth')) ?? 1),
        description: (f.attr('description') || textOf(childElem(f, 'description')) || '').trim(),
      }));
      regs.push({
        name: r.attr('name') || textOf(childElem(r, 'name')),
        addressOffset: parseSvdNumber(r.attr('addressOffset') || textOf(childElem(r, 'addressOffset')) || '0'),
        size: parseSvdNumber(r.attr('size') || textOf(childElem(r, 'size')) || '32'),
        description: (r.attr('description') || textOf(childElem(r, 'description')) || '').trim(),
        fields,
      });
    }
    peripherals.push({
      name: p.attr('name') || textOf(childElem(p, 'name')),
      base: parseSvdNumber(p.attr('baseAddress') || textOf(childElem(p, 'baseAddress')) || '0'),
      description: (p.attr('description') || textOf(childElem(p, 'description')) || '').trim(),
      registers: regs,
    });
  }
  return { name: dev.attr('name') || (childElem(dev, 'name') && textOf(childElem(dev, 'name'))), core: coreName || null, peripherals };
}

export function svdToRdi(svd, cpu) {
  const lines = [];
  const core = CORE_REGS[cpu] || CORE_REGS['Cortex-M3'];
  let idx = 0;
  for (const r of core) lines.push(`R=${++idx},${r},32,${GRP_CORE},${UNSIGNED + HEX},Core register ${r}`);
  for (const p of svd.peripherals) {
    const addr = '0x' + p.base.toString(16).toUpperCase();
    lines.push(`R=${++idx},${p.name},32,${GRP_PERI},${UNSIGNED + HEX},${p.name} @ ${addr} ${p.description}`.trim());
    const regIdx = idx;
    const bitStart = idx + p.registers.length + 1;
    let bitIdx = bitStart;
    p.registers.forEach((r, i) => {
      const off = '0x' + r.addressOffset.toString(16).toUpperCase();
      const pos = `pos=${off} size=${r.size}`;
      lines.push(`R=${regIdx},${r.name},${r.size},${regIdx},${UNSIGNED + HEX},${p.name}.${r.name} (${pos}) ${r.description}`.slice(0, 200));
    });
    for (const r of p.registers) {
      for (const f of r.fields) {
        const mask = ((1 << f.bitWidth) - 1) << f.bitOffset;
        lines.push(`B=${bitIdx++},${f.name},${f.bitOffset},${f.bitWidth},${mask},${r.name} field: ${f.description}`.slice(0, 220));
      }
    }
    idx = bitIdx - 1;
  }
  return { text: lines.join('\r\n') + '\r\n', registers: idx };
}

export function registerGdbStubTools(ctx) {
  register(ctx, {
    name: 'debug_pack_generate',
    description: 'Generate a debugger-agnostic register/bitfield description from the device SVD in the installed pack: core registers plus every peripheral register and its fields (R= / B= RDI-style lines). This is the same register knowledge the µVision debugger loads from the .svd, exposed as text for gdb stubs, RDI packs, Python debuggers or documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        device: str('Device name (e.g. STM32F103C8)'),
        output: str('Optional output file'),
        maxPeripherals: int('Limit (default: all)'),
        peripherals: { type: 'array', items: { type: 'string' }, description: 'Only these peripheral names' },
      },
      required: ['device'],
    },
    handler: async (args) => {
      const devs = findDevices(packRootsOf(ctx), args.device, 20).filter(d => d.name.toLowerCase() === args.device.toLowerCase());
      const dev = devs[0];
      if (!dev) return { ok: false, error: `device not found: ${args.device}` };
      if (!dev.svd) return { ok: false, error: `device has no SVD in its pack: ${dev.name}` };
      const svdPath = path.join(path.dirname(dev.pack.pdsc), 'SVD', path.basename(dev.svd));
      if (!fs.existsSync(svdPath)) return { ok: false, error: `SVD file missing: ${svdPath}` };
      const svd = readSvd(svdPath);
      if (args.peripherals && args.peripherals.length) {
        const keep = new Set(args.peripherals.map(s => s.toUpperCase()));
        svd.peripherals = svd.peripherals.filter(p => keep.has(p.name.toUpperCase()));
      }
      if (args.maxPeripherals) svd.peripherals = svd.peripherals.slice(0, args.maxPeripherals);
      const coreName = svd.core || dev.core || (/STM32F10[0-5]/.test(dev.name) ? 'Cortex-M3' : 'Cortex-M3');
      const rdi = svdToRdi(svd, coreName);
      let saved = null;
      if (args.output) { saved = path.resolve(args.output); fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, rdi.text, 'latin1'); }
      return {
        ok: true, device: dev.name, core: coreName, svd: svdPath, saved,
        peripherals: svd.peripherals.length,
        registers: svd.peripherals.reduce((a, p) => a + p.registers.length, 0),
        fields: svd.peripherals.reduce((a, p) => a + p.registers.reduce((b, r) => b + r.fields.length, 0), 0),
        head: rdi.text.split(/\r?\n/).slice(0, 12).join('\n'),
      };
    },
  });

  register(ctx, {
    name: 'debug_peripheral_map',
    description: 'Structured peripheral memory map of a device (base address, register offsets, bitfields) derived from the pack SVD — for scripting a gdb stub or an external debugger.',
    inputSchema: { type: 'object', properties: { device: str('Device name'), peripheral: str('One peripheral'), maxRegisters: int('Per-register cap (default 64)') }, required: ['device'] },
    handler: async (args) => {
      const dev = findDevices(packRootsOf(ctx), args.device, 10).find(d => d.name.toLowerCase() === args.device.toLowerCase());
      if (!dev || !dev.svd) return { ok: false, error: `device/SVD not found: ${args.device}` };
      const svdPath = path.join(path.dirname(dev.pack.pdsc), 'SVD', path.basename(dev.svd));
      const svd = readSvd(svdPath);
      let peris = svd.peripherals;
      if (args.peripheral) peris = peris.filter(p => p.name.toLowerCase() === args.peripheral.toLowerCase());
      return {
        ok: true, device: svd.name || dev.name,
        peripherals: peris.map(p => ({
          name: p.name, base: '0x' + p.base.toString(16), description: p.description,
          registers: p.registers.slice(0, args.maxRegisters || 64).map(r => ({
            name: r.name, offset: '0x' + r.addressOffset.toString(16), address: '0x' + (p.base + r.addressOffset).toString(16), size: r.size,
            description: r.description,
            fields: r.fields.map(f => ({ name: f.name, bitOffset: f.bitOffset, bitWidth: f.bitWidth, description: f.description })),
          })),
        })),
      };
    },
  });
}
