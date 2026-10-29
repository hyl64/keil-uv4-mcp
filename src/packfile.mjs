// packfile.mjs — CMSIS-Pack (.pack) = ZIP archive reader (no deps; zlib.inflateRaw).
//
// .pack layout (per DSP.168 & the PackUnzip strings in reverse/modules.md):
//   <vendor>.<name>.<version>.pack  containing the <vendor>.<name>.<version>.pdsc
//   plus directories. PackUnzip CLI (verified strings):
//     Usage: PackUnzip [-i] <InputPath> [-o <OutputPath>] [--no-gui|-l|-p|-v|-h|-?]
//       -l extract versioned license file | -p extract PDSC | -v verbose
//       --skip-check skip .PACK integrity check | --import copy into .Download and extract
//   PackInstaller.exe validates the SHA-256 checksum embedded in the pdsc
//   (<releases><release version=... tag=.../> + <hash> in web index).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

function u16(b, o) { return b.readUInt16LE(o); }
function u32(b, o) { return b.readUInt32LE(o); }

export function zipReadCentralDirectory(buf) {
  // locate EOCD
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (EOCD missing)');
  const count = u16(buf, eocd + 10);
  let off = u32(buf, eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (u32(buf, off) !== 0x02014b50) break;
    const method = u16(buf, off + 10);
    const crc = u32(buf, off + 16);
    const compSize = u32(buf, off + 20);
    const uncompSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOff = u32(buf, off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, crc, compSize, uncompSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function zipExtract(buf, entry) {
  const lo = entry.localOff;
  if (u32(buf, lo) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const nameLen = u16(buf, lo + 26);
  const extraLen = u16(buf, lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
}

/** Inspect a .pack: entries, pdsc location, per-entry CRC map (PackUnzip integrity equivalent). */
export function inspectPack(file) {
  const buf = fs.readFileSync(file);
  const entries = zipReadCentralDirectory(buf);
  const pdsc = entries.find(e => /\.pdsc$/i.test(e.name) && !e.name.includes('/'));
  const hashAlgo = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    file: path.resolve(file), bytes: buf.length, sha256: hashAlgo,
    entries: entries.length,
    directories: [...new Set(entries.map(e => e.name.split('/')[0]).filter(Boolean))].slice(0, 60),
    pdscEntry: pdsc ? pdsc.name : null,
    topFiles: entries.filter(e => !e.name.includes('/')).map(e => e.name).slice(0, 20),
    sample: entries.slice(0, 30).map(e => ({ name: e.name, size: e.uncompSize, method: e.method })),
  };
}

export function readPackEntryText(file, entryName, maxBytes = 8 * 1024 * 1024) {
  const buf = fs.readFileSync(file);
  const e = zipReadCentralDirectory(buf).find(x => x.name === entryName);
  if (!e) throw new Error(`entry not found: ${entryName}`);
  const data = zipExtract(buf, e);
  return data.subarray(0, maxBytes).toString('utf8');
}

/** Extract the whole pack to a directory (PackUnzip --no-gui equivalent). */
export function extractPack(file, outDir) {
  const buf = fs.readFileSync(file);
  const entries = zipReadCentralDirectory(buf);
  const written = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const dest = path.resolve(outDir, e.name);
    if (!dest.startsWith(path.resolve(outDir) + path.sep)) throw new Error(`zip-slip blocked: ${e.name}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zipExtract(buf, e));
    written.push(e.name);
  }
  return { outDir: path.resolve(outDir), files: written.length, names: written.slice(0, 50) };
}
