// tools/image.mjs — ELF/MAP/HEX inspection and memory utilisation.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool } from './common.mjs';
import { readElf, readMap, analyzeHex, memoryUsage } from '../image.mjs';
import { Project, findProjectFile } from '../project.mjs';

function resolveInProject(project, rel) {
  const pr = new Project(findProjectFile(project));
  const t = pr.targets()[0];
  const dir = path.resolve(pr.dir, (t && t.outputDirectory) || '.');
  return { pr, t, file: path.resolve(dir, rel) };
}

export function registerImageTools(ctx) {
  register(ctx, {
    name: 'elf_info',
    description: 'Inspect the .axf ELF: sections, loadable segments, symbol table (functions/objects with sizes) and code/data totals — without requiring fromelf.',
    inputSchema: {
      type: 'object',
      properties: { file: str('Path to .axf/.elf'), project: str('Project (when file is relative to the output folder)'), name: str('Output name (defaults to the target output name)'), symbolFilter: str('Substring filter for symbols'), limit: int('max symbols (default 500)') },
    },
    handler: async (args) => {
      let file = args.file;
      if (!file && args.project) {
        const { pr, t, file: auto } = resolveInProject(args.project, (args.name || t.outputName) + '.axf');
        file = auto;
      }
      if (!file) return { ok: false, error: 'file or project+name required' };
      const elf = readElf(path.resolve(file));
      if (!elf.ok) return elf;
      let syms = elf.symbols.filter(s => s.value);
      if (args.symbolFilter) syms = syms.filter(s => s.name.includes(args.symbolFilter));
      return { ok: true, file: path.resolve(file), ...elf, symbols: syms.slice(0, args.limit || 500), symbolCount: syms.length };
    },
  });

  register(ctx, {
    name: 'map_info',
    description: 'Parse the linker map: image totals (RO/RW/ROM), execution regions, per-object section sizes and global symbols.',
    inputSchema: { type: 'object', properties: { file: str('Map file'), project: str('Project (derive path)'), name: str('Output name') }, required: [] },
    handler: async (args) => {
      let file = args.file;
      if (!file && args.project) {
        const pr = new Project(findProjectFile(args.project));
        const t = pr.targets()[0];
        file = path.resolve(pr.dir, t.listingPath || '.', (args.name || t.outputName) + '.map');
      }
      if (!file) return { ok: false, error: 'file or project+name required' };
      return readMap(path.resolve(file));
    },
  });

  register(ctx, {
    name: 'hex_info',
    description: 'Intel-HEX analysis: records, contiguous segments, byte count, address range and checksum verification.',
    inputSchema: { type: 'object', properties: { file: str('Hex file'), project: str('Project (derive path)'), name: str('Output name') } },
    handler: async (args) => {
      let file = args.file;
      if (!file && args.project) {
        const pr = new Project(findProjectFile(args.project));
        const t = pr.targets()[0];
        file = path.resolve(pr.dir, t.outputDirectory || '.', (args.name || t.outputName) + '.hex');
      }
      return analyzeHex(path.resolve(file));
    },
  });

  register(ctx, {
    name: 'memory_usage',
    description: 'Flash/RAM utilisation: ELF segments mapped onto the target memory model (IROM/IRAM), with fill percentages and region overflow warnings.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), file: str('Explicit .axf path') }, required: ['project'] },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const file = args.file ? path.resolve(args.file) : path.resolve(pr.dir, t.outputDirectory || '.', t.outputName + '.axf');
      if (!fs.existsSync(file)) return { ok: false, error: `image not found: ${file}` };
      const elf = readElf(file);
      if (!elf.ok) return elf;
      const mu = memoryUsage(elf, t);
      const warnings = [];
      if (mu.rom.size && mu.rom.used > mu.rom.size) warnings.push('code exceeds IROM size');
      if (mu.ram.size && mu.ram.used > mu.ram.size) warnings.push('data exceeds IRAM size');
      return { ok: true, target: t.name, image: file, ...mu, warnings };
    },
  });

  register(ctx, {
    name: 'symbols_file',
    description: 'Read the preprocessor symbol file produced by UV4 -X (co-arm_<target>.h) and return defines as key/value pairs.',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), file: str('Explicit file') }, required: ['project'] },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const dir = path.resolve(pr.dir, t.outputDirectory || '.');
      const cands = [path.join(dir, `co-arm_${t.name}.h`), path.join(dir, `co-arm_${t.name}.hpp`), path.join(dir, `co-arm_${t.outputName}.h`)];
      const file = args.file ? path.resolve(args.file) : cands.find(f => fs.existsSync(f));
      if (!file || !fs.existsSync(file)) return { ok: false, error: 'symbol file not found; run uv4_symbols first', searched: cands };
      const text = fs.readFileSync(file, 'utf8');
      const defs = {};
      for (const m of text.matchAll(/^#define\s+(\w+)(?:\s+(.*))?$/gm)) defs[m[1]] = (m[2] || '').trim();
      return { ok: true, file, defines: defs, count: Object.keys(defs).length, head: text.split(/\r?\n/).slice(0, 12).join('\n') };
    },
  });
}

