// image.mjs — ELF (.axf) and Intel HEX analysis without external tools.
import fs from 'node:fs';
import { parseIntelHex } from './util.mjs';

const SHT = { SHT_NULL: 0, SHT_PROGBITS: 1, SHT_SYMTAB: 2, SHT_STRTAB: 3, SHT_RELA: 4, SHT_HASH: 5, SHT_DYNAMIC: 6, SHT_NOTE: 7, SHT_NOBITS: 8, SHT_REL: 9 };
const STT = ['NOTYPE', 'OBJECT', 'FUNC', 'SECTION', 'FILE', 'COMMON', 'TLS'];
const STB = ['LOCAL', 'GLOBAL', 'WEAK'];

export function readElf(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 52 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    return { ok: false, error: 'not an ELF image' };
  }
  const is64 = buf[4] === 2;
  const le = buf[5] === 1;
  const rd = (off, size) => {
    if (off + size > buf.length) return 0;
    if (size === 2) return le ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
    if (size === 4) return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
    if (size === 8) return Number(le ? buf.readBigUInt64LE(off) : buf.readBigUInt64BE(off));
    return 0;
  };
  const etype = rd(16, 2);
  const machine = rd(18, 2);
  const entry = is64 ? rd(24, 8) : rd(24, 4);
  const shoff = is64 ? rd(40, 8) : rd(32, 4);
  const shentsize = rd(is64 ? 58 : 46, 2);
  const shnum = rd(is64 ? 60 : 48, 2);
  const shstrndx = rd(is64 ? 62 : 50, 2);
  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    const sh = is64 ? {
      name: rd(o, 4), type: rd(o + 4, 4), flags: rd(o + 8, 8), addr: rd(o + 16, 8), offset: rd(o + 24, 8),
      size: rd(o + 32, 8), link: rd(o + 40, 4), info: rd(o + 44, 4), addralign: rd(o + 48, 8), entsize: rd(o + 56, 8),
    } : {
      name: rd(o, 4), type: rd(o + 4, 4), flags: rd(o + 8, 4), addr: rd(o + 12, 4), offset: rd(o + 16, 4),
      size: rd(o + 20, 4), link: rd(o + 24, 4), info: rd(o + 28, 4), addralign: rd(o + 32, 4), entsize: rd(o + 36, 4),
    };
    sections.push(sh);
  }
  const shstr = sections[shstrndx];
  const nameOf = (idx) => {
    if (!shstr) return '';
    let start = shstr.offset + idx;
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.subarray(start, end).toString('latin1');
  };
  for (const s of sections) s.nameStr = nameOf(s.name);
  const symtab = sections.find(s => s.type === SHT.SHT_SYMTAB);
  const syms = [];
  if (symtab && symtab.entsize) {
    const strtab = sections[symtab.link];
    const strAt = (idx) => {
      if (!strtab) return '';
      let start = strtab.offset + idx; let end = start;
      while (end < buf.length && buf[end] !== 0) end++;
      return buf.subarray(start, end).toString('latin1');
    };
    const count = Math.floor(symtab.size / symtab.entsize);
    for (let i = 0; i < count; i++) {
      const o = symtab.offset + i * symtab.entsize;
      if (is64) {
        const nameIdx = rd(o, 4); const info = buf[o + 4]; const other = buf[o + 5]; const shndx = rd(o + 6, 2);
        const value = rd(o + 8, 8); const size = rd(o + 16, 8);
        syms.push({ name: strAt(nameIdx), value, size, info, type: STT[info & 0xf] || String(info & 0xf), bind: STB[info >> 4] || String(info >> 4), shndx, other });
      } else {
        const nameIdx = rd(o, 4); const value = rd(o + 4, 4); const size = rd(o + 8, 4); const info = buf[o + 12]; const other = buf[o + 13]; const shndx = rd(o + 14, 2);
        syms.push({ name: strAt(nameIdx), value, size, info, type: STT[info & 0xf] || String(info & 0xf), bind: STB[info >> 4] || String(info >> 4), shndx, other });
      }
    }
  }
  const mem = [];
  for (const s of sections) {
    if (s.type !== SHT.SHT_PROGBITS || !s.addr || s.flags === 0) continue;
    const kind = (s.flags & 0x4) ? (s.flags & 0x2 ? 'text' : 'rodata') : (s.flags & 0x2 ? 'data' : 'other');
    mem.push({ name: s.nameStr, address: s.addr, size: s.size, kind, offset: s.offset });
  }
  return {
    ok: true,
    format: is64 ? 'ELF64' : 'ELF32', littleEndian: le, type: etype === 2 ? 'EXEC' : etype === 1 ? 'REL' : `type(${etype})`,
    machine, entry: '0x' + entry.toString(16), sections: sections.map(s => ({ name: s.nameStr, type: s.type, addr: s.addr, size: s.size, flags: s.flags })),
    symbols: syms, segments: mem,
    stats: {
      functions: syms.filter(s => s.type === 'FUNC' && s.bind === 'GLOBAL' && s.value).length,
      objects: syms.filter(s => s.type === 'OBJECT' && s.bind === 'GLOBAL' && s.value).length,
      codeBytes: mem.filter(m => m.kind === 'text').reduce((a, m) => a + m.size, 0),
      dataBytes: mem.filter(m => m.kind === 'data').reduce((a, m) => a + m.size, 0),
    },
  };
}

