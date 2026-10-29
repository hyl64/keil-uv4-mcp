import { startServer } from "../tests/mcp_client.mjs";
import path from "node:path";
const c = startServer(path.resolve("../src/server.mjs"));
await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
c.notify("notifications/initialized", {});
const tools = await c.request("tools/list", {});
console.log("keys", Object.keys(tools));
console.log("count", (tools.tools || []).length, "items", (tools.items || []).length, "nextCursor", tools.nextCursor);
c.close();

