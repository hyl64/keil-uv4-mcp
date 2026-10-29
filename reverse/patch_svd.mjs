import fs from "node:fs";
const f = new URL("../src/tools/gdbstub.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");
// size attribute may be hexadecimal (size="0x20"); Number() of that string is NaN.
s = s.replace("size: Number((r.attr('size') || textOf(childElem(r, 'size')) || '32')),",
  "size: parseSvdNumber(r.attr('size') || textOf(childElem(r, 'size')) || '32'),");
s = s.replace("addressOffset: Number((r.attr('addressOffset') || textOf(childElem(r, 'addressOffset')) || '0')),",
  "addressOffset: parseSvdNumber(r.attr('addressOffset') || textOf(childElem(r, 'addressOffset')) || '0'),");
s = s.replace("base: Number((p.attr('baseAddress') || textOf(childElem(p, 'baseAddress')) || '0')),",
  "base: parseSvdNumber(p.attr('baseAddress') || textOf(childElem(p, 'baseAddress')) || '0'),");
s = s.replace("bitOffset: Number(f.attr('bitOffset') ?? textOf(childElem(f, 'bitOffset')) ?? 0),",
  "bitOffset: parseSvdNumber(f.attr('bitOffset') ?? textOf(childElem(f, 'bitOffset')) ?? 0),");
s = s.replace("bitWidth: Number(f.attr('bitWidth') ?? textOf(childElem(f, 'bitWidth')) ?? 1),",
  "bitWidth: parseSvdNumber(f.attr('bitWidth') ?? textOf(childElem(f, 'bitWidth')) ?? 1),");
// fields can be nested under <fields>; childElems(r,'field') misses them
s = s.replace("const fields = childElems(r, 'field').map(f => ({",
  "const fields = findAll(r, n => n.name === 'field').map(f => ({");
s = s.replace("const CORE_REGS = {",
  "/** CMSIS-SVD numbers are decimal or 0x-prefixed hexadecimal. */\nfunction parseSvdNumber(v) {\n  if (v === undefined || v === null || v === '') return 0;\n  return typeof v === 'number' ? v : Number(String(v).trim());\n}\n\nconst CORE_REGS = {");
fs.writeFileSync(f, s);
console.log("patched gdbstub");
