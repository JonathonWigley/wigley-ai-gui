import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListeners } from '../../../../shared/listeners';
import type {
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../../contract';
import { type LiveTools, serveMcp } from './mcp-server';

interface RpcResponse {
  id?: number;
  method?: string;
  result?: {
    capabilities?: unknown;
    tools?: ToolDefinition[];
    content?: { type: string; text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

interface ToolCall {
  name: string;
  args: unknown;
  context: ToolCallContext;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'ask_round',
    description: 'Ask a round.',
    inputSchema: {
      type: 'object',
      properties: { heading: { type: 'string' } },
    },
  },
  {
    name: 'collect_last_round',
    description: 'Collect the last round.',
    inputSchema: { type: 'object' },
  },
];

const DONE: ToolResult = {
  content: [{ type: 'text', text: 'done' }],
  structuredContent: { ok: true },
};

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-host', version: '0' },
  },
};

const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

function fakeSession(
  answer: (call: ToolCall) => Promise<ToolResult> = async () => DONE,
) {
  const calls: ToolCall[] = [];
  const session: ToolSession = {
    call: (name, args, context) => {
      const call = { name, args, context };
      calls.push(call);
      return answer(call);
    },
    end: () => {},
  };
  return { session, calls };
}

// A live list holding `TOOLS` until `change`, counting its live listeners.
function fakeLiveTools() {
  let tools = TOOLS;
  let listenerCount = 0;
  const listeners = createListeners<void>();
  const live: LiveTools = {
    tools: () => tools,
    onToolsChanged(listener) {
      listenerCount++;
      const added = listeners.add(listener);
      return {
        dispose() {
          listenerCount--;
          added.dispose();
        },
      };
    },
  };
  return {
    live,
    change(next: ToolDefinition[]) {
      tools = next;
      listeners.tell();
    },
    listenerCount: () => listenerCount,
  };
}

const servers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

// `before` is written to a paused input ahead of the server, as the relay
// hands over a socket holding bytes sent with the hello.
function connect(session: ToolSession, before: object[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  const answered = new Map<number, (response: RpcResponse) => void>();
  const notified: string[] = [];
  createInterface({ input: output }).on('line', (line) => {
    const response = JSON.parse(line) as RpcResponse;
    if (response.method !== undefined) {
      notified.push(response.method);
    }
    if (response.id !== undefined) {
      answered.get(response.id)?.(response);
    }
  });
  const send = (message: object) => input.write(`${JSON.stringify(message)}\n`);
  const response = (id: number) =>
    new Promise<RpcResponse>((resolve) => answered.set(id, resolve));
  if (before.length > 0) {
    input.pause();
    before.forEach(send);
  }
  const liveTools = fakeLiveTools();
  const server = serveMcp({ input, output }, session, liveTools.live);
  servers.push(server);
  return { send, response, notified, liveTools, server };
}

async function initialized(client: ReturnType<typeof connect>) {
  const reply = client.response(1);
  client.send(INITIALIZE);
  await reply;
  client.send(INITIALIZED);
}

function listTools(
  client: ReturnType<typeof connect>,
  id: number,
): Promise<RpcResponse> {
  const reply = client.response(id);
  client.send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
  return reply;
}

function callTool(
  client: ReturnType<typeof connect>,
  id: number,
  params: object,
): Promise<RpcResponse> {
  const reply = client.response(id);
  client.send({ jsonrpc: '2.0', id, method: 'tools/call', params });
  return reply;
}

describe('serveMcp', () => {
  it('lists the tools the live list holds', async () => {
    const client = connect(fakeSession().session);
    await initialized(client);

    expect((await listTools(client, 2)).result?.tools).toEqual(TOOLS);
  });

  it('advertises tools.listChanged when the client initializes', async () => {
    const client = connect(fakeSession().session);
    const reply = client.response(1);
    client.send(INITIALIZE);

    expect((await reply).result?.capabilities).toEqual({
      tools: { listChanged: true },
    });
  });

  it('notifies the client when the live list changes and lists the new tools', async () => {
    const client = connect(fakeSession().session);
    await initialized(client);

    client.liveTools.change([TOOLS[1]]);

    await vi.waitFor(() =>
      expect(client.notified).toEqual(['notifications/tools/list_changed']),
    );
    expect((await listTools(client, 2)).result?.tools).toEqual([TOOLS[1]]);
  });

  it('stops listening to the live list once closed', async () => {
    const client = connect(fakeSession().session);
    await initialized(client);
    expect(client.liveTools.listenerCount()).toBe(1);

    await client.server.close();

    expect(client.liveTools.listenerCount()).toBe(0);
  });

  it('calls the session with the tool name, arguments and tool-use id', async () => {
    const { session, calls } = fakeSession();
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, {
      name: 'ask_round',
      arguments: { heading: 'Pick a theme' },
      _meta: { 'claudecode/toolUseId': 'toolu_01' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('ask_round');
    expect(calls[0].args).toEqual({ heading: 'Pick a theme' });
    expect(calls[0].context.toolUseId).toBe('toolu_01');
    expect(reply.result).toEqual(DONE);
  });

  it('passes a null tool-use id when the host sends none', async () => {
    const { session, calls } = fakeSession();
    const client = connect(session);
    await initialized(client);

    await callTool(client, 2, { name: 'ask_round', arguments: {} });

    expect(calls[0].context.toolUseId).toBeNull();
  });

  it('passes an error result from the session through unchanged', async () => {
    const failed: ToolResult = {
      content: [{ type: 'text', text: 'bad round' }],
      isError: true,
    };
    const { session } = fakeSession(async () => failed);
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, {
      name: 'ask_round',
      arguments: {},
    });

    expect(reply.result).toEqual(failed);
  });

  it('returns a thrown error as a tool error naming its type', async () => {
    const { session } = fakeSession(async () => {
      throw new TypeError('body is not an object');
    });
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, {
      name: 'ask_round',
      arguments: {},
    });

    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content).toEqual([
      { type: 'text', text: expect.stringContaining('TypeError') },
    ]);
  });

  it('hands a call for any tool name to the session', async () => {
    const { session, calls } = fakeSession();
    const client = connect(session);
    await initialized(client);

    await callTool(client, 2, { name: 'ask', arguments: {} });

    expect(calls[0].name).toBe('ask');
  });

  it('answers a call the session rejects as unknown with the error text', async () => {
    const { session } = fakeSession(() =>
      Promise.reject(new Error('Unknown tool: x. Valid tools are .')),
    );
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, { name: 'x', arguments: {} });

    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content).toEqual([
      { type: 'text', text: 'Error: Unknown tool: x. Valid tools are .' },
    ]);
  });

  it('aborts the session call when the host cancels the request', async () => {
    const { session, calls } = fakeSession(() => new Promise(() => {}));
    const client = connect(session);
    await initialized(client);

    client.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'ask_round', arguments: {} },
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    client.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2, reason: 'the user stopped the call' },
    });

    await vi.waitFor(() => expect(calls[0].context.signal.aborted).toBe(true));
  });

  it('reads messages written to a paused input before it connected', async () => {
    const client = connect(fakeSession().session, [
      INITIALIZE,
      INITIALIZED,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    const reply = await client.response(2);

    expect(reply.result?.tools?.map((tool) => tool.name)).toEqual([
      'ask_round',
      'collect_last_round',
    ]);
  });
});
