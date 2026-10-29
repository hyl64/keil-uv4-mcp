// uvsock.mjs — UVSOCK wire-protocol client (pure Node), reconstructed from UVSC.dll
// AND verified live against µVision 5.43 (UV4 -s4328, capture in reverse/uvsock_live.md).
//
// Frame: 32-byte LE header [totalLen, frameId, dataLen, reserved×5] + payload.
//   Request frames: frameId = serviceId (0x1000, 0x2004, ...).
//   Response frames:  frameId = 0x3000 ("command response");
//       payload = u32 serviceId, u32 status(0=OK), u32 data...   ← correlation key is payload[0]!
//   Event frames:     frameId = 0x4000/0x5000..; payload = u32 eventId, u32 status, u32 data..., text
//       (0x1001 project-state text, 0x5000 build-done code 1..4, 0x5001 build output line…)
// Version (service 0x0001): response payload[2] = decimal HHMMSS-style packed VVMMPP? no —
//       observed 0xE5 = 229 → "2.29" (major=/100, minor=%100), matching UV4's "UVSOCK=V%d.%d".
import net from 'node:net';

export const SVC = {
  VERSION: 0x0001, CHECK_LICENSE: 0x000b, ACK: 0x000c,
  PRJ_LOAD: 0x1000, PRJ_PROJECT_STATE_TEXT_REQ: 0x1001,
  PRJ_BUILD: 0x1006, PRJ_REBUILD: 0x1007,
  PRJ_TEXT_CMD_IN: 0x1002, PRJ_TEXT_CMD_IN2: 0x1003, PRJ_TEXT_QUERY: 0x1004, PRJ_TEXT_QUERY2: 0x1005,
  PRJ_BUILD_WAIT: 0x1008, PRJ_DEBUG_START: 0x100a,
  PRJ_GET_DEBUG_TARGET: 0x100b, PRJ_GET_OPTITEM: 0x100d, PRJ_SET_OPTITEM: 0x100e,
  PRJ_ENUM_BREAKPOINTS: 0x100f, PRJ_ENUM_WATCHLIST: 0x1010, PRJ_U32_GETSET: 0x1011,
  PRJ_U32_RESULT: 0x1012, PRJ_U32_ARRAY_GETSET: 0x1014, PRJ_ENUM_TARGETS: 0x1015,
  PRJ_TEXT_OUT1: 0x1016, PRJ_KEYVAL_CMD: 0x1017, PRJ_TEXT_OUT2: 0x1018,
  DBG_ENTER: 0x2000, DBG_EXIT: 0x2001, DBG_STOP: 0x2002, DBG_START: 0x2003, DBG_STATUS: 0x2004,
  DBG_RESET: 0x2005, DBG_STEP_INTO: 0x2009, DBG_MEM_READ: 0x200b, DBG_MEM_WRITE: 0x200c,
  DBG_DATA_MAP_INPLACE: 0x200a, DBG_RESET_CORE: 0x2011, DBG_RESET_SYS: 0x2012,
  DBG_MAP_BATCH: 0x2014, DBG_MAP_BATCH_WRITE: 0x2015, DBG_DATA_WINDOW_READ: 0x2016,
  DBG_ITM_STRUCT: 0x2018, DBG_ITM_STREAM: 0x2019, DBG_ENUM_CALLSTACK: 0x201a,
  DBG_STRUCT_2021: 0x2021, // 60B in-place struct (FUN_10007570; exact name unresolved)
  DBG_EVAL_TO_STR: 0x2024, DBG_WATCH_ADD: 0x2025,
  DBG_ENUM_MENUS: 0x2026, DBG_MEMORY_MAP: 0x2027, DBG_ENUM_REGISTER_GROUPS: 0x2028,
  DBG_REGISTER_GROUP: 0x2029, DBG_SILENT: 0x202a, DBG_WATCH_EVAL: 0x202b,
  DBG_WATCH_REMOVE: 0x202c, DBG_VARIABLE_SET: 0x202d, DBG_ADR_TOFILELINE: 0x202e,
  DBG_FILELINE_TO_ADR: 0x202f, DBG_VTR_GET: 0x2030, DBG_ITM_READ: 0x2031,
  DBG_EVTR_FILES: 0x2032, DBG_TEXT_CMD_STREAM: 0x2033, // text cmd; streams 0x5020 chunks, echoes at end (180s)
  DBG_EXEC_CMD: 0x2034,
  DBG_EVTR_REGISTER: 0x2035, DBG_EVTR_UNREGISTER: 0x2036, DBG_ITM_UNREGISTER: 0x2038,
  DBG_RUN_TO_ADDR: 0x2102, DBG_STEP_HLL: 0x2106, DBG_STEP_HLL_N: 0x2107, DBG_STEP_INTO_N: 0x2108,
};
export const EVT = {
  RESPONSE: 0x3000, INFO: 0x4000,
  BUILD_DONE: 0x5000, BUILD_TEXT: 0x5001, ENUM_DATA: 0x5005,
  ENUM_BP_START: 0x5007, ENUM_BP_DATA: 0x5008, ENUM_BP_END: 0x5009,
  ENUM_WL_START: 0x500a, ENUM_WL_DATA: 0x500b, ENUM_WL_END: 0x500c,
  DEBUG_START_EVENTS: 0x500d, DEBUG_START_EVENTS2: 0x5010,
  VARS_START: 0x5017, VARS_DATA: 0x5018, VARS_END: 0x5019,
  EXEC_CMD_TEXT: 0x5020, EXEC_CMD_DONE: 0x5021, // 0x5021 doubles as EXEC-done and targets-start
  TARGETS_START: 0x5021, TARGETS_DATA: 0x5022, TARGETS_END: 0x5023,
  MENUS_START: 0x5024, MENUS_DATA: 0x5025, MENUS_END: 0x5026,
  MEMMAP_DATA: 0x5027, MEMMAP_END: 0x5028,
  REGGRP_START: 0x5029, REGGRP_DATA: 0x502a, REGGRP_END: 0x502b,
  REGBLOCK_START: 0x502c, REGBLOCK_DATA: 0x502d, REGBLOCK_END: 0x502e,
  SCVDFILES_DATA: 0x502f, SCVDFILES_END: 0x5030,
  ITM_START: 0x5014, ITM_DATA: 0x5015, ITM_END: 0x5016,
  ITM_READY: 0x5060, ITM_STREAM_DATA: 0x5061, ITM_STREAM_END: 0x5062,
  ERROR: 0x201f,
};

