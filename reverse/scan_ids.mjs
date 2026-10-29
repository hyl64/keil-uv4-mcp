// scan_ids.mjs — harvest every UVSC service-ID immediate: pattern push imm32; call rel32 (68 xx xx xx xx E8 xx xx xx xx).
import fs from 'node:fs';

const file = process.argv[2] || 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/UV4/UVSC.dll';
const buf = fs.readFileSync(file);
// parse PE
const peOff = buf.readUInt32LE(0x3c);
const nSec = buf.readUInt16LE(peOff + 6);
const optSize = buf.readUInt16LE(peOff + 20);
const imageBase = buf.readUInt32LE(peOff + 52);
const secOff = peOff + 24 + optSize;
const secs = [];
for (let i = 0; i < nSec; i++) {
  const o = secOff + i * 40;
  secs.push({
    name: buf.subarray(o, o + 8).toString('latin1').replace(/\0.*/, ''),
    vsize: buf.readUInt32LE(o + 8), va: buf.readUInt32LE(o + 12),
    rawSize: buf.readUInt32LE(o + 16), rawOff: buf.readUInt32LE(o + 20),
  });
}
const text = secs.find(s => s.name === '.text');
if (!text) throw new Error('no .text');
const known = new Set([0x1, 0xb, 0xc, 0x1000, 0x1006, 0x1007, 0x100b, 0x100d, 0x100e, 0x1015, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2009, 0x200b, 0x200c, 0x200f, 0x2010, 0x2013, 0x201f, 0x2025, 0x2031, 0x2034, 0x2102, 0x2106, 0x2108, 0x3000, 0x4000, 0x5000, 0x5001, 0x5005, 0x5017, 0x5018, 0x5019, 0x5021, 0x5022, 0x5023, 0x5060, 0x5061, 0x5062, 0x1001]);
const plausible = (id) => id >= 1 && id <= 0xffff && (id < 0x100 || (id >> 8) >= 0x10 && (id >> 8) <= 0x51 || id === 0xc || id === 0xb);
const hits = new Map();
const start = text.rawOff, end = start + text.rawSize - 10;
let ae90refs = 0;
for (let i = start; i < end; i++) {
  if (buf[i] !== 0x68) continue;
  const id = buf.readUInt32LE(i + 1);
  if (!plausible(id)) continue;
  // must be followed within 40 bytes by E8 call (the ae90 call)
  let k = i + 5, found = false;
  for (let g = 0; g < 40 && k < end; g++, k++) {
    if (buf[k] === 0xe8) { found = true; break; }
    if (buf[k] === 0xc3 || buf[k] === 0xc2) break;
  }
  if (!found) continue;
  const va = imageBase + text.va + (i - start);
  const key = id;
  if (!hits.has(key)) hits.set(key, []);
  hits.get(key).push(va);
}
const sorted = [...hits.entries()].sort((a, b) => a[0] - b[0]);
console.log('ID\tcount\tknown?\tfirst-VA');
for (const [id, addrs] of sorted) {
  console.log(`0x${id.toString(16)}\t${addrs.length}\t${known.has(id) ? 'Y' : 'new'}\t0x${addrs[0].toString(16)}`);
}
console.log(`total distinct ids: ${sorted.length}`);
