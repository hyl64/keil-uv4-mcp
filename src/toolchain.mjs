// toolchain.mjs — faithful command lines for the ARM toolchain bundled with MDK.
// The templates reproduce the F-record command column of <project>_<target>.dep,
// which µVision writes before starting the tool (evidence: reverse/rte_injection_evidence.json).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const TOOL_COMMANDS = {
  armcc: '--c99 -c --cpu %CPU% %DEF% -g %OPT% --apcs=interwork %INC% %MISC% -o %OBJ% --depend %DEP%',
  armasm: '--cpu %CPU% --pd "__EVAL SETA 1" -g --apcs=interwork %INC% %PD% --list %LST% --xref -o %OBJ% --depend %DEP%',
  armclang: '--target=arm-arm-none-eabi -mcpu=%CPU% %DEF% -g %OPT% %INC% %MISC% -c -o %OBJ% -MD -MF %DEP%',
  armlink: '--cpu %CPU% %OBJS% --scatter "%SCT%" --summary_stderr --info summarysizes --map --load_addr_map_info --xref --callgraph --symbols --info sizes --info totals --info unused --info veneers --list "%MAP%" -o %AXF%',
  fromelf: '--i32combined --output "%HEX%" "%AXF%"',
};

export function cpuSpecFromProject(target) {
  const cpuAttr = target && target.misc && target.misc.cpuType ? String(target.misc.cpuType).replace(/"/g, '') : null;
  if (cpuAttr) return cpuAttr;
  const m = /CPUTYPE\("([^"]+)"\)/.exec((target && target.cpu) || '');
  if (m) return m[1];
  return 'Cortex-M3';
}

/** uVision's __UVISION_VERSION build number from TOOLS.INI ("5.43a" -> 543). */
export function uvisionBuildNumber(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version || '5.43'));
  if (!m) return '543';
  return String(Number(m[1]) * 100 + Number(m[2]));
}

/** Split a Define field exactly like uVision does (comma or space separated). */
export function splitDefines(definesString) {
  return String(definesString || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

/** -I rendering observed in the F record: "-I <path>" for user paths (quoted when spaces). */
export function renderIncludes(includePath) {
  return String(includePath || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean)
    .map(p => `-I ${/\s/.test(p) ? `"${p}"` : p}`).join(' ');
}

/**
 * Build the command line µVision records for one translation unit.
 * Order (verified against two recorded F lines):
 *   armasm: --cpu C --pd "__EVAL SETA 1" -g --apcs=interwork <asm inc> <-I rte>
 *           --pd "__UVISION_VERSION SETA V" <--pd "DEF SETA 1"> --list <lst> --xref -o <obj> --depend <dep>
 *   armcc : --c99 -c --cpu C -D__EVAL -g -O<n> --apcs=interwork <c inc> <-I rte>
 *           -D__UVISION_VERSION="V" <-DDEF ...> <misc> -o <obj> --depend <dep>
 */
export function buildCompileCommand(opts) {
  const { tool, target } = opts;
  const cpu = cpuSpecFromProject(target);
  const ver = opts.uvisionVersion || '543';
  const opt = `-O${target && target.c && target.c.optimization !== undefined ? target.c.optimization : 1}`;
  // UV4 glues the RTE device include to the switch with no separating space: -IC:\...\Device\Include
  const rteInc = opts.rteDeviceInclude ? `-I${/\s/.test(opts.rteDeviceInclude) ? `"${opts.rteDeviceInclude}"` : opts.rteDeviceInclude}` : '';
  if (tool === 'armasm') {
    const defs = splitDefines(target && target.asm ? target.asm.define : '');
    const pd = defs.map(d => (d.includes('=') ? `--pd "${d.replace('=', ' SETA ')}"` : `--pd "${d} SETA 1"`)).join(' ');
    return [
      '--cpu', cpu,
      '--pd "__EVAL SETA 1"', '-g', '--apcs=interwork',
      renderIncludes(target && target.asm ? target.asm.includePath : ''),
      rteInc,
      `--pd "__UVISION_VERSION SETA ${ver}"`,
      pd,
      `--list ${opts.lstPath}`, '--xref', '-o', opts.objPath, '--depend', opts.depPath,
    ].filter(Boolean).join(' ');
  }
  const defs = splitDefines(target && target.c ? target.c.define : '');
  return [
    '--c99 -c',
    `--cpu ${cpu}`,
    `-D__EVAL -g ${opt} --apcs=interwork`,
    renderIncludes(target && target.c ? target.c.includePath : ''),
    rteInc,
    `-D__UVISION_VERSION="${ver}"`,
    defs.map(d => `-D${d}`).join(' '),
    (opts.extraDefines || []).map(d => `-D${d}`).join(' '),
    target && target.c ? target.c.misc || '' : '',
    '-o', opts.objPath, '--depend', opts.depPath,
  ].filter(Boolean).join(' ');
}

function runExe(exe, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ ok: false, error: String(e.message || e), stdout: '', stderr: '' }); return; }
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, exitCode: code, stdout: out, stderr: err });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e), stdout: out, stderr: err }); });
  });
}

export async function runTool(install, toolset, tool, args, cwd) {
  const bin = toolset ? path.join(toolset.dir, 'bin', `${tool}.exe`) : null;
  if (!bin || !fs.existsSync(bin)) return { ok: false, error: `tool not found: ${tool}` };
  return runExe(bin, args, cwd || process.cwd());
}

/** Query the installed toolchain versions (armcc/armasm/armlink/fromelf use --vsn). */
export async function toolchainInfo(install, toolset) {
  const info = { toolset: toolset && { name: toolset.name, dir: toolset.dir }, tools: {} };
  if (!toolset) return info;
  const checks = [['armcc', ['--vsn']], ['armasm', ['--vsn']], ['armlink', ['--vsn']], ['fromelf', ['--vsn']], ['armclang', ['--version']], ['armar', ['--vsn']]];
  for (const [tool, args] of checks) {
    const bin = path.join(toolset.dir, 'bin', `${tool}.exe`);
    if (!fs.existsSync(bin)) { info.tools[tool] = { present: false }; continue; }
    const r = await runExe(bin, args, toolset.dir, 15000);
    const text = `${r.stdout}\n${r.stderr}`;
    const prod = /Product:\s*([^\r\n]+)/.exec(text);
    const comp = /Component:\s*([^\r\n]+)/.exec(text);
    const toolv = /Tool:\s*([^\r\n]+)/.exec(text);
    info.tools[tool] = { present: true, product: prod ? prod[1].trim() : null, component: comp ? comp[1].trim() : null, tool: toolv ? toolv[1].trim() : null, text: text.trim().slice(0, 400) };
  }
  return info;
}
