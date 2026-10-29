// mcp.mjs — minimal, spec-conformant MCP (JSON-RPC 2.0 over stdio) server core.
// Implements initialize / tools/list / tools/call / resources/list / prompts/list,
// pagination, progress notifications, cancellation and structured error mapping.
import readline from 'node:readline';

export const PROTOCOL_VERSION = '2024-11-05';
export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export class McpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class Server {
  constructor({ name, version, instructions }) {
    this.name = name; this.version = version; this.instructions = instructions;
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
    this.notifySink = null;
    this.cancelled = new Set();
  }
  tool(def) {
    if (!def.name) throw new Error('tool needs a name');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(def.name)) throw new Error(`invalid tool name: ${def.name}`);
    this.tools.set(def.name, def);
    return def;
  }
  resource(def) { this.resources.set(def.uri, def); }
  prompt(def) { this.prompts.set(def.name, def); }

  send(msg) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); }
  notify(method, params) { this.send({ method, params }); }

  registerNotifications(sink) {
    this.notifySink = sink;
    sink.onProgress = (token, progress, total, message) => {
      const p = { progressToken: token, progress };
      if (total !== undefined) p.total = total;
      if (message) p.message = message;
      this.notify('notifications/progress', p);
    };
    sink.log = (level, logger, data) => this.notify('notifications/message', { level, logger, data });
  }

  async handleCall(name, args, ctx) {
    const def = this.tools.get(name);
    if (!def) throw new McpError(-32602, `Unknown tool: ${name}`);
    validateInput(def.inputSchema, args || {});
    const result = await def.handler(args || {}, ctx);
    return normalizeResult(result);
  }

  async dispatch(msg) {
    const id = msg.id;
    const method = msg.method;
    if (method === 'notifications/cancelled') {
      this.cancelled.add(msg.params && msg.params.requestId);
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === undefined) return; // response to server-initiated request: ignore
    try {
      let result;
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: SUPPORTED_VERSIONS.includes(msg.params && msg.params.protocolVersion)
              ? msg.params.protocolVersion : PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
              logging: {},
            },
            serverInfo: { name: this.name, version: this.version },
            instructions: this.instructions,
          };
          break;
        case 'ping': result = {}; break;
        case 'tools/list': {
          const cursor = msg.params && msg.params.cursor;
          result = this.paginate([...this.tools.values()].map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), cursor, 200, it => it, 'tools');
          break;
        }
        case 'tools/call': {
          const { name, arguments: a } = msg.params || {};
          const sink = makeProgressSink(this, msg.params && msg.params._meta);
          result = await this.handleCall(name, a, { progress: sink, server: this });
          break;
        }
        case 'resources/list':
          result = this.paginate([...this.resources.values()].map(r => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType })), msg.params && msg.params.cursor, 200, x => x, 'resources');
          break;
        case 'resources/read': {
          const uri = msg.params && msg.params.uri;
          const r = this.resources.get(uri);
          if (!r) throw new McpError(-32002, `Resource not found: ${uri}`);
          const content = await r.read();
          result = { contents: [{ uri, mimeType: r.mimeType || 'application/json', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] };
          break;
        }
        case 'resources/templates/list': result = { resourceTemplates: [] }; break;
        case 'prompts/list':
          result = { prompts: [...this.prompts.values()].map(p => ({ name: p.name, description: p.description, arguments: p.arguments })) };
          break;
        case 'prompts/get': {
          const p = this.prompts.get(msg.params && msg.params.name);
          if (!p) throw new McpError(-32602, `Unknown prompt: ${msg.params && msg.params.name}`);
          result = await p.get(msg.params.arguments || {});
          break;
        }
        default:
          throw new McpError(-32601, `Method not found: ${method}`);
      }
      if (id !== undefined) this.send({ id, result });
    } catch (e) {
      if (id === undefined) return;
      const code = e instanceof McpError ? e.code : -32603;
      const message = e && e.message ? e.message : String(e);
      this.send({ id, error: { code, message, data: e && e.data !== undefined ? e.data : { stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6) : null } } });
    }
  }

  paginate(items, cursor, pageSize, map, key = 'items') {
    const start = cursor ? Number(Buffer.from(cursor, 'base64').toString('utf8')) || 0 : 0;
    const slice = items.slice(start, start + pageSize).map(map);
    const next = start + pageSize < items.length ? Buffer.from(String(start + pageSize)).toString('base64') : undefined;
    const res = { [key]: slice };
    if (next) res.nextCursor = next;
    return res;
  }

  listen(stream = process.stdin) {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      let msg;
      try { msg = JSON.parse(text); } catch {
        this.send({ id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      if (Array.isArray(msg)) { msg.forEach(m => this.dispatch(m)); return; }
      this.dispatch(msg);
    });
  }
}

function makeProgressSink(server, meta) {
  const token = meta && meta.progressToken;
  return {
    onProgress: token !== undefined && token !== null
      ? (progress, total, message) => server.notify('notifications/progress', { progressToken: token, progress, total, message })
      : () => {},
  };
}

/** Validate against a tiny JSON-Schema subset used by our tool definitions. */
export function validateInput(schema, value, path = '$') {
  if (!schema) return;
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new McpError(-32602, `Invalid arguments: ${path} must be an object`);
    }
    for (const req of schema.required || []) {
      if (!(req in value)) throw new McpError(-32602, `Invalid arguments: missing required property '${req}'`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateInput(props[k], v, `${path}.${k}`);
      else if (schema.additionalProperties === false) throw new McpError(-32602, `Invalid arguments: unexpected property '${k}'`);
      // Tools that opt into strict enforcement get an explicit error instead of
      // silently ignoring unknown members (schema stays permissive to match the
      // canonical MCP shape used by every other tool).
      else if (schema['x-strict'] === true) throw new McpError(-32602, `Invalid arguments: unexpected property '${k}'`);
    }
    return;
  }
  if (value === undefined || value === null) {
    if (schema.type && !(schema.nullable)) return; // lenient: treat null as absent
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') throw new McpError(-32602, `Invalid arguments: ${path} must be a string`);
      if (schema.enum && !schema.enum.includes(value)) throw new McpError(-32602, `Invalid arguments: ${path} must be one of ${schema.enum.join(', ')}`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) throw new McpError(-32602, `Invalid arguments: ${path} must be an integer`);
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) throw new McpError(-32602, `Invalid arguments: ${path} must be a number`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw new McpError(-32602, `Invalid arguments: ${path} must be a boolean`);
      break;
    case 'array':
      if (!Array.isArray(value)) throw new McpError(-32602, `Invalid arguments: ${path} must be an array`);
      if (schema.items) value.forEach((v, i) => validateInput(schema.items, v, `${path}[${i}]`));
      break;
    default: break;
  }
}

/** Normalize handler output to an MCP CallToolResult. */
export function normalizeResult(result) {
  if (result && typeof result === 'object' && Array.isArray(result.content)) return result;
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message, extra) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message, ...(extra || {}) }, null, 2) }],
    isError: true,
  };
}
