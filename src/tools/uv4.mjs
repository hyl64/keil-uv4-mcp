// tools/uv4.mjs — UV4.exe command-line reproduction as MCP tools.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool, enumOf } from './common.mjs';
import {
  UV4_COMMANDS, UV4_OPTIONS, UV4_ERRORLEVEL, runUv4, defaultLogPath, summarizeLog,
  projectKind, buildArgs,
} from '../uv4cli.mjs';
import { Project, findProjectFile } from '../project.mjs';
import { collectArtifacts } from '../uv4cli.mjs';

const COMMANDS = Object.keys(UV4_COMMANDS);

/** Portable mode: return a structured diagnostic instead of throwing. */
function needsKeilDiagnostic(ctx, feature) {
  if (ctx.data && typeof ctx.data.needsKeil === 'function') return ctx.data.needsKeil(feature);
  return {
    ok: false, needsKeil: true, feature, portableMode: true,
    reason: 'This operation drives the real Keil toolchain, which is not installed.',
    remedy: ['Install Keil MDK, or set KEIL_MDK_ROOT to the folder containing TOOLS.INI and UV4\\UV4.exe.'],
  };
}

function requireInstall(ctx) {
  if (!ctx.install || !ctx.install.found) return null;
  return ctx.install;
}

function enrich(r, project) {
  if (!r) return r;
  const summary = summarizeLog(r.log);
  const out = {
    ok: r.ok,
    exitCode: r.exitCode,
    errorlevelMeaning: r.errorlevelMeaning,
    timedOut: r.timedOut,
    killed: r.killed,
    elapsedMs: r.elapsedMs,
    argv: r.argv,
    exe: r.exe,
    logPath: r.logPath,
    logExists: r.logExist,
    logFresh: r.logFresh,
    summary,
    lastTarget: r.lastTarget || null,
    logTail: (r.log || '').split(/\r?\n/).slice(-40).join('\n'),
  };
  if (r.error) out.error = r.error;
  if (project) {
    try {
      const pr = new Project(project);
      const t = pr.target(r.lastTarget || undefined);
      if (t) {
        out.artifacts = collectArtifacts(pr.file, t.outputDirectory, t.outputName);
        out.target = { name: t.name, device: t.device, output: { dir: t.outputDirectory, name: t.outputName } };
      }
    } catch { /* project may be a multi-project file */ }
  }
  return out;
}

function commonProps() {
  return {
    project: str('Project file (.uvprojx/.uvproj) or directory containing one', { minLength: 1 }),
    target: str('Target name (-t)'),
    outputLog: str('Log file (-o); defaults to <project>.<cmd>.log next to the project'),
    timeoutMs: int('Process timeout (ms); on expiry the UV4 process tree is killed'),
    hideGui: bool('-j0 (default true)'),
    ignoreGuiLayout: bool('-sg: ignore uvguix layouts (recommended in batch)'),
    socketPort: int('-s <port>: enable UVSOCK remote-control server'),
    env: { type: 'object', description: 'Extra environment variables for the process', additionalProperties: { type: 'string' } },
  };
}

function normalizeProject(p) {
  const file = findProjectFile(p);
  return file;
}

async function runCommand(ctx, args, command, opts = {}) {
  const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, 'uv4 command line');
  const project = args.project ? normalizeProject(args.project) : null;
  if (!project) throw new Error('project is required');
  const kind = projectKind(project);
  if ((command === '-z' || command === '-q') && kind !== 'multi') {
    if (!opts.allowSingle) {
      throw new Error(`${command} is only supported on multi-project files (.uvmpw/.uvmpwx); pass force:true to try anyway (UV4 may hang)`);
    }
  }
  const logPath = args.outputLog ? path.resolve(args.outputLog) : defaultLogPath(project, command);
  const timeoutMs = args.timeoutMs || ctx.cfg.uv4TimeoutMs;
  const r = await runUv4(ctx.cfg, {
    exe: install.uv4Exe,
    command,
    project,
    target: args.target || null,
    outputLog: logPath,
    timeoutMs,
    hideGui: args.hideGui !== false,
    ignoreGuiLayout: args.ignoreGuiLayout !== false,
    socketPort: args.socketPort || null,
  });
  const result = enrich(r, project);
  result.project = project;
  result.command = command;
  result.commandDescription = UV4_COMMANDS[command] ? UV4_COMMANDS[command].desc : null;
  return result;
}