export function encodeFrame(serviceId, payload = Buffer.alloc(0)) {
  const hdr = Buffer.alloc(32);
  hdr.writeUInt32LE(0x20 + payload.length, 0);
  hdr.writeUInt32LE(serviceId >>> 0, 4);
  hdr.writeUInt32LE(payload.length, 8);
  return Buffer.concat([hdr, payload]);
}

export function decodeFrame(buf) {
  if (buf.length < 32) return null;
  const total = buf.readUInt32LE(0);
  const id = buf.readUInt32LE(4);
  const dataLen = buf.readUInt32LE(8);
  const payload = buf.subarray(32, 32 + Math.min(dataLen, Math.max(0, buf.length - 32)));
  const u32 = (i) => (payload.length >= i + 4 ? payload.readUInt32LE(i) : null);
  return { total, id, dataLen, payload, innerId: u32(0), status: u32(4), w2: u32(8), w3: u32(12), w4: u32(16) };
}

export class UvsockClient {
  constructor(host = '127.0.0.1', port = 4328) {
    this.host = host; this.port = port;
    this.sock = null;
    this.rx = Buffer.alloc(0);
    this.waiters = new Set();
    this.text = [];
    this.buildDone = null;
    this.events = [];
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      const t = setTimeout(() => { s.destroy(); reject(new Error(`connect timeout ${this.host}:${this.port}`)); }, timeoutMs);
      s.once('connect', () => {
        clearTimeout(t);
        this.sock = s;
        s.on('data', (d) => this._feed(d));
        s.on('error', () => this._closeAll());
        s.on('close', () => this._closeAll());
        resolve(true);
      });
      s.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  }

  close() { try { this.sock && this.sock.destroy(); } catch {} this.sock = null; this._closeAll(); }

  _closeAll() {
    for (const w of this.waiters) { clearTimeout(w.timer); w.reject(new Error('connection closed')); }
    this.waiters.clear();
  }

