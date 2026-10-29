// tools/importxml.mjs — project_import.xsd documents (-i) for creating/updating projects.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, arr, bool } from './common.mjs';
import { findDevices } from '../packs.mjs';
import { findProjectFile } from '../project.mjs';
function packRootsOf(ctx) {
  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
}


function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const sw = (v) => (v === true || v === 1 || v === '1' ? '1' : '0');

/** Build a project_import.xsd compliant document (README: UV4 -i MyProject.uvprojx -i MyImport.xml -t target). */
export function buildImportXml(opts) {
  const o = opts || {};
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<Project>\n';
  if (o.toolset) x += `  <ToolsetName>${esc(o.toolset)}</ToolsetName>\n`;
  if (o.device) x += `  <Device>${esc(o.device)}</Device>\n`;
  if (o.outputName || o.outputPath || o.createLib) {
    x += `  <Output${o.outputName ? ` name="${esc(o.outputName)}"` : ''}${o.outputPath ? ` path="${esc(o.outputPath)}"` : ''}${o.createLib ? ' CreateLib="1"' : ''}/>\n`;
  }
  if (o.includePath) x += `  <IncludePath>${esc(o.includePath)}</IncludePath>\n`;
  if (o.scatterFile) x += `  <ScatterFile>${esc(o.scatterFile)}</ScatterFile>\n`;
  if (o.sfrFile) x += `  <SFDFile>${esc(o.sfrFile)}</SFDFile>\n`;
  if (o.miscControls) x += `  <MiscControls>${esc(o.miscControls)}</MiscControls>\n`;
  if (o.cDefines) x += `  <CDefines>${esc(o.cDefines)}</CDefines>\n`;
  if (o.asmDefines) x += `  <AsmDefines>${esc(o.asmDefines)}</AsmDefines>\n`;
  if (o.cOptions) x += `  <COptions>${esc(o.cOptions)}</COptions>\n`;
  if (o.asmOptions) x += `  <AsmOptions>${esc(o.asmOptions)}</AsmOptions>\n`;
  if (o.linkOptions) x += `  <LinkOptions>${esc(o.linkOptions)}</LinkOptions>\n`;
  if (o.useUlib !== undefined) x += `  <useUlib>${sw(o.useUlib)}</useUlib>\n`;
  if (o.simulator) {
    x += '  <Simulator>\n';
    if (o.simulator.useSimulator !== undefined) x += `    <UseSimulator>${sw(o.simulator.useSimulator)}</UseSimulator>\n`;
    if (o.simulator.loadApplicationAtStartup !== undefined) x += `    <LoadApplicationAtStartup>${sw(o.simulator.loadApplicationAtStartup)}</LoadApplicationAtStartup>\n`;
    if (o.simulator.runToMain !== undefined) x += `    <RunToMain>${sw(o.simulator.runToMain)}</RunToMain>\n`;
    if (o.simulator.initializationFile) x += `    <InitializationFile>${esc(o.simulator.initializationFile)}</InitializationFile>\n`;
    x += '  </Simulator>\n';
  }
  if (o.target) {
    x += '  <Target>\n';
    if (o.target.useTarget !== undefined) x += `    <UseTarget>${sw(o.target.useTarget)}</UseTarget>\n`;
    if (o.target.loadApplicationAtStartup !== undefined) x += `    <LoadApplicationAtStartup>${sw(o.target.loadApplicationAtStartup)}</LoadApplicationAtStartup>\n`;
    if (o.target.runToMain !== undefined) x += `    <RunToMain>${sw(o.target.runToMain)}</RunToMain>\n`;
    if (o.target.initializationFile) x += `    <InitializationFile>${esc(o.target.initializationFile)}</InitializationFile>\n`;
    if (o.target.driver) x += `    <Driver>${esc(o.target.driver)}</Driver>\n`;
    x += '  </Target>\n';
  }
  if (o.groups && o.groups.length) {
    x += '  <Groups>\n';
    for (const g of o.groups) {
      x += '    <Group>\n';
      if (g.name) x += `      <GroupName>${esc(g.name)}</GroupName>\n`;
      if (g.files && g.files.length) {
        x += '      <Files>\n';
        for (const f of g.files) {
          const p = typeof f === 'string' ? f : f.path;
          const t = typeof f === 'string' ? guessType(p) : (f.type || guessType(p));
          x += `        <File><FileName>${esc(path.basename(p))}</FileName><FileType>${t}</FileType><FilePath>${esc(p)}</FilePath></File>\n`;
        }
        x += '      </Files>\n';
      }
      x += '    </Group>\n';
    }
    x += '  </Groups>\n';
  }
  x += '</Project>\n';
  return x;
}