function submitJob(ctx, args, command) {
  const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, 'uv4 command line');
  const project = normalizeProject(args.project);
  const logPath = args.outputLog ? path.resolve(args.outputLog) : defaultLogPath(project, command);
  const job = ctx.jobs.submit({
    kind: UV4_COMMANDS[command].name,
    project, target: args.target || null, command,
    run: async () => {
      const r = await runUv4(ctx.cfg, {
        exe: install.uv4Exe, command, project, target: args.target || null, outputLog: logPath,
        timeoutMs: args.timeoutMs || ctx.cfg.uv4TimeoutMs, hideGui: args.hideGui !== false,
        ignoreGuiLayout: args.ignoreGuiLayout !== false, socketPort: args.socketPort || null,
      });
      return enrich(r, project);
    },
  });
  return { ok: true, job, message: `Job ${job.id} queued; poll with uv4_job_status or wait with uv4_job_wait` };
}

export function registerUv4Tools(ctx) {
  ctx.cliCommands = UV4_COMMANDS;
  ctx.cliOptions = UV4_OPTIONS;
  ctx.cliErrorlevel = UV4_ERRORLEVEL;

  const asyncProp = bool('Run as a background job (default false for clean/export, true for build/rebuild)');

  register(ctx, {
    name: 'uv4_build',
    description: 'UV4 -b: build the current target (or batch-selected targets of a multi-project) and exit. Returns exit code, structured build summary, artifacts, and the target UV4 recorded.',
    inputSchema: { type: 'object', properties: { ...commonProps(), async: asyncProp } },
    handler: async (args) => (args.async === false ? runCommand(ctx, args, '-b') : submitJob(ctx, args, '-b')),
  });

  register(ctx, {
    name: 'uv4_rebuild',
    description: 'UV4 -r: re-translate (full rebuild) the current target and exit.',
    inputSchema: { type: 'object', properties: { ...commonProps(), async: asyncProp } },
    handler: async (args) => (args.async === false ? runCommand(ctx, args, '-r') : submitJob(ctx, args, '-r')),
  });

  register(ctx, {
    name: 'uv4_clean',
    description: 'UV4 -c: clean all targets of the project and exit.',
    inputSchema: { type: 'object', properties: { ...commonProps() } },
    handler: async (args) => runCommand(ctx, args, '-c'),
  });

  register(ctx, {
    name: 'uv4_clean_rebuild',
    description: 'UV4 -cr: clean all targets and re-translate the current target.',
    inputSchema: { type: 'object', properties: { ...commonProps(), async: asyncProp, force: bool('Allow on single project (may hang)') } },
    handler: async (args) => (args.async === false ? runCommand(ctx, args, '-cr', { allowSingle: true }) : submitJob(ctx, args, '-cr')),
  });

  register(ctx, {
    name: 'uv4_rebuild_all',
    description: 'UV4 -z / -q: rebuild all / batch-selected targets of a multi-project file. Refused on single projects because UV4 waits forever there.',
    inputSchema: {
      type: 'object',
      properties: { ...commonProps(), mode: enumOf(['all', 'selected'], 'all = -z, selected = -q (default all)'), force: bool('Allow on a single project (UV4 may hang; the wrapper still enforces the timeout)') },
    },
    handler: async (args) => runCommand(ctx, args, args.mode === 'selected' ? '-q' : '-z', { allowSingle: !!args.force }),
  });

  register(ctx, {
    name: 'uv4_download',
    description: 'UV4 -f: download the built program to Flash via the configured debug adapter, then exit.',
    inputSchema: { type: 'object', properties: { ...commonProps(), async: asyncProp, force: bool('Skip adapter/flash configuration checks') } },
    handler: async (args) => (args.async === false ? runCommand(ctx, args, '-f') : submitJob(ctx, args, '-f')),
  });

  register(ctx, {
    name: 'uv4_symbols',
    description: 'UV4 -X / -X1: generate co-arm_<target>.h/hpp preprocessor symbol files in the output folder (current target or all targets).',
    inputSchema: { type: 'object', properties: { ...commonProps(), allTargets: bool('-X1 instead of -X') } },
    handler: async (args) => {
      const r = await runCommand(ctx, args, args.allTargets ? '-X1' : '-X');
      if (r.ok) {
        try {
          const pr = new Project(r.project);
          const dirs = pr.targets().map(t => path.resolve(pr.dir, t.outputDirectory));
          r.symbolFiles = [];
          for (const d of [...new Set(dirs)]) {
            for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) if (/^co-arm_.*\.(h|hpp)$/i.test(f)) r.symbolFiles.push(path.join(d, f));
          }
        } catch {}
      }
      return r;
    },
  });

  register(ctx, {
    name: 'uv4_export_cprj',
    description: 'UV4 -et / -ep: export one target or all targets to <projectName>.<targetName>.cprj (CMSIS solution format).',
    inputSchema: { type: 'object', properties: { ...commonProps(), all: bool('-ep instead of -et') } },
    handler: async (args) => {
      const r = await runCommand(ctx, args, args.all ? '-ep' : '-et');
      try {
        const pr = new Project(r.project);
        r.cprjFiles = fs.readdirSync(pr.dir).filter(f => f.toLowerCase().endsWith('.cprj')).map(f => path.join(pr.dir, f));
      } catch {}
      return r;
    },
  });

  register(ctx, {
    name: 'uv4_convert',
    description: 'UV4 -5: convert a uVision4 .uvproj project to .uvprojx (optionally -l logfile). Error 20 on conversion failure.',
    inputSchema: { type: 'object', properties: { project: str('Legacy .uvproj file'), logFile: str('-l logfile'), timeoutMs: int('timeout') } },
    handler: async (args) => {
      const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, 'uv4 command line');
      const project = normalizeProject(args.project);
      const logPath = args.logFile ? path.resolve(args.logFile) : defaultLogPath(project, '-5');
      const r = await runUv4(ctx.cfg, { exe: install.uv4Exe, command: '-5', project, outputLog: logPath, logFile: args.logFile, timeoutMs: args.timeoutMs || 300000, hideGui: true });
      const out = enrich(r, project);
      const converted = project.replace(/\.uvproj$/i, '.uvprojx');
      out.converted = converted;
      out.convertedExists = fs.existsSync(converted);
      return out;
    },
  });

  register(ctx, {
    name: 'uv4_import',
    description: 'UV4 -i/-n/-np: create or update a project from an XML import (project_import.xsd) or from a device name. GUI is suppressed automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Target project path (created when missing)'),
        importXml: str('Path to the import XML file (-i)'),
        device: str('Device name (-n to create, -np to create/update all targets)'),
        updateExisting: bool('-np semantics for device'),
        target: str('Target name (-t)'),
        timeoutMs: int('timeout'),
      },
      required: ['project'],
    },
    handler: async (args) => {
      const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, 'uv4 command line');
      const project = path.resolve(args.project);
      const logPath = defaultLogPath(project, '-i');
      const r = await runUv4(ctx.cfg, {
        exe: install.uv4Exe, command: null, project,
        importXml: args.importXml ? path.resolve(args.importXml) : null,
        deviceName: args.device || null, useNp: !!args.updateExisting,
        target: args.target || null, outputLog: logPath, timeoutMs: args.timeoutMs || 120000, hideGui: true,
      });
      const out = enrich(r, fs.existsSync(project) ? project : null);
      try { if (fs.existsSync(project)) out.projectSummary = new Project(project).targets().map(t => ({ name: t.name, device: t.device })); } catch {}
      return out;
    },
  });

  register(ctx, {
    name: 'uv4_run',
    description: 'Generic UV4 runner: any supported command with any supported option, returning raw argv and structured results. Use for -d (debug with init script), -x/-y (DDE) and exotic combinations.',
    inputSchema: {
      type: 'object',
      properties: {
        command: enumOf(COMMANDS, 'UV4 command switch'),
        project: str('Project file (optional for commands that open the last project)'),
        target: str('-t'),
        outputLog: str('-o'),
        importXml: str('-i'),
        device: str('-n / -np device'),
        useNp: bool('use -np for device'),
        logFile: str('-l'),
        socketPort: int('-s'),
        ignoreGuiLayout: bool('-sg'),
        hideGui: bool('-j0'),
        extra: { type: 'array', items: { type: 'string' }, description: 'Extra arguments appended verbatim' },
        timeoutMs: int('timeout'),
        force: bool('Skip single/multi-project validation'),
      },
      required: ['command'],
    },
    handler: async (args) => {
      const install = requireInstall(ctx);
    if (!install) return needsKeilDiagnostic(ctx, 'uv4 command line');
      const project = args.project ? normalizeProject(args.project) : null;
      if (project && !args.force) {
        const kind = projectKind(project);
        if ((args.command === '-z' || args.command === '-q') && kind !== 'multi') throw new Error(`${args.command} needs a multi-project file; pass force:true to try anyway`);
      }
      const logPath = args.outputLog ? path.resolve(args.outputLog) : (project ? defaultLogPath(project, args.command) : null);
      const argvPreview = buildArgs({
        command: args.command, project, target: args.target, outputLog: logPath, importXml: args.importXml,
        deviceName: args.device, useNp: args.useNp, logFile: args.logFile, socketPort: args.socketPort,
        ignoreGuiLayout: args.ignoreGuiLayout, hideGui: args.hideGui !== false, extra: args.extra,
      });
      const r = await runUv4(ctx.cfg, {
        exe: install.uv4Exe, command: args.command, project, target: args.target || null, outputLog: logPath,
        importXml: args.importXml || null, deviceName: args.device || null, useNp: !!args.useNp,
        logFile: args.logFile || null, socketPort: args.socketPort || null,
        ignoreGuiLayout: !!args.ignoreGuiLayout, hideGui: args.hideGui !== false, extra: args.extra || [],
        timeoutMs: args.timeoutMs || ctx.cfg.uv4TimeoutMs,
      });
      const out = enrich(r, project);
      out.argvPreview = argvPreview;
      out.commandDescription = UV4_COMMANDS[args.command] ? UV4_COMMANDS[args.command].desc : null;
      return out;
    },
  });

  register(ctx, {
    name: 'uv4_job_status',
    description: 'Status/result of an asynchronous UV4 job.',
    inputSchema: { type: 'object', properties: { id: str('Job id') }, required: ['id'] },
    handler: async (args) => {
      const j = ctx.jobs.view(ctx.jobs.get(args.id));
      return j || { ok: false, error: `unknown job ${args.id}` };
    },
  });

  register(ctx, {
    name: 'uv4_job_list',
    description: 'List asynchronous UV4 jobs (state, project, target, timings).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, jobs: ctx.jobs.list() }),
  });

  register(ctx, {
    name: 'uv4_job_wait',
    description: 'Wait for an asynchronous UV4 job to finish (bounded).',
    inputSchema: { type: 'object', properties: { id: str('Job id'), timeoutMs: int('max wait (default 120000)') }, required: ['id'] },
    handler: async (args) => {
      const j = await ctx.jobs.wait(args.id, args.timeoutMs || 120000);
      return j || { ok: false, error: `unknown job ${args.id}` };
    },
  });

  register(ctx, {
    name: 'uv4_build_log',
    description: 'Read and summarize any UV4 log: build log, .build_log.htm or an -o output file. Extracts errors/warnings, program size and artifacts.',
    inputSchema: { type: 'object', properties: { path: str('Log file'), maxLines: int('tail lines (default 200)') }, required: ['path'] },
    handler: async (args) => {
      const p = path.resolve(args.path);
      if (!fs.existsSync(p)) return { ok: false, error: `log not found: ${p}` };
      const raw = fs.readFileSync(p, 'latin1');
      const text = /\.htm/i.test(p) ? raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : raw;
      return { ok: true, path: p, size: raw.length, summary: summarizeLog(text), tail: text.split(/\r?\n/).slice(-(args.maxLines || 200)).join('\n') };
    },
  });

  register(ctx, {
    name: 'cli_reference',
    description: 'The recovered UV4 command-line contract: commands, options and ERRORLEVEL table (evidence-backed).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      ok: true,
      commands: UV4_COMMANDS,
      options: UV4_OPTIONS,
      errorlevel: UV4_ERRORLEVEL,
      syntax: '<UV4.exe> [command] [projectfile] [options]',
      notes: [
        'UV4 is a GUI-subsystem binary: always pass -j0 in automation or a shell waiting on stdio can deadlock.',
        'UV4 rewrites <project>.uvoptx on every invocation (current target, debug options).',
        '-z/-q hang forever on single-project files; only use with .uvmpw/.uvmpwx.',
        '-et/-ep/-X/-X1 produce no stdout; verify by the produced files.',
      ],
    }),
  });
}

