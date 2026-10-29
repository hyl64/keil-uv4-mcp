// tools/system.mjs — installation, toolchain, license, UVSOCK/IPC and process tools.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool, arr } from './common.mjs';
import { discoverInstall, resolveToolset, toolPath } from '../config.mjs';
import { toolchainInfo, runTool, cpuSpecFromProject } from '../toolchain.mjs';
import { licenseStatus, licenseFiles } from '../license.mjs';
import { probePort, waitForPort, scanRange, readBanner, describeLocalListeners, listUv4Processes, killUv4Processes } from '../uvscanner.mjs';
function needsKeilDiagnostic(ctx, feature) {
  if (ctx.data && typeof ctx.data.needsKeil === 'function') return ctx.data.needsKeil(feature);
  return { ok: false, needsKeil: true, feature, portableMode: true, reason: 'Keil toolchain not installed.' };
}

import { UV4_COMMANDS, UV4_OPTIONS, UV4_ERRORLEVEL } from '../uv4cli.mjs';

export function registerSystemTools(ctx) {
  register(ctx, {
    name: 'keil_install',
    description: 'Report the detected Keil MDK installation (TOOLS.INI): UV4 path, uVision version, tool variants, toolsets (ARMCC/ARMCLANG), pack roots (RTEPATH), CMSIS-Toolbox binaries and registered debug drivers.',
    inputSchema: { type: 'object', properties: { mdkRoot: str('Override install root') } },
    handler: async (args) => {
      const inst = args.mdkRoot ? discoverInstall(args.mdkRoot) : ctx.install;
      if (!inst.found) return { ok: false, error: 'Keil installation not found', candidates: inst.candidates || [], hint: 'set KEIL_MDK_ROOT' };
      const toolbox = [];
      try {
        for (const f of fs.readdirSync(inst.cmsisToolboxBin)) if (f.toLowerCase().endsWith('.exe')) toolbox.push(f);
      } catch {}
      return {
        ok: true,
        root: inst.root, toolsIni: inst.toolsIni, uv4: inst.uv4Exe, uvisionCom: inst.uvisionCom,
        uvisionVersion: inst.uvisionVersion, toolVariant: inst.toolVariant,
        toolsets: inst.toolsets, packRoots: inst.packRoots,
        cmsisToolbox: { dir: inst.cmsisToolboxBin, tools: toolbox },
        debugDrivers: inst.debugDrivers,
        licenseFiles: licenseFiles(inst),
      };
    },
  });

  register(ctx, {
    name: 'toolchain_versions',
    description: 'Query the bundled ARM toolchain: product, component and build for armcc, armasm, armlink, fromelf and armclang of the selected toolset.',
    inputSchema: { type: 'object', properties: { toolset: str('Toolset id/name/dir; default = first (highest) entry of ARMCCPATH<n>'), all: bool('Query every registered toolset') } },
    handler: async (args) => {
      const inst = ctx.install;
      if (!inst.found) return needsKeilDiagnostic(ctx, 'toolchain');
      const sets = args.all ? inst.toolsets : [resolveToolset(inst, args.toolset)];
      const out = [];
      for (const ts of sets) if (ts) out.push(await toolchainInfo(inst, ts));
      return { ok: true, toolsets: out };
    },
  });

  register(ctx, {
    name: 'tool_run',
    description: 'Run any bundled toolchain binary directly (armcc, armasm, armclang, armlink, fromelf, armar) with explicit arguments, in a chosen working directory. Returns stdout/stderr/exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: str('Tool name without .exe'),
        args: arr({ type: 'string' }, 'Arguments'),
        cwd: str('Working directory'),
        toolset: str('Toolset selection (id, name or dir); armcc/armasm auto-select the AC5 toolset'),
        timeoutMs: int('timeout (default 120000)'),
      },
      required: ['tool', 'args'],
    },
    handler: async (args) => {
      if (!ctx.install || !ctx.install.found) return needsKeilDiagnostic(ctx, 'tool_run');
      const inst = ctx.install;
      if (!inst.found) return needsKeilDiagnostic(ctx, 'toolchain');
      let ts = resolveToolset(inst, args.toolset);
      // armcc exists only in the Arm Compiler 5 toolset (ARMCC), armclang only in ARMCLANG.
      if (!args.toolset && !toolPath(inst, ts, args.tool)) {
        const alt = inst.toolsets.find(t => toolPath(inst, t, args.tool));
        if (alt) ts = alt;
      }
      const bin = toolPath(inst, ts, args.tool);
      if (!bin) return { ok: false, error: `tool not found: ${args.tool}`, toolset: ts };
      const { spawn } = await import('node:child_process');
      const r = await new Promise((resolve) => {
        const c = spawn(bin, args.args, { cwd: args.cwd || path.dirname(bin), windowsHide: true });
        let out = '', err = '';
        c.stdout.on('data', d => out += d);
        c.stderr.on('data', d => err += d);
        const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, args.timeoutMs || 120000);
        c.on('close', (code) => { clearTimeout(t); resolve({ exitCode: code, stdout: out, stderr: err }); });
        c.on('error', (e) => { clearTimeout(t); resolve({ exitCode: null, error: String(e.message || e) }); });
      });
      return { ok: r.exitCode === 0, tool: bin, ...r };
    },
  });

  register(ctx, {
    name: 'license_status',
    description: 'MDK license status: armlm/armlm-ipc/FlexNet files, running daemons, and an optional live build-gate probe that reports UV4 Error #601 (no MDK-ARM license).',
    inputSchema: { type: 'object', properties: { project: str('Project for the gate probe (optional)'), probe: bool('Run the build gate probe (default: only when project given)') } },
    handler: async (args) => {
      const inst = ctx.install;
      if (!inst.found) return needsKeilDiagnostic(ctx, 'toolchain');
      const project = args.project ? path.resolve(args.project) : null;
      const cfg = { ...ctx.cfg, uv4Exe: inst.uv4Exe };
      const st = await licenseStatus(cfg, inst, args.probe === false ? null : project);
      return { ok: true, ...st };
    },
  });

  register(ctx, {
    name: 'uvsock_probe',
    description: 'Probe the UVSOCK remote-control endpoint used by UV4 -s <port>: TCP reachability, greeting bytes after connect, and (optionally) a port-range scan. Purely observational.',
    inputSchema: {
      type: 'object',
      properties: {
        host: str('Host (default 127.0.0.1)'),
        port: int('Port (default $KEIL_UVSOCK_PORT or 4328)'),
        scan: int('Also scan this many consecutive ports from `port`'),
        banner: bool('Read the first bytes sent by the server (default true)'),
        waitMs: int('Wait up to this long for the port to open (default 0)'),
      },
    },
    handler: async (args) => {
      const host = args.host || '127.0.0.1';
      const port = args.port || Number(process.env.KEIL_UVSOCK_PORT || 4328);
      const reach = args.waitMs ? await waitForPort(host, port, args.waitMs) : await probePort(host, port, 1500);
      const out = { ok: true, host, port, reachable: reach.open, probe: reach };
      if (reach.open && args.banner !== false) out.banner = await readBanner(host, port, 2500);
      if (args.scan) out.scan = await scanRange(host, port, args.scan);
      out.listeners = (await describeLocalListeners()).listeners ? (await describeLocalListeners()).listeners.filter(l => l.Name && /UV4|Keil|armlm/i.test(l.Name)) : [];
      return out;
    },
  });

  register(ctx, {
    name: 'uv4_processes',
    description: 'List running UV4.exe processes with command lines. With kill=true terminates UV4 process trees (recovers hung -z/-q runs and stale instances holding a project lock).',
    inputSchema: { type: 'object', properties: { kill: bool('Terminate UV4 (and children)'), pid: int('Only this process') } },
    handler: async (args) => {
      const before = await listUv4Processes();
      if (!args.kill) return { ok: true, ...before };
      const r = await killUv4Processes(args.pid);
      const after = await listUv4Processes();
      return { ok: r.ok, before: before.processes, kill: r, remaining: after.processes };
    },
  });

  register(ctx, {
    name: 'debug_script',
    description: 'Compute and (optionally) run the UV4 -d debug-session invocation for a debugger initialization script (INCLUDE-style .ini), reporting the exact argv and the log. This is the CLI entry point into µVision\'s debugger commands (LOAD, GO, STEP, BreakSet, WatchSet, DEFINE, SIGNAL, LOG, EXIT ...).',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file'),
        target: str('Target'),
        script: str('Debugger init script (.ini) to write (contents)'),
        scriptPath: str('Existing script path (alternative to script)'),
        run: bool('Actually launch UV4 -d (default false: only prepare)'),
        timeoutMs: int('timeout (default 120000)'),
      },
      required: ['project'],
    },
    handler: async (args) => {
      const { runUv4 } = await import('../uv4cli.mjs');
      const project = path.resolve(args.project);
      let scriptPath = args.scriptPath ? path.resolve(args.scriptPath) : null;
      if (!scriptPath && args.script) {
        scriptPath = path.join(path.dirname(project), path.basename(project, path.extname(project)) + '.dbg.ini');
        fs.writeFileSync(scriptPath, args.script, 'utf8');
      }
      const argv = ['-j0', '-d', project, args.target ? `-t "${args.target}"` : null, scriptPath ? `-x "${scriptPath}"` : null].filter(Boolean).join(' ');
      if (!args.run) return { ok: true, prepared: true, argv, scriptPath, hint: 'UV4 -d runs the script in Debug Mode; finish the session with EXIT inside the script. Use -s <port> together with uvsock_probe for headless control.' };
      const logPath = path.join(path.dirname(project), path.basename(project, path.extname(project)) + '.debug.log');
      const r = await runUv4(ctx.cfg, { exe: ctx.install.uv4Exe, command: '-d', project, target: args.target || null, outputLog: logPath, extra: ['-x', scriptPath], timeoutMs: args.timeoutMs || 120000, hideGui: true });
      return { ok: r.ok, argv, exitCode: r.exitCode, timedOut: r.timedOut, logPath, logTail: (r.log || '').split(/\r?\n/).slice(-40).join('\n') };
    },
  });

  register(ctx, {
    name: 'debug_command_reference',
    description: 'Catalogue of the µVision debugger command set recovered from the shipped help (uv4.chm): command, syntax summary, and the group it belongs to (execution, breakpoints, trace, variables, scripting).',
    inputSchema: { type: 'object', properties: { group: str('Filter by group') } },
    handler: async (args) => {
      const cmds = DEBUG_COMMANDS.filter(c => !args.group || c.group.toLowerCase() === String(args.group).toLowerCase());
      return { ok: true, count: cmds.length, commands: cmds };
    },
  });

  register(ctx, {
    name: 'cli_table',
    description: 'Raw recovered UV4 CLI table (commands, options, ERRORLEVEL) — identical to the cli_reference tool, provided for discoverability from the system group.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, commands: UV4_COMMANDS, options: UV4_OPTIONS, errorlevel: UV4_ERRORLEVEL }),
  });
}

