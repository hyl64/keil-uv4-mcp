// uv4cli.mjs — faithful reproduction of the UV4.exe command-line contract.
//
// Reconstructed from:
//  * UV4.exe (sha256 428baf13d15e6760af1618def9c9815c97f0321cc5e459ec7adc4dde41c42f89)
//    CLI parser: CCommandLineInfo::ParseParam (0x9d3a11), ParseParamFlag (0x9d3a62),
//    CCommandLineInfo::ParseParamFlag only recognises MFC OLE switches (pt,p,Register,...);
//    every UV4 specific switch therefore reaches the app's own parse loop, which was
//    characterised by runtime probing (reverse/cli_matrix.json).
//  * uv4.chm → uv4_commandline.html (command/option table, ERRORLEVEL table).
//  * Observed exit codes: 0 clean, 1 warnings, 2 errors, 3 fatal; 11/12/13/15/20 per help.
//
// Behaviour notes discovered by probing:
//  * UV4 is a GUI subsystem exe; launching through a shell that waits on stdio can
//    deadlock. We always start it with CreateProcess semantics via child_process.spawn
//    and no inherited stdio pipes, and we always pass -j0 for headless use.
//  * UV4 rewrites <project>.uvoptx on every invocation (last target, debug opts...).
//  * `-z` and `-q` only make sense for multi-project (.uvmpw) files; with a plain
//    .uvprojx they hang forever waiting on an internal event. The wrapper refuses
//    -z/-q on single projects unless `force` is set, and enforces a timeout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const UV4_COMMANDS = {
  '-b': { name: 'build', desc: 'Build current target and exit (batch-selected targets for multi-projects)' },
  '-r': { name: 'rebuild', desc: 'Re-translate current target and exit' },
  '-c': { name: 'clean', desc: 'Clean all project targets and exit' },
  '-cr': { name: 'clean_rebuild', desc: 'Clean all targets then re-translate current target' },
  '-z': { name: 'rebuild_all', desc: 'Re-build ALL targets (multi-project only)' },
  '-q': { name: 'rebuild_selected', desc: 'Re-build batch-selected targets (multi-project only)' },
  '-f': { name: 'download', desc: 'Download program to Flash and exit' },
  '-d': { name: 'debug', desc: 'Enter debug mode (use -x/-y for DDE output, or -s for UVSOCK)' },
  '-5': { name: 'convert', desc: 'Convert uVision4 .uvproj to .uvprojx (option -l logfile)' },
  '-et': { name: 'export_target', desc: 'Export target to <projectName>.<targetName>.cprj' },
  '-ep': { name: 'export_all', desc: 'Export all targets to .cprj files' },
  '-X': { name: 'symbols', desc: 'Generate co-arm_<target>.h/hpp preprocessor symbol file' },
  '-X1': { name: 'symbols_all', desc: 'Generate symbol files for all targets' },
};

export const UV4_OPTIONS = {
  '-j0': 'Hide GUI, suppress message boxes (batch mode)',
  '-i': 'Import/create project from XML (project_import.xsd)',
  '-n': 'Create new project for device (GUI suppressed)',
  '-np': 'Create project if absent else update device in all targets',
  '-o': 'Output log file',
  '-l': 'Log file (with -5)',
  '-s': 'Enable UVSOCK TCP remote control on port',
  '-t': 'Select current target',
  '-x': 'DDE mode, complete output (with -d)',
  '-y': 'DDE mode, confirmations only (with -d)',
  '-sg': 'Ignore uvguix GUI layout (batch safe)',
};

export const UV4_ERRORLEVEL = {
  0: 'No errors or warnings',
  1: 'Warnings only',
  2: 'Errors',
  3: 'Fatal errors',
  11: 'Cannot open project file for writing',
  12: 'Device with given name not found in database',
  13: 'Error writing project file',
  15: 'Error reading import XML file',
  20: 'Error converting project',
};

const MULTI_EXT = new Set(['.uvmpw', '.uvmpwx']);

