import type { Readable, Writable } from 'node:stream';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  type AnswersPayload,
  type FormsSession,
  ROUND_ERROR_NAME,
  type ToolDefinition,
} from '../../contract';

// The `_meta` key Claude Code sends a tools/call's calling tool_use id under.
const TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

const SERVER_INFO = { name: 'wigley-forms', version: '1.0.0' };

// A type alias, not an interface: the SDK's result type has a string index signature.
type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function payloadResult(payload: AnswersPayload): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: { ...payload },
  };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function sessionErrorText(error: Error): string {
  return error.name === ROUND_ERROR_NAME
    ? error.message
    : `${error.name}: ${error.message}`;
}

function toolUseId(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.[TOOL_USE_ID_META_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

// Only an explicit `wait: false` returns the draft at once.
function waitArgument(args: unknown): boolean {
  return (args as { wait?: unknown } | undefined)?.wait !== false;
}

async function callTool(
  session: FormsSession,
  toolNames: string[],
  name: string,
  args: unknown,
  meta: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (name === 'ask_round') {
    return payloadResult(
      await session.askRound(args ?? {}, toolUseId(meta), signal),
    );
  }
  if (name === 'collect_last_round') {
    return payloadResult(
      await session.collectLastRound(waitArgument(args), signal),
    );
  }
  return errorResult(
    `Unknown tool: ${name}. Valid tools are ${toolNames.join(', ')}.`,
  );
}

// One MCP server for one connection; `input` may arrive paused, holding bytes
// sent before the server existed.
export function serveMcp(
  streams: { input: Readable; output: Writable },
  session: FormsSession,
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
    try {
      return await callTool(
        session,
        toolNames,
        name,
        args,
        meta,
        ctx.mcpReq.signal,
      );
    } catch (error) {
      if (error instanceof Error) {
        return errorResult(sessionErrorText(error));
      }
      throw error;
    }
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
