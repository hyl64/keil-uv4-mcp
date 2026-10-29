// tests/beginner_test.mjs — the "one command" promise, tested as a beginner would read it.
//
// The assertions here are about *understanding*, not just plumbing: a diagnosis must state the
// version mismatch in plain words, every blocking check must ship a runnable fix, and no check
// may leak a µVision error number as the headline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';
import { parsePackId, installedVersions, localIndex } from '../src/packmgr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIX = (...p) => path.join(ROOT, 'data', 'fixtures', ...p);

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ', name); }
  else { fail++; console.log('FAIL ', name, detail === undefined ? '' : '->', String(detail).slice(0, 350)); }
};
const skipped = (n, why) => { skip++; console.log('SKIP ', n, '->', why); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keil-beginner-'));
const { server, ctx } = createServer({ mdkRoot: path.join(tmp, 'no-keil') });
const call = async (n, args) => {
  const t = server.tools.get(n);
  if (!t) return { missing: true };
  const r = await t.handler(args || {}, ctx);
  const text = r && r.content && r.content[0] && r.content[0].text;
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return data;
};

// ---------------------------------------------------------------- pack id parsing
console.log('--- PackID parsing (right to left) ---');
const p1 = parsePackId('Keil.STM32F1xx_DFP.2.4.0');
ok('Keil.STM32F1xx_DFP.2.4.0 -> vendor Keil', p1 && p1.vendor === 'Keil', JSON.stringify(p1));
ok('  ... name STM32F1xx_DFP', p1 && p1.name === 'STM32F1xx_DFP', JSON.stringify(p1));
ok('  ... version 2.4.0', p1 && p1.version === '2.4.0', JSON.stringify(p1));
ok('ARM.CMSIS.6.2.0 splits correctly', (() => { const x = parsePackId('ARM.CMSIS.6.2.0'); return x && x.vendor === 'ARM' && x.name === 'CMSIS' && x.version === '6.2.0'; })());
ok('garbage is rejected', parsePackId('garbage') === null);
ok('a bare version is rejected', parsePackId('1.2.3') === null);

// ---------------------------------------------------------------- doctor
console.log('\n--- doctor ---');
const doc = await call('doctor');
ok('doctor answers', doc.ok === true && typeof doc.summary === 'string' && doc.summary.length > 5, JSON.stringify(doc).slice(0, 200));
const names = (doc.checks || []).map(c => c.name);
for (const required of ['node', 'compiler', 'flasher', 'packs', 'pack-list', 'fixtures']) {
  ok(`doctor checks ${required}`, names.includes(required), names.join(','));
}
ok('every doctor check has a plain-language "what"', (doc.checks || []).every(c => typeof c.what === 'string' && c.what.length > 3));
ok('every warn/error check offers a fix', (doc.checks || []).filter(c => c.status !== 'ok' && c.status !== 'info').every(c => Array.isArray(c.fix) && c.fix.length > 0));
ok('doctor deduplicates the pack list', !/CMSIS@6\.2\.0.*CMSIS@6\.2\.0/.test(JSON.stringify(doc.checks.find(c => c.name === 'pack-list'))), JSON.stringify(doc.checks.find(c => c.name === 'pack-list')));
ok('doctor ends with a next step', typeof doc.next === 'string' && doc.next.length > 5);

// ---------------------------------------------------------------- diagnose: version mismatch
console.log('\n--- pack_diagnose: PackID 2.4.0 vs installed 2.4.1 ---');
const blinky = await call('pack_diagnose', { project: FIX('samples', 'Blinky', 'Blinky.uvprojx') });
ok('diagnose runs', !!blinky.summary, JSON.stringify(blinky).slice(0, 300));
ok('it is reported as blocking', blinky.level === 'error', blinky.level);
ok('the summary names both versions in plain words',
  /2\.4\.0/.test(blinky.summary) && /2\.4\.1/.test(blinky.summary), blinky.summary);
ok('the summary does not start with an error number', !/^#?\d{3}/.test(blinky.summary), blinky.summary);
const versionCheck = (blinky.checks || []).find(c => c.id === 'pack-version');
ok('a pack-version check exists', !!versionCheck, JSON.stringify(blinky.checks));
ok('  ... it explains WHY (exact-version PackID)', /精确版本/.test(versionCheck.why || ''), versionCheck.why);
ok('  ... it offers both remedies', Array.isArray(versionCheck.fix) && versionCheck.fix.length >= 2, JSON.stringify(versionCheck.fix));
const acts = blinky.actions || [];
ok('two fixes are proposed', acts.length >= 2, JSON.stringify(acts).slice(0, 300));
ok('one fix installs 2.4.0', acts.some(a => a.tool === 'pack_fetch' && a.args.version === '2.4.0'), JSON.stringify(acts).slice(0, 300));
ok('one fix rewrites the project PackID to 2.4.1',
  acts.some(a => a.tool === 'project_set_option' && /2\.4\.1$/.test(String(a.args.value))), JSON.stringify(acts).slice(0, 400));
ok('the device is still reported as resolvable', (blinky.checks || []).some(c => c.id === 'device' && c.status === 'ok'));
ok('diagnose points at the download cache dir', typeof blinky.downloadDir === 'string' && blinky.downloadDir.length > 0);

// ---------------------------------------------------------------- diagnose: healthy project
console.log('\n--- pack_diagnose: matching project ---');
const gen2 = await call('pack_diagnose', { project: FIX('samples', 'Gen2', 'app.uvprojx') });
ok('a matching project reports ok', gen2.level === 'ok' && gen2.ok === true, `${gen2.level} ${gen2.summary}`);
ok('  ... no install action is nagged when nothing is missing', (gen2.actions || []).length === 0, JSON.stringify(gen2.actions).slice(0, 200));

// ---------------------------------------------------------------- diagnose: missing includes
console.log('\n--- pack_diagnose: broken include paths ---');
const minimal = await call('pack_diagnose', { project: FIX('samples', 'Minimal', 'minimal.uvprojx') });
ok('a warn-level project is not called blocking', minimal.level !== 'error', `${minimal.level} ${minimal.summary}`);
const inc = (minimal.checks || []).find(c => c.id === 'includes');
ok('the include check fires and names the directories', inc && inc.status === 'warn' && /CMSIS|Device/.test(inc.what), JSON.stringify(inc));

// ---------------------------------------------------------------- bad input
console.log('\n--- graceful failure ---');
const bad = await call('pack_diagnose', { project: path.join(tmp, 'nope.uvprojx') });
ok('a missing project returns an error with a hint', bad.ok === false && typeof bad.hint === 'string', JSON.stringify(bad).slice(0, 200));

// ---------------------------------------------------------------- pack_fetch (dry runs only)
console.log('\n--- pack_fetch (safe dry runs) ---');
const dry = await call('pack_fetch', { vendor: 'Keil', pack: 'STM32F1xx_DFP', version: '2.4.0' });
ok('dry run by default', dry.ok === true && dry.dryRun === true, JSON.stringify(dry).slice(0, 250));
ok('  ... builds the keil.com URL', dry.url === 'https://www.keil.com/pack/Keil.STM32F1xx_DFP.2.4.0.pack', dry.url);
ok('  ... names the target directory', /Keil[\\/]STM32F1xx_DFP[\\/]2\.4\.0$/.test(String(dry.destDir)), dry.destDir);
ok('  ... explains how to actually install', /allowNetwork|source/.test(String(dry.hint)), dry.hint);
const noSrc = await call('pack_fetch', { vendor: 'Keil', pack: 'STM32F1xx_DFP', version: '2.4.0', source: path.join(tmp, 'missing.pack') });
ok('a missing local .pack is a clean error', noSrc.ok === false && /not found/.test(noSrc.error), JSON.stringify(noSrc).slice(0, 200));
const badCoord = await call('pack_fetch', { vendor: 'Keil/../evil', pack: 'X', version: '1.0.0' });
ok('path traversal in coordinates is refused', badCoord.ok === false, JSON.stringify(badCoord).slice(0, 200));

// ---------------------------------------------------------------- pack_versions
console.log('\n--- pack_versions (offline index) ---');
const pv = await call('pack_versions', { query: 'STM32F1' });
ok('pack_versions answers', pv.ok === true && Array.isArray(pv.installed), JSON.stringify(pv).slice(0, 200));
ok('  ... lists installed versions without duplicates', pv.installed.filter(x => /STM32F1xx_DFP/.test(x)).length === new Set(pv.installed.filter(x => /STM32F1xx_DFP/.test(x))).size, JSON.stringify(pv.installed));
const idx = localIndex(ctx.data.packRoots());
if (idx.length) {
  ok('local index carries version lists', idx.every(x => Array.isArray(x.versions)));
  ok('  ... and a download base URL', idx.every(x => /^https?:\/\//.test(String(x.url))), JSON.stringify(idx[0]).slice(0, 200));
} else {
  skipped('local index', 'no .Web index cache on this machine');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass}/${pass + fail} beginner checks passed${skip ? ` (${skip} skipped)` : ''}`);
process.exit(fail === 0 ? 0 : 1);
