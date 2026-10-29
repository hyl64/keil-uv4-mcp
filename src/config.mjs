// config.mjs — Keil installation discovery (TOOLS.INI driven) and runtime config.
import fs from 'node:fs';
import path from 'node:path';

function readIni(file) {
  const out = {};
  let section = null;
  let text = '';
  try { text = fs.readFileSync(file, 'latin1'); } catch { return out; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const m = /^\[([^\]]+)\]\s*$/.exec(line);
    if (m) { section = m[1].toUpperCase(); out[section] = out[section] || {}; continue; }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (kv && section) {
      const value = kv[2].replace(/\s+#.*$/, '');
      const str = /^"(.*)"$/.exec(value.trim());
      out[section][kv[1].toUpperCase()] = str ? str[1] : value.trim();
    }
  }
  return out;
}

export function expandMdkPath(p, mdkRoot) {
  if (!p) return p;
  let v = p.replace(/^"(.*)"$/, '$1');
  if (path.isAbsolute(v)) return path.normalize(v);
  return path.normalize(path.join(mdkRoot, v));
}

export function discoverInstall(explicitMdkRoot) {
  const candidates = [];
  if (explicitMdkRoot) candidates.push(explicitMdkRoot);
  if (process.env.KEIL_MDK_ROOT) candidates.push(process.env.KEIL_MDK_ROOT);
  if (process.env.KEIL_ROOT) candidates.push(process.env.KEIL_ROOT);
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Keil_v5'));
  for (const d of ['C:\\Keil_v5', 'C:\\Keil', 'D:\\Keil_v5']) candidates.push(d);

  for (const root of candidates) {
    try {
      const toolsIni = path.join(root, 'TOOLS.INI');
      if (!fs.existsSync(toolsIni)) continue;
      const ini = readIni(toolsIni);
      const arm = ini.ARMADS || ini.ARM || {};
      const armInfo = ini.ARM || {};
      const uv4Dir = path.join(root, 'UV4');
      const uv4Exe = path.join(uv4Dir, 'UV4.exe');
      if (!fs.existsSync(uv4Exe)) continue;
      const armPath = expandMdkPath(arm.PATH || path.join(root, 'ARM') + '\\', root).replace(/\\$/, '');
      const toolsets = [];
      for (let i = 0; i < 8; i++) {
        const k = `ARMCCPATH${i}`;
        if (!arm[k]) continue;
        const m = /^"([^"]*)"\s*\(\s*"([^"]*)"\s*\)$/.exec(arm[k]);
        if (!m) continue;
        let dir = m[1].replace(/^\.\\/, '');
        dir = path.isAbsolute(dir) ? dir : path.join(armPath.replace(/\\$/, ''), dir);
        toolsets.push({ id: i, dir: path.normalize(dir), name: m[2] });
      }
      const packs = [];
      if (arm.RTEPATH) packs.push(...String(arm.RTEPATH).split(';').filter(Boolean).map(p => path.normalize(p)));
      if (process.env.LOCALAPPDATA) packs.push(path.join(process.env.LOCALAPPDATA, 'Arm', 'Packs'));
      const cmsisToolbox = arm.CMSIS_TOOLBOX || path.join(armPath, 'cmsis-toolbox');
      return {
        found: true,
        root,
        toolsIni,
        uv4Dir,
        uv4Exe,
        uvisionCom: path.join(uv4Dir, 'uvision.com'),
        uvisionVersion: armInfo.VERSION || arm.VERSION || null,
        toolVariant: (ini.UV2 && ini.UV2.TOOL_VARIANT) || null,
        armPath,
        toolsets,
        packRoots: [...new Set(packs)],
        cmsisToolbox,
        cmsisToolboxBin: path.join(cmsisToolbox, 'bin'),
        debugDrivers: Object.entries(ini.ARM || {})
          .filter(([k]) => /^TDRV\d+$/.test(k))
          .map(([k, v]) => ({ id: k, spec: v })),
        licenseTerms: (() => { try { return fs.readdirSync(path.join(root, 'license_terms')); } catch { return []; } })(),
      };
    } catch { /* try next candidate */ }
  }
  return { found: false, candidates };
}

export function resolveToolset(install, prefer) {
  if (!install || !install.toolsets || install.toolsets.length === 0) return null;
  if (prefer === undefined || prefer === null) return install.toolsets[0];
  return install.toolsets.find(t => t.id === Number(prefer) || t.name === prefer || t.dir === prefer) || null;
}

export function toolPath(install, toolset, tool) {
  if (!toolset) return null;
  const exe = `${tool}.exe`;
  const p = path.join(toolset.dir, 'bin', exe);
  return fs.existsSync(p) ? p : null;
}

export const DEFAULT_CONFIG = {
  uv4TimeoutMs: 15 * 60 * 1000,
  uv4QuietTimeoutMs: 20 * 1000,
  maxConcurrentUv4: 2,
  killOnTimeout: true,
};


