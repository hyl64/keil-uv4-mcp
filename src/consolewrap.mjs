// consolewrap.mjs — equivalent of uvision.com (v5.36.0.0 "µVision command line",
// class uVisionLauncher), reconstructed from its import table + strings.
//
// Verified facts (reverse/modules.md):
//   imports: KERNEL32 only (90 APIs) — CreateNamedPipeA, ConnectNamedPipe, ReadFile,
//            WriteFile, GetCommandLineA, GetModuleFileNameA, WaitForSingleObject,
//            GetExitCodeProcess, TerminateProcess, ResumeThread, SetConsoleCtrlHandler, Beep
//   strings: "\\.\pipe\%dcout", "\\.\pipe\%dcin", "\\.\pipe\%dcerr",
//            "ERROR: Could not create named pipes.", "uv4.exe"
//   => It creates three PID-suffixed named pipes (stdout/stdin/stderr), launches
//      uv4.exe as a suspended process whose std handles are those pipes, resumes it,
//      pumps the pipes into the caller's console (ReadConsoleW/WriteConsoleW) and
//      propagates the child exit code. Ctrl+C is forwarded via SetConsoleCtrlHandler.
//
// We reproduce the observable contract with ordinary child-process redirection,
// which is what the pipes achieve; the pipe names themselves matter only to debuggers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const UVISION_COM_CONTRACT = {
  binary: 'uvision.com',
  version: '5.36.0.0',
  description: 'µVision command line',
  class: 'uVisionLauncher',
  pipes: ['\\\\.\\pipe\\%dcout', '\\\\.\\pipe\\%dcin', '\\\\.\\pipe\\%dcerr'],
  child: 'uv4.exe',
  imports: { KERNEL32: 90 },
  behavior: [
    'CreateNamedPipeA/ConnectNamedPipe: three PID-suffixed pipes for child stdout/stdin/stderr',
    'GetCommandLineA: forwards the caller command line verbatim to uv4.exe',
    'GetModuleFileNameA: resolves uv4.exe next to the launcher',
    'suspended start + ResumeThread: attaches the pipes before the child runs',
    'WaitForSingleObject/GetExitCodeProcess: blocks and propagates the ERRORLEVEL',
    'SetConsoleCtrlHandler: forwards Ctrl+C to the child (TerminateProcess on hard break)',
    'Beep: console bell on critical errors ("ERROR: Could not create named pipes.")',
  ],
};

/** Build argv exactly as uvision.com would: everything after the program name. */
export function forwardArgv(argv) {
  // uvision.com passes the raw command line; mapping argv -> args keeps 1:1 semantics.
  return argv.map((a) => String(a));
}

/**
 * Launch UV4 the way uvision.com does: console visible-ish semantics, stdout/stderr
 * captured and mirrored, exit code propagated, timeout kills the tree.
 */
export async function runConsole({ uv4Exe, args, cwd, timeoutMs = 900000, env, onData }) {
  if (!fs.existsSync(uv4Exe)) throw new Error(`uv4.exe not found: ${uv4Exe}`);
  return await new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(uv4Exe, forwardArgv(args || []), {
        cwd: cwd || path.dirname(uv4Exe),
        env: { ...process.env, ...(env || {}) },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, error: String(e.message || e), exitCode: null });
      return;
    }
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => { const s = d.toString('latin1'); out.push(s); if (onData) onData('out', s); });
    child.stderr.on('data', (d) => { const s = d.toString('latin1'); err.push(s); if (onData) onData('err', s); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch {}
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e.message || e), exitCode: null, stdout: out.join(''), stderr: err.join('') });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        signal: signal || null,
        timedOut,
        elapsedMs: Date.now() - started,
        stdout: out.join(''),
        stderr: err.join(''),
        forwardedArgv: forwardArgv(args || []),
      });
    });
  });
}
