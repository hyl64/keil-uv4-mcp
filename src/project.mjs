// project.mjs — .uvprojx / .uvproj / .uvmpw model: read, query, edit; XML-level fidelity.
import fs from 'node:fs';
import { resolveWin } from './util.mjs';
import path from 'node:path';
import {
  loadXmlFile, childElem, childElems, childPath, textOf, findAll, setTextFmt,
  ensureChild, createElement, removeChild, markDirty, deepClone, serialize,
} from './xml.mjs';

const NUM = (v, d = null) => (v === null || v === undefined || v === '' ? d : Number(v));
const BOOL = (v, d = false) => (v === null || v === undefined || v === '' ? d : String(v).trim() === '1');

export function findProjectFile(fileOrDir) {
  let p = path.resolve(fileOrDir);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    const entries = fs.readdirSync(p);
    const hit = entries.find(e => /\.(uvprojx|uvproj)$/i.test(e));
    if (!hit) throw new Error(`no .uvprojx/.uvproj in ${p}`);
    p = path.join(p, hit);
  }
  if (!fs.existsSync(p)) throw new Error(`project not found: ${p}`);
  return p;
}

/** Read a target's options into a normalized object. */
export function readTarget(targetEl, proj = null) {
  const tco = childPath(targetEl, 'TargetOption', 'TargetCommonOption');
  const armAds = childPath(targetEl, 'TargetOption', 'TargetArmAds');
  const misc = childElem(armAds, 'ArmAdsMisc');
  const cads = childElem(armAds, 'Cads');
  const aads = childElem(armAds, 'Aads');
  const ldads = childElem(armAds, 'LDads');
  const ocm = childElem(misc, 'OnChipMemories');
  const mem = {};
  if (ocm) for (const c of ocm.elements) {
    mem[c.name] = { type: NUM(textOf(childElem(c, 'Type'))), start: textOf(childElem(c, 'StartAddress')), size: textOf(childElem(c, 'Size')) };
  }
  const various = (n) => ({
    define: textOf(childElem(childElem(n, 'VariousControls'), 'Define')) || '',
    undefine: textOf(childElem(childElem(n, 'VariousControls'), 'Undefine')) || '',
    includePath: textOf(childElem(childElem(n, 'VariousControls'), 'IncludePath')) || '',
    misc: textOf(childElem(childElem(n, 'VariousControls'), 'MiscControls')) || '',
  });
  const t = {
    name: textOf(childElem(targetEl, 'TargetName')),
    toolset: textOf(childElem(targetEl, 'ToolsetName')),
    toolsetNumber: textOf(childElem(targetEl, 'ToolsetNumber')),
    pCCUsed: textOf(childElem(targetEl, 'pCCUsed')),
    ac6: BOOL(textOf(childElem(targetEl, 'uAC6'))),
    device: textOf(childElem(tco, 'Device')),
    vendor: textOf(childElem(tco, 'Vendor')),
    packId: textOf(childElem(tco, 'PackID')),
    cpu: textOf(childElem(tco, 'Cpu')),
    outputDirectory: textOf(childElem(tco, 'OutputDirectory')),
    outputName: textOf(childElem(tco, 'OutputName')),
    listingPath: textOf(childElem(tco, 'ListingPath')),
    createExecutable: BOOL(textOf(childElem(tco, 'CreateExecutable')), true),
    createLib: BOOL(textOf(childElem(tco, 'CreateLib'))),
    createHexFile: BOOL(textOf(childElem(tco, 'CreateHexFile'))),
    debugInformation: BOOL(textOf(childElem(tco, 'DebugInformation'))),
    browseInformation: BOOL(textOf(childElem(tco, 'BrowseInformation'))),
    batchBuild: BOOL(textOf(childElem(tco, 'SelectedForBatchBuild'))),
    flashDriver: textOf(childElem(tco, 'FlashDriverDll')),
    registerFile: textOf(childElem(tco, 'RegisterFile')),
    svdFile: textOf(childElem(tco, 'SFDFile')),
    misc: {
      cpuType: textOf(childElem(misc, 'AdsCpuType')),
      thumb: BOOL(textOf(childElem(misc, 'uThumb')), true),
      rvdsVP: BOOL(textOf(childElem(misc, 'RvdsVP'))),
      rvdsMve: BOOL(textOf(childElem(misc, 'RvdsMve'))),
      secure: BOOL(textOf(childElem(misc, 'nSecure'))),
      bigEndian: BOOL(textOf(childElem(misc, 'BigEnd'))),
      roSelDefault: NUM(textOf(childElem(misc, 'RoSelD'))),
      rwSelDefault: NUM(textOf(childElem(misc, 'RwSelD'))),
      stackSel: NUM(textOf(childElem(misc, 'StupSel'))),
      startup: textOf(childElem(misc, 'RvctStartVector')),
      useMicrolib: BOOL(textOf(childElem(misc, 'useUlib'))),
      memory: mem,
    },
    c: {
      optimization: NUM(textOf(childElem(cads, 'Optim')), 0),
      optimizeForTime: BOOL(textOf(childElem(cads, 'oTime'))),
      c99: BOOL(textOf(childElem(cads, 'uC99'))),
      gnu: BOOL(textOf(childElem(cads, 'uGnu'))),
      warnLevel: NUM(textOf(childElem(cads, 'wLevel')), 0),
      ...various(cads),
      ac6Lang: cads ? {
        c: textOf(childElem(cads, 'v6Lang')), lto: textOf(childElem(cads, 'v6Lto')), rtti: textOf(childElem(cads, 'v6Rtti')),
        shortEnums: BOOL(textOf(childElem(cads, 'vShortEn'))), shortWchar: BOOL(textOf(childElem(cads, 'vShortWch'))),
        wcharEnums: textOf(childElem(cads, 'v6WtE')), warningsAsErrors: textOf(childElem(cads, 'v6WtE')),
      } : null,
    },
    asm: aads ? { ...various(aads), thumb: BOOL(textOf(childElem(aads, 'thumb'))) } : null,
    link: ldads ? {
      useMemoryLayout: BOOL(textOf(childElem(ldads, 'umfTarg'))),
      noStdLibs: BOOL(textOf(childElem(ldads, 'noStLib'))),
      reportFile: BOOL(textOf(childElem(ldads, 'RepFail'))),
      scatterFile: textOf(childElem(ldads, 'ScatterFile')) || '',
      textAddressRange: textOf(childElem(ldads, 'TextAddressRange')) || '',
      dataAddressRange: textOf(childElem(ldads, 'DataAddressRange')) || '',
      includeLibs: textOf(childElem(ldads, 'IncludeLibs')) || '',
      misc: textOf(childElem(ldads, 'Misc')) || '',
      linkerInputFile: textOf(childElem(ldads, 'LinkerInputFile')) || '',
      disabledWarnings: textOf(childElem(ldads, 'DisabledWarnings')) || '',
    } : null,
    rte: proj ? readRteForTarget(proj, textOf(childElem(targetEl, 'TargetName'))) : { components: [], apis: [] },
  };
  return t;
}

