// tools/compile.mjs — license-free build and flash.
//
// This is the primary build path for users who do not have (or do not want) an MDK
// licence: the µVision project is read with the same parser the rest of the server uses,
// then compiled with a cross compiler that needs no activation (arm-none-eabi-gcc or
// clang+lld), and flashed with pyOCD/OpenOCD. Nothing here talks to armlm, FlexNet or
// UV4.exe, so there is no Error #601 gate to satisfy.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool, enumOf } from './common.mjs';
import { Project, findProjectFile } from '../project.mjs';
import { detectBackends, detectFlashers, portableCompile, runFlash, flashCommand, parseCpuString } from '../build.mjs';

function openProject(fileOrDir) {
  const file = findProjectFile(fileOrDir);
  const pr = new Project(file);
  return { file, pr, dir: path.dirname(file) };
}

function absFrom(dir, p) {
  if (!p) return null;
  if (/\$\(|\$\{/.test(p)) return null; // unresolved µVision variable: caller sees it in `unresolved`
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(dir, p);
}

/**
 * CMSIS-Core headers are not listed in most .uvprojx IncludePath values: UV4 finds them
 * through RTE/the pack. A raw compiler does not, so resolve Core/Include from the pack
 * roots the server already knows (installed packs first, bundled fixtures second).
 */
function cmsisIncludes(roots, coreHeader = 'core_cm3.h') {
  const found = [];
  for (const root of roots || []) {
    const base = path.join(root, 'ARM', 'CMSIS');
    let versions = [];
    try { versions = fs.readdirSync(base); } catch { continue; }
    versions.sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
    for (const v of versions) {
      const inc = path.join(base, v, 'CMSIS', 'Core', 'Include');
      if (fs.existsSync(path.join(inc, coreHeader))) { found.push(inc); break; }
    }
  }
  return [...new Set(found)];
}

/** Turn one target into the compiler spec, resolving paths against the project directory. */
function targetSpec(pr, dir, t, args, extraIncludes = []) {
  const files = pr.allFilePaths(t.name) || [];
  const unresolved = [];
  const includes = [];
  for (const raw of String(t.c.includePath || '').split(';').filter(Boolean)) {
    const a = absFrom(dir, raw);
    if (a) includes.push(a); else unresolved.push(raw);
  }
  const added = [];
  for (const inc of extraIncludes) {
    if (!includes.some(i => path.resolve(i).toLowerCase() === path.resolve(inc).toLowerCase())) {
      includes.push(inc); added.push(inc);
    }
  }
  const defines = String(t.c.define || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const sources = files.map(f => absFrom(dir, f) || f).filter(Boolean);
  const missing = sources.filter(f => !fs.existsSync(f));
  return {
    spec: {
      files: sources.map(p => ({ path: p })),
      defines,
      includes,
      cpu: t.cpu,
      cpuType: t.misc.cpuType,
      outDir: args.outDir ? path.resolve(args.outDir) : path.join(dir, t.outputDirectory || '.\\Objects'),
      outputName: args.outputName || t.outputName || 'Target',
      backend: args.backend,
    },
    meta: {
      target: t.name, device: t.device, cpu: t.cpu, cpuType: t.misc.cpuType,
      defines, includes, addedIncludes: added, sources, missing, unresolved,
      outputName: args.outputName || t.outputName,
      outputDir: args.outDir ? path.resolve(args.outDir) : path.join(dir, t.outputDirectory || '.\\Objects'),
    },
  };
}

export function registerCompileTools(ctx) {
  register(ctx, {
    name: 'build_backends',
    description: 'List the license-free cross compilers and flashing tools this machine has (arm-none-eabi-gcc / clang+lld, and pyOCD / OpenOCD / ST-LINK / J-Link). Nothing here requires an MDK licence.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const compilers = await detectBackends();
      const flashers = await detectFlashers();
      return {
        ok: true,
        licenseFree: true,
        compilers: compilers.map(b => ({ id: b.id, exe: b.exe, linker: b.linker, objcopy: b.objcopy, version: b.version || null })),
        flashers: flashers.map(f => ({ id: f.id, exe: f.exe, note: f.note })),
        note: compilers.length ? 'a licence-free build path is available' : 'no cross compiler found: install arm-none-eabi-gcc or LLVM (clang + lld)',
      };
    },
  });

  register(ctx, {
    name: 'compile',
    description: 'Compile one µVision target with a license-free toolchain (arm-none-eabi-gcc or clang+lld): reads <project>.uvprojx like UV4 would (device Cpu string, defines, include paths, file groups), emits .elf + .hex + .bin + .map. No MDK licence, no armlm, no UV4.exe involved. Object code is not byte-identical to armcc — the backend is reported in the result.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file or directory'),
        target: str('Target name (default: first target)'),
        backend: enumOf(['auto', 'clang', 'gcc'], 'force a compiler (default auto: clang, then arm-none-eabi-gcc)'),
        outDir: str('Output directory (default: the target output directory)'),
        outputName: str('Output base name (default: the target output name)'),
      },
      required: ['project'],
    },
    handler: async (args) => {
      try {
        const { pr, dir, file } = openProject(args.project);
        const targets = pr.targets();
        if (!targets.length) return { ok: false, error: 'project has no targets', project: file };
        const t = args.target ? targets.find(x => x.name === args.target) : targets[0];
        if (!t) return { ok: false, error: `target not found: ${args.target}`, targets: targets.map(x => x.name) };
        let roots = [];
        try { roots = ctx.data ? ctx.data.packRoots() : []; } catch { roots = []; }
        const extra = cmsisIncludes(roots);
        const { spec, meta } = targetSpec(pr, dir, t, args, extra);
        if (!meta.sources.length) return { ok: false, error: 'target has no source files', target: t.name };
        const res = await portableCompile({ ...spec, backend: args.backend && args.backend !== 'auto' ? args.backend : undefined });
        return { ...res, project: file, target: t.name, meta };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  });

  register(ctx, {
    name: 'flash',
    description: 'Flash a .hex/.bin/.elf with a license-free programmer: pyOCD, OpenOCD, STM32_Programmer_CLI, ST-LINK_CLI or J-Link Commander. dryRun defaults to true and returns the exact command line; pass dryRun:false to actually program the target.',
    inputSchema: {
      type: 'object',
      properties: {
        file: str('.hex/.bin/.elf to program (or use project + target to find the build output)'),
        project: str('Project file (used to locate the built image when file is omitted)'),
        target: str('Target name (with project)'),
        chip: str('Device name for the programmer, e.g. STM32F103C8'),
        probe: str('OpenOCD interface config name, e.g. cmsis-dap, st-link, jlink'),
        address: str('Flash base address (default 0x08000000)'),
        dryRun: bool('Only print the command (default true)'),
        timeoutMs: int('Programming timeout (default 120000)'),
      },
      required: [],
    },
    handler: async (args) => {
      let file = args.file ? path.resolve(args.file) : null;
      let project = null;
      if (!file && args.project) {
        try {
          const { pr, dir, file: pf } = openProject(args.project);
          project = pf;
          const t = args.target ? pr.targets().find(x => x.name === args.target) : pr.targets()[0];
          if (t) {
            const outDir = path.join(dir, t.outputDirectory || '.\\Objects');
            for (const ext of ['.hex', '.bin', '.elf']) {
              const cand = path.join(outDir, `${t.outputName}${ext}`);
              if (fs.existsSync(cand)) { file = cand; break; }
            }
          }
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
      if (!file) return { ok: false, error: 'no image to flash', hint: 'pass file, or project+target after running compile' };
      if (!fs.existsSync(file)) return { ok: false, error: `image not found: ${file}` };

      const flashers = await detectFlashers();
      if (!flashers.length) {
        return {
          ok: false, licenseFree: true, image: file,
          error: 'no flashing tool found',
          need: ['pyocd (pip install pyocd)', 'openocd', 'STM32_Programmer_CLI', 'J-Link Commander'],
          hint: 'install one of them; the generated command is identical to what this tool would run',
        };
      }
      const wanted = args.chip ? /stm32/i.test(args.chip) : true;
      const flasher = flashers.find(f => ['pyocd', 'openocd'].includes(f.id)) || flashers[0];
      const spec = { file, chip: args.chip, probe: args.probe, address: args.address, dryRun: args.dryRun !== false, timeoutMs: args.timeoutMs };
      const res = await runFlash(flasher, spec);
      return { ...res, image: file, project, available: flashers.map(f => f.id), licenseFree: true };
    },
  });
}
