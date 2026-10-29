import fs from "node:fs";
const p = new URL("../src/tools/modules.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
if (t.includes("uv4_console")) { console.log("already present"); process.exit(0); }
t = t.replace(
  "import { readGuiLayout, readDbgconf } from '../formats.mjs';",
  "import { readGuiLayout, readDbgconf } from '../formats.mjs';\nimport { runConsole, UVISION_COM_CONTRACT } from '../consolewrap.mjs';"
);
const block = `  // ---------- uvision.com equivalent ----------
  register(ctx, {
    name: 'uv4_console',
    description: 'uvision.com equivalent (µVision command line, v5.36.0.0 / class uVisionLauncher): forward any UV4 command line to uv4.exe with stdout/stderr mirrored and the ERRORLEVEL propagated. Reconstructed from the real launcher (KERNEL32-only imports: CreateNamedPipeA/ConnectNamedPipe for \\\\.\\\\pipe\\\\<pid>cout|cin|cerr, GetCommandLineA forwarding, ResumeThread, WaitForSingleObject exit-code propagation, SetConsoleCtrlHandler for Ctrl+C). Use instead of uv4_build when you want the child console text.',
    inputSchema: {
      type: 'object',
      properties: {
        args: arr({ type: 'string' }, 'argv forwarded verbatim, e.g. ["-b","C:\\\\p\\\\app.uvprojx","-j0","-o","log.txt"]'),
        cwd: str('working directory (default: UV4 dir)'),
        timeoutMs: int('default 900000; on expiry the process tree is killed'),
        env: { type: 'object', description: 'extra environment variables', additionalProperties: { type: 'string' } },
      },
      required: ['args'],
    },
    handler: async (args) => {
      const r = await runConsole({
        uv4Exe: ctx.install.uv4Exe, args: args.args || [],
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

  // ---------- license architecture dossier ----------`;
t = t.replace("  // ---------- license architecture dossier ----------", block);
fs.writeFileSync(p, t);
console.log("uv4_console + uvision_com_reference added");
