// tests/mcp_client.mjs — minimal stdio MCP client for exercising the server end-to-end.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

export function startServer(serverPath) {
  const child = spawn(process.execPath, [serverPath], { cwd: path.dirname(serverPath), stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  const notifications = [];
  let nextId = 1;
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(Object.assign(new Error(msg.error.message), { rpc: msg.error }));
      else resolve(msg.result);
    } else if (msg.method) {
      notifications.push(msg);
    }
  });
  const stderr = [];
  child.stderr.on('data', d => stderr.push(d.toString()));

  function request(method, params, timeoutMs = 120000) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async function callTool(name, args, timeoutMs = 120000) {
    const res = await request('tools/call', { name, arguments: args }, timeoutMs);
    const text = res.content && res.content[0] && res.content[0].text;
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { isError: !!res.isError, data };
  }

  function close() { try { child.stdin.end(); } catch {} try { child.kill(); } catch {} }

  return { child, request, notify, callTool, close, notifications, stderr };
}