/** RTE lives once per project at <Project><RTE>, with <targetInfo name=...> scoping per target. */
function readRteForTarget(proj, name) {
  const rte = childElem(proj.proj, 'RTE');
  if (!rte) return { components: [], apis: [] };
  const comps = [];
  for (const c of childElems(childElem(rte, 'components'), 'component')) {
    const names = childElems(childElem(c, 'targetInfos'), 'targetInfo').map(x => x.attr('name'));
    if (names.length && !names.includes(name)) continue;
    const pkg = childElem(c, 'package');
    comps.push({
      vendor: c.attr('Cvendor'), bundle: c.attr('Cbundle'), cls: c.attr('Cclass'), group: c.attr('Cgroup'),
      sub: c.attr('Csub'), variant: c.attr('Cvariant'), version: c.attr('Cversion'), condition: c.attr('condition'),
      pack: pkg ? { vendor: pkg.attr('vendor'), name: pkg.attr('name'), version: pkg.attr('version') } : null,
    });
  }
  const apis = [];
  for (const a of childElems(childElem(rte, 'apis'), 'api')) {
    const names = childElems(childElem(a, 'targetInfos'), 'targetInfo').map(x => x.attr('name'));
    if (names.length && !names.includes(name)) continue;
    const pkg = childElem(a, 'package');
    apis.push({ vendor: a.attr('Cvendor'), cls: a.attr('Cclass'), group: a.attr('Cgroup'), version: a.attr('Capiversion'),
      pack: pkg ? { vendor: pkg.attr('vendor'), name: pkg.attr('name'), version: pkg.attr('version') } : null });
  }
  return { components: comps, apis };
};

