// xml.mjs — dependency-free XML DOM with byte-faithful round-tripping.
// UV4 writes .uvprojx/.uvoptx with 2-space indentation; edits must preserve the
// untouched regions exactly, so we keep a raw tree (text nodes included).
import fs from 'node:fs';

export class Node {
  constructor(type, name, attrs, start, parent) {
    this.type = type;           // 'elem' | 'text' | 'decl' | 'comment' | 'cdata'
    this.name = name || '';
    this.attrs = attrs || {};   // ordered plain object
    this.attrOrder = attrs ? Object.keys(attrs) : [];
    this.children = [];
    this.parent = parent || null;
    this.start = start;
    this.end = start;
  }
  get elements() { return this.children.filter(c => c.type === 'elem'); }
  attr(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
  }
  insertChild(node, index) {
    node.parent = this;
    this.children.splice(index, 0, node);
  }
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, g) ? ENT[g] : m;
  });
}
export function encodeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function encodeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function parseXml(str) {
  const root = new Node('root', '#document', null, 0, null);
  const stack = [root];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const lt = str.indexOf('<', i);
    if (lt < 0) { pushText(str.slice(i)); break; }
    if (lt > i) pushText(str.slice(i, lt));
    if (str.startsWith('<!--', lt)) {
      const e = str.indexOf('-->', lt + 4); const end = e < 0 ? n : e + 3;
      const node = new Node('comment', '', null, lt); node.value = str.slice(lt, end);
      add(node); i = end; continue;
    }
    if (str.startsWith('<![CDATA[', lt)) {
      const e = str.indexOf(']]>', lt + 9); const end = e < 0 ? n : e + 3;
      const node = new Node('cdata', '', null, lt); node.value = str.slice(lt + 9, e < 0 ? n : e);
      add(node); i = end; continue;
    }
    if (str.startsWith('<?', lt)) {
      const e = str.indexOf('?>', lt + 2); const end = e < 0 ? n : e + 2;
      const node = new Node('decl', '', null, lt); node.value = str.slice(lt, end);
      add(node); i = end; continue;
    }
    if (str.startsWith('<!', lt)) {
      const e = str.indexOf('>', lt + 2); const end = e < 0 ? n : e + 1;
      const node = new Node('decl', '', null, lt); node.value = str.slice(lt, end);
      add(node); i = end; continue;
    }
    // element
    const tagEnd = findTagEnd(str, lt + 1);
    const head = str.slice(lt + 1, tagEnd);
    const selfClosing = head.trimEnd().endsWith('/');
    const body = selfClosing ? head.trimEnd().slice(0, -1) : head;
    const { name, attrs } = parseTagHead(body);
    if (name.startsWith('/')) { // closing tag (normally handled below)
      i = tagEnd + 1; continue;
    }
    const el = new Node('elem', name, attrs, lt);
    add(el);
    i = tagEnd + 1;
    if (!selfClosing) {
      const close = findMatchingClose(str, i, name);
      el.innerStart = i;
      el.innerEnd = close.innerEnd;
      el.roundTrip = { text: str.slice(i, close.innerEnd) };
      stack.push(el);
      // parse children recursively (bounded by close.innerEnd)
      const inner = parseXml(str.slice(i, close.innerEnd));
      for (const ch of inner.children) { ch.parent = el; el.children.push(ch); }
      i = close.afterEnd;
      stack.pop();
    } else {
      el.innerStart = tagEnd + 1; el.innerEnd = tagEnd + 1; el.roundTrip = { text: '' }; el.selfClosing = true;
    }
  }
  return root;

  function pushText(t, valueOnly) {
    if (!t) return;
    const node = add(new Node('text', '#text', null, -1));
    node.value = valueOnly !== undefined ? valueOnly : t;
  }
  function add(node) {
    node.parent = stack[stack.length - 1];
    if (node.type === 'text') { node.value = ''; }
    stack[stack.length - 1].children.push(node);
    return node;
  }
}

