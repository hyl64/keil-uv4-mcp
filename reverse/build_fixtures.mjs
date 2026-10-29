// build_fixtures.mjs — snapshot the Keil data this server needs into data/fixtures,
// so the package runs with no installation. Only *declaration* files are copied
// (pdsc/prop/xsd/svcs/yml) — never the hundreds of MB of pack sources/headers.
import fs from 'node:fs';
import path from 'node:path';

const UV4 = process.env.KEIL_UV4_DIR || 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/UV4';
const PACKS = process.env.KEIL_PACK_ROOT || 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs';
const OUT = path.resolve('data/fixtures');

const dirs = {
  uv4: path.join(OUT, 'UV4'),
  cdb: path.join(OUT, 'cdb'),
  packs: path.join(OUT, 'Packs'),
  samples: path.join(OUT, 'samples'),
  tools: path.join(OUT, 'tools'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const copied = [];
function copyFile(src, dstDir) {
  const name = path.basename(src);
  const dst = path.join(dstDir, name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied.push({ to: path.relative(OUT, dst).replace(/\\/g, '/'), bytes: fs.statSync(dst).size });
}

// 1) UV4 configuration / schema / VCS menu files
let uvCount = 0;
for (const name of fs.readdirSync(UV4)) {
  if (/\.(prop|def|SVCS|xsd|yml)$/i.test(name)) {
    copyFile(path.join(UV4, name), dirs.uv4);
    uvCount++;
  }
}

// 2) device declaration files only (*.pdsc), keeping <vendor>/<pack>/<version> layout
let pdscCount = 0;
function walkPacks(root, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === '.Web' || e.name === '.Download' || e.name === '.WebIndex') continue;
      walkPacks(p, depth + 1);
    } else if (/\.pdsc$/i.test(e.name)) {
      const rel = path.relative(PACKS, p);
      const dst = path.join(dirs.packs, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(p, dst);
      pdscCount++;
    }
  }
}
walkPacks(PACKS);

// 3) legacy cdb XML dump (already produced by UVCDB2XML in reverse/cdb)
const cdbSrc = path.resolve('reverse/cdb/uv4_cdb.xml');
if (fs.existsSync(cdbSrc)) {
  fs.copyFileSync(cdbSrc, path.join(dirs.cdb, 'uv4_cdb.xml'));
  copied.push({ to: 'cdb/uv4_cdb.xml', bytes: fs.statSync(path.join(dirs.cdb, 'uv4_cdb.xml')).size });
}

// 4) toolchain metadata (recorded facts; no binaries shipped)
const toolchainMeta = {
  generated: new Date().toISOString(),
  source: 'recorded from a real MDK 5.43a installation by reverse/toolchain_snapshot',
  uvisionVersion: '5.43a',
  buildNumber: '543',
  toolVariant: 'mdk_lite',
  toolsets: [
    { id: 0, name: 'ARMCLANG', display: 'Arm Compiler 6', version: 'V6.24', binDir: 'ARM/ARMCLANG/bin', tools: ['armclang', 'armlink', 'fromelf', 'armar', 'armasm'] },
    { id: 1, name: 'ARMCC', display: 'Arm Compiler 5', version: 'V5.06 update 6 (build 750)', binDir: 'ARM/ARMCC/bin', tools: ['armcc', 'armasm', 'armlink', 'fromelf', 'armar'] },
  ],
  toolCommands: {
    armcc: ['-c', '--cpu', '--apcs', '-I', '-D', '-o', '--depend', '--list'],
    armasm: ['-g', '--cpu', '--pd', '-I', '-o', '--list'],
    armlink: ['--cpu', '--scatter', '--map', '--info', '--list', '-o', '--via'],
    fromelf: ['--i32combined', '--text', '-o'],
    armclang: ['-c', '--target', '-I', '-D', '-o', '-MD'],
  },
  packRootsExample: '%LOCALAPPDATA%/Arm/Packs',
  licensedFeatures: ['MDK-ARM (build gate error #601 when absent)'],
};
fs.writeFileSync(path.join(dirs.tools, 'toolchain.json'), JSON.stringify(toolchainMeta, null, 2) + '\n');
copied.push({ to: 'tools/toolchain.json', bytes: fs.statSync(path.join(dirs.tools, 'toolchain.json')).size });

// 5) sample projects + build artefacts (kept small: skip object/intermediate files)
const sampleSrc = path.resolve('reverse/samples');
const dropAlways = /\.(o|d|crf|lst|htm|build_log|lnp|sct|axf)$/i;
function copySamples() {
  const walk = (src, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(src, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (e.name === 'Listings') continue;
        walk(p, r);
        continue;
      }
      if (dropAlways.test(e.name)) continue;
      const size = fs.statSync(p).size;
      // keep sources/projects/deps/batch always; keep .map/.hex only when small (test fixtures)
      const core = /\.(uvprojx|uvproj|uvoptx|uvmpw|uvguix|dep|c|h|s|S|BAT|__i|_ia|i|txt|yml|rdi)$/i.test(e.name);
      const artefact = /\.(map|hex)$/i.test(e.name) && size < 200 * 1024;
      if (!core && !artefact) continue;
      const dst = path.join(dirs.samples, r);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(p, dst);
      copied.push({ to: path.relative(OUT, dst).replace(/\\/g, '/'), bytes: size });
    }
  };
  walk(sampleSrc, '');
}
copySamples();

const totalBytes = copied.reduce((a, c) => a + c.bytes, 0);
console.log(JSON.stringify({
  out: OUT,
  uv4ConfigFiles: uvCount,
  pdscFiles: pdscCount,
  sampleFiles: copied.filter(c => c.to.startsWith('samples/')).length,
  totalFiles: copied.length,
  totalMB: +(totalBytes / 1048576).toFixed(2),
}, null, 2));
