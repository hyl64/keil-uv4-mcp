// cdb.mjs — UV4.cdb legacy device database (via UVCDB2XML dump).
//
// UV4.cdb is the built-in device database (pre-CMSIS-Pack era, still authoritative
// for 'Generic' devices and legacy projects). UVCDB2XML.exe (in UV4 dir) is a console
// converter that prints the whole database as <uvcdb> XML on stdout (verified: no args,
// cwd=UV4 dir, exit 0, 4.55 MB / 2831 devices / 33 vendors, schema UVCDB2XML.xsd).
// Record: <vendor name="STMicroelectronics:13"><device name core family>
//   <startup>…</startup><system>…</system><includeFile>…</includeFile>
//   <includePath>…</includePath><description>multiline</description></device>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseXml, childElem, childElems, textOf } from './xml.mjs';

let cache = null; // { file, mtime, db }

function parseUvcdb(xmlText) {
  const doc = parseXml(xmlText);
  const root = childElem(doc, 'uvcdb');
  const vendors = [];
  const devices = new Map();
  for (const v of childElems(root, 'vendor')) {
    const vname = v.attr('name') || '';
    const [vendor, vendorId] = [vname.split(':')[0], vname.split(':')[1] || null];
    const list = [];
    for (const d of childElems(v, 'device')) {
      const dev = {
        name: d.attr('name'), core: d.attr('core') || null, family: d.attr('family') || null,
        vendor, vendorId: vendorId ? Number(vendorId) : null,
        startup: textOf(childElem(d, 'startup')) || null,
        system: textOf(childElem(d, 'system')) || null,
        includeFile: textOf(childElem(d, 'includeFile')) || null,
        includePath: textOf(childElem(d, 'includePath')) || null,
        description: (textOf(childElem(d, 'description')) || '').replace(/\s*\n\s*/g, ' ').trim(),
      };
      list.push(dev);
      devices.set(dev.name.toLowerCase(), dev);
    }
    vendors.push({ vendor, vendorId, deviceCount: list.length });
  }
  return { vendors, devices };
}

/** Ensure a dump exists (use bundled reverse/cdb/uv4_cdb.xml when present, else run UVCDB2XML). */
export async function ensureDump(uv4Dir, dumpPath) {
  if (fs.existsSync(dumpPath)) return dumpPath;
  const exe = path.join(uv4Dir, 'UVCDB2XML.exe');
  if (!fs.existsSync(exe)) throw new Error(`UVCDB2XML.exe not found in ${uv4Dir}`);
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  const out = fs.createWriteStream(dumpPath);
  await new Promise((resolve, reject) => {
    const c = spawn(exe, [], { cwd: uv4Dir, windowsHide: true });
    c.stdout.pipe(out);
    let err = '';
    c.stderr.on('data', d => err += d);
    c.on('error', reject);
    c.on('close', (code) => code === 0 ? resolve() : reject(new Error(`UVCDB2XML exit ${code}: ${err}`)));
    setTimeout(() => { try { c.kill(); } catch {} reject(new Error('UVCDB2XML timeout')); }, 120000);
  }).catch((e) => { try { out.close(); fs.unlinkSync(dumpPath); } catch {} ; throw e; });
  try { out.close(); } catch {}
  return dumpPath;
}

export async function loadCdb(uv4Dir, dumpPath) {
  const file = await ensureDump(uv4Dir, dumpPath);
  const st = fs.statSync(file);
  if (cache && cache.file === file && cache.mtime === st.mtimeMs) return cache.db;
  const db = parseUvcdb(fs.readFileSync(file, 'utf8'));
  cache = { file, mtime: st.mtimeMs, db };
  return db;
}

export async function cdbFind(uv4Dir, dumpPath, query, limit = 100) {
  const db = await loadCdb(uv4Dir, dumpPath);
  const q = String(query || '').toLowerCase();
  const hits = [];
  for (const dev of db.devices.values()) {
    if (!q || dev.name.toLowerCase().includes(q)) hits.push(dev);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function clearCdbCache() { cache = null; }