/** Parse the linker MAP file µVision writes (-list file). */
export function readMap(file) {
  if (!fs.existsSync(file)) return { ok: false, error: `map not found: ${file}` };
  const text = fs.readFileSync(file, 'latin1');
  const out = { ok: true, path: file, imageTotals: null, memoryMap: [], symbols: [], components: [], sectionSizes: [], callGraph: [] };
  const reTotals = /Total RO\s+Size\s+\(Code \+ RO Data\)\s+(\d+)\s+\(([^)]+)\)/i.exec(text);
  const reROData = /Total RO Data Size\s+(\d+)\s+\(([^)]+)\)/i.exec(text);
  const reRWData = /Total RW\s+Size\s+\(RW Data \+ ZI Data\)\s+(\d+)\s+\(([^)]+)\)/i.exec(text);
  const reROM = /Total ROM Size\s+\(Code \+ RO Data \+ RW Data\)\s+(\d+)\s+\(([^)]+)\)/i.exec(text);
  out.imageTotals = {
    ro: reTotals ? { bytes: Number(reTotals[1]), text: reTotals[2] } : null,
    roData: reROData ? { bytes: Number(reROData[1]), text: reROData[2] } : null,
    rw: reRWData ? { bytes: Number(reRWData[1]), text: reRWData[2] } : null,
    rom: reROM ? { bytes: Number(reROM[1]), text: reROM[2] } : null,
  };
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = /^\s*(Execution Region \S+)\s+\(Exec base at (0x[0-9a-fA-F]+), load base (0x[0-9a-fA-F]+)?.*\)/.exec(line))) {
      out.memoryMap.push({ region: m[1], execBase: m[2], loadBase: m[3] || m[2] });
    } else if ((m = /^\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(\d+)\s+\.(text|rodata|data|bss)\s+(\S+)/.exec(line))) {
      out.sectionSizes.push({ address: m[1], size: m[2], bytes: Number(m[3]), section: '.' + m[4], object: m[5] });
    }
  }
  const symStart = text.indexOf('Global Symbols');
  if (symStart >= 0) {
    const seg = text.slice(symStart, symStart + 400000);
    for (const line of seg.split(/\r?\n/)) {
      const m = /^\s+(\S+)\s+0x([0-9a-fA-F]{8})\s+(\w+)\s+(\S+)\s+(\S+)/.exec(line);
      if (m && /^\d+$/.test(m[3]) === false) out.symbols.push({ name: m[1], address: '0x' + m[2], type: m[3], section: m[4], object: m[5] });
      if (out.symbols.length > 20000) break;
    }
  }
  return out;
}

export function analyzeHex(file) {
  if (!fs.existsSync(file)) return { ok: false, error: `hex not found: ${file}` };
  const text = fs.readFileSync(file, 'utf8');
  const r = parseIntelHex(text);
  return { ok: true, path: file, ...r, lines: text.split(/\r?\n/).length };
}

/** Compare an ELF image's used ranges against the target's memory map. */
export function memoryUsage(elf, target) {
  const usage = [];
  const rom = [target.irom, target.iromSize];
  const ram = [target.iram, target.iramSize];
  const parse = (v) => (typeof v === 'string' ? parseInt(v, 16) : Number(v) || 0);
  const romStart = parse(target.misc && target.misc.memory && target.misc.memory.IROM && target.misc.memory.IROM.start || /IROM\((0x[0-9a-fA-F]+)/.exec(target.cpu || '')?.[1] || 0);
  const romSize = parse(target.misc && target.misc.memory && target.misc.memory.IROM && target.misc.memory.IROM.size || /IROM\([^,]+,\s*(0x[0-9a-fA-F]+)\)/.exec(target.cpu || '')?.[1] || 0);
  const ramStart = parse(target.misc && target.misc.memory && target.misc.memory.IRAM && target.misc.memory.IRAM.start || /IRAM\((0x[0-9a-fA-F]+)/.exec(target.cpu || '')?.[1] || 0);
  const ramSize = parse(target.misc && target.misc.memory && target.misc.memory.IRAM && target.misc.memory.IRAM.size || /IRAM\([^,]+,\s*(0x[0-9a-fA-F]+)\)/.exec(target.cpu || '')?.[1] || 0);
  for (const s of elf.segments) {
    if (s.address >= romStart && s.address < romStart + romSize) usage.push({ kind: 'flash', name: s.name, address: s.address, size: s.size, fill: romSize ? s.size / romSize : null });
    else if (s.address >= ramStart && s.address < ramStart + ramSize) usage.push({ kind: 'ram', name: s.name, address: s.address, size: s.size, fill: ramSize ? s.size / ramSize : null });
  }
  return { regions: [rom, ram], usage, rom: { start: romStart, size: romSize, used: usage.filter(u => u.kind === 'flash').reduce((a, u) => a + u.size, 0) }, ram: { start: ramStart, size: ramSize, used: usage.filter(u => u.kind === 'ram').reduce((a, u) => a + u.size, 0) } };
}
