// tools/packs.mjs — CMSIS-Pack device/component tools.
import path from 'node:path';
import { register, str, int, bool, arr } from './common.mjs';
import { listPackCatalog, findDevices, findComponents, readPack, deviceToTargetOptions, clearPackCache, discoverPacks } from '../packs.mjs';

function roots(ctx) {
  const roots = ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
  if (!roots.length) throw new Error('no pack roots: no installed packs and no bundled fixtures');
  return roots;
}

export function registerPackTools(ctx) {
  register(ctx, {
    name: 'pack_list',
    description: 'Installed CMSIS-Packs under the RTEPATH roots (vendor, pack, version, device/component counts, .pdsc path).',
    inputSchema: { type: 'object', properties: { refresh: bool('drop cached .pdsc parses') } },
    handler: async (args) => {
      if (args.refresh) clearPackCache();
      const r = roots(ctx);
      return { ok: true, roots: r, packs: listPackCatalog(r), cmsisToolbox: ctx.install.cmsisToolboxBin };
    },
  });

  register(ctx, {
    name: 'pack_devices',
    description: 'Search the device database across installed packs. Returns name, vendor, family, core, clock, memory regions, define, SVD, flash algorithm and the owning pack.',
    inputSchema: { type: 'object', properties: { query: str('Substring of the device name (e.g. STM32F103)'), limit: int('max results (default 50)') } },
    handler: async (args) => {
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 1000);
      const list = findDevices(roots(ctx), args.query || '', limit);
      return { ok: true, count: list.length, devices: list.map(d => ({ name: d.name, vendor: d.vendor, family: d.family, subFamily: d.subFamily, core: d.core, clock: d.clock, memory: d.memory, define: d.define, svd: d.svd, pack: d.pack })) };
    },
  });

  register(ctx, {
    name: 'pack_device_detail',
    description: 'Full device record plus the exact TargetOption fragments UV4 would use (Cpu string, flash driver UL2CM3(...), SVD and register header paths, default defines).',
    inputSchema: { type: 'object', properties: { name: str('Exact device name'), vendor: str('Vendor filter') }, required: ['name'] },
    handler: async (args) => {
      const q = args.name.trim();
      const all = findDevices(roots(ctx), q, 400);
      const d = all.find(x => x.name.toLowerCase() === q.toLowerCase() && (!args.vendor || x.vendor.toLowerCase() === args.vendor.toLowerCase()))
        || all.find(x => x.name.toLowerCase() === q.toLowerCase());
      if (!d) return { ok: false, error: `device not found: ${q}`, candidates: all.slice(0, 10).map(x => x.name) };
      const to = deviceToTargetOptions(d);
      return { ok: true, device: d, targetOptions: to, uvprojx: { Device: d.name, Vendor: d.vendor, PackID: `${d.pack.vendor}.${d.pack.name}.${d.pack.version}`, Cpu: to.cpu, FlashDriverDll: to.flashDriver, SFDFile: to.svd, RegisterFile: to.registerFile } };
    },
  });

  register(ctx, {
    name: 'pack_components',
    description: 'Search RTE components (Cclass:Cgroup[:Csub[:Cvariant]]) with file counts and their availability condition.',
    inputSchema: { type: 'object', properties: { query: str('substring of Cclass:Cgroup:Csub'), pack: str('restrict to pack name'), limit: int('default 100') }, required: ['query'] },
    handler: async (args) => {
      const all = findComponents(roots(ctx), args.query, 2000);
      const filtered = args.pack ? all.filter(c => c.pack.name.toLowerCase() === args.pack.toLowerCase()) : all;
      return { ok: true, count: filtered.length, components: filtered.slice(0, args.limit || 100) };
    },
  });

  register(ctx, {
    name: 'pack_conditions',
    description: 'RTE conditions of a pack (<condition id> with its <require> device/core rules) — used to explain Error #540/#542.',
    inputSchema: { type: 'object', properties: { pack: str('Pack name (e.g. CMSIS, STM32F1xx_DFP)'), id: str('Condition id filter') }, required: ['pack'] },
    handler: async (args) => {
      const p = discoverPacks(roots(ctx)).find(x => x.name.toLowerCase() === args.pack.toLowerCase());
      if (!p) return { ok: false, error: `pack not found: ${args.pack}` };
      const db = readPack(p.pdsc);
      const conds = args.id ? db.conditions.filter(c => c.id === args.id) : db.conditions;
      return { ok: true, pack: { vendor: p.vendor, name: p.name, version: p.version }, conditions: conds.slice(0, 500), count: conds.length };
    },
  });

  register(ctx, {
    name: 'pack_rte_validate',
    description: 'Validate the RTE component list of a project target against installed packs/conditions and return the UV4 error codes that would be raised (#540 component not available, #541 API missing, #542 API version, #543 device, #544 pack).',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target') }, required: ['project'] },
    handler: async (args) => {
      const { Project, findProjectFile } = await import('../project.mjs');
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const rs = roots(ctx);
      const catalog = listPackCatalog(rs);
      const installed = new Map(catalog.map(p => [`${p.vendor}.${p.name}`.toLowerCase(), p]));
      const devs = findDevices(rs, t.device, 20).filter(d => d.name === t.device);
      const issues = [];
      if (t.device && devs.length === 0) issues.push({ code: 543, message: `Error #543: Device '${t.device}' not found in installed packs` });
      for (const c of t.rte.components) {
        const id = c.pack ? `${c.pack.vendor}.${c.pack.name}`.toLowerCase() : null;
        if (id && !installed.has(id)) {
          issues.push({ code: 544, component: `${c.vendor}::${c.cls}:${c.group}${c.sub ? ':' + c.sub : ''}`, message: `Error #544: required software pack '${c.pack.vendor}.${c.pack.name}.${c.pack.version}' is not installed` });
          continue;
        }
        const comps = findComponents([installed.get(id) && installed.get(id).pdsc ? path.dirname(installed.get(id).pdsc) : rs[0]], c.group, 2000);
        const hit = comps.find(x => x.cls === c.cls && x.group === c.group && (x.sub || null) === (c.sub || null));
        if (!hit) issues.push({ code: 540, component: `${c.cls}:${c.group}${c.sub ? ':' + c.sub : ''}`, message: 'Error #540: component is not available for target' });
      }
      return { ok: issues.length === 0, target: t.name, device: t.device, issues, packs: catalog.map(p => `${p.vendor}.${p.name}.${p.version}`) };
    },
  });
}

