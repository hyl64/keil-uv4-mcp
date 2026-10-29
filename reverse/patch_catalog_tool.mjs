import fs from "node:fs";
const p = new URL("../src/tools/modules.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
if (t.includes("module_catalog")) { console.log("already present"); process.exit(0); }
t = t.replace(
  "import { readGuiLayout, readDbgconf } from '../formats.mjs';",
  "import { readGuiLayout, readDbgconf } from '../formats.mjs';\nimport { fileURLToPath } from 'node:url';\nconst PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');\nconst CATALOG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'reverse', 'module_catalog.json'), 'utf8'));\n"
);
t = t.replace(
  "  // ---------- license architecture dossier ----------",
  `  register(ctx, {
    name: 'module_catalog',
    description: 'The full reverse-engineered catalogue of every binary and data format in the UV4 install directory (25 modules: roles, versions, PE arch, export tables incl. UVSC 103 / UVSCWrapper 275 / UVAC 14 / armlm.dll 4, CLI syntax, plus 8 data formats). Optional module filter.',
    inputSchema: { type: 'object', properties: { module: str('module key substring e.g. UVSC or armlm') } },
    handler: async (args) => {
      const q = String(args.module || '').toLowerCase();
      const mods = Object.fromEntries(Object.entries(CATALOG.modules).filter(([k]) => !q || k.toLowerCase().includes(q)));
      return { ok: true, dir: CATALOG.dir, modules: mods, moduleCount: Object.keys(mods).length, formats: CATALOG.formats, source: CATALOG.source };
    },
  });

  // ---------- license architecture dossier ----------`
);
fs.writeFileSync(p, t);
console.log("module_catalog tool added");
