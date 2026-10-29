// tools/deps.mjs — dependency database and incremental analysis tools.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool, arr } from './common.mjs';
import { resolveWin } from '../util.mjs';
import { Project, findProjectFile } from '../project.mjs';
import {
  parseDep, parseCompilerDep, buildGraph, impacted, scanIncludes, depFilePath, uv4Stamp, uv4TimeStamp, uv4TimeStampHex, stampHex, parseDefines,
} from '../deps.mjs';
function packRootsOf(ctx) {
  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
}

import { buildCompileCommand, uvisionBuildNumber } from '../toolchain.mjs';

/**
 * UV4 lists the includes of a translation unit in the I records. The order and the
 * path spelling come from the compiler's depend file (.d). When it is missing we fall
 * back to our own include-closure scan, using the include directories µVision would
 * hand to the compiler (user paths + the RTE device includes of the project's PackID).
 */
function collectIncludes({ project, target: t, file, abs, outDir, rteDirs }) {
  const base = objBase(outDir, file.name);
  const dep = base + '.d';
  if (fs.existsSync(dep)) {
    const out = [];
    for (const pair of parseCompilerDep(fs.readFileSync(dep, 'utf8'))) {
      const p = path.isAbsolute(pair.dependency) ? pair.dependency : path.resolve(path.dirname(abs), pair.dependency);
      if (p.toLowerCase() === abs.toLowerCase()) continue;
      out.push(p);
    }
    return out;
  }
  const incDirs = String((t && t.c && t.c.includePath) || '').split(';').filter(Boolean).map(d => path.resolve(project.dir, d));
  const dirs = rteDirs && rteDirs.length ? [...incDirs, ...rteDirs] : incDirs;
  if (!fs.existsSync(abs)) return [];
  return scanIncludes(abs, dirs).includes.slice(1);
}

/** RTE device include directories of the target's PackID (RTEPATH\\Vendor.Pack\\version\\Device\\Include). */
function rteIncludeDirs(ctx, t) {
  const out = [];
  const m = /^([^.]+)\.(.+?)\.(\d+(?:\.\d+)*)$/.exec((t && t.packId) || '');
  if (!m) return out;
  for (const root of packRootsOf(ctx)) {
    const dir = path.join(root, m[1], m[2], m[3], 'Device', 'Include');
    if (fs.existsSync(dir)) out.push(dir);
  }
  return out;
}

function objBase(outDir, fileName) {
  return path.join(outDir, path.basename(fileName, path.extname(fileName)));
}

/**
 * UV4 stores the F-record command as ONE physical line: CRLF line breaks inside the
 * command are folded to a bare CR (observed: "...\r\r-I..."), which is exactly what
 * the writer at FUN_00680b10 does before fwrite.
 */
