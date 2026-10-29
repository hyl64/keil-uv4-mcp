import fs from "node:fs";
import { createServer } from "../src/server.mjs";
const { server } = createServer();
const rows = [];
const groups = {
  "CLI reproduction": ["uv4_"],
  "Project model": ["project_"],
  "Dependencies": ["dep_", "test_build"],
  "Packs / devices": ["pack_"],
  "Images / symbols": ["elf_info", "map_info", "hex_info", "memory_usage", "symbols_file"],
  "Session options": ["options_"],
  "Scaffolding / batch": ["batch_", "import_xml"],
  "Debugger / SVD": ["debug_"],
  "Installation / toolchain": ["keil_install", "toolchain_", "tool_run", "license_", "uvsock_", "uv4_processes", "cli_"],
};
const assigned = new Set();
for (const [group, prefixes] of Object.entries(groups)) {
  for (const name of server.tools.keys()) {
    if (assigned.has(name)) continue;
    if (prefixes.some(p => name.startsWith(p))) {
      assigned.add(name);
      const d = (server.tools.get(name).description || "").split(/(?<=\.)\s/)[0].replace(/\|/g, "/");
      rows.push(`| \`${name}\` | ${d} |`);
    }
  }
}
for (const name of server.tools.keys()) {
  if (assigned.has(name)) continue;
  rows.push(`| \`${name}\` | ${(server.tools.get(name).description || "").replace(/\|/g, "/")} |`);
}
fs.writeFileSync(new URL("../reverse/tool_table.md", import.meta.url), rows.join("\n") + "\n", "utf8");
console.log(rows.length + " tools");