function findTagEnd(str, from) {
  let quote = null;
  for (let i = from; i < str.length; i++) {
    const c = str[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '>') return i;
  }
  return str.length - 1;
}

function findMatchingClose(str, from, name) {
  let depth = 1;
  let i = from;
  const openRe = new RegExp(`<${escapeRe(name)}(?:\\s|/|>)`, 'g');
  const closeTag = `</${name}>`;
  while (i < str.length) {
    const nextClose = str.indexOf(closeTag, i);
    if (nextClose < 0) return { innerEnd: str.length, afterEnd: str.length };
    openRe.lastIndex = i;
    let m;
    let nested = null;
    while ((m = openRe.exec(str)) && m.index < nextClose) { nested = m; }
    if (nested && nested.index < nextClose) {
      // nested same-name element: skip it wholly
      const tagEnd = findTagEnd(str, nested.index + 1);
      const head = str.slice(nested.index + 1, tagEnd);
      if (!head.trimEnd().endsWith('/')) {
        const inner = findMatchingClose(str, tagEnd + 1, name);
        i = inner.afterEnd;
        continue;
      }
      i = tagEnd + 1;
      continue;
    }
    return { innerEnd: nextClose, afterEnd: nextClose + closeTag.length };
  }
  return { innerEnd: str.length, afterEnd: str.length };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseTagHead(body) {
  const m = /^\s*([^\s/>]+)/.exec(body);
  const name = m ? m[1] : '';
  const attrs = {};
  const rest = body.slice(m ? m[0].length : body.length);
  const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let a;
  while ((a = attrRe.exec(rest))) attrs[a[1]] = decodeEntities(a[3] !== undefined ? a[3] : a[4]);
  return { name, attrs };
}

// ---------- DOM helpers -------------------------------------------------------
export function findAll(node, pred, acc = []) {
  for (const c of node.children) {
    if (c.type !== 'elem') continue;
    if (pred(c)) acc.push(c);
    findAll(c, pred, acc);
  }
  return acc;
}
export function childElem(node, name) {
  if (!node) return null;
  return node.children.find(c => c.type === 'elem' && c.name === name) || null;
}
export function childElems(node, name) {
  if (!node) return [];
  return node.children.filter(c => c.type === 'elem' && c.name === name);
}
export function childPath(node, ...names) {
  let cur = node;
  for (const n of names) { cur = childElem(cur, n); if (!cur) return null; }
  return cur;
}
export function textOf(node) {
  if (!node) return null;
  if (node.type === 'text') return decodeEntities(node.value || '');
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text') out += decodeEntities(c.value || '');
    else if (c.type === 'cdata') out += c.value || '';
    else if (c.type === 'elem') out += textOf(c);
  }
  return out;
}
export function attrOf(node, name) { return node ? node.attr(name) : null; }

/**
 * Byte-faithful serializer.
 * Unchanged elements replay their original inner text; up to `depth` affected
 * (dirty) levels re-indent their children so edited documents stay readable
 * exactly like uVision's own 2-space layout; below that boundary the original
 * bytes are reused verbatim.
 */
export function serialize(node, depth = 0, inRaw = false) {
  if (node.type === 'root') return node.children.map(c => serialize(c, 0, false)).join('') ;
  if (node.type === 'text') return node.value || '';
  if (node.type === 'decl' || node.type === 'comment') return node.value || '';
  if (node.type === 'cdata') return `<![CDATA[${node.value || ''}]]>`;
  const attrs = node.attrOrder.filter(k => Object.prototype.hasOwnProperty.call(node.attrs, k))
    .map(k => ` ${k}="${encodeAttr(node.attrs[k])}"`).join('');
  const tag = `<${node.name}${attrs}`;
  if (node.selfClosing) return `${tag}/>`;
  if (inRaw || node.roundTrip === null || node.roundTrip === undefined) {
    const rendered = node.children.map(c => serialize(c, depth + 1, true)).join('');
    if (rendered === '' && node.origSelfClosing) return `${tag}/>`;
    return `${tag}>${rendered}</${node.name}>`;
  }
  if (!node.dirty) return `${tag}>${node.roundTrip.text}</${node.name}>`;
  if (node.inlineDirty && depth > 0) {
    return `${tag}>${node.children.map(c => serialize(c, 0, true)).join('')}</${node.name}>`;
  }
  const childIndent = depthIndent(depth + 1);
  const closeIndent = depthIndent(depth);
  const kids = node.children.filter(c => !(c.type === 'text' && /^[\s]*$/.test(c.value || '')));
  if (kids.length === 0) return `${tag}/>`;
  let out = `${tag}>\n`;
  for (const c of kids) {
    if (c.type === 'text') { out += c.value || ''; continue; }
    out += childIndent + serialize(c, depth + 1, false) + '\n';
  }
  out += closeIndent + `</${node.name}>`;
  return out;
}