function normaliseCommand(cmd) {
  const oneLine = String(cmd).replace(/\r\n|\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine;
}

export function registerDepTools(ctx) {
  register(ctx, {
    name: 'dep_read',
    description: 'Parse a µVision dependency database (<Output>/<project>_<target>.dep: F/I records with UV4 file stamps) or a compiler .d file. Reports the compiler version header and per-file command lines.',
    inputSchema: { type: 'object', properties: { file: str('Path to the .dep or .d file'), maxSources: int('limit source rows (default 500)') }, required: ['file'] },
    handler: async (args) => {
      const f = path.resolve(args.file);
      if (!fs.existsSync(f)) return { ok: false, error: `not found: ${f}` };
      const text = fs.readFileSync(f, 'latin1');
      if (/^Dependencies for Project/m.test(text)) {
        const d = parseDep(text);
        return {
          ok: true, format: 'uv4-dep', file: f, project: d.project, target: d.target, compilerVersion: d.compilerVersion,
          sources: d.sources.slice(0, args.maxSources || 500).map(s => ({ path: s.path, stamp: s.hash, mtimeFromStamp: new Date(parseInt(s.hash, 16) * 1000).toISOString(), command: s.cmd })),
          includes: d.includes.map(i => ({ path: i.path, stamp: i.hash, mtimeFromStamp: new Date(parseInt(i.hash, 16) * 1000).toISOString() })),
          counts: { sources: d.sources.length, includes: d.includes.length },
        };
      }
      const pairs = parseCompilerDep(text);
      return { ok: true, format: 'compiler-d', file: f, pairs, counts: { pairs: pairs.length } };
    },
  });

  register(ctx, {
    name: 'dep_graph',
    description: 'Build the dependency graph of a target: each project file, its include closure from the .d files, stamp (mtime) and existence. Detects stale files (stamp != floor(mtime/1000)) exactly like UV4 does.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file'), target: str('Target'), rescan: bool('Recompute include closure from sources when .d files are missing (default true)') },
      required: ['project'],
    },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      if (!t) return { ok: false, error: 'no target' };
      const outDir = resolveWin(pr.dir, t.outputDirectory || '.');
      const files = pr.files(t.name);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose].filter(f => [1, 2, 8].includes(f.type));
      const incDirs = String(t.c.includePath || '').split(';').filter(Boolean).map(d => resolveWin(pr.dir, d));
      // Include closure search path: project includes + the target's RTE device include
      // (resolved from the pack, live install or bundled fixture).
      const scanDirs = [...incDirs, ...rteIncludeDirs(ctx, t)];
      const entries = [];
      for (const f of all) {
        const abs = resolveWin(pr.dir, f.filePath || '');
        const dep = objBase(outDir, f.name) + '.d';
        const item = { file: abs, depFile: fs.existsSync(dep) ? dep : null };
        if (!item.depFile && f.type !== 2 && args.rescan !== false && fs.existsSync(abs)) {
          const scan = scanIncludes(abs, scanDirs);
          item.scanned = scan.includes;
          if (scan.missing.length) item.missingIncludes = scan.missing;
        }
        entries.push(item);
      }
      const g = buildGraph(pr.dir, entries, {});
      // augment: which project files are stale
      const stale = [];
      for (const n of g.nodes) {
        const st = n.mtimeMs ? uv4Stamp(n.mtimeMs) : null;
        if (n.hash !== null && st !== null) {
          const objMtime = fs.existsSync(n.path.replace(/\.(c|cpp|s)$/i, '.o')) ? fs.statSync(n.path.replace(/\.(c|cpp|s)$/i, '.o')).mtimeMs : null;
          if (!objMtime || objMtime < n.mtimeMs) stale.push({ path: n.path, reason: objMtime ? 'source newer than object' : 'no object' });
        }
      }
      return {
        ok: true, project: pr.file, target: t.name, outputDir: outDir,
        graph: { stats: g.stats, nodes: g.nodes.map(n => ({ path: n.path, exists: n.exists, stamp: n.hash === null ? null : stampHex(n.hash), deps: n.deps.length, usedBy: n.usedBy.length })) },
        stale,
        includeDirs: incDirs,
      };
    },
  });

  register(ctx, {
    name: 'dep_impact',
    description: 'Impact analysis: given changed files (e.g. a touched header), list every translation unit that must be recompiled, using the recorded include closures.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file'), target: str('Target'), changed: arr({ type: 'string' }, 'Changed file paths') },
      required: ['project', 'changed'],
    },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const outDir = resolveWin(pr.dir, t.outputDirectory || '.');
      const files = pr.files(t.name);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose].filter(f => [1, 2, 8].includes(f.type));
      const incDirs = String(t.c.includePath || '').split(';').filter(Boolean).map(d => resolveWin(pr.dir, d));
      const rteDirs = rteIncludeDirs(ctx, t);
      const scanDirs = [...incDirs, ...rteDirs];
      const entries = all.map(f => {
        const abs = resolveWin(pr.dir, f.filePath || '');
        const dep = objBase(outDir, f.name) + '.d';
        const item = { file: abs, depFile: fs.existsSync(dep) ? dep : null };
        if (!item.depFile && fs.existsSync(abs)) {
          const scan = scanIncludes(abs, scanDirs);
          // write a synthetic .d so buildGraph can use the closure
          const tmp = path.join(outDir, `.scan_${path.basename(abs)}.d`);
          try {
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(tmp, scan.includes.slice(1).map(i => `${abs}: ${i}` + '\r\n').join(''), 'latin1');
            item.depFile = tmp;
          } catch {}
        }
        return item;
      });
      const changedAbs = (args.changed || []).map(p => (path.isAbsolute(p) ? path.normalize(p) : path.resolve(process.cwd(), p)));
      const g = buildGraph(pr.dir, entries, {});
      const r = impacted(g, changedAbs, all.map(f => resolveWin(pr.dir, f.filePath || '')));
      // A changed translation unit is always recompiled, even when nothing includes it.
      const roots = new Set(all.map(f => resolveWin(pr.dir, f.filePath || '').toLowerCase()));
      const recompile = [...new Set([...r.needCompile, ...r.seeds.filter(p => roots.has(p.toLowerCase()))])];
      return { ok: true, project: pr.file, target: t.name, changed: args.changed, seeds: r.seeds, affectedTotal: r.affected.length, recompile, unknownChanged: r.unknownChanged, scannedIncludes: r.affected.length, note: 'recompile lists the translation units of the target that must be rebuilt (changed sources and sources including changed headers)' };
    },
  });

  register(ctx, {
    name: 'dep_scan',
    description: 'Toolchain-free #include closure scan of one source using the target include paths and defines. Reports every resolved header and each missing include.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file (for include paths/defines)'), target: str('Target'), file: str('Source file'), includePaths: arr({ type: 'string' }, 'Override include paths') },
      required: ['file'],
    },
    handler: async (args) => {
      let inc = (args.includePaths || []).map(p => path.resolve(p));
      let defines = [];
      if (args.project) {
        const pr = new Project(findProjectFile(args.project));
        const t = pr.target(args.target) || pr.targets()[0];
        if (t) {
          if (!inc.length) inc = String(t.c.includePath || '').split(';').filter(Boolean).map(d => resolveWin(pr.dir, d));
          defines = parseDefines(t.c.define);
        }
      }
      const r = scanIncludes(path.resolve(args.file), inc, defines);
      return { ok: true, file: r.file, includes: r.includes, count: r.includes.length, missing: r.missing, includePaths: inc, defines };
    },
  });

  register(ctx, {
    name: 'dep_write',
    description: 'Regenerate a UV4-compatible dependency database (<project>_<target>.dep): F records carry the file clock time (HHMMSS as 0xHHMMSS) and the exact per-file tool command line (uVision version, RTE device include, defines), I records list the includes from the compiler .d files. Byte layout matches UV4.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file'), target: str('Target'), output: str('Write to this path (default <outputDir>/<project>_<target>.dep)'), dryRun: bool('Return content only') },
      required: ['project'],
    },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const outDir = resolveWin(pr.dir, t.outputDirectory || '.');
      const target = t.name;
      const files = pr.files(target);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose].filter(f => [1, 2, 8].includes(f.type));
      const lines = [];
      lines.push(`Dependencies for Project '${path.basename(pr.file, path.extname(pr.file))}', Target '${target}': (DO NOT MODIFY !)`);
      const cc = (t.pCCUsed || '').split('::').filter(Boolean);
      const compilerVersion = cc.length >= 2 ? `${cc[0]}::${cc[1]}::${cc[2] || ''}` : `${t.pCCUsed || ''}`;
      lines.push(`CompilerVersion: ${compilerVersion}`);
      // RTE device includes: <RTEPATH>\<Vendor>.<Pack>\<version>\Device\Include (from PackID).
      const rteDirs = [];
      for (const root of packRootsOf(ctx)) {
        if (!t.packId) break;
        const m = /^([^.]+)\.(.+?)\.(\d+(?:\.\d+)*)$/.exec(t.packId);
        if (!m) break;
        const dir = path.join(root, m[1], m[2], m[3], 'Device', 'Include');
        if (fs.existsSync(dir)) rteDirs.push(dir);
      }
      const rteDeviceInclude = rteDirs[0] || null;
      const buildNumber = uvisionBuildNumber(ctx.install && ctx.install.uvisionVersion);
      const includes = new Set();
      for (const f of all) {
        const abs = resolveWin(pr.dir, f.filePath || '');
        const tool = f.type === 2 ? 'armasm' : 'armcc';
        const base = objBase(outDir, f.name);
        const obj = base + '.o';
        const dep = base + '.d';
        const lst = base + '.lst';
        // µVision writes the object/dependency/listing paths relative to the project folder and lower-cases the folder name.
        const relOut = (absPath) => {
          const r = path.relative(pr.dir, absPath);
          const dirSeg = r.split(/[\\/]/).slice(0, -1).join('\\');
          const fileSeg = r.split(/[\\/]/).slice(-1)[0];
          return dirSeg ? `.\\${dirSeg.replace(/[A-Z]/g, m => m.toLowerCase())}\\${fileSeg}` : `.\\${fileSeg}`;
        };
        const cmd = buildCompileCommand({
          tool, target: t, file: f.name, relFile: f.filePath,
          objPath: relOut(obj), depPath: relOut(dep), lstPath: relOut(lst),
          rteDeviceInclude,
          uvisionVersion: buildNumber,
        });
        const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
        // AF: the (0x%08X) field carries the file's clock time as decimal HHMMSS.
        const stamp = st ? uv4TimeStamp(st.mtimeMs) : 0;
        const cmdNorm = normaliseCommand(cmd);
        lines.push(`F (${f.filePath})(${stampHex(stamp)})(${cmdNorm})`);
        for (const depEntry of collectIncludes({ project: pr, target: t, file: f, abs, outDir, rteDirs })) {
          const key = depEntry.toLowerCase();
          if (includes.has(key)) continue;
          includes.add(key);
          const hs = fs.existsSync(depEntry) ? fs.statSync(depEntry) : null;
          lines.push(`I (${depEntry})(${(hs ? uv4TimeStampHex(hs.mtimeMs) : '0x00000000')})`);
        }
      }
      const content = lines.join('\r\n') + '\r\n';
      const { file: defFile } = depFilePath(pr.file, target, t.outputDirectory);
      const out = path.resolve(args.output || defFile);
      if (!args.dryRun) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, content, 'latin1'); }
      return { ok: true, file: out, bytes: content.length, records: { source: all.length, include: includes.size }, preview: content.split(/\r?\n/).slice(0, 8).join('\n') };
    },
  });

  register(ctx, {
    name: 'test_build',
    description: 'Reproduce the per-file command lines µVision would run for a target (armcc/armasm) without building: compile objects, depend files, listings and the linker command with a generated scatter file.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), file: str('Only this source file') }, required: ['project'] },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const outDir = resolveWin(pr.dir, t.outputDirectory || '.');
      const files = pr.files(t.name);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose].filter(f => [1, 2, 8].includes(f.type));
      const sel = args.file ? all.filter(f => path.basename(f.filePath).toLowerCase() === path.basename(args.file).toLowerCase()) : all;
      const cmds = sel.map(f => {
        const obj = objBase(outDir, f.name);
        return {
          file: f.filePath, type: f.type,
          tool: f.type === 2 ? 'armasm' : 'armcc',
          command: buildCompileCommand({
            tool: f.type === 2 ? 'armasm' : 'armcc', target: t, file: f.name, relFile: f.filePath,
            objPath: obj + '.o', depPath: obj + '.d', lstPath: obj + '.lst',
          }),
        };
      });
      const objs = all.map(f => `"${objBase(outDir, f.name)}.o"`).join(' ');
      const sct = path.join(outDir, `${t.outputName}.sct`);
      const link = `armlink --cpu ${(/CPUTYPE\("([^"]+)"\)/.exec(t.cpu) || [, 'Cortex-M3'])[1]} ${objs} --scatter "${sct}" --summary_stderr --info summarysizes --map --load_addr_map_info --xref --callgraph --symbols --info sizes --info totals --info unused --info veneers --list "${path.join(resolveWin(pr.dir, t.listingPath || '.'), t.outputName + '.map')}" -o "${path.join(outDir, t.outputName + '.axf')}"`;
      return { ok: true, project: pr.file, target: t.name, compile: cmds, link, scatter: sct, macros: t.c.define ? parseDefines(t.c.define) : [] };
    },
  });
}