  _feed(chunk) {
    this.rx = Buffer.concat([this.rx, chunk]);
    for (;;) {
      if (this.rx.length < 32) return;
      const total = this.rx.readUInt32LE(0);
      if (total < 32 || total > 32 + 32 * 1024 * 1024) { this.rx = Buffer.alloc(0); return; }
      if (this.rx.length < total) return;
      const f = decodeFrame(this.rx.subarray(0, total));
      this.rx = this.rx.subarray(total);
      if (!f) return;
      // Live-verified (reverse/uvsock_live.md): build output lines arrive as frame id
      // 0x5001 with payload [u32 textLen][u8 sep][text…\n]; completion as id 0x5000
      // payload [u32 rsv][u32 code 1=OK 2=warn 3=err 4=cancelled].
      if (f.id === EVT.BUILD_TEXT) {
        const len = f.payload.length >= 4 ? f.payload.readUInt32LE(0) : f.payload.length - 4;
        this.text.push(f.payload.subarray(4, 4 + Math.max(0, Math.min(len, f.payload.length - 4))).toString('latin1').replace(/\n?\0.*$/, ''));
      } else if (f.id === EVT.BUILD_DONE) {
        const code = f.payload.length >= 8 ? f.payload.readUInt32LE(4) : 0;
        this.buildDone = { code, meaning: { 1: 'OK', 2: 'warnings', 3: 'errors', 4: 'cancelled' }[code] || `code ${code}` };
      }
      for (const w of [...this.waiters]) {
        if (w.pred(f)) { this.waiters.delete(w); clearTimeout(w.timer); w.resolve(f); break; }
      }
      this.events.push(f);
      if (this.events.length > 500) this.events.shift();
    }
  }