function depthIndent(depth) { return '  '.repeat(depth); }

/** Invalidate round-trip cache for every roundTrip node; each recomputes its own region. */
export function markDirty(el) {
  let cur = el;
  while (cur) {
    if (cur.roundTrip) cur.dirty = true;
    cur = cur.parent;
  }
}

export function setTextFmt(el, value, indent) {
  // Replaces all children with a single text node containing `value`; keeps newlines for readability.
  el.children = [];
  const tn = new Node('text', '#text', null, -1, el);
  tn.value = String(value);
  el.children.push(tn);
  el.selfClosing = false;
  if (el.roundTrip) { el.roundTrip = null; markDirty(el); }
  return el;
}

export function ensureChild(parent, name, indent, defaultValue) {
  let el = childElem(parent, name);
  if (!el) {
    el = new Node('elem', name, {}, -1, parent);
    el.selfClosing = false;
    el.children = [];
    el.roundTrip = null;
    const idx = parent.children.findIndex(c => c.type === 'elem' && c.name.toLowerCase() > name.toLowerCase());
    parent.insertChild(el, idx < 0 ? parent.children.length : idx);
    markDirty(parent);
  }
  if (defaultValue !== undefined && textOf(el) === '') setTextFmt(el, defaultValue, indent);
  return el;
}

export function removeChild(parent, el) {
  if (!el) return;
  const i = parent.children.indexOf(el);
  if (i >= 0) { parent.children.splice(i, 1); markDirty(parent); }
}

export function createElement(name, children = [], attrs = null) {
  const el = new Node('elem', name, attrs || {}, -1, null);
  el.selfClosing = children.length === 0;
  el.roundTrip = null;
  el.children = children.map(c => {
    if (typeof c === 'string' || c instanceof String) {
      const t = new Node('text', '#text', null, -1, el); t.value = String(c); return t;
    }
    c.parent = el; return c;
  });
  return el;
}

export function deepClone(node, parent = null) {
  const c = new Node(node.type, node.name, { ...(node.attrs || {}) }, -1, parent);
  c.attrOrder = node.attrOrder ? [...node.attrOrder] : Object.keys(node.attrs || {});
  c.value = node.value;
  c.selfClosing = node.selfClosing;
  c.roundTrip = node.roundTrip ? { text: node.roundTrip.text } : null;
  c.dirty = node.dirty;
  c.children = node.children.map(ch => deepClone(ch, c));
  return c;
}

// ---------- convenience ------------------------------------------------------
export function loadXmlFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const doc = new ParseDoc(raw, file);
  return doc;
}

class ParseDoc {
  constructor(raw, file) {
    this.raw = raw; this.file = file;
    this.root = parseXml(raw);
    this.decls = this.root.children.filter(c => c.type === 'decl');
    this.proj = childElem(this.root, 'Project') || childElem(this.root, 'ProjectOpt') || this.root.children.find(c => c.type === 'elem');
  }
  toString() { return this.root.children.map(serialize).join(''); }
  save(file = this.file) { fs.writeFileSync(file, this.toString(), 'utf8'); this.raw = this.toString(); }
}

export { ParseDoc };







