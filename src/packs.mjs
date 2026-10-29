// packs.mjs — CMSIS-Pack (.pdsc) device / component database.
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, childElem, childElems, textOf, findAll } from './xml.mjs';

const cache = new Map();

function isDirEntry(e) { try { return e.isDirectory(); } catch { return false; } }
function isFileEntry(e) { try { return e.isFile(); } catch { return false; } }

/** Walk <root>/<vendor>/<pack>/<version>/<*.pdsc>, plus flat layouts. */
export function discoverPacks(roots = []) {
  const packs = [];
  for (const root of roots) {
    let vendors = [];
    try { vendors = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const v of vendors) {
      const vname = String(v.name);
      if (!isDirEntry(v) || vname.startsWith('.')) continue;
      const vdir = path.join(root, vname);
      let level2 = [];
      try { level2 = fs.readdirSync(vdir, { withFileTypes: true }); } catch { continue; }
      for (const p of level2) {
        const pname = String(p.name);
        if (!isDirEntry(p)) continue;
        const pdir = path.join(vdir, pname);
        let level3 = [];
        try { level3 = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
        for (const x of level3) {
          const xname = String(x.name);
          if (isDirEntry(x)) {
            const vdir2 = path.join(pdir, xname);
            let files = [];
            try { files = fs.readdirSync(vdir2, { withFileTypes: true }); } catch { continue; }
            for (const f of files) {
              const fn = String(f.name);
              if (!isFileEntry(f) || !/\.pdsc$/i.test(fn)) continue;
              packs.push({ root, vendor: vname, name: pname, version: xname, dir: vdir2, pdsc: path.join(vdir2, fn) });
            }
          } else if (isFileEntry(x) && /\.pdsc$/i.test(xname)) {
            packs.push({ root, vendor: vname, name: xname.replace(/\.pdsc$/i, ''), version: pname, dir: pdir, pdsc: path.join(pdir, xname) });
          }
        }
      }
    }
  }
  return packs;
}

export function readPack(pdscPath) {
  const st = fs.statSync(pdscPath);
  const hit = cache.get(pdscPath);
  if (hit && hit.mtime === st.mtimeMs) return hit.db;
  const raw = fs.readFileSync(pdscPath, 'utf8').replace(/^\uFEFF/, '');
  const doc = parseXml(raw);
  const pkgEl = childElem(doc, 'package');
  const db = {
    path: pdscPath,
    vendor: pkgEl ? (pkgEl.attr('vendor') || textOf(childElem(pkgEl, 'vendor'))) : null,
    name: pkgEl ? (pkgEl.attr('name') || textOf(childElem(pkgEl, 'name'))) : null,
    description: pkgEl ? String(textOf(childElem(pkgEl, 'description')) || '').trim() : null,
    url: pkgEl ? textOf(childElem(pkgEl, 'url')) : null,
    devices: [],
    components: [],
    conditions: [],
  };

  const devicesEl = childElem(pkgEl, 'devices');
  if (devicesEl) {
    for (const fam of childElems(devicesEl, 'family')) {
      const fctx = { vendor: fam.attr('Dvendor') || db.vendor, family: fam.attr('Dfamily') };
      for (const dev of childElems(fam, 'device')) db.devices.push(deviceFrom(dev, fctx));
      for (const sub of childElems(fam, 'subFamily')) {
        const sctx = { ...fctx, subFamily: sub.attr('DsubFamily') };
        for (const dev of childElems(sub, 'device')) db.devices.push(deviceFrom(dev, sctx));
      }
    }
    for (const dev of childElems(devicesEl, 'device')) db.devices.push(deviceFrom(dev, { vendor: db.vendor }));
  }

  const compsEl = childElem(pkgEl, 'components');
  if (compsEl) collectComponents(compsEl, db.components, {});

  const condEl = childElem(pkgEl, 'conditions');
  if (condEl) for (const c of childElems(condEl, 'condition')) {
    db.conditions.push({
      id: c.attr('id'),
      requires: childElems(c, 'require').map(r => ({ device: r.attr('Ddevice'), vendor: r.attr('Dvendor'), processor: r.attr('Pname'), condition: r.attr('condition') })),
    });
  }

  cache.set(pdscPath, { mtime: st.mtimeMs, db });
  return db;
}

const LEAF_MARKERS = new Set(['files', 'description', 'RTE_components_h', 'api']);

/**
 * Flatten the PACK.xsd component tree into one row per selectable unit.
 * <components> holds a flat list of <component>; each row may carry Cclass,
 * Cgroup, Csub, Cvariant and is either a leaf (files/description) or a parent
 * whose <component> children inherit the outer attributes.
 */
function collectComponents(node, out, ctx) {
  const kids = childElems(node, 'component');
  const isLeaf = node.name !== 'components' && !kids.length;
  const a = node.attrs || {};
  const next = {
    cls: a.Cclass || ctx.cls || null,
    group: a.Cgroup || ctx.group || null,
    sub: a.Csub !== undefined ? a.Csub : (ctx.sub || null),
    variant: a.Cvariant || null,
    version: a.Cversion || null,
    vendor: a.Cvendor || ctx.vendor || null,
    bundle: a.Cbundle || ctx.bundle || null,
    condition: a.condition || null,
  };
  if (node.name === 'components') {
    for (const k of kids) collectComponents(k, out, {});
    return;
  }
  if (kids.length && !node.children.some(c => c.type === 'elem' && LEAF_MARKERS.has(c.name))) {
    for (const k of kids) collectComponents(k, out, next);
    return;
  }
  out.push({ ...next, files: findAll(node, n => n.name === 'file').length });
}

function deviceFrom(dev, ctx) {
  const proc = childElem(dev, 'processor');
  const compile = childElem(dev, 'compile');
  const debug = childElem(dev, 'debug');
  const mem = childElems(dev, 'memory').map(m => ({
    id: m.attr('id'), start: m.attr('start'), size: m.attr('size'),
    startup: m.attr('startup') === '1', default: m.attr('default') === '1', init: m.attr('init') !== '0',
  }));
  const algos = childElems(dev, 'algorithm').map(a => ({ name: a.attr('name'), start: a.attr('start'), size: a.attr('size'), default: a.attr('default') === '1' }));
  return {
    name: String(dev.attr('Dname') || '').replace(/^[^:]*::/, ''),
    vendor: String(dev.attr('Dvendor') || ctx.vendor || '').replace(/^.*::/, ''),
    vendorId: dev.attr('Dvendor') || ctx.vendor || null,
    family: ctx.family || dev.attr('Dfamily') || null,
    subFamily: ctx.subFamily || null,
    core: dev.attr('Dcore') || (proc && proc.attr('Dcore')) || null,
    clock: null, // µVision stores CLOCK(12000000) in Cpu; the DFP clock is only a UI hint
    fpu: proc ? proc.attr('Dfpu') : null,
    mpu: proc ? proc.attr('Dmpu') : null,
    endian: proc ? proc.attr('Dendian') : null,
    memory: mem,
    define: compile ? compile.attr('define') : null,
    header: compile ? compile.attr('header') : null,
    svd: debug ? debug.attr('svd') : null,
    flashAlgorithm: algos.find(a => a.default) || algos[0] || null,
    flashAlgorithms: algos,
  };
}

export function listPackCatalog(packRoots) {
  return discoverPacks(packRoots).map(p => {
    let db = null;
    try { db = readPack(p.pdsc); } catch { db = null; }
    return {
      vendor: p.vendor, name: p.name, version: p.version, dir: p.dir, pdsc: p.pdsc,
      description: db && db.description ? db.description.slice(0, 160) : null,
      devices: db ? db.devices.length : null,
      components: db ? db.components.length : null,
      parseError: db ? null : 'pdsc parse failed',
    };
  });
}

export function findDevices(packRoots, query, limit = 200) {
  const q = String(query || '').toLowerCase();
  const out = [];
  const seen = new Set();
  for (const p of discoverPacks(packRoots)) {
    let db;
    try { db = readPack(p.pdsc); } catch { continue; }
    for (const d of db.devices) {
      if (q && !d.name.toLowerCase().includes(q)) continue;
      const key = d.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...d, pack: { vendor: p.vendor, name: p.name, version: p.version, pdsc: p.pdsc } });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function findComponents(packRoots, query, limit = 400) {
  const q = String(query || '').toLowerCase();
  const out = [];
  for (const p of discoverPacks(packRoots)) {
    let db;
    try { db = readPack(p.pdsc); } catch { continue; }
    for (const c of db.components) {
      const label = [c.cls, c.group, c.sub, c.variant].filter(Boolean).join(':');
      if (q && !label.toLowerCase().includes(q)) continue;
      out.push({ ...c, pack: { vendor: p.vendor, name: p.name, version: p.version } });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function deviceToTargetOptions(device) {
  const irom = device.memory.find(m => /^I?ROM/i.test(m.id || '') && !m.init) || device.memory.find(m => /ROM/i.test(m.id || ''));
  const iram = device.memory.find(m => /RAM/i.test(m.id || '') && m.init) || device.memory.find(m => /RAM/i.test(m.id || ''));
  const core = device.core || 'Cortex-M3';
  const cpu = [
    iram ? `IRAM(${iram.start},${iram.size})` : 'IRAM(0x20000000,0x0)',
    irom ? `IROM(${irom.start},${irom.size})` : 'IROM(0x0,0x0)',
    `CPUTYPE("${core}")`,
    device.clock && String(device.clock).trim() !== '' && String(device.clock) !== '0' ? `CLOCK(${device.clock})` : 'CLOCK(12000000)',
    device.endian && /big/i.test(device.endian) ? 'EBIG' : 'ELITTLE',
  ].filter(Boolean).join(' ');
  const algo = device.flashAlgorithm;
  // UV4's own rendering (verified against a UV4-migrated project):
  //   -FS0 + 7 hex digits of the start address, -FL0 + 6 hex digits of the size,
  //   Windows separators in the algorithm path and the SVD / register header paths.
  const algoWin = algo ? String(algo.name).replace(/\//g, '\\') : '';
  const winPath = (v) => String(v || '').replace(/\//g, '\\');
  const flashDriver = algo
    ? `UL2CM3(-S0 -C0 -P0 -FD20000000 -FC1000 -FN1 -FF0${path.basename(algoWin).replace(/\.(FLM|flm)$/, '')} -FS${uv4Hex(algo.start)} -FL${uv4Hex(algo.size).slice(2)} -FP0($$Device:${device.name}$${algoWin}))`
    : '';
  return {
    cpu, core,
    irom: (irom && irom.start) || '0x0', iromSize: (irom && irom.size) || '0x0',
    iram: (iram && iram.start) || '0x20000000', iramSize: (iram && iram.size) || '0x0',
    flashDriver,
    // UV4 stamps absolute import timestamps into these paths (HHMMSS of the import);
    // the time makes the document non-deterministic, so the stable substitute is the
    // documented element value with time 000000. UV4 resolves $$Device from the PackID
    // and rewrites the field on the next save either way.
    importStamp: importTimestamp(),
    svd: device.svd ? `$$Device:${device.name}$SVD\\${winPath(path.basename(device.svd))}` : '',
    registerFile: device.header ? `$$Device:${device.name}$Device\\Include\\${winPath(path.basename(device.header))}` : '',
    define: device.define || '',
  };
}

/** Current local time as UV4's import timestamp HHMMSS. */
export function importTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** UV4 renders fixed 8-digit hex without the 0x prefix: 0x08000000 -> 08000000. */
function uv4Hex(v) {
  const s = String(v || '0x0').replace(/^0x/i, '');
  return s.padStart(8, '0');
}

export function clearPackCache() { cache.clear(); }





