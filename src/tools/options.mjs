// tools/options.mjs — .uvoptx (project/target session options) editing and views.
// Structure per UV4\project_optx.xsd: <ProjectOpt><SchemaVersion/><Header/>
//   <Extensions/><DaveTm/><Target>…<TargetOption><CLKADS/><OPTTT/><OPTHX/>…
//   <DebugOpt> (uSim/uTrg, nTsel, pMon, sIfile/tIfile initialisation scripts)
//   <TargetDriverDllRegistry><SetRegEntry><Number/><Key/><Name/></SetRegEntry>…</…>
//   <Breakpoint/><Tracepoint/><DebugFlag/>…
import fs from 'node:fs';
import path from 'node:path';
import { register, str, int, bool, arr } from './common.mjs';
import { loadXmlFile, childElem, childElems, textOf, findAll, setTextFmt, ensureChild } from '../xml.mjs';
import { findProjectFile } from '../project.mjs';

const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<ProjectOpt xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_optx.xsd">

  <SchemaVersion>1.0</SchemaVersion>

  <Header>### uVision Project, (C) Keil Software</Header>

  <Extensions>
    <cExt>*.c</cExt>
    <aExt>*.s*; *.src; *.a*</aExt>
    <oExt>*.obj; *.o</oExt>
    <lExt>*.lib</lExt>
    <tExt>*.txt; *.h; *.inc; *.md</tExt>
    <pExt>*.plm</pExt>
    <CppX>*.cpp; *.cc; *.cxx</CppX>
    <nMigrate>0</nMigrate>
  </Extensions>

  <DaveTm>
    <dwLowDateTime>0</dwLowDateTime>
    <dwHighDateTime>0</dwHighDateTime>
  </DaveTm>
`;

const TARGET_BLOCK = (name, cpuClock, driverLabel, driverSpec, driverIndex) => `  <Target>
    <TargetName>${xml(name)}</TargetName>
    <ToolsetNumber>0x4</ToolsetNumber>
    <ToolsetName>ARM-ADS</ToolsetName>
    <TargetOption>
      <CLKADS>${cpuClock || 12000000}</CLKADS>
      <OPTTT>
        <gFlags>0</gFlags>
        <BeepAtEnd>1</BeepAtEnd>
        <RunSim>0</RunSim>
        <RunTarget>1</RunTarget>
        <RunAbUc>0</RunAbUc>
      </OPTTT>
      <OPTHX>
        <HexSelection>1</HexSelection>
        <FlashByte>65535</FlashByte>
        <HexRangeLowAddress>0</HexRangeLowAddress>
        <HexRangeHighAddress>0</HexRangeHighAddress>
        <HexOffset>0</HexOffset>
      </OPTHX>
      <DebugOpt>
        <uSim>0</uSim>
        <uTrg>1</uTrg>
        <sLdApp>1</sLdApp>
        <sGomain>1</sGomain>
        <sRbreak>1</sRbreak>
        <sRwatch>1</sRwatch>
        <sRmem>1</sRmem>
        <sRfunc>1</sRfunc>
        <sRbox>1</sRbox>
        <tLdApp>1</tLdApp>
        <tGomain>1</tGomain>
        <tRbreak>1</tRbreak>
        <tRwatch>1</tRwatch>
        <tRmem>1</tRmem>
        <tRfunc>0</tRfunc>
        <tRbox>1</tRbox>
        <tRtrace>1</tRtrace>
        <sRSysVw>1</sRSysVw>
        <tRSysVw>1</tRSysVw>
        <sRunDeb>0</sRunDeb>
        <sLrtime>0</sLrtime>
        <bEvRecOn>1</bEvRecOn>
        <bSchkAxf>0</bSchkAxf>
        <bTchkAxf>0</bTchkAxf>
        <nTsel>${driverIndex ?? 0}</nTsel>
        <sDll></sDll>
        <sDllPa></sDllPa>
        <sDlgDll></sDlgDll>
        <sDlgPa></sDlgPa>
        <sIfile></sIfile>
        <tDll></tDll>
        <tDllPa></tDllPa>
        <tDlgDll></tDlgDll>
        <tDlgPa></tDlgPa>
        <tIfile></tIfile>
        <pMon>${xml(driverLabel || 'BIN\\UL2CM3.DLL')}</pMon>
      </DebugOpt>
      <TargetDriverDllRegistry>
        <SetRegEntry>
          <Number>0</Number>
          <Key>UL2CM3</Key>
          <Name>${xml(driverSpec || '')}</Name>
        </SetRegEntry>
      </TargetDriverDllRegistry>
      <Breakpoint/>
      <Tracepoint>
        <THDelay>0</THDelay>
      </Tracepoint>
    </TargetOption>
  </Target>
