// tools/modules.mjs — MCP tools for the companion binaries & decoded data formats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { register, str, int, bool, arr, enumOf } from './common.mjs';
import { UvsockClient, SVC, EVT } from '../uvsock.mjs';
import { cdbFind, loadCdb, clearCdbCache } from '../cdb.mjs';
import { editorProfile, parseProps, expandVar, listSvcs, parseSvcs } from '../editor.mjs';
import { inspectPack, extractPack, readPackEntryText } from '../packfile.mjs';
import { readGuiLayout, readDbgconf } from '../formats.mjs';
import { runConsole, UVISION_COM_CONTRACT } from '../consolewrap.mjs';
import { moduleCatalogPath, FIXTURE_LAYOUT } from '../portable.mjs';
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The catalogue is loaded on first use, never at import time: a package copied without
// the development tree (reverse/) must still start, and simply report the catalogue as
// unavailable instead of failing the whole server.
let _catalogState = null;
function loadCatalog() {
  if (_catalogState) return _catalogState;
  const file = moduleCatalogPath();
  if (!file) return (_catalogState = { file: null, data: null, error: 'module_catalog.json is not bundled with this copy (expected data/fixtures/catalog/module_catalog.json, or set KEIL_MCP_MODULE_CATALOG)' });
  try { return (_catalogState = { file, data: JSON.parse(fs.readFileSync(file, 'utf8')), error: null }); }
  catch (e) { return (_catalogState = { file, data: null, error: `module_catalog.json at ${file} is unreadable: ${String(e.message || e)}` }); }
}


function runCap(exe, args, { cwd, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let c;
    try { c = spawn(exe, args, { cwd: cwd || path.dirname(exe), windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: String(e.message || e) }); return; }
    let out = '', err = '';
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => err += d);
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, timeoutMs);
    c.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, exitCode: code, stdout: out, stderr: err }); });
    c.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e), stdout: out, stderr: err }); });
  });
}