function rteFilesFor(proj, targetName) {
  const rte = childElem(proj.proj, 'RTE');
  if (!rte) return [];
  return childElems(childElem(rte, 'files'), 'file')
    .filter(f => { const names = (f.attr('name') || '').split(';').filter(Boolean); const tn = f.attr('target') || (childElem(f, '') ? '' : ''); return true; })
    .map(f => ({ category: f.attr('category'), name: f.attr('name'), attr: f.attr('attr'), instance: f.attr('instance'), path: f.attr('path'), src: f.attr('src'), group: f.attr('group'), targets: f.attr('target') }))
    .filter(f => !f.targets || f.targets.split(';').includes(targetName));
};

export function readFiles(targetEl) {
  const groups = [];
  const groupsEl = childElem(targetEl, 'Groups');
  if (groupsEl) for (const g of childElems(groupsEl, 'Group')) {
    const files = childElems(childElem(g, 'Files'), 'File').map(f => ({
      name: textOf(childElem(f, 'FileName')),
      type: NUM(textOf(childElem(f, 'FileType'))),
      filePath: textOf(childElem(f, 'FilePath')),
      group: textOf(childElem(g, 'GroupName')),
    }));
    groups.push({ name: textOf(childElem(g, 'GroupName')), files });
  }
  const loose = childElems(childElem(targetEl, 'Files'), 'File').map(f => ({
    name: textOf(childElem(f, 'FileName')), type: NUM(textOf(childElem(f, 'FileType'))), filePath: textOf(childElem(f, 'FilePath')), group: null,
  }));
  return { groups, loose };
}

export class Project {
  constructor(file) {
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    this.doc = loadXmlFile(this.file);
    this.proj = childElem(this.doc.root, 'Project') || childElem(this.doc.root, 'ProjectOpt');
    if (!this.proj) throw new Error('not a uVision project (no <Project>)');
    this.kind = this.proj.name === 'ProjectOpt' ? 'opt' : 'project';
    this.dirty = false;
  }
  get schemaVersion() { return textOf(childElem(this.proj, 'SchemaVersion')); }
  targetEls() { return childElems(childElem(this.proj, 'Targets'), 'Target'); }
  targets() { return this.targetEls().map(el => readTarget(el, this)); }
  targetEl(name) {
    const els = this.targetEls();
    if (!name) return els[0] || null;
    return els.find(e => textOf(childElem(e, 'TargetName')) === name)
      || els.find(e => (textOf(childElem(e, 'TargetName')) || '').toLowerCase() === String(name).toLowerCase())
      || null;
  }
  target(name) {
    const el = this.targetEl(name);
    return el ? readTarget(el, this) : null;
  }
  targetNames() { return this.targetEls().map(e => textOf(childElem(e, 'TargetName'))); }
  files(targetName) {
    const el = this.targetEl(targetName);
    return el ? readFiles(el) : null;
  }
  allFilePaths(targetName) {
    const f = this.files(targetName);
    if (!f) return [];
    return [...f.groups.flatMap(g => g.files), ...f.loose].map(x => resolveWin(this.dir, x.filePath));
  }