`;

function xml(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function optxPath(projectFile) {
  return projectFile.replace(/\.uvprojx$/i, '.uvoptx').replace(/\.uvproj$/i, '.uvopt');
}

export function createOptx(projectFile, targets) {
  const file = optxPath(projectFile);
  let x = HEADER;
  targets.forEach((t, i) => { x += TARGET_BLOCK(t.name, t.clock, t.mon, t.spec, t.driverIndex); });
  x += '\n</ProjectOpt>\n';
  fs.writeFileSync(file, x, 'utf8');
  return file;
}

export function readOptx(file) {
  const doc = loadXmlFile(file);
  const targets = childElems(childElem(doc.root, 'ProjectOpt'), 'Target').map(t => {
    const to = childElem(t, 'TargetOption');
    const dbg = childElem(to, 'DebugOpt');
    const reg = childElems(childElem(to, 'TargetDriverDllRegistry'), 'SetRegEntry').map(r => ({
      number: textOf(childElem(r, 'Number')), key: textOf(childElem(r, 'Key')), value: textOf(childElem(r, 'Name')),
    }));
    return {
      name: textOf(childElem(t, 'TargetName')),
      clock: textOf(childElem(to, 'CLKADS')),
      simulation: (textOf(childElem(dbg, 'uSim')) || '0') === '1',
      targetDriver: (textOf(childElem(dbg, 'uTrg')) || '0') === '1',
      driverIndex: textOf(childElem(dbg, 'nTsel')),
      driverDll: textOf(childElem(dbg, 'pMon')),
      initScript: textOf(childElem(dbg, 'sIfile')),
      targetInitScript: textOf(childElem(dbg, 'tIfile')),
      loadAtStartup: (textOf(childElem(dbg, 'sLdApp')) || '0') === '1',
      runToMain: (textOf(childElem(dbg, 'sGomain')) || '0') === '1',
      driverRegistry: reg,
      breakpoints: findAll(childElem(to, 'Breakpoint') || t, n => n.name === 'Bp').length,
    };
  });
  return { file: path.resolve(file), targets, doc };
}

export function registerOptionsTools(ctx) {
  register(ctx, {
    name: 'options_read',
    description: 'Read the session/options file (.uvoptx, project_optx.xsd) for each target: debug driver (pMon/nTsel), simulation vs hardware, initialisation scripts (sIfile/tIfile), driver registry entries and breakpoint count.',
    inputSchema: { type: 'object', properties: { project: str('Project file (.uvprojx) or .uvoptx'), target: str('Target filter') }, required: ['project'] },
    handler: async (args) => {
      const p = path.resolve(args.project);
      const file = /\.uvoptx?$/i.test(p) ? p : optxPath(findProjectFile(p));
      if (!fs.existsSync(file)) return { ok: false, error: `options file not found: ${file}`, hint: 'run any uv4 command once, or use options_create' };
      const o = readOptx(file);
      return { ok: true, file: o.file, targets: args.target ? o.targets.filter(t => t.name === args.target) : o.targets };
    },
  });

  register(ctx, {
    name: 'options_set',
    description: 'Set a value in the .uvoptx of a target (e.g. TargetOption.DebugOpt/uSim, .pMon, .sIfile for a debug initialisation script, .CLKADS). Writes µVision-compatible XML in place.',
    inputSchema: {
      type: 'object',
      properties: {
        project: str('Project file or .uvoptx'),
        target: str('Target name'),
        path: arr({ type: 'string' }, 'Element path, e.g. ["TargetOption","DebugOpt","sIfile"]'),
        value: { type: ['string', 'number', 'boolean'] },
      },
      required: ['project', 'target', 'path', 'value'],
    },
    handler: async (args) => {
      const p = path.resolve(args.project);
      const file = /\.uvoptx?$/i.test(p) ? p : optxPath(findProjectFile(p));
      if (!fs.existsSync(file)) return { ok: false, error: `options file not found: ${file}` };
      const doc = loadXmlFile(file);
      const t = childElems(childElem(doc.root, 'ProjectOpt'), 'Target').find(x => textOf(childElem(x, 'TargetName')) === args.target);
      if (!t) return { ok: false, error: `target not found in options file: ${args.target}` };
      let cur = t;
      for (const seg of args.path.slice(0, -1)) cur = ensureChild(cur, seg, '  ');
      const leaf = ensureChild(cur, args.path[args.path.length - 1], '  ');
      setTextFmt(leaf, args.value === true ? '1' : args.value === false ? '0' : String(args.value));
      doc.save();
      return { ok: true, file, target: args.target, path: args.path.join('.'), value: args.value };
    },
  });

  register(ctx, {
    name: 'options_create',
    description: 'Create a .uvoptx for a project (targets from the .uvprojx, debug driver from the device flash algorithm). µVision regenerates it on the first run anyway; this makes projects usable before that first run.',
    inputSchema: { type: 'object', properties: { project: str('Project file') }, required: ['project'] },
    handler: async (args) => {
      const { Project } = await import('../project.mjs');
      const pr = new Project(findProjectFile(args.project));
      const targets = pr.targets().map(t => ({
        name: t.name,
        clock: /CLOCK\((\d+)\)/.exec(t.cpu || '') ? Number(/CLOCK\((\d+)\)/.exec(t.cpu)[1]) : 12000000,
        mon: 'BIN\\UL2CM3.DLL',
        spec: t.flashDriver,
        driverIndex: 0,
      }));
      const file = createOptx(pr.file, targets);
      return { ok: true, file, targets: targets.map(t => t.name), note: 'debug driver BIN\\UL2CM3.DLL (ULINK2/ME Cortex Debugger, TDRV0 in TOOLS.INI)' };
    },
  });
}
