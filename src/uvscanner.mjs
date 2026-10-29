// uvscanner.mjs — listener inventory + probing for the UVSOCK remote-control endpoint.
// UV4 -s <port> enables the socket server (CHM "UVSOCK (TCP/IP) Settings").
// The binary registers the service as "UVSOCK=V%d.%d" and keeps the named kernel
// objects UVSOCK_Buffer_Mtx (@0xbf1f00) / UVSOCK_Sync_Sem (@0xbf1f30); the server
// accepts TCP connections on the configured port.
// This module only reports observable facts (ports, owning process, greeting bytes).
import net from 'node:net';
import { spawn } from 'node:child_process';

export function probePort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const s = new net.Socket();
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try { s.destroy(); } catch {}
      resolve({ host, port, elapsedMs: Date.now() - started, ...r });
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done({ open: true }));
    s.once('timeout', () => done({ open: false, reason: 'timeout' }));
    s.once('error', (e) => done({ open: false, reason: e.code || String(e.message || e) }));
    s.connect(port, host);
  });
}

export async function waitForPort(host, port, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probePort(host, port, 800);
    if (last.open) return last;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { open: false, host, port, timedOut: true, last };
}

export async function scanRange(host, startPort, count = 16) {
  const results = [];
  for (let p = startPort; p < startPort + count; p++) results.push(await probePort(host, p, 400));
  return results;
}

/** Capture whatever a UVSOCK server sends spontaneously after connect (pure read, no command). */
export function readBanner(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const chunks = [];
    const s = new net.Socket();
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      try { s.destroy(); } catch {}
      const buf = Buffer.concat(chunks);
      resolve({
        bytes: buf.length,
        hex: buf.subarray(0, 64).toString('hex'),
        text: buf.subarray(0, 256).toString('latin1').replace(/[^\x20-\x7e]/g, '.'),
        reason,
      });
    };
    s.setTimeout(timeoutMs);
    s.on('data', (d) => { chunks.push(d); if (Buffer.concat(chunks).length > 4096) finish('limit'); });
    s.on('timeout', () => finish('timeout'));
    s.on('error', (e) => finish(`error:${e.code || e.message}`));
    s.on('close', () => finish('closed'));
    s.connect(port, host);
  });
}

/** Inventory of listening TCP ports with owning process names (Windows). */
export function describeLocalListeners() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command',
        "Get-NetTCPConnection -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{Local=$_.LocalAddress;Port=$_.LocalPort;Pid=$_.OwningProcess;Name=$p.ProcessName} } | ConvertTo-Json -Compress"], { windowsHide: true });
    } catch (e) { resolve({ ok: false, error: String(e) }); return; }
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out || '[]');
        resolve({ ok: true, listeners: Array.isArray(parsed) ? parsed : [parsed] });
      } catch { resolve({ ok: false, error: 'parse', raw: out.slice(0, 400) }); }
    });
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

/** UV4 processes currently running, with their command line. */
export function listUv4Processes() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='UV4.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true });
    } catch (e) { resolve({ ok: false, error: String(e) }); return; }
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', () => {
      try {
        const p = JSON.parse(out || '[]');
        resolve({ ok: true, processes: Array.isArray(p) ? p : (p ? [p] : []) });
      } catch { resolve({ ok: false, error: 'parse', raw: out.slice(0, 400) }); }
    });
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

/** Kill UV4 (and children) — used to recover from the -z/-q hang and stale instances. */
export function killUv4Processes(pid) {
  return new Promise((resolve) => {
    const args = pid ? ['/PID', String(pid), '/T', '/F'] : ['/IM', 'UV4.exe', '/T', '/F'];
    let child;
    try { child = spawn('taskkill', args, { windowsHide: true }); }
    catch (e) { resolve({ ok: false, error: String(e) }); return; }
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => out += d.toString());
    child.on('close', (code) => resolve({ ok: code === 0, exitCode: code, output: out.trim() }));
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}
