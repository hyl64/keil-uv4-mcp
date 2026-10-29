// tools/common.mjs — shared schema helpers and tool registration wrapper.
export function s(type, extra = {}) { return { type, ...extra }; }
export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
export const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra });
export const enumOf = (values, description) => ({ type: 'string', description, enum: values });
export const arr = (items, description) => ({ type: 'array', description, items });

function serializeJson(result) {
  const text = JSON.stringify(result, null, 2);
  const isError = !!(result && typeof result === 'object' && result.ok === false);
  return { content: [{ type: 'text', text }], isError };
}

let toolCount = 0;
export function toolCountValue() { return toolCount; }

export function register(ctx, def) {
  const wrapped = {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema || { type: 'object', properties: {}, additionalProperties: false },
    async handler(args) {
      try {
        const out = await def.handler(args, ctx);
        return serializeJson(out);
      } catch (e) {
        return serializeJson({ ok: false, error: String((e && e.message) || e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 5) : null });
      }
    },
  };
  ctx.server.tool(wrapped);
  toolCount++;
  return wrapped;
}