const DEBUG_COMMANDS = [
  { group: 'execution', name: 'Go', syntax: 'g [addr|main|func]', desc: 'Start execution; optional stop address' },
  { group: 'execution', name: 'Tstep', syntax: 't | t stepcount | ts func', desc: 'Single step (into)' },
  { group: 'execution', name: 'Pstep', syntax: 'p | p stepcount | ps func', desc: 'Step over' },
  { group: 'execution', name: 'Ostep', syntax: 'o', desc: 'Step out of current function' },
  { group: 'execution', name: 'KILL', syntax: 'kill', desc: 'Stop program execution' },
  { group: 'execution', name: 'RESET', syntax: 'reset', desc: 'Reset the target' },
  { group: 'execution', name: 'EXIT', syntax: 'exit', desc: 'Exit debug mode (ends a -d batch session)' },
  { group: 'execution', name: 'SBC', syntax: 'sbc stepcount', desc: 'Step into branch (Cortex-M)' },
  { group: 'breakpoints', name: 'BreakSet', syntax: 'bs addr [,count[,commands]]', desc: 'Set execution breakpoint' },
  { group: 'breakpoints', name: 'BreakKill', syntax: 'bk addr', desc: 'Remove breakpoint' },
  { group: 'breakpoints', name: 'BreakEnable/BreakDisable', syntax: 'be|bd addr', desc: 'Enable/disable breakpoint' },
  { group: 'breakpoints', name: 'BreakList', syntax: 'bl', desc: 'List breakpoints' },
  { group: 'breakpoints', name: 'BreakAccess', syntax: 'ba expr [,access [,count]]', desc: 'Access (read/write) breakpoint' },
  { group: 'variables', name: 'WatchSet', syntax: 'ws expr [,format]', desc: 'Add watch expression' },
  { group: 'variables', name: 'WatchKill', syntax: 'wk index', desc: 'Remove watch' },
  { group: 'variables', name: 'EVALuate', syntax: 'eval expr', desc: 'Evaluate an expression' },
  { group: 'variables', name: 'ASSIGN', syntax: 'assign expr=value', desc: 'Assign to a variable/memory' },
  { group: 'variables', name: 'DISPLAY', syntax: 'display type [address], count', desc: 'Display memory contents' },
  { group: 'variables', name: 'ENTER', syntax: 'enter type address, value ...', desc: 'Write memory' },
  { group: 'memory', name: 'SAVE', syntax: 'save filename, address1, address2', desc: 'Dump memory to Intel HEX' },
  { group: 'memory', name: 'LOAD', syntax: 'load filename [INCREMENTAL]', desc: 'Load program image' },
  { group: 'memory', name: 'MAP', syntax: 'map addr[,addr] , expr', desc: 'Map memory address to expression' },
  { group: 'memory', name: 'Unassemble', syntax: 'u [addr[,addr]]', desc: 'Disassemble memory' },
  { group: 'memory', name: 'Enter', syntax: 'enter', desc: 'Enter memory values' },
  { group: 'trace', name: 'TraceEnable/TraceDisable', syntax: 'te|td', desc: 'Enable/disable trace capture' },
  { group: 'trace', name: 'TraceRun/TraceSuspend/TraceHalt', syntax: 'tr|tsu|th', desc: 'ETM trace control' },
  { group: 'trace', name: 'TraceList', syntax: 'tl', desc: 'List trace records' },
  { group: 'trace', name: 'TraceAccessPoint', syntax: 'tap addr', desc: 'Trace point' },
  { group: 'trace', name: 'TraceDataPoint', syntax: 'tdp', desc: 'Trace data point' },
  { group: 'trace', name: 'LogicAnalyze', syntax: 'la ...', desc: 'Logic analyzer signals' },
  { group: 'trace', name: 'PerformanceAnalyze', syntax: 'pa ...', desc: 'Performance analysis' },
  { group: 'trace', name: 'COVERAGE', syntax: 'coverage cmd', desc: 'Code coverage control' },
  { group: 'trace', name: 'COVTOFILE', syntax: 'covtofile file', desc: 'Write coverage data' },
  { group: 'trace', name: 'EventRecorder', syntax: 'er ...', desc: 'Event recorder control' },
  { group: 'trace', name: 'IRLOG/ITMLOG', syntax: 'irlog ... | itmlog ...', desc: 'Instruction/ITM trace logging' },
  { group: 'scripting', name: 'FUNC', syntax: 'func f_name(args) { body }', desc: 'Define a C-like debugger function' },
  { group: 'scripting', name: 'SIGNAL', syntax: 'signal void name(args) { ... twatch(n) ... }', desc: 'Define a signal function (simulation)' },
  { group: 'scripting', name: 'DEFINE', syntax: 'define button "text","command"', desc: 'Toolbox button definition' },
  { group: 'scripting', name: 'INCLUDE', syntax: 'include file.ini', desc: 'Execute a script file' },
  { group: 'scripting', name: 'LOG', syntax: 'log >file | log >>file | log off', desc: 'Redirect command window output' },
  { group: 'scripting', name: 'SCOPE', syntax: 'scope funcname', desc: 'Set current scope for locals' },
  { group: 'scripting', name: 'SET', syntax: 'set [type] [name]', desc: 'Set variable display type' },
  { group: 'scripting', name: 'MODE', syntax: 'mode', desc: 'Debugger mode information' },
  { group: 'scripting', name: 'DIR', syntax: 'dir', desc: 'Directory of the application' },
  { group: 'scripting', name: 'ASM', syntax: 'asm inline assembler', desc: 'Assemble inline instruction' },
  { group: 'scripting', name: 'SLOG', syntax: 'slog ...', desc: 'System log redirection' },
];

