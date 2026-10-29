import fs from "node:fs";
const f = new URL("../src/tools/batchgen.mjs", import.meta.url);
let s = fs.readFileSync(f, "utf8");

// 1) toolset selection: the target compiles with Arm Compiler 5 unless uAC6 is set
s = s.replace("      const toolset = ctx.install.toolsets[0];",
  "      // AC5 targets use the ARMCC toolset; AC6 targets (uAC6=1) use ARMCLANG\n      const wantAc6 = !!t.ac6;\n      const toolset = ctx.install.toolsets.find(x => /ARMCLANG/i.test(x.dir) === wantAc6) || ctx.install.toolsets[0];");

// 2) via-file split: keep the version token, then the defines, then the output
s = s.replace(`function viaLines(cmd, fileRel) {
  const parts = cmd.split(' ');
  // 1st line: options up to (excluding) the RTE include
  const rteIdx = parts.findIndex(p => /^-I[A-Za-z]:\\\\/.test(p));
  const head = rteIdx >= 0 ? parts.slice(0, rteIdx).join(' ') : parts.join(' ');
  const rte = rteIdx >= 0 ? parts[rteIdx] : null;
  const tail = rteIdx >= 0 ? parts.slice(rteIdx + 1) : [];
  const verIdx = tail.findIndex(p => /^--pd$/.test(p) && /UVISION_VERSION/.test(tail[tail.indexOf(p) + 1] || '') || /^-D__UVISION_VERSION/.test(p));
  const verLine = verIdx >= 0 ? tail.slice(verIdx, verIdx + (tail[verIdx] === '--pd' ? 2 : 1)).join(' ') : '';
  const rest = verIdx >= 0 ? tail.slice(verIdx + (tail[verIdx] === '--pd' ? 2 : 1)) : tail;
  const outIdx = rest.findIndex(p => p === '-o');
  const defs = outIdx >= 0 ? rest.slice(1, outIdx).join(' ') : rest.join(' ');
  const outLine = outIdx >= 0 ? rest.slice(outIdx).join(' ') : '';
  return [head, rte, \`\${verLine} \${defs}\`.trim(), \`\${outLine} "\${fileRel}"\`.trim()].filter(Boolean);
}`,
`/**
 * Split a recorded command line into the physical lines µVision writes into
 * <name>.__i / ._ia (observed: options ..., -I<RTE>, __UVISION_VERSION + defines,
 * -o <obj> --depend <dep> "<source>").
 */
function viaLines(cmd, fileRel) {
  const parts = cmd.split(' ').filter(Boolean);
  const rteIdx = parts.findIndex(p => /^-I[A-Za-z]:\\\\/.test(p));
  const head = (rteIdx >= 0 ? parts.slice(0, rteIdx) : parts).join(' ');
  const rte = rteIdx >= 0 ? parts[rteIdx] : null;
  const tail = rteIdx >= 0 ? parts.slice(rteIdx + 1) : [];
  const outIdx = tail.findIndex(p => p === '-o');
  const beforeOut = outIdx >= 0 ? tail.slice(0, outIdx) : tail;
  const outLine = outIdx >= 0 ? tail.slice(outIdx).join(' ') : '';
  const verIdx = beforeOut.findIndex(p => /UVISION_VERSION/.test(p) || (p === '--pd' && /UVISION_VERSION/.test(beforeOut[beforeOut.indexOf(p) + 1] || '')));
  let verLine = '', defsLine = '';
  if (verIdx >= 0) {
    const verTok = beforeOut[verIdx] === '--pd' ? beforeOut.slice(verIdx, verIdx + 2) : beforeOut.slice(verIdx, verIdx + 1);
    verLine = verTok.join(' ');
    defsLine = beforeOut.slice(verIdx + verTok.length).join(' ');
  } else {
    defsLine = beforeOut.join(' ');
  }
  return [head, rte, [verLine, defsLine].filter(Boolean).join(' '), \`\${outLine} "\${fileRel}"\`.trim()].filter(Boolean);
}`);

// 3) rel(): preserve the project's spelling of the output/listing folders
s = s.replace(`      const rel = (p) => {
        const r = path.relative(pr.dir, p).split(path.sep);
        const dir = r.slice(0, -1).map(s => s.toLowerCase()).join('\\\\');
        return dir ? \`.\\\\\${dir}\\\\\${r[r.length - 1]}\` : \`.\\\\\${r[r.length - 1]}\`;
      };`,
`      // µVision lower-cases the object/listing folder in the via files but keeps
      // OutputDirectory as typed in the .lnp / batch file; the via-file caller passes
      // lower=true accordingly.
      const rel = (p, lower) => {
        const r = path.relative(pr.dir, p).split(path.sep);
        const dir = r.slice(0, -1).map(s => (lower ? s.toLowerCase() : s)).join('\\\\');
        return dir ? \`.\\\\\${dir}\\\\\${r[r.length - 1]}\` : \`.\\\\\${r[r.length - 1]}\`;
      };`);
s = s.replace("objPath: rel(base + '.o'), depPath: rel(base + '.d'), lstPath: rel(base + '.lst'),",
  "objPath: rel(base + '.o', true), depPath: rel(base + '.d', true), lstPath: rel(base + '.lst', true),");
s = s.replace("...objs.map(o => `\"${rel(o)}\"`),", "...objs.map(o => `\"${rel(o, true)}\"`),");
s = s.replace("`--scatter \"${rel(path.join(outDir, t.outputName + '.sct'))}\"`,", "`--scatter \"${rel(path.join(outDir, t.outputName + '.sct'), false)}\"`,");
s = s.replace("`--list \"${path.join(t.listingPath || '.', t.outputName + '.map')}\" -o \"${path.join(t.outputDirectory || '.', t.outputName + '.axf')}\"`,",
  "`--list \"${path.join(t.listingPath || '.', t.outputName + '.map')}\" -o \"${path.join(t.outputDirectory || '.', t.outputName + '.axf')}\"`,");
s = s.replace("...vias.map(v => `\"${path.join(toolBin, v.via.endsWith('._ia') ? 'ArmAsm' : 'ArmCC')}\" --Via \"${rel(v.via)}\"`).map(s => s.replace(/\\\\\\\\/g, '\\\\')),",
  "...vias.map(v => `\"${path.join(toolBin, v.via.endsWith('._ia') ? 'ArmAsm' : 'ArmCC')}\" --Via \"${rel(v.via, true)}\"`),");
s = s.replace("`\"${path.join(toolBin, 'ArmLink')}\" --Via \"${rel(lnpPath)}\"`,", "`\"${path.join(toolBin, 'ArmLink')}\" --Via \"${rel(lnpPath, false)}\"`,");
s = s.replace("`\"${path.join(toolBin, 'fromelf.exe')}\" \"${rel(path.join(outDir, t.outputName + '.axf'))}\" --i32combined --output \"${rel(path.join(outDir, t.outputName + '.hex'))}\"`,",
  "`\"${path.join(toolBin, 'fromelf.exe')}\" \"${rel(path.join(outDir, t.outputName + '.axf'), false)}\" --i32combined --output \"${rel(path.join(outDir, t.outputName + '.hex'), false)}\"`,");
fs.writeFileSync(f, s);
console.log("patched batchgen");
