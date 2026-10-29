// formats.mjs — remaining µVision data formats: .uvguix (dock/window layout, project_guix.xsd)
// and .dbgconf (RTE debug configuration, Keil "Configuration Wizard" comment format).
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, childElem, childElems, textOf, findAll } from './xml.mjs';

// ---- .uvguix ------------------------------------------------------------------
// <ProjectGui><SchemaVersion/><Header/><UserString/><WinId><ViewName>…<DockMan>
// <Window> entries carry RegID/PaneID/IsVisible/IsFloating/IsTabbed/IsActivated/
// MRUWidth/PinState/RectRecentDocked/RectLastDocked/Buttons; ControlBarsSummary
// holds toolbar state. Keyed per user as <project>.uvguix.<USERNAME>; DFP samples
// ship bare <project>.uvguix.
export function readGuiLayout(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const doc = parseXml(raw);
  const root = childElem(doc, 'ProjectGui');
  if (!root) throw new Error('not a ProjectGui file');
  const windows = findAll(root, n => n.name === 'Window').map(w => ({
    regId: num(w, 'RegID'), paneId: num(w, 'PaneID'), name: str(w, 'Name'),
    visible: num(w, 'IsVisible') === 1, floating: num(w, 'IsFloating') === 1,
    tabbed: num(w, 'IsTabbed') === 1, activated: num(w, 'IsActivated') === 1,
    pinState: num(w, 'PinState'), mruWidth: num(w, 'MRUWidth'),
    rectDocked: (str(w, 'RectRecentDocked') || '').trim(),
  }));
  const bars = findAll(root, n => n.name === 'ControlBar').map(b => ({
    name: str(b, 'Name') || str(b, 'ViewName'), regId: num(b, 'RegID'),
    visible: num(b, 'IsVisible') === 1,
  }));
  return {
    file: path.resolve(file),
    schemaVersion: str(root, 'SchemaVersion'),
    lastAddFilePath: str(root, 'LastAddFilePath'),
    activeDebugView: str(root, 'sActiveDebugView'),
    viewCount: num(root, 'ViewType'),
    windows: windows.slice(0, 200),
    controlBars: bars.slice(0, 100),
    totals: { windows: windows.length, controlBars: bars.length },
  };
}
function num(parent, name) { const el = childElem(parent, name); return el && textOf(el) !== '' ? Number(textOf(el)) : null; }
function str(parent, name) { const el = childElem(parent, name); return el ? textOf(el) : null; }

// ---- .dbgconf (Configuration Wizard) -----------------------------------------
// Grammar (documented by the format itself, used by SysViewer/System Viewer &
// the debug tab): plain C file whose comments carry directives:
//   //<h> Caption       group heading
//   //<o.bit> NAME <i> help    bit-field option at bit position (or <o.7:0> range)
//   //<c> NAME <i> help        checkbox (1 bit)
//   //#define NAME 0xVALUE;    current value lines matched to directives
export function readDbgconf(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = { file: path.resolve(file), version: null, note: [], blocks: [], defines: {} };
  let stack = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = /^\/\/\s*Version:\s*(.+)$/i.exec(line))) { out.version = m[1].trim(); continue; }
    if ((m = /^\/\/\s*<h>(.*)$/i.exec(line))) { const b = { kind: 'heading', caption: m[1].trim(), items: [] }; (stack[stack.length - 1] || out).items ? stack[stack.length - 1].items.push(b) : out.blocks.push(b); stack.push(b); continue; }
    if ((m = /^\/\/\s*<\/h>/i.exec(line))) { stack.pop(); continue; }
    if ((m = /^\/\/\s*<o(?:\.(\d+)(?::(\d+))?)?>\s*([A-Za-z_]\w*)\s*(?:<i>(.*))?$/i.exec(line))) {
      const item = { kind: 'option', name: m[3], bit: m[1] ? Number(m[1]) : null, high: m[2] ? Number(m[2]) : null, help: (m[4] || '').trim() };
      // value: next non-directive line containing NAME = 0x…; or #define NAME value
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const vm = new RegExp(`^\\s*#?define?\\s*${item.name}\\s+(0x[0-9A-Fa-f]+|\\d+)`, 'i').exec(lines[j]) || new RegExp(`^\\s*${item.name}\\s*=\\s*(0x[0-9A-Fa-f]+|\\d+)`, 'i').exec(lines[j]);
        if (vm) { item.value = vm[1]; break; }
        if (/#define/.test(lines[j]) || lines[j].trim() === '}') break;
      }
      (stack.length ? stack[stack.length - 1] : { items: out.blocks[0] ? out.blocks[0].items : (out.blocks.push({ kind: 'heading', caption: '', items: [] }), out.blocks[0]) }).items.push(item);
      continue;
    }
    if ((m = /^\s*#define\s+([A-Za-z_]\w*)\s+(0x[0-9A-Fa-f]+|\d+)(\s*;)?/i.exec(line))) { out.defines[m[1]] = m[2]; continue; }
    if (/^\/\/\s*Note:/i.test(line)) out.note.push(line.slice(2).trim());
  }
  const flat = [];
  const walk = (b) => { for (const it of b.items || []) { if (it.kind) flat.push({ ...it, group: b.caption }); else walk(it); } };
  for (const b of out.blocks) walk(b);
  out.options = flat.map(o => ({ ...o, value: o.value !== undefined ? o.value : (out.defines[o.name] !== undefined ? out.defines[o.name] : null) }));
  return { ...out, optionCount: out.options.length, blocks: undefined };
}