export function registerModuleTools(ctx) {
  // Data directory: live UV4 folder when installed, else the bundled fixture snapshot.
  const uv4Dir = ctx.data ? ctx.data.uv4Dir() : (ctx.install && ctx.install.uv4Dir) || null;
  const serverPkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cdbDump = (p) => {
    if (p) return path.resolve(p);
    if (ctx.data) return ctx.data.cdbXml();
    // Fallbacks for callers without the facaded ctx: development tree first, bundled copy second.
    const dev = path.join(process.env.KEIL_MCP_REVERSE_DIR || path.join(serverPkgRoot, 'reverse'), 'cdb', 'uv4_cdb.xml');
    return fs.existsSync(dev) ? dev : path.join(FIXTURE_LAYOUT.cdb, 'uv4_cdb.xml');
  };

  // ---------- UVSOCK remote-control client ----------
  register(ctx, {
    name: 'uvsock_service_table',
    description: 'The UVSOCK wire protocol reference decoded from UVSC.dll: 32-byte little-endian frame [totalLen,serviceId,dataLen,reserved×5]+payload, plain TCP, ACK=0xC after every request, error frames 0x201F, build events 0x5000/0x5001. Lists every service id with evidence addresses.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      ok: true,
      frame: { headerBytes: 32, endian: 'little', fields: ['u32 totalLen=0x20+dataLen', 'u32 serviceId', 'u32 dataLen', 'u32[5] reserved=0', 'payload'] },
      services: SVC, events: EVT,
      evidence: 'reverse/uvsock_protocol.md (UVSC.dll v2.30 FUN_1000ae90/FUN_1000b760/UVSC_CreateMsg decompilation)',
      activation: 'start the server with uv4_run {command:"-d" or -b…, socketPort:N} or GUI Tools→Options→UVSOCK; default port in this build is $KEIL_UVSOCK_PORT (4328)',
    }),
  });

  register(ctx, {
    name: 'uvsock_connect',
    description: 'Open a live UVSOCK session against a running µVision (UV4 -s <port> or Tools→Options→UVSOCK Enable). Performs the handshake version query (service 0x0001) and returns the protocol version + license capability record (0x000B).',
    inputSchema: { type: 'object', properties: { host: str('default 127.0.0.1'), port: int('default $KEIL_UVSOCK_PORT/4328') } },
    handler: async (args) => {
      const client = new UvsockClient(args.host || '127.0.0.1', args.port || Number(process.env.KEIL_UVSOCK_PORT || 4328));
      try {
        await client.connect(3000);
        const version = await client.version();
        let license = null;
        try { license = await client.checkLicense(); } catch (e) { license = { error: String(e.message || e) }; }
        ctx.uvsock = client;
        return { ok: true, connected: true, host: client.host, port: client.port, protocolVersion: version, license, note: 'session kept open for uvsock_request; disconnect with uvsock_disconnect' };
      } catch (e) {
        try { client.close(); } catch {}
        return { ok: false, error: `UVSOCK handshake failed: ${String(e.message || e)}`, hint: 'start µVision with a socket port: uv4_run {command:"-d", socketPort:4328} (or enable in Tools→Options)' };
      }
    },
  });

  register(ctx, {
    name: 'uvsock_request',
    description: 'Drive a connected µVision over UVSOCK: version/license/prj_load/prj_build/prj_rebuild/enum_targets/get_optitem/set_optitem/mem_read/status/exec_cmd(raw text)/raw(<hex serviceId>). Uses the decoded frame protocol; returns the response payload decoded per service.',
    inputSchema: {
      type: 'object',
      properties: {
        op: enumOf(['version', 'license', 'prj_load', 'prj_build', 'prj_rebuild', 'enum_targets', 'get_optitem', 'set_optitem', 'mem_read', 'status', 'exec_cmd', 'ack_now', 'raw'], 'operation'),
        value: str('path for prj_load; key for get_optitem; "KEY=VALUE" for set_optitem; command text for exec_cmd'),
        value2: str('second value (set_optitem value; mem_read length; raw payload hex)'),
        address: str('mem_read address (hex)'),
        host: str('connect if not connected'), port: int('port'),
        timeoutMs: int('per-request timeout (default 10000; build 15000 + poll 0..60000 for output)'),
      },
      required: ['op'],
    },
    handler: async (args) => {
      let client = ctx.uvsock;
      if (!client || !client.sock) {
        client = new UvsockClient(args.host || '127.0.0.1', args.port || Number(process.env.KEIL_UVSOCK_PORT || 4328));
        await client.connect(3000);
        ctx.uvsock = client;
      }
      switch (args.op) {
        case 'version': return { ok: true, ...(await client.version()) };
        case 'license': return { ok: true, ...(await client.checkLicense()) };
        case 'prj_load': return { ok: true, ...(await client.loadProject(args.value)) };
        case 'prj_build': case 'prj_rebuild': {
          const collect = Math.min(args.timeoutMs && args.timeoutMs > 15000 ? args.timeoutMs : 8000, 60000);
          const r = await client.build({ rebuild: args.op === 'prj_rebuild', collectMs: collect });
          return { ok: true, ...r };
        }
        case 'enum_targets': return { ok: true, ...(await client.enumTargets()) };
        case 'get_optitem': return { ok: true, ...(await client.getOptItem(args.value)) };
        case 'set_optitem': return { ok: true, ...(await client.setOptItem(args.value, args.value2 || '')) };
        case 'mem_read': return { ok: true, ...(await client.memRead(parseInt(args.address, 16), Number(args.value || args.value2 || 64))) };
        case 'status': return { ok: true, ...(await client.status()) };
        case 'exec_cmd': return { ok: true, ...(await client.exec(args.value)) };
        case 'ack_now': await client._sendAck(); return { ok: true, acked: true };
        case 'raw': {
          const id = parseInt(String(args.value).replace(/^0x/i, ''), 16);
          const payload = args.value2 ? Buffer.from(args.value2, 'hex') : Buffer.alloc(0);
          const f = await client.request(id, payload, { timeoutMs: args.timeoutMs || 10000 });
          return { ok: true, serviceId: '0x' + f.id.toString(16), dataLen: f.dataLen, payloadHex: f.payload.toString('hex'), payloadText: f.payload.toString('latin1').replace(/[^\x20-\x7e]/g, '.') };
        }
        default: return { ok: false, error: 'unknown op' };
      }
    },
  });

  register(ctx, {
    name: 'uvsock_disconnect',
    description: 'Close the cached UVSOCK TCP session.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => { if (ctx.uvsock) { try { ctx.uvsock.close(); } catch {} ctx.uvsock = null; } return { ok: true, closed: true }; },
  });

  // ---------- legacy .cdb device database ----------
  register(ctx, {
    name: 'cdb_devices',
    description: 'Query the built-in UV4.cdb device database (2831 devices / 33 vendors, converted with UVCDB2XML.exe; the dump is bundled at data/fixtures/cdb/uv4_cdb.xml, or regenerated from a live install with refresh). Legacy startup/system file paths, include header, core, family, description.',
    inputSchema: { type: 'object', properties: { query: str('device substring'), limit: int('max 500'), refresh: bool('re-run UVCDB2XML') } },
    handler: async (args) => {
      if (args.refresh) { clearCdbCache(); }
      const hits = await cdbFind(uv4Dir, cdbDump(), args.query || '', Math.min(args.limit || 50, 500));
      return { ok: true, query: args.query || '', count: hits.length, devices: hits };
    },
  });

  register(ctx, {
    name: 'cdb_vendors',
    description: 'Vendor list of the legacy device database with device counts (vendorId is the numeric ID UV4 stores in projects).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const db = await loadCdb(uv4Dir, cdbDump());
      return { ok: true, vendors: db.vendors };
    },
  });

  // ---------- editor / source control configuration ----------
  register(ctx, {
    name: 'editor_props',
    description: 'Read the µVision editor configuration chain (global.prop.def defaults + global.prop user overrides + <a|c><tool>.prop.def + <tool>.prop) — the SciTE/Scintilla (UvEdit.dll 4.4.6) property model: key=value, $(var) expansion, keywords per file-pattern. Optionally expand one key.',
    inputSchema: { type: 'object', properties: { tool: str('tool prefix (default arm)'), key: str('specific key to resolve with $(var) expansion') } },
    handler: async (args) => {
      const files = editorProfile(uv4Dir, args.tool || 'arm');
      const merged = { vars: {}, entries: [] };
      for (const f of files) for (const [k, v] of Object.entries(f.props.vars)) merged.vars[k] = v;
      const out = { ok: true, files: files.map(f => ({ file: f.file, kind: f.kind, entries: f.props.entries.length, comments: f.props.comments.slice(0, 8) })) };
      if (args.key) {
        const eff = merged.vars[args.key];
        out.key = { key: args.key, raw: eff === undefined ? null : eff, expanded: eff === undefined ? null : expandVar({ vars: merged.vars }, eff) };
      }
      return out;
    },
  });

  register(ctx, {
    name: 'svcs_menus',
    description: 'Parse the .SVCS source-control menu files (UTF-16 INI consumed by UVSC.dll/UVSC64.dll bridge): every MenuItem with Command/Arguments/QueryComment/QueryRevision (uv4 ships GIT/CVS/Perforce/SVN/SourceSafe/… definitions).',
    inputSchema: { type: 'object', properties: { file: str('specific .svcs file, else all') } },
    handler: async (args) => {
      if (args.file) return { ok: true, svcs: parseSvcs(path.resolve(args.file)) };
      return { ok: true, files: listSvcs(uv4Dir) };
    },
  });

  // ---------- .pack archive reader ----------
  register(ctx, {
    name: 'pack_file_inspect',
    description: 'Inspect a .pack file (CMSIS-Pack = ZIP + PDSC): sha256, entries, top-level files, directories — the integrity view PackUnzip/-installer use.',
    inputSchema: { type: 'object', properties: { file: str('.pack path') }, required: ['file'] },
    handler: async (args) => {
      const f = path.resolve(args.file);
      if (!fs.existsSync(f)) return { ok: false, error: `not found: ${f}` };
      return { ok: true, ...inspectPack(f) };
    },
  });

  register(ctx, {
    name: 'pack_file_extract',
    description: 'Extract a .pack archive into a directory (PackUnzip --no-gui equivalent; zip-slip protected). Optionally read just the PDSC text.',
    inputSchema: {
      type: 'object',
      properties: { file: str('.pack path'), outputDirectory: str('destination'), pdscOnly: bool('return PDSC text instead of extracting') },
      required: ['file'],
    },
    handler: async (args) => {
      const f = path.resolve(args.file);
      if (args.pdscOnly) {
        const info = inspectPack(f);
        if (!info.pdscEntry) return { ok: false, error: 'no top-level .pdsc in pack' };
        return { ok: true, entry: info.pdscEntry, text: readPackEntryText(f, info.pdscEntry) };
      }
      const out = args.outputDirectory ? path.resolve(args.outputDirectory) : path.resolve(path.dirname(f), path.basename(f, '.pack'));
      return { ok: true, ...extractPack(f, out) };
    },
  });

  // ---------- companion tool runners ----------
  register(ctx, {
    name: 'companion_run',
    description: 'Run the UV4 companion binaries with their real CLI (each behaviour verified this session): uv2csolution (<.uvprojx> → app.csolution.yml/app.cproject.yml/vcpkg-configuration.json; refuses AC5 targets), UVCDB2XML (cdb→XML to stdout), SfrCC2 <base.sfr> (SFR preprocessor → .LST/.S file), SVDConv <svd> [flags] (check/generate header), PackUnzip [-i] <pack> [-o dir] [--no-gui|-p|-l|-v] (GUI subsystem: use pack_file_extract instead unless real flags needed), DoxyIndex, KSPAWN (console spawner: kspawn "cmd line").',
    inputSchema: {
      type: 'object',
      properties: {
        tool: enumOf(['uv2csolution', 'UVCDB2XML', 'SfrCC2', 'SVDConv', 'PackUnzip', 'DoxyIndex', 'KSPAWN'], 'companion exe'),
        args: arr({ type: 'string' }, 'arguments'),
        cwd: str('working directory'),
        timeoutMs: int('default 60000 (GUI-subsystem tools may be killed at timeout)'),
      },
      required: ['tool'],
    },
    handler: async (args) => {
      const exeMap = {
        uv2csolution: 'uv2csolution.exe', UVCDB2XML: 'UVCDB2XML.exe', SfrCC2: 'SfrCC2.Exe',
        SVDConv: 'SVDConv.exe', PackUnzip: 'PackUnzip.exe', DoxyIndex: 'DoxyIndex.exe', KSPAWN: 'KSPAWN.EXE',
      };
      const exe = path.join(uv4Dir, exeMap[args.tool]);
      if (!fs.existsSync(exe)) return { ok: false, error: `not found: ${exe}` };
      const r = await runCap(exe, args.args || [], { cwd: args.cwd, timeoutMs: args.timeoutMs || 60000 });
      const projDir = args.cwd && args.tool === 'uv2csolution' ? args.cwd : (args.args && args.args[args.args.length - 1] && path.dirname(path.resolve(args.args[args.args.length - 1])));
      const produced = args.tool === 'uv2csolution' && projDir && fs.existsSync(projDir)
        ? fs.readdirSync(projDir).filter(f => /\.(csolution\.yml|cproject\.yml)$/.test(f) || f === 'vcpkg-configuration.json').map(f => path.join(projDir, f)) : [];
      return { ...r, tool: args.tool, exe, producedFiles: produced };
    },
  });


  // ---------- uvguix / dbgconf readers ----------
  register(ctx, {
    name: 'gui_layout_read',
    description: 'Read a .uvguix window/dock-layout file (project_guix.xsd ProjectGui: DockMan windows RegID/PaneID/IsFloating/PinState/rects, toolbar ControlBarsSummary). µVision stores per-user copies <project>.uvguix.<USER> beside the project; DFP samples ship bare .uvguix templates.',
    inputSchema: { type: 'object', properties: { file: str('.uvguix path') }, required: ['file'] },
    handler: async (args) => { try { return { ok: true, ...readGuiLayout(path.resolve(args.file)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } },
  });

  register(ctx, {
    name: 'dbgconf_read',
    description: 'Parse an RTE .dbgconf (Keil Configuration Wizard comment grammar: //<h> groups, //<o.bit> NAME //<i> help, #define values) — the debug-configuration data behind the System Viewer/debug tab (e.g. STM32F10x DBGMCU_CR stop-on-halt bits).',
    inputSchema: { type: 'object', properties: { file: str('.dbgconf path') }, required: ['file'] },
    handler: async (args) => { try { return { ok: true, ...readDbgconf(path.resolve(args.file)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } },
  });

  register(ctx, {
    name: 'module_catalog',
    description: 'The full reverse-engineered catalogue of every binary and data format in the UV4 install directory (25 modules: roles, versions, PE arch, export tables incl. UVSC 103 / UVSCWrapper 275 / UVAC 14 / armlm.dll 4, CLI syntax, plus 8 data formats). Optional module filter.',
    inputSchema: { type: 'object', properties: { module: str('module key substring e.g. UVSC or armlm') } },
    handler: async (args) => {
      const state = loadCatalog();
      if (!state.data) return { ok: false, error: state.error, catalogFile: state.file };
      const CATALOG = state.data;
      const q = String(args.module || '').toLowerCase();
      const mods = Object.fromEntries(Object.entries(CATALOG.modules).filter(([k]) => !q || k.toLowerCase().includes(q)));
      return { ok: true, catalogFile: state.file, dir: CATALOG.dir, modules: mods, moduleCount: Object.keys(mods).length, formats: CATALOG.formats, source: CATALOG.source };
    },
  });

  // ---------- uvision.com equivalent ----------
  register(ctx, {
    name: 'uv4_console',
    description: 'uvision.com equivalent (µVision command line, v5.36.0.0 / class uVisionLauncher): forward any UV4 command line to uv4.exe with stdout/stderr mirrored and the ERRORLEVEL propagated. Reconstructed from the real launcher (KERNEL32-only imports: CreateNamedPipeA/ConnectNamedPipe for \\.\\pipe\\<pid>cout|cin|cerr, GetCommandLineA forwarding, ResumeThread, WaitForSingleObject exit-code propagation, SetConsoleCtrlHandler for Ctrl+C). Use instead of uv4_build when you want the child console text.',
    inputSchema: {
      type: 'object',
      properties: {
        args: arr({ type: 'string' }, 'argv forwarded verbatim, e.g. ["-b","C:\\p\\app.uvprojx","-j0","-o","log.txt"]'),
        cwd: str('working directory (default: UV4 dir)'),
        timeoutMs: int('default 900000; on expiry the process tree is killed'),
        env: { type: 'object', description: 'extra environment variables', additionalProperties: { type: 'string' } },
      },
      required: ['args'],
    },
    handler: async (args) => {
      const r = await runConsole({
        uv4Exe: (ctx.install && ctx.install.uv4Exe) || '', args: args.args || [],
        cwd: args.cwd, timeoutMs: args.timeoutMs || 900000, env: args.env,
      });
      return { ...r, contract: UVISION_COM_CONTRACT.behavior.slice(0, 3) };
    },
  });

  register(ctx, {
    name: 'uvision_com_reference',
    description: 'The reconstructed uvision.com (µVision command line) contrat: PID-suffixed named pipes, KERNEL32-only import list, argv forwarding, exit-code propagation and Ctrl+C handling.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, ...UVISION_COM_CONTRACT }),
  });

  // ---------- license architecture dossier ----------
  register(ctx, {
    name: 'license_architecture',
    description: 'The decoded license architecture (static evidence): UV4.exe imports armlm.dll → armlm_request_capabilities/armlm_cleanup; armlm.exe + armlm-ipc.exe are Go 1.24.5 binaries wrapping the FlexNet Embedded (FNE, "lm-merge-to-master") client (FLXERR_* codes, trusted storage), activation against https://api.arm.com/p-software-licensing/v1/activate with nonce-signed ActivationRequest/Response; local store under ~/.armlm (logs lm_*.log), usage-analytics cache; armlm-gui.exe manages activation; legacy FlexNet/armlmd (lmgrd family) remains for network licenses. Read-only reporting; never modifies license state.',
    inputSchema: { type: 'object', properties: { detail: str('section: imports|go|fne|paths') } },
    handler: async (args) => {
      const base = {
        ok: true,
        dllExports: { 'armlm.dll': ['armlm_request_capabilities', 'armlm_cleanup', 'armlm_ext_request_capabilities', 'armlm_ext_cleanup'], 'UV4.dll(DCOMUTIL30)': ['2 exports (DDE/automation glue)'] },
        uv4Imports: 'armlm.dll → armlm_cleanup, armlm_request_capabilities (PE import table, evidence ev_a6e7866a…)',
        goBinaries: { runtime: 'go1.24.5', modules: ['armlm.exe (daemon+CLI)', 'armlm-ipc.exe (HTTP/2 loopback IPC shim)', 'armlm-ipc bundled payload streams license data to armlm.exe'], symbols: ['storeLicense', 'DeleteLicense', 'RenewLicenses', 'doActivation/doReactivation/doActivationNow/doActivationWithLock', 'getMachineID', 'ActivationServerURL', 'proxyActivationData', 'licenseSources/memLicenseSource', 'usage analytics cache'] },
        fne: 'FlexNet Embedded client (CGO, fne-client includes): FLXERR_* codes, trusted storage, capability requests, host-id callouts, tolerance specifiers, metered/preview/server licenses',
        endpoints: { activation: 'https://api.arm.com/p-software-licensing/v1/activate (HTTPS POST, nonce mandatory)', localStore: '~/.armlm (logs, cache)' },
        legacy: 'FlexNet/armlmd.exe (lmgrd-style) + armlmdiag.exe diagnostics for floating/network licenses',
        gate: 'UV4 build refuses with "Error #601: cannot start build: no MDK-ARM license is available" (string 0xbf7168)',
      };
      if (args.detail) {
        const k = { imports: 'uv4Imports', go: 'goBinaries', fne: 'fne', paths: 'endpoints' }[args.detail];
        return k ? { ok: true, section: args.detail, value: base[k] } : { ok: false, error: 'detail ∈ imports|go|fne|paths', sections: Object.keys(base) };
      }
      return base;
    },
  });
}

