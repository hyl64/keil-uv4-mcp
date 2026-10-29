// deps.mjs — dependency graph reproduction.
//
// Two on-disk formats are produced by uVision and reproduced here:
//  1. <Output>\<project>_<target>.dep  (project dependency database)
//     Header:  Dependencies for Project '<proj>', Target '<tgt>': (DO NOT MODIFY !)
//              CompilerVersion: <buildno>::<name>::<toolset path>
//     Records: F (.\src.c)(0xHASH)(<full tool command line, %s separators>)
//              I (<include file>)(0xHASH)
//     The hash column is UV4's per-file content stamp; we do not fabricate it —
//     imported .d files carry the compiler-side information instead.
//  2. <Output>\<name>.d  (per-file include list written by armcc/armasm --depend)
//     One line per dependency: "<obj>: <dep>\r\n"; UV4 separates the columns with
//     a single TAB + space ("<tab> ") that survives the compiler output.
// Keil's IDE marks out-of-date files from the F/I lists and the object timestamps,
// so a faithful dependency engine must record exactly the same include closure.
import fs from 'node:fs';
import { resolveWin } from './util.mjs';
import path from 'node:path';

export function depFilePath(projectFile, targetName, outputDir) {
  const dir = resolveWin(path.dirname(projectFile), outputDir || '.');
  const base = path.basename(projectFile, path.extname(projectFile));
  return { dir, file: path.join(dir, `${base}_${String(targetName).replace(/[\\/:*?"<>|]/g, '_')}.dep`) };
}

/**
 * AF: the (0x%08X) field is the file's clock time rendered as decimal HHMMSS and
 * printed in hex. Evidence: main.c last write 15:52:13 -> field 0x00155213,
 * startup.s 15:56:37 -> 0x00155637, stdint.h 13:10:21 -> 0x00131021.
 * Reading the same clock time as seconds/UNIX/FNV/CRC/MD5 does not reproduce the
 * values (see reverse/dep_stamp_evidence.json). The hour, minute and second numbers
 * are concatenated in base 10 - they are NOT base-16 digits.
 */
export function uv4TimeStamp(mtimeMs) {
  const d = new Date(mtimeMs);
  const hhmmss = ((d.getHours() * 100) + d.getMinutes()) * 100 + d.getSeconds();
  return hhmmss >>> 0;
}

/** Unix seconds view of the same instant (used for staleness comparisons in the graph). */
export function uv4Stamp(mtimeMs) {
  return Math.floor(mtimeMs / 1000) >>> 0;
}

/** Value as UV4 prints it: 0x + 8 hex digits of the decimal HHMMSS. */
export function uv4TimeStampHex(mtimeMs) {
  return '0x' + uv4TimeStamp(mtimeMs).toString(16).toUpperCase().padStart(8, '0');
}

/** Decimal rendering of the same clock time: ((h*100 + m)*100 + s) -> 0xHHMMSS. This is the layout UV4 stores. */
export function uv4DosStamp(mtimeMs) {
  const d = new Date(mtimeMs);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return (((date << 16) | uv4DosTime(mtimeMs)) >>> 0);
}

export function hashFile(file) {
  try { return uv4Stamp(fs.statSync(file).mtimeMs); } catch { return null; }
}

export function stampHex(v) {
  return '0x' + String(v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function parseDep(text) {
  const out = { project: null, target: null, compilerVersion: null, sources: [], includes: [], raw: text };
  // Records are CR-terminated and the F command column may contain CRs of its own
  // (UV4 writes a bare CR for every newline inside the command), so records are
  // split on the F(/I( at line starts and terminated by ")\r\n" or EOF.
  const src = text.replace(/\r\n/g, '\n');
  for (const line of src.split('\n')) {
    let m;
    if ((m = /^Dependencies for Project '([^']*)', Target '([^']*)'/.exec(line))) { out.project = m[1]; out.target = m[2]; continue; }
    if ((m = /^CompilerVersion:\s*(.+)$/.exec(line))) { out.compilerVersion = m[1]; continue; }
    if ((m = /^I \((.*?)\)\((0x[0-9A-Fa-f]+)\)$/.exec(line))) { out.includes.push({ path: m[1], hash: m[2] }); continue; }
  }
  const fRe = /F \(([^)]*)\)\((0x[0-9A-Fa-f]+)\)\(([\s\S]*?)\)(?=\r?\n[FI] \(|\r?\n*$)/g;
  let fm;
  while ((fm = fRe.exec(text))) out.sources.push({ path: fm[1], hash: fm[2], cmd: fm[3].replace(/\r\r/g, '\r') });
  return out;
}

export function parseCompilerDep(text) {
  const pairs = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.*):\s?(\S.*)$/.exec(line);
    if (!m) continue;
    pairs.push({ target: m[1].trim(), dependency: m[2].trim() });
  }
  return pairs;
}

