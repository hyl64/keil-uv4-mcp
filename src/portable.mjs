// portable.mjs — resolve the data the server needs, from a real Keil install when
// available, otherwise from the bundled fixture tree (data/fixtures).
//
// Design: every consumer asks this module for a *resource*, never for an install path.
// A resource resolves to the first existing candidate:
//   1. inside the detected install (identical bytes to what Keil ships)
//   2. inside <pkg>/data/fixtures (the snapshot committed with this package)
// This is what makes the server runnable with no Keil installation at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_ROOT = path.join(PKG_ROOT, 'data', 'fixtures');

/** Sub-trees inside data/fixtures that mirror the UV4 install layout. */
export const FIXTURE_LAYOUT = {
  uv4: path.join(FIXTURE_ROOT, 'UV4'),          // *.prop.def, *.SVCS, *.xsd, pack-requirements.yml
  cdb: path.join(FIXTURE_ROOT, 'cdb'),          // uv4_cdb.xml (UVCDB2XML dump of UV4.cdb)
  packs: path.join(FIXTURE_ROOT, 'Packs'),      // <vendor>/<pack>/<version>/*.pdsc
  tools: path.join(FIXTURE_ROOT, 'tools'),      // toolchain metadata (versions, command templates)
  samples: path.join(FIXTURE_ROOT, 'samples'),  // projects + build artefacts for the test suite
  catalog: path.join(FIXTURE_ROOT, 'catalog'),  // module_catalog.json (companion-binary catalogue)
};

function firstExisting(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Resolve one named fixture file, preferring the live install.
 * @param {object} install result of discoverInstall()
 * @param {string} rel e.g. 'UV4/global.prop.def', 'cdb/uv4_cdb.xml', 'Packs/Keil/STM32F1xx_DFP/2.4.1/Keil.STM32F1xx_DFP.pdsc'
 */
export function resolveFixture(install, rel) {
  const norm = String(rel).replace(/\\/g, '/');
  const live = [];
  if (install && install.found) {
    if (norm.startsWith('UV4/')) live.push(path.join(install.uv4Dir, norm.slice(4)));
    else if (norm.startsWith('Packs/')) {
      for (const root of install.packRoots || []) live.push(path.join(root, norm.slice(6)));
    }
  }
  const fixture = path.join(FIXTURE_ROOT, norm);
  return firstExisting([...live, fixture]);
}

/**
 * The set of directories to search for .pdsc packs, live install first, fixtures last.
 * Consumers (packs.mjs) accept a plain array of roots, so this stays format-compatible.
 */
export function packRoots(install) {
  const roots = [];
  if (install && install.found) for (const r of install.packRoots || []) roots.push(r);
  if (fs.existsSync(FIXTURE_LAYOUT.packs)) roots.push(FIXTURE_LAYOUT.packs);
  return [...new Set(roots)];
}

/** UV4-side data directory (props, SVCS, XSD, version metadata). */
export function uv4DataDir(install) {
  if (install && install.found && fs.existsSync(install.uv4Dir)) return install.uv4Dir;
  return FIXTURE_LAYOUT.uv4;
}

/** Legacy device-database XML dump (bundled; regenerated with UVCDB2XML only when present). */
export function cdbDumpPath(install, override) {
  if (override) return path.resolve(override);
  return resolveFixture(install, 'cdb/uv4_cdb.xml') || path.join(FIXTURE_LAYOUT.cdb, 'uv4_cdb.xml');
}

/**
 * The reverse-engineered module catalogue (UV4.exe and 24 companion binaries).
 * Shipped inside the package (data/fixtures/catalog) so a copied directory works with
 * no checkout, and kept readable from a development tree (reverse/) for tooling that
 * regenerates it. Returns null when neither exists — callers degrade, they never crash.
 */
export function moduleCatalogPath() {
  return firstExisting([
    process.env.KEIL_MCP_MODULE_CATALOG,
    process.env.KEIL_MCP_REVERSE_DIR ? path.join(process.env.KEIL_MCP_REVERSE_DIR, 'module_catalog.json') : null,
    path.join(FIXTURE_LAYOUT.catalog, 'module_catalog.json'),
    path.join(PKG_ROOT, 'reverse', 'module_catalog.json'),
  ]);
}

/** Is a real toolchain available (needed by build/convert/tool_run/license)? */export function toolchainAvailable(install) {
  return !!(install && install.found && Array.isArray(install.toolsets) && install.toolsets.length > 0);
}

/** Structured diagnostic used by every tool that truly needs the installation. */
export function needsKeil(feature, install) {
  return {
    ok: false,
    needsKeil: true,
    feature,
    reason: 'This operation drives the real Keil toolchain, which is not installed on this machine.',
    portableMode: true,
    searched: (install && install.candidates) || [],
    remedy: [
      'Install Keil MDK (µVision) and re-run, or',
      'set KEIL_MDK_ROOT to an existing installation root (the folder containing TOOLS.INI and UV4\\UV4.exe), or',
      'use the portable tools for this task: project_read/project_validate/project_diff, dep_read/dep_graph/dep_impact/dep_write, pack_*/cdb_*, elf_info/map_info/hex_info/memory_usage, debug_pack_generate, batch_generate, import_xml_*, project_create*.',
    ],
    docs: 'README.zh-CN.md#独立运行portable-模式',
  };
}

/** A short manifest of what the fixture tree can answer without an install. */
export function fixtureManifest() {
  const count = (dir, re) => {
    try {
      let n = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (!re || re.test(e.name)) n++;
        }
      };
      walk(dir);
      return n;
    } catch { return 0; }
  };
  return {
    root: FIXTURE_ROOT,
    present: fs.existsSync(FIXTURE_ROOT),
    uv4Files: count(FIXTURE_LAYOUT.uv4),
    pdscFiles: count(FIXTURE_LAYOUT.packs, /\.pdsc$/i),
    samples: count(FIXTURE_LAYOUT.samples),
    cdbDump: fs.existsSync(path.join(FIXTURE_LAYOUT.cdb, 'uv4_cdb.xml')),
    moduleCatalog: fs.existsSync(path.join(FIXTURE_LAYOUT.catalog, 'module_catalog.json')),
  };
}
