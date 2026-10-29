// tools/packmgr.mjs — beginner-facing entry points: doctor, pack_diagnose, pack_fetch.
//
// The wording in these tools is deliberately plain: a newcomer should be able to read the
// `summary`, run one `actions[]` entry, and be done. µVision error numbers appear only as
// context ("µVision would say #544"), never as the explanation.
import { register, str, bool, arr } from './common.mjs';
import { FIXTURE_ROOT } from '../portable.mjs';
import { diagnoseProject, doctor, fetchPack, localIndex, downloadDirFor } from '../packmgr.mjs';

function rootsOf(ctx) {
  try { return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || []; } catch { return []; }
}

export function registerPackManagerTools(ctx) {
  register(ctx, {
    name: 'doctor',
    description: 'One command to answer "is this machine ready?". Checks Node version, cross compiler, flashing tool, pack roots, installed packs and the bundled snapshot, and says what to install for each gap. Read-only, offline.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        return { ok: true, ...(await doctor(rootsOf(ctx), FIXTURE_ROOT)) };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  });

  register(ctx, {
    name: 'pack_diagnose',
    description: 'Answer "why will this project not build?" in one shot: compares the project PackID/device/RTE/includes against the installed packs, explains the version mismatch in plain language, and returns ready-to-run fixes. Offline, read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file or directory'),
        target: str('Target name (default: first target)'),
      },
      required: ['project'],
    },
    handler: async (args) => {
      try {
        const roots = rootsOf(ctx);
        const r = diagnoseProject(args.project, args.target, roots);
        return { ...r, packRoots: roots, downloadDir: roots[0] ? downloadDirFor(roots[0]) : null };
      } catch (e) {
        return { ok: false, error: String(e.message || e), hint: '确认路径指向 .uvprojx / .uvproj 文件或包含它的目录' };
      }
    },
  });

  register(ctx, {
    name: 'pack_fetch',
    description: 'Install one CMSIS-Pack: from a local .pack (source) or from keil.com (allowNetwork). dryRun defaults to true and only reports the URL and target directory. Extracts into <packRoot>/<Vendor>/<Pack>/<Version> and never overwrites silently.',
    inputSchema: {
      type: 'object',
      properties: {
        vendor: str('Pack vendor, e.g. Keil'),
        pack: str('Pack name, e.g. STM32F1xx_DFP'),
        version: str('Exact version, e.g. 2.4.1'),
        source: str('Local .pack file to install (works offline)'),
        baseUrl: str('Download base (default https://www.keil.com/pack/)'),
        allowNetwork: bool('Actually download from the network (default false)'),
        dryRun: bool('Only report what would happen (default true)'),
      },
      required: ['vendor', 'pack', 'version'],
    },
    handler: async (args) => {
      try {
        const roots = rootsOf(ctx);
        if (!roots.length) {
          return {
            ok: false,
            error: '没有可用的 pack 目录',
            fix: ['设置 KEIL_MDK_ROOT 指向一个安装根目录，或创建任意目录并把它加到 RTEPATH'],
          };
        }
        const dryRun = args.dryRun !== false && !args.allowNetwork;
        const r = await fetchPack({
          vendor: args.vendor, pack: args.pack, version: args.version,
          roots, source: args.source, baseUrl: args.baseUrl,
          dryRun: args.source ? (args.dryRun !== false) : dryRun,
        });
        return {
          ...r,
          next: r.dryRun
            ? '确认无误后加干跑开关：source 安装用 dryRun:false；联网下载用 allowNetwork:true。'
            : '装好了。重跑 pack_diagnose 确认 ok=true，然后就可以 compile 了。',
        };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  });

  register(ctx, {
    name: 'pack_versions',
    description: 'Which versions of a pack exist locally (from the .Web index cache) versus which are installed. Answers "can I install 2.4.0 at all?" without touching the network.',
    inputSchema: { type: 'object', properties: { query: str('vendor or pack name substring') } },
    handler: async (args) => {
      const roots = rootsOf(ctx);
      const q = String(args.query || '').toLowerCase();
      const idx = localIndex(roots).filter(x => !q || `${x.vendor}.${x.name}`.toLowerCase().includes(q));
      const installed = (await import('../packs.mjs')).listPackCatalog(roots);
      // The same pack is often visible twice (installed tree + bundled snapshot); a beginner
      // reads a duplicated list as "I have it twice".
      const seen = new Set();
      const installedNames = [];
      for (const p of installed) {
        const key = `${p.vendor}.${p.name}.${p.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        installedNames.push(key);
      }
      return {
        ok: true,
        installed: installedNames,
        index: idx.slice(0, 50).map(x => ({ pack: `${x.vendor}.${x.name}`, versions: x.versions, url: x.url, cache: x.pdsc })),
        note: idx.length ? 'index 来自本地 .Web 缓存（PackInstaller 拉过的那份），不含网络查询' : '本机没有 .Web 索引缓存',
      };
    },
  });
}
