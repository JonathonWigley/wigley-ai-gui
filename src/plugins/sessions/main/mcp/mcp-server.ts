import type { Readable, Writable } from 'node:stream';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { ToolDefinition, ToolResult, ToolSession } from '../../contract';

// The `_meta` key Claude Code sends a tools/call's calling tool_use id under.
const TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

const SERVER_INFO = { name: 'wigley-forms', version: '1.0.0' };

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function toolUseId(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.[TOOL_USE_ID_META_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

// A name outside `tools` never reaches the session; a thrown Error becomes an
// error result naming its type.
async function callTool(
  session: ToolSession,
  toolNames: string[],
  name: string,
  args: unknown,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (!toolNames.includes(name)) {
    return errorResult(
      `Unknown tool: ${name}. Valid tools are ${toolNames.join(', ')}.`,
    );
  }
  try {
    return await session.call(name, args, {
      toolUseId: toolUseId(meta),
      signal,
    });
  } catch (error) {
    if (error instanceof Error) {
      return errorResult(`${error.name}: ${error.message}`);
    }
    throw error;
  }
}

// One MCP server for one connection, listing `tools` and sending each call of
// one of them to `session`; `input` may arrive paused, holding bytes sent
// before the server existed.
export function serveMcp(
  streams: { input: Readable; output: Writable },
  session: ToolSession,
  tools: ToolDefinition[],
): { close(): Promise<void> } {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  const toolNames = tools.map((tool) => tool.name);
  server.setRequestHandler('tools/list', async () => ({
    // MCP's tool type requires the literal `type: 'object'` on every schema.
    tools: tools.map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema, type: 'object' as const },
    })),
  }));
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args, _meta: meta } = request.params;
    // The SDK's result type has a string index signature, which an interface lacks.
    return {
      ...(await callTool(
        session,
        toolNames,
        name,
        args,
        meta,
        ctx.mcpReq.signal,
      )),
    };
  });
  const connected = server
    .connect(new StdioServerTransport(streams.input, streams.output))
    .then(() => {
      streams.input.resume();
    });
  return {
    close: async () => {
      await connected;
      await server.close();
    },
  };
}
