// server.mjs — MCP entry point: registers every Keil/µVision tool.
import { Server, errorResult } from './mcp.mjs';
import { toolCountValue } from './tools/common.mjs';
export { toolCountValue as registeredToolCount };
import { DEFAULT_CONFIG, discoverInstall, resolveToolset } from './config.mjs';
import { packRoots as portablePackRoots, uv4DataDir, cdbDumpPath, fixtureManifest, toolchainAvailable, needsKeil } from './portable.mjs';
import { JobManager } from './jobs.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerUv4Tools } from './tools/uv4.mjs';
import { registerProjectTools } from './tools/project.mjs';
import { registerDepTools } from './tools/deps.mjs';
import { registerPackTools } from './tools/packs.mjs';
import { registerImageTools } from './tools/image.mjs';
import { registerSystemTools } from './tools/system.mjs';
import { registerScaffoldExtra } from './tools/scaffold_extra.mjs';
import { registerMultiProjectTools } from './tools/multiproject.mjs';
import { registerOptionsTools } from './tools/options.mjs';
import { registerImportTools } from './tools/importxml.mjs';
import { registerBatchTools } from './tools/batchgen.mjs';
import { registerGdbStubTools } from './tools/gdbstub.mjs';
import { registerModuleTools } from './tools/modules.mjs';
import { registerCompileTools } from './tools/compile.mjs';
import { registerPackManagerTools } from './tools/packmgr.mjs';

// Report the packaged version, never a hand-maintained copy of it.
const PKG_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

export function createServer(opts = {}) {
  const install = discoverInstall(opts.mdkRoot);
  const cfg = {
    ...DEFAULT_CONFIG,
    uv4TimeoutMs: Number(process.env.UV4_TIMEOUT_MS || DEFAULT_CONFIG.uv4TimeoutMs),
    ...(install.found ? { uv4Exe: install.uv4Exe, uv4Dir: install.uv4Dir } : {}),
  };
  const server = new Server({
    name: 'keil-uv4-mcp',
    version: PKG_VERSION,
    instructions: [
      'Keil µVision (UV4) full-surface MCP server.',
      install.found
        ? `Keil install: ${install.root} (full toolchain available)`
        : 'Portable mode: no Keil installation found — project/dep/pack/device/image/UVSOCK tools work from the bundled fixture snapshot; build/convert/tool_run/license need KEIL_MDK_ROOT.',
      'Build via uv4_build/uv4_rebuild (async jobs) or uv4_run for any CLI command.',
      'Inspect projects with project_read; create with project_create (device DB aware).',
      'Use dep_impact before a build to know which translation units are dirty.',
      'uvsock_probe + uv4_processes control a running IDE; license_status reports the #601 gate.',
    ].join('\n'),
  });
  const jobs = new JobManager({
    maxConcurrent: cfg.maxConcurrentUv4,
    notify: (job) => server.notify('notifications/message', { level: 'info', logger: 'uv4-job', data: { jobId: job.id, state: job.state, kind: job.kind, project: job.project, target: job.target, summary: job.result && job.result.summary || null } }),
  });
  // Portable data facade: tools ask ctx.data.* instead of ctx.install.*. With a real
  // installation these resolve to the live files; without one they fall back to the
  // bundled fixture snapshot, so the server stays fully functional.
  const data = {
    packRoots: () => portablePackRoots(install),
    uv4Dir: () => uv4DataDir(install),
    cdbXml: (override) => cdbDumpPath(install, override),
    manifest: () => fixtureManifest(),
    toolchainAvailable: () => toolchainAvailable(install),
    needsKeil: (feature) => needsKeil(feature, install),
  };
  const ctx = { server, cfg, install, data, jobs, config: () => cfg };
  const registrars = [registerUv4Tools, registerProjectTools, registerDepTools, registerPackTools, registerImageTools, registerSystemTools, registerScaffoldExtra, registerMultiProjectTools, registerOptionsTools, registerImportTools, registerBatchTools, registerGdbStubTools, registerModuleTools, registerCompileTools, registerPackManagerTools];
  for (const reg of registrars) {
    try { reg(ctx); } catch (e) { process.stderr.write(`tool registration failed: ${reg.name}: ${e && e.stack || e}\n`); }
  }
  // Resource: recovered CLI reference JSON.
  server.resource({
    uri: 'keil://cli/reference',
    name: 'UV4 CLI reference',
    description: 'Recovered UV4 command/option/ERRORLEVEL table',
    mimeType: 'application/json',
    read: () => JSON.stringify({ commands: ctx.cliCommands, options: ctx.cliOptions, errorlevel: ctx.cliErrorlevel }, null, 2),
  });
  return { server, ctx, install, cfg };
}

/** Wrap a sync/async implementation into an MCP tool handler returning JSON text. */
export function toolResult(data) {
  if (data && typeof data === 'object' && data.ok === false) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function tryTool(fn) {
  return async (args, ctx) => {
    try { return toolResult(await fn(args, ctx)); }
    catch (e) { return errorResult(String((e && e.message) || e), { stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4) : null }); }
  };
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    // Compare canonical paths, not spellings: `node .\src\server.mjs`, an 8.3 short path
    // (C:\Users\ERDAN~1.DES\...), a symlink, or different letter case must all count as
    // "started directly" — otherwise the server imports cleanly and then exits silently.
    const canon = (p) => {
      let r = path.resolve(p);
      try { r = fs.realpathSync.native ? fs.realpathSync.native(r) : fs.realpathSync(r); } catch { /* keep resolved form */ }
      return process.platform === 'win32' ? r.toLowerCase() : r;
    };
    return canon(process.argv[1]) === canon(fileURLToPath(import.meta.url));
  } catch { return false; }
})();

if (isMain || process.env.KEIL_MCP_AUTOSTART === '1') {
  const { server, install } = createServer();
  process.stderr.write(`keil-uv4-mcp: ${server.tools.size} tools, ${install.found ? 'install=' + install.root : 'PORTABLE (no Keil install; fixtures active)'}\n`);
  server.listen(process.stdin);
}