export function quoteArg(a) {
  if (a === '') return '""';
  if (/[\s"]/.test(a)) return '"' + a.replace(/"/g, '\\"') + '"';
  return a;
}

export function projectKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (MULTI_EXT.has(ext)) return 'multi';
  if (ext === '.uvprojx' || ext === '.uvproj') return 'single';
  return 'unknown';
}

/** Deterministic default log path next to the project (UV4 leaves -o logs beside the project by default). */
export function defaultLogPath(project, command) {
  const dir = path.dirname(project);
  const base = path.basename(project, path.extname(project));
  const tag = (command || '-x').replace(/^-/, '').replace(/[^A-Za-z0-9]/g, '') || 'cmd';
  return path.join(dir, `${base}.${tag}.log`);
}

/**
 * Build the UV4 argv exactly like the CLI does, with the order the app accepts:
 *   UV4 -j0 -o <log> <command> <project> -t <target> [-s port] [-sg] [-i xml] [-n dev]
 */
export function buildArgs(opts) {
  const args = [];
  if (opts.hideGui !== false) args.push('-j0');
  if (opts.outputLog) args.push('-o', opts.outputLog);
  if (opts.command) args.push(opts.command);
  if (opts.project) args.push(opts.project);
  if (opts.target) args.push('-t', opts.target);
  if (opts.device && (opts.command === '-i' || opts.command === null)) { /* handled by import */ }
  if (opts.socketPort) args.push('-s', String(opts.socketPort));
  if (opts.ignoreGuiLayout) args.push('-sg');
  if (opts.importXml) args.push('-i', opts.importXml);
  if (opts.deviceName) args.push(opts.useNp ? '-np' : '-n', opts.deviceName);
  if (opts.logFile) args.push('-l', opts.logFile);
  if (opts.extra) args.push(...opts.extra);
  return args;
}

/** Run UV4 headless with process-tree timeout handling. Returns an observation record. */
export function runUv4(cfg, opts) {
  const exe = opts.exe || (cfg && cfg.uv4Exe);
  if (!exe) throw new Error('UV4.exe not located (set KEIL_MDK_ROOT)');
  const args = buildArgs(opts);
  const started = Date.now();
  const logPath = opts.outputLog;
  const preLog = logPath && fs.existsSync(logPath) ? fs.statSync(logPath).mtimeMs : null;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, {
        cwd: opts.cwd || path.dirname(opts.project || exe),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: false,
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message || e), argv: args, exe });
      return;
    }
    let timedOut = false;
    let killed = false;
    const timeoutMs = opts.timeoutMs || (cfg && cfg.uv4TimeoutMs) || 900000;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); killed = true; } catch {}
      // GUI process tree: uv4 spawns builder children, kill them too.
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e && e.message || e), argv: args, exe, timedOut });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      const result = {
        ok: !timedOut && code === 0,
        exe,
        argv: args,
        exitCode: code,
        signal,
        timedOut,
        killed,
        elapsedMs: elapsed,
        errorlevelMeaning: UV4_ERRORLEVEL[code] || null,
        logPath, log: null, logExist: false,
      };
      if (logPath && fs.existsSync(logPath)) {
        result.logExist = true;
        const st = fs.statSync(logPath);
        result.logMtime = st.mtimeMs;
        result.logFresh = preLog === null ? true : st.mtimeMs >= preLog;
        try { result.log = fs.readFileSync(logPath, 'utf8'); } catch { result.log = null; }
      }
      if (opts.project) {
        const dir = path.dirname(opts.project);
        const base = path.basename(opts.project, path.extname(opts.project));
        const optx = [path.join(dir, base + '.uvoptx'), path.join(dir, base + '.uvopt')].find(f => fs.existsSync(f));
        if (optx) { try { result.lastTarget = parseLastTarget(optx); } catch { result.lastTarget = null; } }
      }
      resolve(result);
    });
  });
}

function parseLastTarget(uvoptxFile) {
  const txt = fs.readFileSync(uvoptxFile, 'utf8');
  const blocks = txt.split(/<Target>[\s\S]*?<TargetName>/).slice(1);
  const names = [...txt.matchAll(/<TargetName>([^<]*)<\/TargetName>/g)].map(m => m[1]);
  const cur = [...txt.matchAll(/<IsCurrentTarget>(\d)<\/IsCurrentTarget>/g)];
  for (let i = 0; i < cur.length; i++) if (cur[i][1] === '1') return names[i] || null;
  return names[0] || null;
}

