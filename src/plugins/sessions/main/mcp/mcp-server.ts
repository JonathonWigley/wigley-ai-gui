import type { Readable, Writable } from 'node:stream';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Disposable } from '../../../../contracts/disposable';
import {
  errorResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../contract';

// The `_meta` key Claude Code sends a tools/call's calling tool_use id under.
const TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

const SERVER_INFO = { name: 'wigley-forms', version: '1.0.0' };

// The tool list a connection serves, read on each `tools/list`.
export interface LiveTools {
  tools(): ToolDefinition[];
  onToolsChanged(listener: () => void): Disposable;
}

function toolUseId(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.[TOOL_USE_ID_META_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

// A thrown Error becomes an error result naming its type.
async function callTool(
  session: ToolSession,
  name: string,
  args: unknown,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<ToolResult> {
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

// One MCP server for one connection, listing the live `tools`, telling the
// client when they change, and sending every call to `session`, which rejects
// an unknown name; `input` may arrive paused, holding bytes sent before the
// server existed.
export function serveMcp(
  streams: { input: Readable; output: Writable },
  session: ToolSession,
  tools: LiveTools,
): { close(): Promise<void> } {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: { listChanged: true } },
  });
  server.setRequestHandler('tools/list', async () => ({
    // MCP's tool type requires the literal `type: 'object'` on every schema.
    tools: tools.tools().map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema, type: 'object' as const },
    })),
  }));
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args, _meta: meta } = request.params;
    // The SDK's result type has a string index signature, which an interface lacks.
    return {
      ...(await callTool(session, name, args, meta, ctx.mcpReq.signal)),
    };
  });
  const connected = server
    .connect(new StdioServerTransport(streams.input, streams.output))
    .then(() => {
      streams.input.resume();
    });
  // A notice that rejects found the connection closing.
  const toolsChanged = tools.onToolsChanged(() => {
    connected.then(() => server.sendToolListChanged()).catch(() => undefined);
  });
  return {
    close: async () => {
      toolsChanged.dispose();
      await connected;
      await server.close();
    },
  };
}