function guessType(p) {
  const e = path.extname(String(p)).toLowerCase();
  if (e === '.s' || e === '.asm') return 2;
  if (e === '.cpp' || e === '.cc' || e === '.cxx') return 8;
  if (e === '.o' || e === '.obj') return 3;
  if (e === '.lib' || e === '.a') return 4;
  if (e === '.h' || e === '.txt' || e === '.inc') return 5;
  return 1;
}

export function registerImportTools(ctx) {
  register(ctx, {
    name: 'import_xml_document',
    description: 'Compose a project_import.xsd document (the format UV4 -i consumes: ToolsetName, Device, Output, IncludePath, CDefines, COptions, Simulator/Target debugger settings, Groups/Files). Returns XML and optionally writes it to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        device: str('Device name'),
        output: str('Optional .xml destination'),
        toolset: str('ToolsetName (default ARM-ADS is not used by the schema; UV4 expects e.g. "ARM")'),
        outputName: str('Output file name'),
        outputPath: str('Output directory'),
        createLib: bool('Create library instead of executable'),
        includePath: str('Include paths (semicolon separated)'),
        scatterFile: str('Custom scatter file'),
        sfrFile: str('SFD/SFR file'),
        cDefines: str('C defines without -D'),
        asmDefines: str('Assembler defines (C syntax)'),
        miscControls: str('Legacy MiscControls field (deprecated by the schema; prefer cOptions)'),
        cOptions: str('Extra C options'),
        asmOptions: str('Extra assembler options'),
        linkOptions: str('Extra linker options'),
        useUlib: bool('MicroLib'),
        useSimulator: bool('Debug with simulator'),
        initFile: str('Debug initialisation script (INCLUDE file)'),
        driver: str('Debug driver path as in TOOLS.INI, e.g. BIN\\UL2ARM.DLL'),
        groups: arr({ type: 'object' }, 'Groups [{name, files:[path|{path,type}]}]'),
      },
      required: ['device'],
    },
    handler: async (args) => {
      const dev = findDevices(packRootsOf(ctx), args.device, 5).find(d => d.name.toLowerCase() === String(args.device).toLowerCase()) || findDevices(packRootsOf(ctx), args.device, 5)[0];
      const xml = buildImportXml({
        toolset: args.toolset || 'ARM', device: dev ? dev.name : args.device,
        outputName: args.outputName, outputPath: args.outputPath, createLib: args.createLib,
        includePath: args.includePath, scatterFile: args.scatterFile, sfrFile: args.sfrFile, miscControls: args.miscControls,
        cDefines: args.cDefines, asmDefines: args.asmDefines, cOptions: args.cOptions, asmOptions: args.asmOptions, linkOptions: args.linkOptions,
        useUlib: args.useUlib,
        simulator: args.useSimulator !== undefined || args.initFile ? { useSimulator: args.useSimulator, initializationFile: args.initFile } : null,
        target: args.driver ? { driver: args.driver } : null,
        groups: args.groups,
      });
      let saved = null;
      if (args.output) { saved = path.resolve(args.output); fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, xml, 'utf8'); }
      return { ok: true, saved, xml, next: saved ? `Run: uv4_import { project: "<new.uvprojx>", importXml: "${saved}" }` : 'Pass the XML string to uv4_import.importXml path after saving it.' };
    },
  });

  register(ctx, {
    name: 'import_xml_from_project',
    description: 'Export an existing project target as a project_import.xsd document (round-trip: re-import with UV4 -i reproduces device/output/includes/defines/debug settings).',
    inputSchema: { type: 'object', properties: { project: str('Project file'), target: str('Target'), output: str('Write the XML here (optional)') }, required: ['project'] },
    handler: async (args) => {
      const { Project } = await import('../project.mjs');
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      if (!t) return { ok: false, error: 'no target' };
      const f = pr.files(t.name);
      const xml = buildImportXml({
        device: t.device, outputName: t.outputName, outputPath: t.outputDirectory, createLib: t.createLib,
        includePath: t.c.includePath, cDefines: t.c.define, asmDefines: t.asm.define, cOptions: t.c.misc,
        asmOptions: t.asm.misc, linkOptions: t.link.misc, useUlib: t.misc.useMicrolib,
        groups: f.groups.map(g => ({ name: g.name, files: g.files.map(x => ({ path: x.filePath, type: x.type })) })),
      });
      let saved = null;
      if (args.output) { saved = path.resolve(args.output); fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, xml, 'utf8'); }
      return { ok: true, target: t.name, saved, xml };
    },
  });
}

