// tests/fuzz_test.mjs — adversarial/edge-case checks for the µVision MCP server.
// Goals: malformed inputs must produce structured tool errors (never crash the
// server), every JSON-RPC frame must stay valid, and the XML engine must not lose
// data on unusual-but-legal project files.
import { startServer } from './mcp_client.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-fuzz-'));
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  let extra = '';
  if (!cond) { try { extra = '  << ' + JSON.stringify(detail).slice(0, 500); } catch { extra = ''; } }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra}`);
}

const c = startServer(path.join(root, 'src', 'server.mjs'));
await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fuzz', version: '1' } });
c.notify('notifications/initialized', {});

// 1. Malformed frame -> JSON-RPC parse error, connection stays usable.
const rawChild = c.child;
rawChild.stdin.write('{not json\n');
await new Promise(r => setTimeout(r, 300));
const after = await c.request('ping', {});
check('server survives a malformed JSON frame', after && typeof after === 'object', after);

// 2. Unknown method -> -32601.
let unknownMethod = null;
try { await c.request('nonsense/method', {}); } catch (e) { unknownMethod = e; }
check('unknown method -> JSON-RPC error', !!unknownMethod && /Method not found/.test(unknownMethod.message), unknownMethod && unknownMethod.message);

// 3. Path/injection style inputs are returned as tool errors, not crashes.
const nasty = [
  ['project_read', { project: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }],
  ['project_read', { project: '../../../../../../etc/passwd' }],
  ['dep_read', { file: 'nul' }],
  ['elf_info', { file: 'C:\\Windows\\notepad.exe' }],
  ['hex_info', { file: '' }],
  ['map_info', {}],
  // SQL-looking text is an ordinary (empty) search: the server uses no SQL at all.
  ['probe_for_error', 'pack_devices', { query: '"; DROP TABLE devices; --', limit: -1 }],
  ['pack_device_detail', { name: 'DEVICE-THAT-DOES-NOT-EXIST' }],
  ['project_set_option', { project: 'C:\\nope.uvprojx', path: [], value: 1 }],
  ['tool_run', { tool: '..\\..\\Windows\\System32\\cmd', args: ['/c', 'echo hi'] }],
  ['batch_generate', { project: 'C:\\nope.uvprojx' }],
  ['options_read', { project: 'C:\\nope.uvprojx' }],
];
let survived = 0;
let benign = 0;
for (const tuple of nasty) {
  const [name, args] = tuple[0] === 'probe_for_error' ? [tuple[1], tuple[2]] : tuple;
  const r = await c.callTool(name, args);
  if (r && (r.isError || r.data.ok === false)) survived++;
  else if (tuple[0] === 'probe_for_error' && r && r.data.ok === true) benign++;
  else console.log('   unexpected success for', name, JSON.stringify(r).slice(0, 200));
}
check('hostile/odd inputs yield structured errors (SQL-like text just returns no rows)',
  survived === nasty.length - 1 && benign === 1, { survived, benign, total: nasty.length });

// 4. Tool "tool_run" must not escape the toolset bin directory.
const escape = await c.callTool('tool_run', { tool: '..\\..\\..\\Windows\\System32\\cmd', args: ['/c', 'whoami'] });
check('tool_run rejects binaries outside the toolset', escape.data.ok === false && /not found/.test(escape.data.error || ''), escape.data);

// 5. Very large string argument is rejected by validation or handled without crash.
const huge = 'A'.repeat(2 * 1024 * 1024);
const big = await c.callTool('pack_devices', { query: huge });
check('multi-MB argument handled', big.data.ok === true && big.data.count === 0, { count: big.data.count, ok: big.data.ok });

// 6. Project XML with CRLF-only line endings, unusual but legal content round trips byte-exactly.
const crlf = path.join(tmp, 'crlf.uvprojx');
const src = fs.readFileSync(path.join(root, 'reverse', 'samples', 'Gen2', 'app.uvprojx'), 'utf8');
fs.writeFileSync(crlf, src.replace(/\r?\n/g, '\r\n'), 'utf8');
const before = fs.readFileSync(crlf, 'utf8');
await c.callTool('project_read', { project: crlf });
check('CRLF project untouched by read', fs.readFileSync(crlf, 'utf8') === before, 'mutated');

// 7. Non-project XML is reported as an error.
const bogus = path.join(tmp, 'bogus.uvprojx');
fs.writeFileSync(bogus, '<?xml version="1.0"?><HTML><BODY/></HTML>', 'utf8');
const bogusRead = await c.callTool('project_read', { project: bogus });
check('non-uVision XML rejected', bogusRead.isError || bogusRead.data.ok === false, bogusRead.data);

// 8. Empty/truncated project file must not crash.
const empty = path.join(tmp, 'empty.uvprojx');
fs.writeFileSync(empty, '', 'utf8');
const emptyRead = await c.callTool('project_read', { project: empty });
check('empty project rejected gracefully', emptyRead.isError || emptyRead.data.ok === false, emptyRead.data);

// 9. Repeated calls keep the server responsive (stateful tools create no leaks).
let okCount = 0;
for (let i = 0; i < 25; i++) {
  const r = await c.callTool('cli_reference', {});
  if (r.data.ok) okCount++;
}
check('25 sequential calls stay healthy', okCount === 25, okCount);

// 10. Unicode path + content handling.
const uniDir = path.join(tmp, '项目 中文');
fs.mkdirSync(uniDir, { recursive: true });
const uniProj = path.join(uniDir, 'led_blink.uvprojx');
fs.writeFileSync(uniProj, src, 'utf8');
const uniRead = await c.callTool('project_read', { project: uniProj, includeFiles: false });
check('unicode project path works', uniRead.data.ok === true, uniRead.data);

c.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} fuzz checks passed`);
if (failed.length) process.exitCode = 1;
