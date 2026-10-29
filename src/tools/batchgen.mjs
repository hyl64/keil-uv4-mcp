// tools/batchgen.mjs — reproduction of uVision's batch build artefacts.
// Evidence: reverse/batch_via_files_evidence.json (+ Flash.BAT, main.__i, startup._ia,
// main.lnp captured from a target with Create Batch File enabled).
import fs from 'node:fs';
import path from 'node:path';
import { register, str } from './common.mjs';
import { Project, findProjectFile } from '../project.mjs';
function packRootsOf(ctx) {
  return ctx.data ? ctx.data.packRoots() : (ctx.install && ctx.install.packRoots) || [];
}

import { buildCompileCommand, cpuSpecFromProject, uvisionBuildNumber } from '../toolchain.mjs';

const CRLF = '\r\n';

function rteDeviceInclude(ctx, t) {
  const m = /^([^.]+)\.(.+?)\.(\d+(?:\.\d+)*)$/.exec(t.packId || '');
  if (!m) return null;
  for (const root of packRootsOf(ctx)) {
    const dir = path.join(root, m[1], m[2], m[3], 'Device', 'Include');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/** Split the compile command into the same 4 physical lines µVision writes into <name>.__i / ._ia. */
/**
 * Split a recorded command line into the physical lines µVision writes into
 * <name>.__i / ._ia (observed: options ..., -I<RTE>, __UVISION_VERSION + defines,
 * -o <obj> --depend <dep> "<source>").
 */
function viaLines(cmd, fileRel) {
  const parts = cmd.split(' ').filter(Boolean);
  const rteIdx = parts.findIndex(p => /^-I[A-Za-z]:\\/.test(p));
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
  return [head, rte, [verLine, defsLine].filter(Boolean).join(' '), `${outLine} "${fileRel}"`.trim()].filter(Boolean);
}

export function registerBatchTools(ctx) {
  register(ctx, {
    name: 'batch_generate',
    description: 'Generate the exact artefacts uVision writes when "Options→Output→Create Batch File" is set: <Target>.BAT in the project root, per-file via files (objects\\<name>.__i and ._ia) and the linker <output>.lnp, all carrying the same options as the real UV4 output.',
    inputSchema: {
      type: 'object',
      properties: { project: str('Project file'), target: str('Target'), outputDirectory: str('Override output directory'), write: 'Write the files (default true)' },
      required: ['project'],
    },
    handler: async (args) => {
      const pr = new Project(findProjectFile(args.project));
      const t = pr.target(args.target) || pr.targets()[0];
      const outDir = path.resolve(pr.dir, args.outputDirectory || t.outputDirectory || '.');
      const lstDir = path.resolve(pr.dir, t.listingPath || '.');
      const files = pr.files(t.name);
      const all = [...files.groups.flatMap(g => g.files), ...files.loose].filter(f => [1, 2, 8].includes(f.type));
      const rte = rteDeviceInclude(ctx, t);
      const ver = uvisionBuildNumber(ctx.install && ctx.install.uvisionVersion);
      // µVision lower-cases the object/listing folder in the via files but keeps
      // OutputDirectory as typed in the .lnp / batch file; the via-file caller passes
      // lower=true accordingly.
      const rel = (p, lower) => {
        const r = path.relative(pr.dir, p).split(path.sep);
        const dir = r.slice(0, -1).map(s => (lower ? s.toLowerCase() : s)).join('\\');
        return dir ? `.\\${dir}\\${r[r.length - 1]}` : `.\\${r[r.length - 1]}`;
      };
      const created = [];
      const vias = [];
      const objs = [];
      for (const f of all) {
        const base = path.join(outDir, path.basename(f.name, path.extname(f.name)));
        objs.push(base + '.o');
        const tool = f.type === 2 ? 'armasm' : 'armcc';
        // The via file lists the RTE include once; when the target's IncludePath already
        // contains that directory (scaffolded projects do), UV4 shows it only in the
        // user include run, so keep the compiler line without a duplicate.
        const alreadyIncluded = String((t.c && t.c.includePath) || '').split(';').map(s => s.trim().toLowerCase()).includes(String(rte || '').toLowerCase());
        const cmd = buildCompileCommand({
          tool, target: t, file: f.name, relFile: f.filePath,
          objPath: rel(base + '.o', true), depPath: rel(base + '.d', true), lstPath: rel(base + '.lst', true),
          rteDeviceInclude: alreadyIncluded ? null : rte, uvisionVersion: ver,
        });
        const lines = viaLines(cmd, f.filePath.replace(/^\.\\/, '').replace(/\\/g, '\\'));
        const viaName = tool === 'armasm' ? path.basename(base) + '._ia' : path.basename(base) + '.__i';
        const viaPath = path.join(outDir, viaName);
        if (args.write !== false) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(viaPath, lines.join(CRLF) + CRLF, 'latin1'); created.push(viaPath); }
        vias.push({ file: f.filePath, via: viaPath, content: lines.join(CRLF) });
      }
      const lnpLines = [
        `--cpu ${cpuSpecFromProject(t)}`,
        ...objs.map(o => `"${rel(o, true)}"`),
        `--scatter "${rel(path.join(outDir, t.outputName + '.sct'), false)}"`,
        '--summary_stderr --info summarysizes --map --load_addr_map_info --xref --callgraph --symbols',
        '--info sizes --info totals --info unused --info veneers',
        `--list "${path.join(t.listingPath || '.', t.outputName + '.map')}" -o "${path.join(t.outputDirectory || '.', t.outputName + '.axf')}"`,
      ];
      const lnpPath = path.join(outDir, t.outputName + '.lnp');
      if (args.write !== false) { fs.writeFileSync(lnpPath, lnpLines.join(CRLF) + CRLF, 'latin1'); created.push(lnpPath); }

      // AC5 targets use the ARMCC toolset; AC6 targets (uAC6=1) use ARMCLANG
      const wantAc6 = !!t.ac6;
      const toolsets = (ctx.install && ctx.install.toolsets) || [];
      const toolset = toolsets.find(x => /ARMCLANG/i.test(x.dir) === wantAc6) || toolsets[0] || null;
      const toolBin = toolset ? toolset.dir + '\\bin' : '<toolset>\\bin';
      const clock = /CLOCK\((\d+)\)/.exec(t.cpu || '');
      const clockHex = '0x' + (clock ? Number(clock[1]) : 12000000).toString(16).toUpperCase().padStart(8, '0');
      const bat = [
        `SET PATH=${toolBin};%PATH%`,
        'SET ARMCC5_ASMOPT=--diag_suppress=9931',
        'SET ARMCC5_CCOPT=--diag_suppress=9931',
        'SET ARMCC5_LINKOPT=--diag_suppress=9931',
        `SET CPU_TYPE=${t.device}`,
        `SET CPU_VENDOR=${t.vendor}`,
        `SET UV2_TARGET=${t.name}`,
        `SET CPU_CLOCK=${clockHex}`,
        ...vias.map(v => `"${path.join(toolBin, v.via.endsWith('._ia') ? 'ArmAsm' : 'ArmCC')}" --Via "${rel(v.via, true)}"`),
        `"${path.join(toolBin, 'ArmLink')}" --Via "${rel(lnpPath, false)}"`,
        `"${path.join(toolBin, 'fromelf.exe')}" "${rel(path.join(outDir, t.outputName + '.axf'), false)}" --i32combined --output "${rel(path.join(outDir, t.outputName + '.hex'), false)}"`,
      ];
      const batPath = path.join(pr.dir, `${t.name}.BAT`);
      if (args.write !== false) { fs.writeFileSync(batPath, bat.join(CRLF) + CRLF, 'utf8'); created.push(batPath); }
      return { ok: true, project: pr.file, target: t.name, batchFile: batPath, viaFiles: vias.map(v => v.via), linkerVia: lnpPath, created, content: { bat: bat.join('\n'), lnp: lnpLines.join('\n'), vias: vias.map(v => ({ file: v.file, text: v.content })) } };
    },
  });
}

