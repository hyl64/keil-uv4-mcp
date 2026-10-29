// util.mjs — shared helpers: JSON results, error wrapping, text/binary analysis.
import fs from 'node:fs';
import path from 'node:path';

export function ok(data) { return { ok: true, ...data }; }
export function fail(message, extra) { return { ok: false, error: message, ...(extra || {}) }; }

/**
 * Resolve a µVision path that was written on Windows.
 *
 * Projects store `.\Objects\`, `..\CMSIS`, `C:\Keil_v5\...`. On POSIX, path.resolve() keeps
 * the backslashes as literal filename characters, so the file is never found
 * ("image not found: …/.\Objects\/main.axf"). Fold separators to '/', drop a leading './',
 * then resolve against the base. Drive-letter paths stay absolute on Windows; on POSIX they
 * simply do not exist, which is the honest outcome.
 */
export function resolveWin(base, ...parts) {
  let cur = String(base === undefined || base === null ? '.' : base).replace(/\\/g, '/');
  for (const raw of parts) {
    if (raw === undefined || raw === null || raw === '') continue;
    let s = String(raw).replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(s) || s.startsWith('/')) { cur = s; continue; }
    s = s.replace(/^\.\//, '');
    cur = cur.replace(/\/+$/, '') + '/' + s;
  }
  return path.normalize(cur);
}

export function guard(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (e) { return fail(String((e && e.message) || e), { stack: e && e.stack ? String(e.stack).split('\n').slice(0, 5) : null }); }
  };
}

export function readTextIfExists(file, maxBytes = 32 * 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    if (st.size > maxBytes) return fs.readFileSync(file, { encoding: 'utf8' }).slice(0, maxBytes);
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

export function tail(text, maxLines = 120) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

/** Parse Intel HEX into a sparse map of address -> byte (handles extended address records). */
export function parseIntelHex(text) {
  const segs = [];
  let base = 0;
  let min = Infinity, max = -Infinity;
  let records = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== ':') continue;
    const bytes = Buffer.from(line.slice(1), 'hex');
    if (bytes.length < 5) continue;
    const len = bytes[0];
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + len);
    records++;
    if (type === 0x00) {
      segs.push({ address: base + addr, data: Buffer.from(data) });
      min = Math.min(min, base + addr);
      max = Math.max(max, base + addr + len);
    } else if (type === 0x01) break;
    else if (type === 0x02) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 0x04) base = ((data[0] << 8) | data[1]) << 16;
    else if (type === 0x03) { /* start segment */ }
    else if (type === 0x05) { /* start linear */ }
  }
  return {
    records, segments: segs.length, bytes: segs.reduce((a, s) => a + s.data.length, 0),
    range: segs.length ? { start: '0x' + min.toString(16), end: '0x' + max.toString(16) } : null,
    checksumErrors: verifyIntelHex(text),
  };
}

function verifyIntelHex(text) {
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== ':') continue;
    const b = Buffer.from(line.slice(1), 'hex');
    if (b.length < 5) { bad++; continue; }
    const sum = b.reduce((a, x) => (a + x) & 0xff, 0);
    if (sum !== 0) bad++;
  }
  return bad;
}

export function humanBytes(n) {
  if (n === null || n === undefined) return null;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${u[i]}`;
}

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

export function rel(base, p) {
  try { return path.relative(base, p) || '.'; } catch { return p; }
}

/** Glob-ish expansion for common patterns (*, **, ?) used by project file filters. */
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/' || pattern[i + 1] === '\\') i++; }
      else re += '[^/\\\\]*';
    } else if (c === '?') re += '.';
    else if ('\\^$.|+()[]{}'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$', 'i');
}

export function walk(dir, filter, maxEntries = 200000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < maxEntries) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (['.git', 'node_modules', '.venv', '__pycache__'].includes(e.name)) continue;
        stack.push(p);
      } else if (e.isFile()) {
        if (!filter || filter(e.name, p)) out.push(p);
      }
      if (out.length >= maxEntries) break;
    }
  }
  return out;
}