  // ---- edits ----------------------------------------------------------------
  setTargetValue(targetName, valuePath, value) {
    const el = this.targetEl(targetName);
    if (!el) {
      const err = new Error(`target not found: ${targetName}`);
      err.code = 'TARGET_NOT_FOUND';
      err.available = this.targetNames();
      throw err;
    }
    let cur = el;
    for (const seg of valuePath.slice(0, -1)) {
      cur = ensureChild(cur, seg, '  ');
      cur = cur;
    }
    const leafName = valuePath[valuePath.length - 1];
    const indent = '  ';
    const leaf = ensureChild(cur, leafName, indent);
    setTextFmt(leaf, value === true ? '1' : value === false ? '0' : String(value));
    this.dirty = true;
    return { target: targetName, path: valuePath.join('.'), value };
  }
  addGroup(targetName, groupName, beforeGroup) {
    const el = this.targetEl(targetName);
    if (!el) throw new Error(`target not found: ${targetName}`);
    let groupsEl = childElem(el, 'Groups');
    if (!groupsEl) { groupsEl = createElement('Groups', []); groupsEl.parent = el; el.children.push(groupsEl); markDirty(el); }
    if (childElems(groupsEl, 'Group').some(g => textOf(childElem(g, 'GroupName')) === groupName)) {
      throw new Error(`group exists: ${groupName}`);
    }
    const g = createElement('Group', [createElement('GroupName', [groupName]), createElement('Files', [])]);
    g.children[0].parent = g; g.children[1].parent = g;
    let idx = groupsEl.children.length;
    if (beforeGroup) {
      const i = groupsEl.children.findIndex(c => c.type === 'elem' && c.name === 'Group' && textOf(childElem(c, 'GroupName')) === beforeGroup);
      if (i >= 0) idx = i;
    }
    groupsEl.insertChild(g, idx);
    markDirty(groupsEl);
    this.dirty = true;
    return { group: groupName };
  }
  addFile(targetName, groupName, filePath, fileType) {
    const el = this.targetEl(targetName);
    if (!el) throw new Error(`target not found: ${targetName}`);
    let gEl = childElems(childElem(el, 'Groups'), 'Group').find(g => textOf(childElem(g, 'GroupName')) === groupName);
    if (!gEl) throw new Error(`group not found: ${groupName}`);
    const filesEl = childElem(gEl, 'Files');
    const name = String(path.basename(filePath));
    const type = fileType !== undefined && fileType !== null ? Number(fileType) : guessFileType(name);
    const f = createElement('File', [
      createElement('FileName', [name]), createElement('FileType', [String(type)]), createElement('FilePath', [String(filePath)]),
    ]);
    filesEl.insertChild(f, filesEl.children.length);
    if (filesEl.selfClosing) filesEl.selfClosing = false;
    markDirty(filesEl);
    this.dirty = true;
    return { target: targetName, group: groupName, file: { name, type, filePath } };
  }
  removeFile(targetName, filePath) {
    const el = this.targetEl(targetName);
    if (!el) throw new Error(`target not found: ${targetName}`);
    let removed = 0;
    for (const g of childElems(childElem(el, 'Groups'), 'Group')) {
      const filesEl = childElem(g, 'Files');
      if (!filesEl) continue;
      for (const f of childElems(filesEl, 'File')) {
        if (samePath(this.dir, textOf(childElem(f, 'FilePath')), filePath)) {
          removeChild(filesEl, f); removed++;
        }
      }
    }
    if (removed) this.dirty = true;
    return { removed };
  }
  removeGroup(targetName, groupName) {
    const el = this.targetEl(targetName);
    const groupsEl = childElem(el, 'Groups');
    const g = childElems(groupsEl, 'Group').find(x => textOf(childElem(x, 'GroupName')) === groupName);
    if (!g) return { removed: false };
    removeChild(groupsEl, g); this.dirty = true; return { removed: true };
  }
  cloneTarget(fromName, toName) {
    const src = this.targetEl(fromName);
    if (!src) throw new Error(`target not found: ${fromName}`);
    if (this.targetEl(toName)) throw new Error(`target exists: ${toName}`);
    const copy = deepClone(src);
    setTextFmt(childElem(copy, 'TargetName'), toName);
    const targetsEl = childElem(this.proj, 'Targets');
    targetsEl.insertChild(copy, targetsEl.children.length);
    markDirty(targetsEl);
    this.dirty = true;
    return { from: fromName, to: toName };
  }
  removeTarget(name) {
    const el = this.targetEl(name);
    if (!el) return { removed: false };
    const targetsEl = childElem(this.proj, 'Targets');
    removeChild(targetsEl, el);
    this.dirty = true;
    return { removed: true };
  }
  save(file) {
    const dest = file ? path.resolve(file) : this.file;
    fs.writeFileSync(dest, this.doc.toString(), 'utf8');
    if (dest === this.file) this.dirty = false;
    return dest;
  }
}