/** Parse a build log into structured counters. Mirrors UV4's own summary strings. */
export function summarizeLog(log) {
  if (!log) return null;
  const out = {
    compiler: null, target: null, action: null,
    compiled: [], assembled: [], linked: false, cleaned: [],
    programSize: null, bvr: null, elapsed: null,
    errors: [], warnings: [], fatal: 0,
  };
  const reCompiler = /\*\*\* Using Compiler '([^']+)', folder: '([^']+)'/;
  const reTarget = /(?:Build|Rebuild) target '([^']+)'/;
  const reSize = /Program Size: (.*)\s*$/m;
  const reBvr = /"([^"]+)"\s*-\s*(\d+) Error\(s\),\s*(\d+) Warning\(s\)\./;
  const reElapsed = /Build Time Elapsed:\s*(\d+):(\d+):(\d+)/;
  let m;
  if ((m = reCompiler.exec(log))) out.compiler = { name: m[1], folder: m[2] };
  if ((m = reTarget.exec(log))) out.target = m[1];
  if (/^Rebuild/m.test(log)) out.action = 'rebuild';
  else if (/^Build/m.test(log)) out.action = 'build';
  else if (/^Clean/m.test(log)) out.action = 'clean';
  for (const c of log.matchAll(/^\s*compiling ([^\r\n]+?)\.\.\.\s*$/gm)) out.compiled.push(c[1]);
  for (const c of log.matchAll(/^\s*assembling ([^\r\n]+?)\.\.\.\s*$/gm)) out.assembled.push(c[1]);
  for (const c of log.matchAll(/^\s*deleting intermediate output files for target '([^']+)'$/gm)) out.cleaned.push(c[1]);
  if (/^\s*linking\.\.\.\s*$/m.test(log)) out.linked = true;
  if ((m = reSize.exec(log))) {
    const kv = {};
    for (const p of m[1].split(/\s+/)) { const km = /^([A-Za-z-]+)=(\d+)$/.exec(p); if (km) kv[km[1]] = Number(km[2]); }
    out.programSize = kv;
  }
  if ((m = reBvr.exec(log))) out.bvr = { output: m[1], errors: Number(m[2]), warnings: Number(m[3]) };
  if ((m = reElapsed.exec(log))) out.elapsed = `${m[1]}:${m[2]}:${m[3]}`;
  for (const line of log.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/Error\(s\),\s*\d+ Warning\(s\)/.test(t) || /warning\(s\)|Warning\(s\)/.test(t) && /-\s*\d+ Error/.test(t)) continue;
    const isFatal = /\bfatal error\b|\bfatal\b.*error|^\*{3}\s*Fatal/i.test(t);
    const isError = isFatal || /\berror:|\berror [A-Z]\d|^\*{3}\s*Error|Error #5\d\d/.test(t);
    const isWarn = !isError && (/\bwarning:|\bwarning #|^\*{3}\s*Warning/.test(t));
    if (isFatal) out.fatal++;
    else if (isError) out.errors.push(t);
    else if (isWarn) out.warnings.push(t);
  }
  if (out.bvr) {
    out.errors = out.bvr.errors ? out.errors.slice(-out.bvr.errors) : [];
    out.warnings = out.bvr.warnings ? out.warnings.slice(-out.bvr.warnings) : [];
    if (!out.bvr.errors) out.fatal = 0;
  }
  return out;
}

/** Enumerate side-effect artifacts of a command using the output directory from the project. */
export function collectArtifacts(project, outputDir, outputName) {
  const dir = path.isAbsolute(outputDir || '') ? outputDir : path.resolve(path.dirname(project), outputDir || '.');
  const name = outputName || path.basename(project, path.extname(project));
  const findings = [];
  for (const ext of ['.axf', '.elf', '.hex', '.bin', '.lib', '.map', '.htm', '.build_log.htm', '.lst', '.d', '.o', '.crf']) {
    const p = path.join(dir, name + ext);
    if (fs.existsSync(p)) findings.push({ path: p, size: fs.statSync(p).size });
  }
  for (const suffix of ['_Flash.dep', '_dep.dep']) {
    const p = path.join(dir, name + suffix);
    if (!fs.existsSync(p)) {
      try {
        for (const f of fs.readdirSync(dir)) if (f.endsWith('.dep')) findings.push({ path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size });
      } catch {}
      break;
    }
  }
  const syms = [path.join(dir, 'co-arm_' + name + '.h'), path.join(dir, 'co-arm_' + name + '.hpp')];
  for (const s of syms) if (fs.existsSync(s)) findings.push({ path: s, size: fs.statSync(s).size });
  return { outputDir: dir, outputName: name, artifacts: dedupe(findings) };
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(x => { if (seen.has(x.path)) return false; seen.add(x.path); return true; });
}
