// editor.mjs — uVision editor configuration: global.prop / <tool>.prop / *.prop.def (SciTE-family
// properties consumed by UvEdit.dll = Scintilla 4.4.6) and per-user overrides arm.prop.
// Format: UTF-8 text, `# comment` or bare-# line comments, key=value, `$(name)` variable
// expansion, per-language sections `file.patterns.asm=...`, keyword lists
// `keywords0.$(file.patterns.cpp)=...` (0=default 1=keywords 2=doc comment 3=number 4=word 5=string…).
import fs from 'node:fs';
import path from 'node:path';

export function parseProps(text) {
  const out = { vars: {}, entries: [], comments: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { out.comments.push(line.slice(1).trim()); continue; }
    const m = /^([A-Za-z0-9_.$()\[\]-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out.entries.push({ key: m[1], value: m[2] });
    out.vars[m[1]] = m[2];
  }
  return out;
}

export function expandVar(props, value, depth = 0) {
  if (depth > 8) return value;
  return String(value).replace(/\$\(([A-Za-z0-9_.$\[\]-]+)\)/g, (mm, k) =>
    Object.prototype.hasOwnProperty.call(props.vars, k) ? expandVar(props, props.vars[k], depth + 1) : '');
}

/** Read the editor default set: global.prop.def + per-toolchain <a|c|html><tool>.prop.def + user <tool>.prop */
export function editorProfile(uv4Dir, toolPrefix = 'arm') {
  const files = [];
  const def = path.join(uv4Dir, 'global.prop.def');
  const usr = path.join(uv4Dir, 'global.prop');
  if (fs.existsSync(def)) files.push({ file: def, kind: 'global-defaults', props: parseProps(fs.readFileSync(def, 'utf8')) });
  if (fs.existsSync(usr)) files.push({ file: usr, kind: 'global-user', props: parseProps(fs.readFileSync(usr, 'utf8')) });
  for (const pre of ['a', 'c']) {
    const f = path.join(uv4Dir, `${pre}${toolPrefix}.prop.def`);
    if (fs.existsSync(f)) files.push({ file: f, kind: `${pre}${toolPrefix}-defaults`, props: parseProps(fs.readFileSync(f, 'utf8')) });
  }
  const fu = path.join(uv4Dir, `${toolPrefix}.prop`);
  if (fs.existsSync(fu)) files.push({ file: fu, kind: `${toolPrefix}-user`, props: parseProps(fs.readFileSync(fu, 'utf8')) });
  return files;
}

// ---- SVCS: source-control menu definitions (UVSC.dll bridge) -------------------
// Format: INI-ish, [SVCS] + "DataBase=<id>", then repeated
//   MenuItem=<label '%F' = current file> / Command / Arguments / Environment /
//   RunMinimized / QueryComment / QueryRevision / QueryCheckPoint / Initial_Folder
// QueryComment=1 → uVision prompts for a comment before running; QueryRevision=1 →
// asks for a revision; MenuItem=----- lines are separators.
export function parseSvcs(file) {
  // .SVCS files are UTF-16LE with BOM (verified on GIT.SVCS/CVS.SVCS in UV4 dir).
  const buf = fs.readFileSync(file);
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString('utf16le') : buf.toString('utf8');
  const items = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^MenuItem=(.*)$/i.test(line)) {
      const label = /^MenuItem=(.*)$/i.exec(line)[1];
      if (/^-{4,}$/.test(label)) { if (cur) items.push(cur); cur = null; continue; }
      if (cur) items.push(cur);
      cur = { label, command: '', arguments: '', environment: '', runMinimized: false, queryComment: false, queryRevision: false, queryCheckPoint: false, initialFolder: '' };
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = /^Command=(.*)$/i.exec(line))) cur.command = m[1];
    else if ((m = /^Arguments=(.*)$/i.exec(line))) cur.arguments = m[1];
    else if ((m = /^Environment=(.*)$/i.exec(line))) cur.environment = m[1];
    else if ((m = /^RunMinimized=(\d)$/i.exec(line))) cur.runMinimized = m[1] === '1';
    else if ((m = /^QueryComment=(\d)$/i.exec(line))) cur.queryComment = m[1] === '1';
    else if ((m = /^QueryRevision=(\d)$/i.exec(line))) cur.queryRevision = m[1] === '1';
    else if ((m = /^QueryCheckPoint=(\d)$/i.exec(line))) cur.queryCheckPoint = m[1] === '1';
    else if ((m = /^Initial_Folder=(.*)$/i.exec(line))) cur.initialFolder = m[1];
  }
  if (cur) items.push(cur);
  const db = /DataBase=(\w+)/i.exec(text);
  return { file: path.resolve(file), dataBase: db ? db[1] : null, items };
}

export function listSvcs(uv4Dir) {
  return fs.readdirSync(uv4Dir).filter(f => f.toLowerCase().endsWith('.svcs'))
    .map(f => {
      try { return parseSvcs(path.join(uv4Dir, f)); }
      catch (e) { return { file: path.join(uv4Dir, f), error: String(e.message || e) }; }
    });
}
