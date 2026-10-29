import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
const child = spawn(process.execPath, [path.resolve("src/server.mjs")], { cwd: process.cwd(), stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === 1) {
    console.log("initialize:", JSON.stringify(m.result && { v: m.result.protocolVersion, tools: m.result.capabilities }));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
  } else if (m.id === 2) {
    console.log("list keys:", Object.keys(m.result || {}));
    console.log("tools:", (m.result && m.result.tools || []).length);
    console.log("first:", JSON.stringify((m.result && m.result.tools || [])[0]));
    child.kill();
  }
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }) + "\n");
