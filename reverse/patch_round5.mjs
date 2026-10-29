import fs from "node:fs";
const dir = new URL(".", import.meta.url).pathname.replace(/^\//, "");
// 1) uvsock.mjs labeling fixes
const u = new URL("../src/uvsock.mjs", import.meta.url);
let t = fs.readFileSync(u, "utf8");
t = t.replace(
  "  EXEC_CMD_TEXT: 0x5020, EXEC_CMD_STATUS: 0x5021,\r\n  TARGETS_START: 0x5021, TARGETS_DATA: 0x5022, TARGETS_END: 0x5023,",
  "  EXEC_CMD_TEXT: 0x5020, EXEC_CMD_DONE: 0x5021, // 0x5021 doubles as EXEC-done and targets-start\n  TARGETS_START: 0x5021, TARGETS_DATA: 0x5022, TARGETS_END: 0x5023,"
);
t = t.replace(
  "  EXEC_CMD_TEXT: 0x5020, EXEC_CMD_STATUS: 0x5021,\n  TARGETS_START: 0x5021, TARGETS_DATA: 0x5022, TARGETS_END: 0x5023,",
  "  EXEC_CMD_TEXT: 0x5020, EXEC_CMD_DONE: 0x5021, // 0x5021 doubles as EXEC-done and targets-start\n  TARGETS_START: 0x5021, TARGETS_DATA: 0x5022, TARGETS_END: 0x5023,"
);
t = t.replace("  DBG_REGISTERS_60B: 0x2021,", "  DBG_STRUCT_2021: 0x2021, // 60B in-place struct (FUN_10007570; exact name unresolved)");
t = t.replace("  DBG_GEN_TEXT_INOUT: 0x2033,", "  DBG_TEXT_CMD_STREAM: 0x2033, // text cmd; streams 0x5020 chunks, echoes at end (180s)");
fs.writeFileSync(u, t);
// 2) modules.mjs: import formats + register tools
const m = new URL("../src/tools/modules.mjs", import.meta.url);
let g = fs.readFileSync(m, "utf8");
if (!g.includes("readGuiLayout")) {
  g = g.replace(
    "import { inspectPack, extractPack, readPackEntryText } from '../packfile.mjs';",
    "import { inspectPack, extractPack, readPackEntryText } from '../packfile.mjs';\nimport { readGuiLayout, readDbgconf } from '../formats.mjs';"
  );
  const tools = `
  // ---------- uvguix / dbgconf readers ----------
  register(ctx, {
    name: 'gui_layout_read',
    description: 'Read a .uvguix window/dock-layout file (project_guix.xsd ProjectGui: DockMan windows RegID/PaneID/IsFloating/PinState/rects, toolbar ControlBarsSummary). µVision stores per-user copies <project>.uvguix.<USER> beside the project; DFP samples ship bare .uvguix templates.',
    inputSchema: { type: 'object', properties: { file: str('.uvguix path') }, required: ['file'] },
    handler: async (args) => { try { return { ok: true, ...readGuiLayout(path.resolve(args.file)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } },
  });

  register(ctx, {
    name: 'dbgconf_read',
    description: 'Parse an RTE .dbgconf (Keil Configuration Wizard comment grammar: //<h> groups, //<o.bit> NAME //<i> help, #define values) — the debug-configuration data behind the System Viewer/debug tab (e.g. STM32F10x DBGMCU_CR stop-on-halt bits).',
    inputSchema: { type: 'object', properties: { file: str('.dbgconf path') }, required: ['file'] },
    handler: async (args) => { try { return { ok: true, ...readDbgconf(path.resolve(args.file)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } },
  });

  // ---------- license architecture dossier ----------`;
  g = g.replace("  // ---------- license architecture dossier ----------", tools);
  fs.writeFileSync(m, g);
}
console.log("patched uvsock + modules");
