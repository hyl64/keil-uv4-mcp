// scaffold.mjs — create uVision projects from scratch (µVision-compatible XML).
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.mjs';

const IND = (n) => '  '.repeat(n);

function kvBlock(indent, pairs) {
  return pairs.map(([k, v]) => `${IND(indent)}<${k}>${v === undefined || v === null ? '' : v}</${k}>\n`).join('');
}

function userProgBlock(name, indent) {
  return (
    `${IND(indent)}<${name}>\n` +
    kvBlock(indent + 1, [['RunUserProg1', 0], ['RunUserProg2', 0], ['UserProg1Name', ''], ['UserProg2Name', ''],
      ['UserProg1Dos16Mode', 0], ['UserProg2Dos16Mode', 0], ['nStop1X', 0], ['nStop2X', 0]]) +
    `${IND(indent)}</${name}>\n`
  );
}

function ocmEntry(name, type, start, size, indent) {
  return `${IND(indent)}<${name}>\n${IND(indent + 1)}<Type>${type}</Type>\n${IND(indent + 1)}<StartAddress>${start}</StartAddress>\n${IND(indent + 1)}<Size>${size}</Size>\n${IND(indent)}</${name}>\n`;
}

export function createProjectXml(opts) {
  const {
    device = 'STM32F103C8', vendor = 'STMicroelectronics', packId = '', packUrl = 'https://www.keil.com/pack/',
    targetName = 'Target 1',
    cpu = 'IRAM(0x20000000,0x5000) IROM(0x8000000,0x10000) CPUTYPE("Cortex-M3") CLOCK(12000000) ELITTLE',
    registerFile = '', svdFile = '', flashDriver = '', outputName = 'Target', define = '', includePath = '',
    deviceDefine = '', groups = [{ name: 'Source', files: [] }],
  } = opts || {};
  const rom = /IROM\((0x[0-9a-fA-F]+),(0x[0-9a-fA-F]+)\)/.exec(cpu) || [null, '0x8000000', '0x10000'];
  const ram = /IRAM\((0x[0-9a-fA-F]+),(0x[0-9a-fA-F]+)\)/.exec(cpu) || [null, '0x20000000', '0x5000'];
  const cpuType = /CPUTYPE\("([^"]+)"\)/.exec(cpu);
  const defines = [deviceDefine, define].filter(Boolean).join(',');

  let ocm = `${IND(8)}<OnChipMemories>\n`;
  for (let i = 1; i <= 6; i++) ocm += ocmEntry(`Ocm${i}`, 0, '0x0', '0x0', 9);
  ocm += ocmEntry('IRAM', 0, ram[1], ram[2], 9);
  ocm += ocmEntry('IROM', 1, rom[1], rom[2], 9);
  ocm += ocmEntry('XRAM', 0, '0x0', '0x0', 9);
  for (let i = 1; i <= 3; i++) ocm += ocmEntry(`OCR_RVCT${i}`, 1, '0x0', '0x0', 9);
  ocm += ocmEntry('OCR_RVCT4', 1, rom[1], rom[2], 9);
  ocm += ocmEntry('OCR_RVCT5', 1, '0x0', '0x0', 9);
  for (let i = 6; i <= 8; i++) ocm += ocmEntry(`OCR_RVCT${i}`, 0, '0x0', '0x0', 9);
  ocm += ocmEntry('OCR_RVCT9', 0, ram[1], ram[2], 9);
  ocm += ocmEntry('OCR_RVCT10', 0, '0x0', '0x0', 9);
  ocm += `${IND(8)}</OnChipMemories>\n`;

  let x = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n';
  x += '<Project xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_projx.xsd">\n\n';
  x += `${IND(1)}<SchemaVersion>2.1</SchemaVersion>\n\n`;
  x += `${IND(1)}<Header>### uVision Project, (C) Keil Software</Header>\n\n`;
  x += `${IND(1)}<Targets>\n${IND(2)}<Target>\n`;
  x += kvBlock(3, [['TargetName', targetName], ['ToolsetNumber', '0x4'], ['ToolsetName', 'ARM-ADS'], ['pCCUsed', ''], ['uAC6', 0]]);
  x += `${IND(3)}<TargetOption>\n${IND(4)}<TargetCommonOption>\n`;
  x += kvBlock(5, [['Device', device], ['Vendor', vendor], ['PackID', packId], ['PackURL', packUrl], ['Cpu', cpu],
    ['FlashUtilSpec', ''], ['StartupFile', ''], ['FlashDriverDll', flashDriver], ['DeviceId', 0],
    ['RegisterFile', registerFile], ['MemoryEnv', ''], ['Cmp', ''], ['Asm', ''], ['Linker', ''], ['OHString', ''],
    ['InfinionOptionDll', ''], ['SLE66CMisc', ''], ['SLE66AMisc', ''], ['SLE66LinkerMisc', ''], ['SFDFile', svdFile],
    ['bCustSvd', 0], ['UseEnv', 0], ['BinPath', ''], ['IncludePath', ''], ['LibPath', ''],
    ['RegisterFilePath', ''], ['DBRegisterFilePath', '']]);
  x += `${IND(5)}<TargetStatus>\n${kvBlock(6, [['Error', 0], ['ExitCodeStop', 0], ['ButtonStop', 0], ['NotGenerated', 0], ['InvalidFlash', 1]])}${IND(5)}</TargetStatus>\n`;
  x += kvBlock(5, [['OutputDirectory', '.\\Objects\\'], ['OutputName', outputName], ['CreateExecutable', 1], ['CreateLib', 0],
    ['CreateHexFile', 1], ['DebugInformation', 1], ['BrowseInformation', 0], ['ListingPath', '.\\Listings\\'],
    ['HexFormatSelection', 1], ['Merge32K', 0], ['CreateBatchFile', 0]]);
  x += userProgBlock('BeforeCompile', 5) + userProgBlock('BeforeMake', 5) + userProgBlock('AfterMake', 5);
  x += kvBlock(5, [['SelectedForBatchBuild', 0], ['SVCSIdString', '']]);
  x += `${IND(4)}</TargetCommonOption>\n`;
  x += `${IND(4)}<CommonProperty>\n`;
  x += kvBlock(5, [['UseCPPCompiler', 0], ['RVCTCodeConst', 0], ['RVCTZI', 0], ['RVCTOtherData', 0], ['ModuleSelection', 0],
    ['IncludeInAssembly', 0], ['AssemblerAddrRel', 0], ['AssemblerNoRL', 0], ['AssemblerOther', ''], ['AssemblerThumbMode', 0],
    ['RVCTCodeRegs', ''], ['AssemblerZIHidden', 0], ['NoWarn', 0], ['WarnLevel', 2], ['ScatterFile', ''], ['SCatterParm', '']]);
  x += `${IND(4)}</CommonProperty>\n`;
  x += `${IND(4)}<TargetArmAds>\n${IND(5)}<ArmAdsMisc>\n`;
  x += kvBlock(6, [['GenerateListings', 0], ['asHll', 1], ['asAsm', 1], ['asMacX', 1], ['asSyms', 1], ['asFals', 1], ['asDbgD', 1], ['asForm', 1],
    ['ldLst', 0], ['ldmm', 1], ['ldXref', 1], ['BigEnd', 0], ['AdsALst', 1], ['AdsACrf', 1], ['AdsANop', 0], ['AdsANot', 0],
    ['AdsLLst', 1], ['AdsLmap', 1], ['AdsLcgr', 1], ['AdsLsym', 1], ['AdsLszi', 1], ['AdsLtoi', 1], ['AdsLsun', 1], ['AdsLven', 1], ['AdsLsxf', 1],
    ['RvctClst', 0], ['GenPPlst', 0], ['AdsCpuType', `"${cpuType ? cpuType[1] : 'Cortex-M3'}"`],
    ['RvctDeviceName', ''], ['mOS', 0], ['uocRom', 0], ['uocRam', 0], ['hadIROM', 1], ['hadIRAM', 1], ['hadXRAM', 0], ['uocXRam', 0],
    ['RvdsVP', 0], ['RvdsMve', 0], ['RvdsCdeCp', 0], ['nBranchProt', 0], ['hadIRAM2', 0], ['hadIROM2', 0], ['StupSel', 8], ['useUlib', 0],
    ['EndSel', 0], ['uLtcg', 0], ['nSecure', 0], ['RoSelD', 3], ['RwSelD', 3], ['CodeSel', 0], ['OptFeed', 0],
    ['NoZi1', 0], ['NoZi2', 0], ['NoZi3', 0], ['NoZi4', 0], ['NoZi5', 0],
    ['Ro1Chk', 0], ['Ro2Chk', 0], ['Ro3Chk', 0], ['Ir1Chk', 1], ['Ir2Chk', 0], ['Ra1Chk', 0], ['Ra2Chk', 0], ['Ra3Chk', 0], ['Im1Chk', 1], ['Im2Chk', 0]]);
  x += ocm;
  x += kvBlock(6, [['RvctStartVector', '']]);
  x += `${IND(5)}</ArmAdsMisc>\n`;
  x += `${IND(5)}<Cads>\n`;
  x += kvBlock(6, [['interw', 1], ['Optim', 2], ['oTime', 0], ['SplitLS', 0], ['OneElfS', 0], ['Strict', 0], ['EnumInt', 0], ['PlainCh', 0],
    ['Ropi', 0], ['Rwpi', 0], ['wLevel', 2], ['uThumb', 0], ['uSurpInc', 0], ['uC99', 1], ['uGnu', 0], ['useXO', 0],
    ['v6Lang', 1], ['v6LangP', 1], ['vShortEn', 0], ['vShortWch', 0], ['v6Lto', 0], ['v6WtE', 0], ['v6Rtti', 0]]);
  x += `${IND(6)}<VariousControls>\n${kvBlock(7, [['MiscControls', ''], ['Define', defines], ['Undefine', ''], ['IncludePath', includePath]])}${IND(6)}</VariousControls>\n`;
  x += `${IND(5)}</Cads>\n`;
  x += `${IND(5)}<Aads>\n`;
  x += kvBlock(6, [['interw', 1], ['Ropi', 0], ['Rwpi', 0], ['thumb', 0], ['SplitLS', 0], ['SwStkChk', 0], ['NoWarn', 0], ['uSurpInc', 0], ['useXO', 0], ['ClangAsOpt', 1]]);
  x += `${IND(6)}<VariousControls>\n${kvBlock(7, [['MiscControls', ''], ['Define', ''], ['Undefine', ''], ['IncludePath', '']])}${IND(6)}</VariousControls>\n`;
  x += `${IND(5)}</Aads>\n`;
  x += `${IND(5)}<LDads>\n`;
  x += kvBlock(6, [['umfTarg', 1], ['Ropi', 0], ['Rwpi', 0], ['noStLib', 0], ['RepFail', 0], ['useFile', 0],
    ['TextAddressRange', rom[1]], ['DataAddressRange', ram[1]], ['pXoBase', ''], ['ScatterFile', ''],
    ['IncludeLibs', ''], ['IncludeLibsPath', ''], ['Misc', ''], ['LinkerInputFile', ''], ['DisabledWarnings', '']]);
  x += `${IND(5)}</LDads>\n`;
  x += `${IND(4)}</TargetArmAds>\n${IND(3)}</TargetOption>\n${IND(3)}<Groups>\n`;
  for (const g of groups) {
    x += `${IND(4)}<Group>\n${IND(5)}<GroupName>${escapeXml(g.name)}</GroupName>\n${IND(5)}<Files>\n`;
    for (const f of g.files || []) {
      const p = typeof f === 'string' ? f : f.path;
      const t = typeof f === 'string' ? guessFileType(path.basename(p)) : (f.type || guessFileType(path.basename(p)));
      x += `${IND(6)}<File>\n${kvBlock(7, [['FileName', escapeXml(path.basename(p))], ['FileType', t], ['FilePath', escapeXml(p)]])}${IND(6)}</File>\n`;
    }
    x += `${IND(5)}</Files>\n${IND(4)}</Group>\n`;
  }
  x += `${IND(3)}</Groups>\n${IND(2)}</Target>\n${IND(1)}</Targets>\n\n`;
  x += `${IND(1)}<RTE>\n${IND(2)}<apis/>\n${IND(2)}<components/>\n${IND(2)}<files/>\n${IND(1)}</RTE>\n\n`;
  x += '</Project>\n';
  return x;
}

