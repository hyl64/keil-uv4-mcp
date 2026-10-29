// packmgr.mjs — "one command" answers for the two questions beginners actually have:
//   "why won't it build?"  (pack_diagnose)
//   "what is missing on this machine?"  (doctor)
// Plus the repair half: installing a pack from a local .pack or from keil.com (pack_fetch).
//
// Design rule: every finding carries `what` (plain language), `why` (the mechanism, citing how
// µVision behaves) and `fix` (a tool call you can copy). No error code is the headline — codes
// such as #544 are mentioned only as "µVision would say this", after the human sentence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Project, findProjectFile } from './project.mjs';
import { listPackCatalog, findDevices } from './packs.mjs';
import { inspectPack, extractPack } from './packfile.mjs';
import { detectBackends, detectFlashers } from './build.mjs';

// <Vendor>.<Pack>.<Version>. Split from the right: the version is the trailing run of numeric
// segments, the name is the segment before it. A regex cannot do this reliably because both
// the vendor and the version may contain dots, and the name may look numeric.
const PACK_ID_RE = null;

/** Split "Keil.STM32F1xx_DFP.2.4.1" into { vendor, name, version }. */
export function parsePackId(id) {
  const s = String(id || '').trim();
  if (!s || !s.includes('.')) return null;
  const parts = s.split('.');
  if (parts.some(p => p === '')) return null;
  let i = parts.length;
  while (i > 1 && /^\d+$/.test(parts[i - 1])) i--;
  // parts[i..] is the version; parts[i-1] the pack name; everything before it the vendor.
  if (i >= parts.length) return null;          // no numeric tail -> not a PackID
  if (i < 2) return null;                      // need at least vendor + name
  if (/^\d+$/.test(parts[i - 1])) return null; // a purely numeric "name" means we mis-split
  return {
    vendor: parts.slice(0, i - 1).join('.'),
    name: parts[i - 1],
    version: parts.slice(i).join('.'),
    raw: s,
  };
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** All installed versions of one pack, newest first. */
export function installedVersions(catalog, vendor, name) {
  return catalog
    .filter(p => String(p.vendor).toLowerCase() === String(vendor).toLowerCase()
      && String(p.name).toLowerCase() === String(name).toLowerCase())
    .map(p => ({ version: p.version, dir: p.dir, pdsc: p.pdsc }))
    .sort((a, b) => cmpVersion(b.version, a.version));
}

/** Where the download cache lives for a given pack root (…/ARM/PACK/.Download). */
export function downloadDirFor(root) {
  return path.join(root, '.Download');
}

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

/**
 * The same pack can be visible twice (installed under %LOCALAPPDATA%\Arm\Packs and again in the
 * bundled snapshot). For a beginner, a duplicated list reads like "you have it twice", so
 * collapse to one row per vendor.name.version, keeping the first root (installed wins).
 */
function dedupeCatalog(catalog) {
  const seen = new Map();
  for (const p of catalog) {
    const key = `${p.vendor}.${p.name}.${p.version}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * Diagnose one project target. Offline, read-only, and safe to run first.
 * @returns {{ok:boolean, summary:string, level:'ok'|'info'|'warn'|'error', checks:any[], actions:any[], next:string}}
 */
export function diagnoseProject(projectPath, targetName, roots) {
  const file = findProjectFile(projectPath);
  const pr = new Project(file);
  const targets = pr.targets();
  const t = targetName ? targets.find(x => x.name === targetName) : targets[0];
  if (!t) throw new Error(`target not found: ${targetName || '(first target)'}`);

  const catalog = dedupeCatalog(listPackCatalog(roots));
  const checks = [];
  const actions = [];
  const push = (c) => checks.push(c);

  // ---- 1. the declared pack -------------------------------------------------
  const declared = parsePackId(t.packId);
  if (!t.packId) {
    push({
      id: 'pack-declared', status: 'info',
      what: '这个工程没有写 PackID（老工程经常这样）。',
      why: '没有 PackID 时 µVision 只按器件名去已装包里找，找到哪个版本就用哪个。',
      fix: ['一般不用管；想固定版本就用 project_set_option 写 TargetOption.TargetCommonOption.PackID。'],
    });
  } else if (!declared) {
    push({
      id: 'pack-declared', status: 'warn',
      what: `PackID 看起来不像标准格式："${t.packId}"`,
      why: '标准写法是 <Vendor>.<Pack>.<Version>，例如 Keil.STM32F1xx_DFP.2.4.1。',
      fix: ['用 project_read 看一下 target.packId，确认是不是手改坏了。'],
    });
  } else {
    const avail = installedVersions(catalog, declared.vendor, declared.name);
    const have = avail.map(v => v.version);
    if (avail.length === 0) {
      push({
        id: 'pack-present', status: 'error',
        what: `这台机器上完全没有装 ${declared.vendor}.${declared.name}（工程要 ${declared.version}）。`,
        why: 'µVision 找不到整包时会报 "required software pack … is not installed"（Error #544）。',
        fix: [`装一个：pack_fetch {vendor:"${declared.vendor}", pack:"${declared.name}", version:"${declared.version}", allowNetwork:true}`],
      });
      actions.push({
        label: `下载并安装 ${declared.vendor}.${declared.name} ${declared.version}（需要联网）`,
        tool: 'pack_fetch',
        args: { vendor: declared.vendor, pack: declared.name, version: declared.version, allowNetwork: true },
      });
    } else if (!have.includes(declared.version)) {
      const newest = have[0];
      const newer = cmpVersion(newest, declared.version) > 0;
      push({
        id: 'pack-version', status: 'error',
        what: `工程写死要 ${declared.name} ${declared.version}，这台机器装的是 ${have.join(' / ')}。`,
        why: 'µVision 的 PackID 是精确版本，不会自动升级或降级——版本差一位就拒绝构建（Error #544）。',
        fix: [
          `不想装旧包：把工程改成已装版本 ${newest}（actions[1]）`,
          `想保持工程原样：装回 ${declared.version}（actions[0]）`,
        ],
      });
      actions.push({
        label: `装回工程要求的 ${declared.name} ${declared.version}`,
        tool: 'pack_fetch',
        args: { vendor: declared.vendor, pack: declared.name, version: declared.version, allowNetwork: true },
      });
      actions.push({
        label: `把工程的 PackID 改成已装的 ${declared.vendor}.${declared.name}.${newest}${newer ? '' : '（本机更旧）'}`,
        tool: 'project_set_option',
        args: {
          project: file, target: t.name,
          path: ['TargetOption', 'TargetCommonOption', 'PackID'],
          value: `${declared.vendor}.${declared.name}.${newest}`,
        },
        note: '改完记得构建一次，确认器件/组件仍匹配。',
      });
    } else {
      push({
        id: 'pack-version', status: 'ok',
        what: `工程要的 ${declared.name} ${declared.version} 已安装。`,
        why: 'PackID 精确匹配。',
        fix: [],
      });
    }
    // A .pack already sitting in the download cache makes the repair work offline. Only
    // relevant when the declared version is the one missing (never nag when everything fits).
    if (!have.includes(declared.version)) {
      for (const root of roots) {
        const dl = path.join(root, '.Download', `${declared.vendor}.${declared.name}.${declared.version}.pack`);
        if (exists(dl)) {
          actions.push({
            label: `用本地已下载的 ${declared.name} ${declared.version} 安装（离线，无需联网）`,
            tool: 'pack_fetch',
            args: { vendor: declared.vendor, pack: declared.name, version: declared.version, source: dl },
          });
          break;
        }
      }
    }
  }

  // ---- 2. the device --------------------------------------------------------
  const devs = t.device ? findDevices(roots, t.device, 50).filter(d => d.name === t.device) : [];
  if (!t.device) {
    push({ id: 'device', status: 'warn', what: '这个 target 没写器件型号。', why: '没有器件就没有内存布局/启动文件/下载算法。', fix: ['用 project_read 检查 device 字段，或在 µVision 里选择器件。'] });
  } else if (!devs.length) {
    push({
      id: 'device', status: 'error',
      what: `器件 ${t.device} 不在任何已安装的包里。`,
      why: 'µVision 会报 Error #543（device not found）。',
      fix: ['先解决上面的 pack 缺失/版本问题，器件随包安装。'],
    });
  } else {
    const d = devs[0];
    const packVer = d.pack && d.pack.version;
    push({
      id: 'device', status: 'ok',
      what: `器件 ${t.device} 来自 ${d.pack.vendor}.${d.pack.name} ${packVer}。`,
      why: '器件解析成功，内存/启动文件/FLM 都从这个包取。',
      fix: [],
    });
    if (declared && packVer && packVer !== declared.version) {
      push({
        id: 'device-version', status: 'warn',
        what: `器件实际来自 ${packVer}，而工程 PackID 写的是 ${declared.version}。`,
        why: '两者不一致时，µVision 会按 PackID 找包、按包找器件，容易一半能编一半不能。',
        fix: ['把 PackID 对齐到实际安装版本（见上一条 actions）。'],
      });
    }
  }

  // ---- 3. include paths -----------------------------------------------------
  const missingInc = String(t.c.includePath || '').split(';').filter(Boolean)
    .filter(p => !exists(path.isAbsolute(p) ? p : path.resolve(path.dirname(file), p)));
  if (missingInc.length) {
    push({
      id: 'includes', status: 'warn',
      what: `有 ${missingInc.length} 个头文件目录不存在：${missingInc.join('；')}`,
      why: '编译时会直接 "cannot open source input file"。多数情况是包换了版本或路径是别人的机器。',
      fix: ['用 project_set_option 改 IncludePath，或重新执行 project_create 让服务器按当前包生成。'],
    });
  } else {
    push({ id: 'includes', status: 'ok', what: '头文件目录都存在。', why: '', fix: [] });
  }

  // ---- 4. RTE components (only the pack-level part; see pack_rte_validate) ---
  const rtePacks = new Set((t.rte && t.rte.components ? t.rte.components : [])
    .filter(c => c.pack && c.pack.vendor && c.pack.name)
    .map(c => `${c.pack.vendor}.${c.pack.name}`.toLowerCase()));
  const missingRte = [...rtePacks].filter(id => !catalog.some(p => `${p.vendor}.${p.name}`.toLowerCase() === id));
  if (missingRte.length) {
    push({
      id: 'rte', status: 'error',
      what: `工程勾选的 RTE 组件来自未安装的包：${missingRte.join('、')}`,
      why: 'µVision 会报 #544 并把这些组件从工程里摘掉。',
      fix: ['按上面的 actions 安装对应包，然后重跑 pack_diagnose。'],
    });
  } else if (rtePacks.size) {
    push({ id: 'rte', status: 'ok', what: `RTE 组件需要的 ${rtePacks.size} 个包都在。`, why: '', fix: [] });
  }

  const errors = checks.filter(c => c.status === 'error');
  const warns = checks.filter(c => c.status === 'warn');
  const level = errors.length ? 'error' : warns.length ? 'warn' : 'ok';
  const summary = level === 'ok'
    ? `可以构建：${t.device || '(无器件)'} / ${t.name} 的包、器件、头文件都对得上。`
    : level === 'warn'
      ? `能构建，但有 ${warns.length} 处需要注意（见 checks）。`
      : `构建会被拒绝：${errors.map(e => e.what).join(' 另外，')}`;

  return {
    ok: level === 'ok',
    level,
    summary,
    project: file,
    target: t.name,
    device: t.device || null,
    packId: t.packId || null,
    installed: catalog.map(p => `${p.vendor}.${p.name}.${p.version}`),
    checks,
    actions,
    next: actions.length ? '从 actions 里挑一条执行（label 都是人话），再重跑一次 pack_diagnose。' : '没有需要做的。',
  };
}

/** Plain-language environment check. */
export async function doctor(roots, fixtureRoot) {
  const checks = [];
  const add = (name, status, what, fix) => checks.push({ name, status, what, fix: fix || [] });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node', nodeMajor >= 20 ? 'ok' : 'error',
    `Node ${process.versions.node}${nodeMajor >= 20 ? '（满足 >= 20）' : '：这个项目需要 Node 20 或更新'}`,
    nodeMajor >= 20 ? [] : ['装 Node 20+（nodejs.org），然后重开终端']);

  const compilers = await detectBackends();
  add('compiler', compilers.length ? 'ok' : 'warn',
    compilers.length ? `可用编译器：${compilers.map(c => c.id).join(', ')}（无需 Keil 许可）` : '没找到 clang 或 arm-none-eabi-gcc：可以查工程/看器件，但编译不了',
    compilers.length ? [] : ['装 LLVM（winget install LLVM.LLVM）或 arm-none-eabi-gcc']);

  const flashers = await detectFlashers();
  add('flasher', flashers.length ? 'ok' : 'warn',
    flashers.length ? `可用烧录工具：${flashers.map(f => f.id).join(', ')}` : '没找到烧录工具：能编译出 .hex，但烧不进板子',
    flashers.length ? [] : ['pip install pyocd，或装 OpenOCD']);

  const readable = (roots || []).filter(r => { try { return fs.existsSync(r); } catch { return false; } });
  add('packs', readable.length ? 'ok' : 'warn',
    readable.length ? `能找到 pack 目录：${readable.join('；')}` : '没有找到任何 pack 目录：器件库查不到东西',
    readable.length ? [] : ['装一个 CMSIS-Pack，或设置 KEIL_MDK_ROOT / RTEPATH']);

  const catalog = readable.length ? dedupeCatalog(listPackCatalog(readable)) : [];
  add('pack-list', catalog.length ? 'ok' : 'warn',
    catalog.length ? `已装 ${catalog.length} 个包：${catalog.map(p => `${p.name}@${p.version}`).join(', ')}` : '一个包都没装',
    catalog.length ? [] : ['用 pack_fetch 装一个，例如 Keil.STM32F1xx_DFP 2.4.1']);

  add('fixtures', exists(path.join(fixtureRoot || '', 'cdb', 'uv4_cdb.xml')) ? 'ok' : 'warn',
    exists(path.join(fixtureRoot || '', 'cdb', 'uv4_cdb.xml')) ? '内置器件库快照可用（不装 Keil 也能查器件）' : '内置快照缺失：这个副本不完整',
    exists(path.join(fixtureRoot || '', 'cdb', 'uv4_cdb.xml')) ? [] : ['重新复制完整目录，或 npm pack 后解包']);

  const keil = !!(process.env.LOCALAPPDATA && exists(path.join(process.env.LOCALAPPDATA, 'Keil_v5', 'UV4', 'UV4.exe')));
  add('keil', 'info',
    keil ? '检测到 Keil 安装：uv4_build 等工具可用（需要有效许可）' : '没装 Keil：走免认证路线（compile + flash），功能不受影响',
    []);

  const errors = checks.filter(c => c.status === 'error');
  const warns = checks.filter(c => c.status === 'warn');
  return {
    ok: errors.length === 0,
    summary: errors.length ? '有阻塞问题，先看 status=error 的条目。'
      : warns.length ? '基本可用，但有缺项（见 warn 条目），补上就能编译+烧录。'
        : '一切就绪：可以直接 compile 然后 flash。',
    checks,
    next: warns.length || errors.length
      ? '按 fix 里的命令补齐，再跑一次 doctor。'
      : '试一条：compile {project:"你的.uvprojx"}',
  };
}

/** Sanitise a pack coordinate used in a filesystem path. */
function safeCoord(s) {
  const v = String(s || '');
  if (!/^[A-Za-z0-9_.-]+$/.test(v)) throw new Error(`invalid pack coordinate: ${v}`);
  return v;
}

/**
 * Install one pack: from a local .pack, or (opt-in) from keil.com.
 * dryRun defaults to true and only reports what would happen.
 */
export async function fetchPack({ vendor, pack, version, roots, source, baseUrl, dryRun = true, timeoutMs = 120000 }) {
  const v = safeCoord(vendor), n = safeCoord(pack), ver = safeCoord(version);
  const root = (roots && roots[0]) || null;
  if (!root) throw new Error('no pack root available (set KEIL_MDK_ROOT or RTEPATH)');
  const fileName = `${v}.${n}.${ver}.pack`;
  const url = `${(baseUrl || 'https://www.keil.com/pack/').replace(/\/?$/, '/')}${fileName}`;
  const destDir = path.join(root, v, n, ver);
  const plan = { vendor: v, pack: n, version: ver, fileName, url, destDir, source: source || null };

  if (source) {
    if (!exists(source)) throw new Error(`source .pack not found: ${source}`);
    const info = inspectPack(source);
    if (dryRun) return { ok: true, dryRun: true, action: 'install-from-file', ...plan, packBytes: info.bytes, sha256: info.sha256 };
    fs.mkdirSync(destDir, { recursive: true });
    const written = extractPack(source, destDir);
    return { ok: true, dryRun: false, action: 'install-from-file', ...plan, installed: destDir, entries: written.length, sha256: info.sha256 };
  }

  if (dryRun) {
    return {
      ok: true, dryRun: true, action: 'download', ...plan,
      hint: '真正下载需要 allowNetwork:true；也可以先手动下载 .pack，再用 source 参数离线安装。',
    };
  }
  if (typeof fetch !== 'function') throw new Error('this Node build has no global fetch (need Node >= 18)');

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `keil-pack-${Date.now()}-${fileName}`);
  fs.writeFileSync(tmp, buf);
  try {
    const info = inspectPack(tmp);
    fs.mkdirSync(destDir, { recursive: true });
    const written = extractPack(tmp, destDir);
    return { ok: true, dryRun: false, action: 'download', ...plan, bytes: buf.length, sha256: info.sha256, installed: destDir, entries: written.length };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

/** Read the local pack index caches (if the machine has them) for "what versions exist". */
export function localIndex(roots) {
  const out = [];
  for (const root of roots || []) {
    const web = path.join(root, '.Web');
    let files = [];
    try { files = fs.readdirSync(web).filter(f => /\.pdsc$/i.test(f)); } catch { continue; }
    for (const f of files) {
      const p = path.join(web, f);
      let text = '';
      try { text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { continue; }
      const tag = (name) => {
        const m = new RegExp(`<${name}>([^<]+)</${name}>`, 'i').exec(text);
        return m ? m[1].trim() : null;
      };
      const vendor = tag('vendor');
      const name = tag('name');
      if (!vendor || !name) continue;
      const versions = [...text.matchAll(/<release\s+version="([^"]+)"/gi)].map(m => m[1]);
      const fileName = path.basename(p);
      out.push({
        vendor, name, versions,
        url: tag('url') || 'https://www.keil.com/pack/',
        pdsc: p, fileName, source: 'web-cache',
      });
    }
  }
  return out;
}
