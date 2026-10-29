// license.mjs — Arm license (armlm) status probes and error taxonomy.
// Observations from the shipped binaries:
//  * UV4\armlm.exe        Arm License Manager daemon (MDK starter installs it per-user)
//  * UV4\armlm-ipc.exe    bootstrap/IPC helper; streams bundled license data to armlm.exe
//  * UV4\armlm.dll        RPC shim consumed by UV4.exe and the toolchain binaries
//  * UV4\FlexNet\armlmd.exe + armlmdiag.exe  legacy FlexLM server + diagnostics
//  * build gate: "Error #601: cannot start build: no MDK-ARM license is available"
//    (string @0xbf7168) — emitted before the build when the toolset is not licensed.
// Status is therefore derived from (a) the license daemons and (b) a one-line
// build gate probe; no license data is modified.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runUv4 } from './uv4cli.mjs';

export function licenseFiles(install) {
  if (!install || !install.uv4Dir) return [];
  const cands = [
    ['armlm.exe', 'license daemon'],
    ['armlm-ipc.exe', 'license IPC bootstrap'],
    ['armlm.dll', 'license RPC shim'],
    [path.join('armlm', 'armlm-gui.exe'), 'license GUI'],
    [path.join('armlm', 'armlm.exe'), 'license daemon (armlm subdir)'],
    [path.join('FlexNet', 'armlmd.exe'), 'FlexLM daemon (legacy)'],
    [path.join('FlexNet', 'armlmdiag.exe'), 'FlexLM diagnostics (legacy)'],
  ];
  const out = [];
  for (const [rel, role] of cands) {
    const p = path.join(install.uv4Dir, rel);
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    out.push({ path: p, role, size: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}

export function runningLicenseDaemons() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command',
        "Get-Process armlm,armlm-ipc,armlmd -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime | ConvertTo-Json -Compress"], { windowsHide: true });
    } catch (e) { resolve([]); return; }
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', () => {
      try {
        const p = JSON.parse(out || '[]');
        resolve(Array.isArray(p) ? p : (p && p.Id ? [p] : []));
      } catch { resolve([]); }
    });
    child.on('error', () => resolve([]));
  });
}

/** Parse the license-related lines out of a build log produced by gate probe. */
export function licenseErrorFromLog(log) {
  if (!log) return null;
  const m = /Error #601:[^\r\n]*/.exec(log) || /Error #6\d\d:[^\r\n]*/.exec(log);
  return m ? m[0].trim() : null;
}

/**
 * One quick build-gate probe: rebuild a throwaway target and read the log for the
 * license gate result. Uses the caller's project (read-only run) when available.
 */
export async function licenseGateProbe(cfg, projectPath) {
  if (!projectPath) return { ok: false, error: 'no project supplied for gate probe' };
  const logPath = path.join(path.dirname(projectPath), path.basename(projectPath, path.extname(projectPath)) + '.license.log');
  const r = await runUv4(cfg, { exe: cfg.uv4Exe, command: '-r', project: projectPath, outputLog: logPath, timeoutMs: 120000, hideGui: true });
  const gate = licenseErrorFromLog(r.log);
  return {
    ok: !gate,
    licensedPerBuildGate: !gate,
    gateMessage: gate,
    exitCode: r.exitCode,
    elapsedMs: r.elapsedMs,
    logPath,
    logTail: (r.log || '').split(/\r?\n/).slice(-6).join('\n'),
  };
}

export async function licenseStatus(cfg, install, projectPath) {
  const files = licenseFiles(install);
  const daemons = await runningLicenseDaemons();
  const status = {
    installation: install && install.root,
    toolVariant: install && install.toolVariant,
    licenseFiles: files,
    daemonsRunning: daemons.map(d => ({ pid: d.Id, name: d.ProcessName, started: d.StartTime })),
    gate: null,
    notes: [
      'Error #601 (0xbf7168) is the MDK-ARM build gate reported by UV4 when the toolset has no license.',
      'armlm-ipc.exe streams the bundled license payload to armlm.exe; killing the daemon does not revoke the license.',
      'The FlexLM pair (armlmd/armlmdiag) is only used with legacy FlexNet-based licenses.',
    ],
  };
  if (projectPath) status.gate = await licenseGateProbe(cfg, projectPath);
  return status;
}
