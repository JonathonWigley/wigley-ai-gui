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

const SERVER_VERSION = '1.0.0';

// The tool list a connection serves, read on each `tools/list`.
export interface LiveTools {
  tools(): ToolDefinition[];
  onToolsChanged(listener: () => void): Disposable;
}

// What a connection's server says its name is, and how it reads the calling
// tool-use id from a call's raw `_meta`, null when the call carries none.
export interface McpServeOptions {
  serverName: string;
  toolUseIdOf(meta: Readonly<Record<string, unknown>> | null): string | null;
}

// A thrown Error becomes an error result naming its type.
async function callTool(
  session: ToolSession,
  name: string,
  args: unknown,
  meta: Readonly<Record<string, unknown>> | null,
  options: McpServeOptions,
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    return await session.call(name, args, {
      toolUseId: options.toolUseIdOf(meta),
      signal,
    });
  } catch (error) {
    if (error instanceof Error) {
      return errorResult(`${error.name}: ${error.message}`);
    }
    throw error;
  }
}

// One MCP server for one connection, named `options.serverName`, listing the
// live `tools`, telling the client when they change, and sending every call to
// `session`, which rejects an unknown name, with the tool-use id
// `options.toolUseIdOf` reads from the call's `_meta`; `input` may arrive
// paused, holding bytes sent before the server existed.
export function serveMcp(
  streams: { input: Readable; output: Writable },
  session: ToolSession,
  tools: LiveTools,
  options: McpServeOptions,
): { close(): Promise<void> } {
  const server = new Server(
    { name: options.serverName, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: true } } },
  );
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
      ...(await callTool(
        session,
        name,
        args,
        meta ?? null,
        options,
        ctx.mcpReq.signal,
      )),
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