  _await(pred, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, reject, timer: setTimeout(() => { this.waiters.delete(w); reject(new Error('response timeout')); }, timeoutMs) };
      this.waiters.add(w);
    });
  }

  /** Send request (frameId=serviceId) and wait for RESPONSE frame whose payload[0]=serviceId.
   *  Live-verified semantics: payload[4]==0 → plain success (data at payload[8..]).
   *  payload[4]>0 → the IDE answers with a notice text (e.g. busy while a build runs);
   *  surfaced as f.info (non-fatal) unless it is an error event (frame 0x201F). */
  async request(serviceId, payload = Buffer.alloc(0), { timeoutMs = 10000 } = {}) {
    if (!this.sock) throw new Error('not connected');
    this.sock.write(encodeFrame(serviceId, payload));
    const f = await this._await((fr) => (fr.id === EVT.RESPONSE && fr.innerId === serviceId) || fr.id === EVT.ERROR, timeoutMs);
    if (f.id === EVT.ERROR) {
      const code = f.status || 0;
      const msg = f.payload.subarray(8).toString('latin1').replace(/\0.*$/, '').trim();
      throw new Error(`UVSOCK error frame (service 0x${serviceId.toString(16)} code ${code}): ${msg}`);
    }
    const noticeLen = f.status || 0;
    f.info = noticeLen > 0 ? f.payload.subarray(8, 8 + noticeLen).toString('latin1').replace(/\0.*$/, '').trim() : null;
    return f;
  }

  async version() {
    const f = await this.request(SVC.VERSION);
    const raw = f.w2 || 0;
    return { raw, major: Math.floor(raw / 100), minor: raw % 100, text: `V${Math.floor(raw / 100)}.${raw % 100}` };
  }

  async checkLicense() {
    const f = await this.request(SVC.CHECK_LICENSE);
    const words = [];
    for (let i = 8; i + 4 <= f.payload.length; i += 4) words.push(f.payload.readUInt32LE(i));
    return { words, licensed: words[0] !== 0, note: 'capability words from payload[2..] (FUN_10008a10)' };
  }

  async loadProject(pathStr) {
    const f = await this.request(SVC.PRJ_LOAD, Buffer.from(pathStr + '\0', 'latin1'), { timeoutMs: 30000 });
    const msg = f.payload.subarray(8).toString('latin1').replace(/\0.*$/, '').trim();
    return { statusWord: f.w2 || 0, message: msg || '(loaded)' };
  }

  async build({ rebuild = false, collectMs = 0 } = {}) {
    this.buildDone = null; this.text = [];
    await this.request(rebuild ? SVC.PRJ_REBUILD : SVC.PRJ_BUILD, Buffer.alloc(0), { timeoutMs: 15000 });
    if (collectMs > 0) {
      const until = Date.now() + collectMs;
      while (Date.now() < until && !this.buildDone) await new Promise(r => setTimeout(r, 150));
    }
    return { started: true, done: this.buildDone, output: this.text.join('\n') };
  }

  async status() {
    const buf = Buffer.alloc(4); buf.writeUInt32LE(0, 0);
    const f = await this.request(SVC.DBG_STATUS, buf, { timeoutMs: 10000 });
    const st = f.w2;
    return { status: st, meaning: { 0: 'not running', 1: 'running', 2: 'stopped' }[st] ?? null };
  }

  async exec(cmd) {
    const f = await this.request(SVC.DBG_EXEC_CMD, Buffer.from(cmd + '\0', 'latin1'), { timeoutMs: 15000 });
    return { reply: f.payload.subarray(8).toString('latin1').replace(/\0.*$/, '') };
  }

  async enumTargets() {
    const records = [];
    let sawStart = false, sawEnd = false;
    const collector = (fr) => {
      if (fr.id === EVT.TARGETS_DATA) {
        const body = fr.payload.subarray(4);
        for (let off = 0; off + 260 <= body.length; off += 260) {
          const rec = body.subarray(off, off + 260);
          const fields = [];
          for (let i = 0; i < 4; i++) fields.push(rec.subarray(i * 64, i * 64 + 64).toString('latin1').split('\0')[0]);
          records.push({ project: fields[0], target: fields[1], extra: fields.slice(2).filter(Boolean) });
        }
        sawStart = true;
      }
      if (fr.id === EVT.TARGETS_START) sawStart = true;
      if (fr.id === EVT.TARGETS_END) sawEnd = true;
      return fr.id === EVT.TARGETS_END || (sawEnd && fr.id === EVT.RESPONSE && fr.innerId === SVC.PRJ_ENUM_TARGETS);
    };
    const streamP = this._await(collector, 10000).catch(() => null);
    const reqP = this.request(SVC.PRJ_ENUM_TARGETS, Buffer.alloc(0), { timeoutMs: 10000 }).catch(e => e);
    await Promise.all([reqP, streamP]);
    return { records, note: 'records=260B/4×64B fields (FUN_100092b0 stream 0x5021/22/23)' };
  }

  async getOptItem(key) {
    const buf = Buffer.alloc(4096);
    buf.write(key + '\0', 'latin1');
    const f = await this.request(SVC.PRJ_GET_OPTITEM, buf, { timeoutMs: 10000 });
    const parts = f.payload.subarray(8).toString('latin1').split('\0');
    return { key: parts[0], value: parts[1] === undefined ? '' : parts[1] };
  }

  async setOptItem(key, value) {
    await this.request(SVC.PRJ_SET_OPTITEM, Buffer.from(`${key}\0${value}\0`, 'latin1'));
    return { key, value };
  }

  async memRead(address, length) {
    const req = Buffer.alloc(12);
    req.writeUInt32LE(address >>> 0, 0);
    req.writeUInt32LE(length >>> 0, 4);
    req.writeUInt32LE(length >>> 0, 8);
    const f = await this.request(SVC.DBG_MEM_READ, req, { timeoutMs: 15000 });
    const data = f.payload.subarray(8, 8 + length);
    return { address: '0x' + (address >>> 0).toString(16), bytes: data.toString('hex') };
  }

  /** Poll buffered events (project-state text etc.) and drain them. */
  drainEvents(filterIds = null) {
    const ids = filterIds ? new Set(filterIds) : null;
    const keep = [], taken = [];
    for (const e of this.events) {
      if (!ids || ids.has(e.innerId) || ids.has(e.id)) taken.push(e);
      else keep.push(e);
    }
    this.events = keep;
    return taken.map(f => ({
      frame: '0x' + f.id.toString(16), inner: f.innerId === null ? null : '0x' + (f.innerId >>> 0).toString(16),
      text: f.payload.subarray(8).toString('latin1').replace(/\0.*$/, '').slice(0, 300),
    }));
  }
}