/** Build a file->dependencies map from compiler .d files plus the project .dep include list. */
export function buildGraph(projectDir, fileEntries, options = {}) {
  const nodes = new Map();
  const add = (p) => {
    const abs = resolveWin(projectDir, p);
    if (!nodes.has(abs)) { let st = null; try { st = fs.statSync(abs); } catch {} nodes.set(abs, { path: abs, hash: st ? uv4Stamp(st.mtimeMs) : null, mtimeMs: st ? st.mtimeMs : null, size: st ? st.size : null, exists: !!st, deps: new Set(), usedBy: new Set() }); }
    return nodes.get(abs);
  };
  const resolved = fileEntries.map(f => {
    const obj = typeof f === 'string' ? { file: f } : f;
    if (!obj || !obj.file) return null;
    const file = resolveWin(projectDir, obj.file);
    let depFile = obj.depFile;
    if (depFile && !path.isAbsolute(depFile)) depFile = resolveWin(projectDir, depFile);
    return { file, depFile: depFile || null };
  }).filter(Boolean);
  for (const f of resolved) {
    const n = add(f.file);
    if (f.depFile && fs.existsSync(f.depFile)) {
      const pairs = parseCompilerDep(fs.readFileSync(f.depFile, 'utf8'));
      for (const p of pairs) {
        const dn = add(p.dependency);
        n.deps.add(dn.path);
        dn.usedBy.add(n.path);
      }
    }
  }
  const graph = { projectDir, nodes: [...nodes.values()].map(n => ({ ...n, deps: [...n.deps], usedBy: [...n.usedBy] })) };
  graph.stats = {
    files: graph.nodes.length,
    existing: graph.nodes.filter(n => n.exists).length,
    missing: graph.nodes.filter(n => !n.exists).map(n => n.path),
    edges: graph.nodes.reduce((a, n) => a + n.deps.length, 0),
  };
  return graph;
}

/** Impact analysis: given changed files, walk the reverse edges to find affected translation units. */
export function impacted(graph, changedFiles, roots) {
  const byPath = new Map(graph.nodes.map(n => [n.path.toLowerCase(), n]));
  const seeds = changedFiles.map(p => {
    const abs = resolveWin(graph.projectDir, p);
    return byPath.get(abs.toLowerCase()) || null;
  }).filter(Boolean);
  const affected = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const n = queue.pop();
    for (const u of n.usedBy) {
      if (affected.has(u)) continue;
      affected.add(u);
      const nn = byPath.get(u.toLowerCase());
      if (nn) queue.push(nn);
    }
  }
  const rootSet = new Set((roots || []).map(r => (path.isAbsolute(r) ? path.normalize(r) : path.resolve(graph.projectDir, r)).toLowerCase()));
  const needCompile = [...affected].filter(p => rootSet.has(p.toLowerCase()));
  const unknownChanged = changedFiles.filter((p) => {
    const abs = resolveWin(graph.projectDir, p);
    return !byPath.has(abs.toLowerCase());
  });
  return { seeds: seeds.map(s => s.path), affected: [...affected], needCompile, unknownChanged };
}

/** XCLANG-style preprocessor scan: collect the include closure of one C file without a toolchain. */
export function scanIncludes(file, includeDirs, defines = [], maxDepth = 40) {
  const seen = new Map();
  const order = [];
  let missing = [];
  const stack = [{ file: path.resolve(file), depth: 0 }];
  const incRe = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/;
  while (stack.length) {
    const { file: cur, depth } = stack.pop();
    const key = cur.toLowerCase();
    if (seen.has(key)) continue;
    let text;
    try { text = fs.readFileSync(cur, 'utf8'); } catch { missing.push(cur); continue; }
    seen.set(key, cur);
    order.push(cur);
    if (depth >= maxDepth) continue;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = incRe.exec(line);
      if (!m) continue;
      const inc = m[1];
      const resolved = resolveInclude(inc, path.dirname(cur), includeDirs);
      if (resolved) stack.push({ file: resolved, depth: depth + 1 });
      else missing.push(inc);
    }
  }
  return { file: path.resolve(file), includes: order, missing: [...new Set(missing)] };
}

function resolveInclude(inc, fromDir, dirs) {
  const cands = [resolveWin(fromDir, inc), ...dirs.map(d => resolveWin(d, inc))];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}

/** Macros visible to the preprocessor: the target's C defines (defined as <name> (=value)). */
export function parseDefines(definesString) {
  const list = [];
  for (const part of String(definesString || '').split(/[\s,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(t);
    if (m) list.push({ name: m[1], value: m[2] === undefined ? '1' : m[2] });
  }
  return list;
}











