// snapshot_toolsini.mjs — record the TOOLS.INI-derived configuration as a fixture.
// The goal requires "TOOLS.INI 派生配置" to be inlined; this captures the parsed
// structure (not the raw INI, which is install-specific in its paths).
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  process.env.KEIL_MDK_ROOT,
  path.join(process.env.LOCALAPPDATA || '', 'Keil_v5'),
  'C:/Keil_v5',
].filter(Boolean);

function readIni(file) {
  const out = {};
  let section = null;
  const text = fs.readFileSync(file, 'latin1');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const m = /^\[([^\]]+)\]\s*$/.exec(line);
    if (m) { section = m[1].toUpperCase(); out[section] = out[section] || {}; continue; }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (kv && section) out[section][kv[1].toUpperCase()] = kv[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

let ini = null, root = null;
for (const c of CANDIDATES) {
  const f = path.join(c, 'TOOLS.INI');
  if (fs.existsSync(f)) { ini = readIni(f); root = c; break; }
}
if (!ini) { console.error('TOOLS.INI not found; nothing to snapshot'); process.exit(1); }

const uv2 = ini.UV2 || {};
const arm = ini.ARM || {};
const armads = ini.ARMADS || {};

// Keep only the keys that describe *behaviour*, and normalise absolute paths so the
// fixture is install-independent.
const normalise = (v) => String(v).replace(/[A-Za-z]:[\\/][^;"']*?Keil_v5/gi, '<MDK>').replace(/\\/g, '/');

const snapshot = {
  generated: new Date().toISOString(),
  source: 'parsed TOOLS.INI from a real MDK installation (paths normalised)',
  sections: Object.keys(ini),
  uvision: {
    version: uv2.VERSION || arm.VERSION || null,
    toolVariant: uv2.TOOL_VARIANT || null,
    path: normalise(uv2.PATH || '<MDK>/UV4'),
  },
  arm: {
    version: arm.VERSION || null,
    path: normalise(arm.PATH || '<MDK>/ARM'),
    rtePath: normalise(arm.RTEPATH || '%LOCALAPPDATA%/Arm/Packs'),
    cmsisToolbox: normalise(arm.CMSIS_TOOLBOX || '<MDK>/ARM/cmsis-toolbox'),
    debugDrivers: Object.entries(arm)
      .filter(([k]) => /^TDRV\d+$/.test(k))
      .map(([k, v]) => {
        const m = /^"([^"]*)"\s*\(\s*"([^"]*)"\s*\)$/.exec(String(v).trim());
        return { id: k, dll: m ? m[1] : null, name: m ? m[2] : String(v) };
      }),
    toolsetDirs: Object.entries(arm)
      .filter(([k]) => /^ARMCCPATH\d+$/.test(k))
      .map(([k, v]) => {
        // forms seen: "ARMCLANG"  ("V6.24")   and   ".\ARMCC"  ("V5.06 update 6 (build 750)")
        const m = /^"?([^"()]*?)"?\s*\(\s*"([^"]*)"\s*\)\s*$/.exec(String(v).trim())
          || /^"?([^"()]*?)"?\s*\(\s*([^)]*)\)\s*$/.exec(String(v).trim());
        const dir = m ? normalise(m[1].replace(/^\.\\/, '').trim()) : null;
        return { id: k, dir, version: m ? m[2].trim() : String(v) };
      }),
  },
  armads: {
    keys: Object.keys(armads),
    version: armads.VERSION || null,
    // Arm Compiler installs are registered here, not in [ARM]:
    //   ARMCCPATH0="ARMCLANG"  ("V6.24")
    //   ARMCCPATH1=".\ARMCC"   ("V5.06 update 6 (build 750)")
    toolsetDirs: Object.entries(armads)
      .filter(([k]) => /^ARMCCPATH\d+$/.test(k))
      .map(([k, v]) => {
        const m = /^"?([^"()]*?)"?\s*\(\s*"?(.*?)"?\s*\)\s*$/.exec(String(v).trim());
        return {
          id: Number(k.replace('ARMCCPATH', '')),
          dir: m ? normalise(m[1].replace(/^\.\\/, '').trim()) : null,
          version: m ? m[2].trim() : String(v),
        };
      })
      .sort((a, b) => a.id - b.id),
  },
};

const out = path.resolve('data/fixtures/tools/tools_ini.json');
fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({
  out,
  root,
  sections: snapshot.sections,
  debugDrivers: snapshot.arm.debugDrivers.length,
  toolsets: snapshot.armads.toolsetDirs.length,
  uvisionVersion: snapshot.uvision.version,
}, null, 1));