export function guessFileType(name) {
  const ext = path.extname(String(name)).toLowerCase();
  if (ext === '.s' || ext === '.asm') return 2;
  if (ext === '.cpp' || ext === '.cxx' || ext === '.cc' || ext === '.c++') return 8;
  if (ext === '.o' || ext === '.obj' || ext === '.lib' || ext === '.a') return 4;
  if (ext === '.h' || ext === '.txt' || ext === '.ini' || ext === '.sct') return 5;
  return 1;
}

function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function writeProject(file, opts) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, createProjectXml(opts), 'utf8');
  return file;
}

/** Batch file equivalent of Options→Output→Create Batch File. */
export function writeBuildBatch(dir, projectPath, target) {
  ensureDir(dir);
  const name = path.basename(projectPath, path.extname(projectPath));
  const lines = [
    '@echo off',
    `rem Batch build file for ${path.basename(projectPath)} target '${target}'`,
    'set UV4=%Keil_v5%\\UV4\\UV4.exe',
    'if not exist "%UV4%" set UV4=C:\\Keil_v5\\UV4\\UV4.exe',
    `"%UV4%" -r "${projectPath}" -t "${target}" -j0 -o "${path.join(dir, name + '.log')}"`,
    'exit /b %ERRORLEVEL%',
    '',
  ];
  const f = path.join(dir, `${name}_${String(target).replace(/[^\w.-]+/g, '_')}.bat`);
  fs.writeFileSync(f, lines.join('\r\n'), 'utf8');
  return f;
}
