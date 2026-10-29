// tools/project.mjs — .uvprojx/.uvproj/.uvmpw model tools.
import fs from 'node:fs';
import path from 'node:path';
import { resolveWin } from '../util.mjs';
import { register, str, int, bool, arr, enumOf } from './common.mjs';
import { Project, findProjectFile, readMultiProject, multiProjectTargets, guessFileType } from '../project.mjs';
import { deviceToTargetOptions, findDevices, listPackCatalog, findComponents, discoverPacks } from '../packs.mjs';
import { writeProject, writeBuildBatch } from '../scaffold.mjs';
import { expandMdkPath } from '../config.mjs';
function packRootsOf(ctx) {
  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
}


function open(p) { return new Project(findProjectFile(p)); }

function fileCounts(pr, targetName) {
  const f = pr.files(targetName);
  if (!f) return null;
  return { groups: f.groups.length, files: f.groups.reduce((a, g) => a + g.files.length, 0) + f.loose.length };
}

function requireTarget(pr, name) {
  const t = pr.target(name);
  if (!t) {
    const err = new Error(`target not found: ${name || '(first)'}`);
    err.code = 'TARGET_NOT_FOUND';
    err.available = pr.targetNames();
    throw err;
  }
  return t;
}

export function registerProjectTools(ctx) {
  register(ctx, {
    name: 'project_read',
    description: 'Read a µVision project: schema version, every target with normalized options (device, memory model, C/asm/linker settings, RTE components), file groups and batch-build flags.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file or directory'),
        target: str('Only this target'),
        includeFiles: bool('Include file group contents (default true)'),
        includeRte: bool('Include RTE components (default true)'),
      },
      required: ['project'],
    },
    handler: async (args) => {
      const pr = open(args.project);
      let targets = pr.targets();
      if (args.target) {
        const t = pr.target(args.target);
        if (!t) return { ok: false, error: `target not found: ${args.target}`, available: pr.targetNames() };
        targets = [t];
      }
      return {
        ok: true, file: pr.file, kind: pr.kind, schemaVersion: pr.schemaVersion,
        targets: targets.map(t => ({
          ...t,
          rte: args.includeRte === false ? { components: t.rte.components.length, apis: t.rte.apis.length } : t.rte,
          files: args.includeFiles === false ? fileCounts(pr, t.name) : pr.files(t.name),
        })),
      };
    },
  });

  register(ctx, {
    name: 'project_files',
    description: 'List the files of a target grouped exactly as µVision shows them (group name, file name, type code, path), with resolved absolute paths and existence flags.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target name'), checkExists: bool('Stat each file (default true)') }, required: ['project'] },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const f = pr.files(t.name);
      const rows = [];
      for (const g of f.groups) for (const file of g.files) {
        const abs = path.resolve(pr.dir, file.filePath || '');
        rows.push({ group: g.name, ...file, absolute: abs, exists: args.checkExists === false ? null : fs.existsSync(abs) });
      }
      for (const file of f.loose) {
        const abs = path.resolve(pr.dir, file.filePath || '');
        rows.push({ group: null, ...file, absolute: abs, exists: args.checkExists === false ? null : fs.existsSync(abs) });
      }
      return { ok: true, project: pr.file, target: t.name, groups: f.groups.map(g => g.name), files: rows, counts: { groups: f.groups.length, files: rows.length } };
    },
  });

  register(ctx, {
    name: 'project_multiproject',
    description: 'Expand a multi-project file (.uvmpw/.uvmpwx): project members, their targets, batch-build selection and output folders.',
    inputSchema: { type: 'object', properties: { project: str('Multi-project file') }, required: ['project'] },
    handler: async (args) => {
      const p = findProjectFile(args.project);
      return { ok: true, ...multiProjectTargets(p) };
    },
  });

  register(ctx, {
    name: 'project_set_option',
    description: 'Set one target option by its XML path, e.g. ["TargetOption","TargetCommonOption","OutputName"] or ["TargetOption","TargetArmAds","Cads","VariousControls","Define"]. Preserves the rest of the file byte-for-byte.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file'),
        target: str('Target name (default: first target)'),
        path: arr({ type: 'string' }, 'XML element path relative to <Target>'),
        value: { type: ['string', 'number', 'boolean'], description: 'New text value' },
        output: str('Write to this file instead of in place'),
        dryRun: bool('Preview the resulting XML without writing'),
      },
      required: ['project', 'path', 'value'],
    },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const r = pr.setTargetValue(t.name, args.path, args.value);
      if (args.dryRun) {
        const before = fs.readFileSync(pr.file, 'utf8');
        const after = pr.doc.toString();
        return { ok: true, ...r, dryRun: true, changed: before !== after, diff: simpleDiff(before, after) };
      }
      const dest = pr.save(args.output ? path.resolve(args.output) : undefined);
      return { ok: true, ...r, saved: dest };
    },
  });

  register(ctx, {
    name: 'project_group_add',
    description: 'Add a file group to a target (fails when the group exists).',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), group: str('Group name'), before: str('Insert before this group'), output: str('Write elsewhere') }, required: ['project', 'group'] },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const r = pr.addGroup(t.name, args.group, args.before);
      return { ok: true, ...r, saved: pr.save(args.output ? path.resolve(args.output) : undefined) };
    },
  });

  register(ctx, {
    name: 'project_group_remove',
    description: 'Remove a file group (and its files) from a target.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), group: str('Group name') }, required: ['project', 'group'] },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const r = pr.removeGroup(t.name, args.group);
      if (r.removed) pr.save();
      return { ok: true, ...r, saved: r.removed ? pr.file : null };
    },
  });

  register(ctx, {
    name: 'project_file_add',
    description: 'Add a source file to a group. FileType codes match µVision: 1=C, 2=assembler, 8=C++, 4=object/lib, 5=text/header.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file'), target: str('Target'), group: str('Target group'), filePath: str('Path as µVision would store it (relative or absolute)'), fileType: int('1 C, 2 asm, 8 C++, 4 object, 5 text') },
      required: ['project', 'group', 'filePath'],
    },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const r = pr.addFile(t.name, args.group, args.filePath, args.fileType);
      return { ok: true, ...r, saved: pr.save() };
    },
  });

  register(ctx, {
    name: 'project_file_remove',
    description: 'Remove files from every group of a target by path match.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), filePath: str('File path to remove') }, required: ['project', 'filePath'] },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const r = pr.removeFile(t.name, args.filePath);
      if (r.removed) pr.save();
      return { ok: true, ...r, saved: r.removed ? pr.file : null };
    },
  });

  register(ctx, {
    name: 'project_target_clone',
    description: 'Duplicate a target (all options and file groups) under a new name — the same result as Project→Manage→Project Items→New target from existing.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), from: str('Source target'), to: str('New target name') }, required: ['project', 'from', 'to'] },
    handler: async (args) => {
      const pr = open(args.project);
      const r = pr.cloneTarget(args.from, args.to);
      return { ok: true, ...r, saved: pr.save() };
    },
  });

  register(ctx, {
    name: 'project_target_remove',
    description: 'Delete a target from a project.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target to remove') }, required: ['project', 'target'] },
    handler: async (args) => {
      const pr = open(args.project);
      const r = pr.removeTarget(args.target);
      if (r.removed) pr.save();
      return { ok: true, ...r };
    },
  });

  register(ctx, {
    name: 'project_create',
    description: 'Create a complete µVision project for a device: TargetOption from the .pdsc (memory, core, flash algorithm, SVD, register header), optional startup/system sources copied from the DFP, include paths and defines. Output verified to build with UV4.',
    inputSchema: {
      type: 'object',
      properties: {
        output: str('Path of the .uvprojx to create'),
        device: str('Device name as in the pack (e.g. STM32F103C8)'),
        vendor: str('Vendor when the name is ambiguous'),
        packId: str('PackID to record (default <vendor>.<pack>.<version>)'),
        target: str('Target name (default Flash)'),
        outputName: str('Output base name (default = project file name)'),
        sources: arr({ type: 'string' }, 'Application source files to add'),
        groups: arr({ type: 'object' }, 'Extra groups: [{name, files:[{path,type}]}]'),
        addStartup: bool('Copy the matching startup_*.s from the DFP (default true)'),
        addSystem: bool('Copy system_*.c from the DFP when present (default true)'),
        extraIncludePaths: arr({ type: 'string' }, 'Extra include directories'),
        define: str('Extra preprocessor defines (comma separated)'),
      },
      required: ['output', 'device'],
    },
    handler: async (args) => {
      const outFile = path.resolve(args.output);
      const dir = path.dirname(outFile);
      const devs = findDevices(packRootsOf(ctx), args.device, 80);
      const dev = (args.vendor ? devs.find(d => d.vendor.toLowerCase() === args.vendor.toLowerCase()) : null)
        || devs.find(d => d.name.toLowerCase() === args.device.toLowerCase())
        || devs[0];
      if (!dev) return { ok: false, error: `device not found in installed packs: ${args.device}`, searched: packRootsOf(ctx) };
      const o = deviceToTargetOptions(dev);
      const packId = args.packId || `${dev.pack.vendor}.${dev.pack.name}.${dev.pack.version}`;
      const dfpDir = path.dirname(dev.pack.pdsc);
      const includePaths = [path.join(dfpDir, 'Device', 'Include')];
      // CMSIS core headers: prefer the CMSIS pack; its Core/Include is shared by all Cortex-M devices.
      // Only CMSIS-Core versions that still support ARM Compiler 5 are usable for AC5
      // projects: CMSIS 6.x cmsis_compiler.h ends in `#error Unknown compiler.` for
      // __CC_ARM (verifiable: core_cm3.h -> cmsis_compiler.h:279). Version 5.x works.
      const ac6 = args.ac6 === true;
      for (const root of packRootsOf(ctx)) {
        const cmsis = path.join(root, 'ARM', 'CMSIS');
        let versions = [];
        try { versions = fs.readdirSync(cmsis); } catch { continue; }
        const usable = versions.filter(v => fs.existsSync(path.join(cmsis, v, 'CMSIS', 'Core', 'Include', 'core_cm3.h')))
          .filter(v => ac6 || Number(String(v).split('.')[0]) <= 5)
          .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        if (usable.length) includePaths.push(path.join(cmsis, usable.pop(), 'CMSIS', 'Core', 'Include'));
      }
      for (const p of args.extraIncludePaths || []) includePaths.push(p);
      fs.mkdirSync(dir, { recursive: true });

      const groups = [{ name: 'Application', files: [] }];
      const copied = [];
      // When the device support already ships a SystemInit (system_*.c copied below),
      // do not also copy it twice: a user systemInit would collide at link time.
      if (args.addStartup !== false) {
        const srcDir = path.join(dfpDir, 'Device', 'Source', 'ARM');
        let cands = [];
        try { cands = fs.readdirSync(srcDir).filter(f => /^startup_.*\.s$/i.test(f)); } catch {}
        if (cands.length) {
          const defTok = (/STM32F10X_([A-Z0-9]+)/i.exec(dev.define || '') || [, ''])[1].toLowerCase();
          const pick = cands.find(f => defTok && f.toLowerCase().includes(defTok)) || cands[0];
          const dst = path.join(dir, pick);
          if (!fs.existsSync(dst)) fs.copyFileSync(path.join(srcDir, pick), dst);
          groups[0].files.push({ path: pick, type: 2 });
          copied.push(dst);
        }
      }
      // Default: no DFP system file. system_stm32f10x.c needs CMSIS-Core headers, and the
      // installed CMSIS 6.x ships cmsis_compiler.h whose AC5 detection ends in
      // "#error Unknown compiler." (verified: core_cm3.h -> cmsis_compiler.h:279). AC5
      // projects get a self-contained sysinit.c instead, or pass addSystem:true on an
      // installation that has CMSIS 5.
      if (args.addSystem === true && /STM32F10/.test(dev.name)) {
        const sys = path.join(dfpDir, 'Device', 'Source', 'system_stm32f10x.c');
        if (fs.existsSync(sys)) {
          const dst = path.join(dir, 'system_stm32f10x.c');
          if (!fs.existsSync(dst)) fs.copyFileSync(sys, dst);
          groups[0].files.push({ path: 'system_stm32f10x.c', type: 1 });
          copied.push(dst);
        }
      }
      for (const s of args.sources || []) groups[0].files.push({ path: s, type: guessFileType(s) });
      for (const g of args.groups || []) groups.push({ name: g.name, files: g.files || [] });
      if (groups[0].files.length === 0) groups.shift();

      writeProject(outFile, {
        device: dev.name, vendor: dev.vendor, packId, cpu: o.cpu, flashDriver: o.flashDriver,
        svdFile: o.svd, registerFile: o.registerFile,
        outputName: args.outputName || path.basename(outFile, path.extname(outFile)),
        targetName: args.target || 'Flash', includePath: includePaths.join(';'), deviceDefine: o.define, define: args.define || '', groups,
      });
      return {
        ok: true, project: outFile,
        device: { name: dev.name, vendor: dev.vendor, core: dev.core, family: dev.family, memory: dev.memory, flashAlgorithm: dev.flashAlgorithm, svd: dev.svd, header: dev.header },
        pack: dev.pack, cpu: o.cpu, includePaths, copied,
        groups: groups.map(g => ({ name: g.name, files: g.files.length })),
        nextSteps: ['Add application sources with project_file_add or sources[], then run uv4_rebuild to verify.'],
      };
    },
  });

  register(ctx, {
    name: 'project_validate',
    description: 'Validate a project against the checks UV4 performs while building: device resolution, memory map presence, startup section, missing files, include dirs, RTE pack availability.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target') }, required: ['project'] },
    handler: async (args) => {
      const pr = open(args.project);
      const t = requireTarget(pr, args.target);
      const issues = [];
      const files = pr.files(t.name);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose];
      const missing = all.filter(f => !fs.existsSync(path.resolve(pr.dir, f.filePath || '')));
      if (all.length === 0) issues.push({ level: 'warning', code: 'NO_SOURCES', message: 'target has no source files' });
      if (missing.length) issues.push({ level: 'error', code: 'FILE_MISSING', message: `${missing.length} source file(s) missing`, files: missing.map(f => f.filePath) });
      const asm = all.filter(f => f.type === 2);
      if (!asm.length) issues.push({ level: 'warning', code: 'NO_STARTUP', message: 'no assembler file: the linker reports L6236E "No section matches selector - no section to be FIRST/LAST"' });
      const mem = t.misc.memory || {};
      const hasRom = mem.IROM && mem.IROM.size && mem.IROM.size !== '0x0';
      if (!hasRom) issues.push({ level: 'error', code: 'NO_IROM', message: 'on-chip IROM undefined: the scatter generator reports "no default Read/Write range selected"' });
      if (!t.link || (!t.link.useMemoryLayout && !t.link.scatterFile)) issues.push({ level: 'error', code: 'NO_SCATTER', message: 'neither memory layout nor scatter file configured' });
      const devFound = t.device ? findDevices(packRootsOf(ctx), t.device, 5).find(d => d.name === t.device) : null;
      if (!devFound) issues.push({ level: 'warning', code: 'DEVICE_UNRESOLVED', message: `device '${t.device}' not found in installed packs (${t.packId || 'no PackID'})` });
      const rte = t.rte.components || [];
      const packIds = [...new Set(rte.map(c => c.pack && `${c.pack.vendor}.${c.pack.name}.${c.pack.version}`).filter(Boolean))];
      const installed = new Set(listPackCatalog(packRootsOf(ctx)).map(p => `${p.vendor}.${p.name}.${p.version}`));
      const missingPacks = packIds.filter(id => !installed.has(id));
      if (missingPacks.length) issues.push({ level: 'error', code: 'RTE_PACK_MISSING', message: `RTE components reference uninstalled packs: ${missingPacks.join(', ')}` });
      const includes = String(t.c.includePath || '').split(';').filter(Boolean);
      const missingIncludes = includes.filter(i => !fs.existsSync(resolveWin(pr.dir, i)));
      if (missingIncludes.length) issues.push({ level: 'warning', code: 'INCLUDE_MISSING', message: `include directories do not exist: ${missingIncludes.join('; ')}` });
      return {
        ok: issues.filter(i => i.level === 'error').length === 0,
        project: pr.file, target: t.name, issues,
        resolvedDevice: devFound ? { name: devFound.name, core: devFound.core, memory: devFound.memory } : null,
        summary: { files: all.length, missing: missing.length, asm: asm.length, rteComponents: rte.length },
      };
    },
  });

  register(ctx, {
    name: 'project_diff',
    description: 'Semantic diff between two project files: targets added/removed, option changes per target (dotted paths), file list changes.',
    inputSchema: { type: 'object', properties: { left: str('Project A'), right: str('Project B') }, required: ['left', 'right'] },
    handler: async (args) => {
      const a = open(args.left); const b = open(args.right);
      const ta = a.targets(); const tb = b.targets();
      const names = new Set([...ta.map(t => t.name), ...tb.map(t => t.name)]);
      const changes = [];
      for (const n of names) {
        const x = ta.find(t => t.name === n); const y = tb.find(t => t.name === n);
        if (!x) { changes.push({ target: n, kind: 'added' }); continue; }
        if (!y) { changes.push({ target: n, kind: 'removed' }); continue; }
        const diffs = [];
        walkDiff(x, y, '', diffs);
        const fa = a.files(n); const fb = b.files(n);
        const listA = fa ? fa.groups.flatMap(g => g.files.map(f => g.name + '/' + f.filePath)) : [];
        const listB = fb ? fb.groups.flatMap(g => g.files.map(f => g.name + '/' + f.filePath)) : [];
        const added = listB.filter(f => !listA.includes(f)); const removed = listA.filter(f => !listB.includes(f));
        if (diffs.length || added.length || removed.length) changes.push({ target: n, kind: 'modified', options: diffs, filesAdded: added, filesRemoved: removed });
      }
      return { ok: true, left: a.file, right: b.file, changes };
    },
  });

  register(ctx, {
    name: 'batch_file',
    description: 'Generate the batch file µVision writes with Options→Output→Create Batch File (same command line, exit code forwarded).',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), dir: str('Destination directory (default: project dir)') }, required: ['project'] },
    handler: async (args) => {
      const p = findProjectFile(args.project);
      const pr = new Project(p);
      const t = requireTarget(pr, args.target);
      const f = writeBuildBatch(args.dir ? path.resolve(args.dir) : path.dirname(p), p, t.name);
      return { ok: true, file: f, content: fs.readFileSync(f, 'utf8') };
    },
  });
}

function walkDiff(a, b, prefix, out) {
  if (a === b) return;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: prefix, from: a, to: b });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) walkDiff(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
}

function simpleDiff(before, after) {
  const bl = before.split('\n'); const al = after.split('\n');
  const out = [];
  const n = Math.max(bl.length, al.length);
  for (let i = 0; i < n; i++) if (bl[i] !== al[i]) out.push({ line: i + 1, before: bl[i], after: al[i] });
  return out.slice(0, 50);
}