function samePath(base, a, b) {
  const na = path.resolve(base, a || '');
  const nb = path.resolve(base, b || '');
  return na.toLowerCase() === nb.toLowerCase();
}

export function guessFileType(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.c'].includes(ext)) return 1;
  if (['.s', '.asm', '.a51'].includes(ext)) return 2;
  if (['.cpp', '.cxx', '.cc', '.c++'].includes(ext)) return 8;
  if (['.o', '.obj', '.lib', '.a'].includes(ext)) return 4;
  if (['.h', '.inc'].includes(ext)) return 5;
  if (['.txt', '.ini', '.sct', '.ld'].includes(ext)) return 5;
  return 1;
}

// ---- multi-project (.uvmpw) ---------------------------------------------------
// Schema: UV4\project_mpw.xsd — <ProjectWorkspace> with <WorkspaceName/> and one
// <project> per member: <PathAndName/>, optional NodeIsActive / NodeIsExpanded /
// NodeIsCheckedInBatchBuild (UV4 writes the latter as 1 only when checked).
export function readMultiProject(file) {
  const doc = loadXmlFile(file);
  const ws = childElem(doc.root, 'ProjectWorkspace') || childElem(doc.root, 'Project');
  if (!ws) throw new Error('not a multi-project file (expected <ProjectWorkspace>)');
  const projects = findAll(ws, n => n.name === 'project').map(n => {
    const full = textOf(childElem(n, 'PathAndName')) || textOf(childElem(n, 'PathWithFileName')) || '';
    return {
      name: path.basename(full, path.extname(full)),
      path: full,
      active: (textOf(childElem(n, 'NodeIsActive')) || '0') === '1',
      batchBuild: (textOf(childElem(n, 'NodeIsCheckedInBatchBuild')) || '0') === '1',
    };
  });
  return { file: path.resolve(file), workspaceName: textOf(childElem(ws, 'WorkspaceName')), projects, doc };
}

export function multiProjectTargets(multiFile) {
  const mp = readMultiProject(multiFile);
  const dir = path.dirname(mp.file);
  const out = [];
  for (const p of mp.projects) {
    const abs = path.resolve(dir, p.path || '');
    if (!fs.existsSync(abs)) { out.push({ project: p.name, path: abs, exists: false }); continue; }
    const pr = new Project(abs);
    for (const t of pr.targets()) {
      out.push({ project: p.name, path: abs, target: t.name, batchBuild: t.batchBuild, device: t.device, output: { dir: t.outputDirectory, name: t.outputName } });
    }
  }
  return { multi: mp.file, targets: out };
}








