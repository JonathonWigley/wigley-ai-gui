import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnswersPayload,
  type FormsSession,
  ROUND_ERROR_NAME,
  type ToolDefinition,
} from '../../contracts/forms';
import { serveMcp } from './mcp-server';

// Stands in for src/main/forms' RoundError, which this layer may not import;
// the adapter knows it by its contract name.
class RoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = ROUND_ERROR_NAME;
  }
}

interface RpcResponse {
  id: number;
  result?: {
    tools?: ToolDefinition[];
    content?: { type: string; text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

interface AskCall {
  args: unknown;
  toolUseId: string | null;
  signal: AbortSignal;
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

const PAYLOAD: AnswersPayload = {
  outcome: 'submitted',
  summary: '1 of 1 answered.',
  next: 'Act on the answers.',
  answers: [],
  notices: [],
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
  ask: (call: AskCall) => Promise<AnswersPayload> = async () => PAYLOAD,
) {
  const asks: AskCall[] = [];
  const collects: boolean[] = [];
  const session: FormsSession = {
    askRound: (args, toolUseId, signal) => {
      const call = { args, toolUseId, signal };
      asks.push(call);
      return ask(call);
    },
    collectLastRound: async (wait) => {
      collects.push(wait);
      return PAYLOAD;
    },
    end: () => {},
  };
  return { session, asks, collects };
}

const servers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

// `before` is written to a paused input ahead of the server, as the relay
// hands over a socket holding bytes sent with the hello.
function connect(session: FormsSession, before: object[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  const answered = new Map<number, (response: RpcResponse) => void>();
  createInterface({ input: output }).on('line', (line) => {
    const response = JSON.parse(line) as RpcResponse;
    answered.get(response.id)?.(response);
  });
  const send = (message: object) => input.write(`${JSON.stringify(message)}\n`);
  const response = (id: number) =>
    new Promise<RpcResponse>((resolve) => answered.set(id, resolve));
  if (before.length > 0) {
    input.pause();
    before.forEach(send);
  }
  servers.push(serveMcp({ input, output }, session, TOOLS));
  return { send, response };
}

async function initialized(client: ReturnType<typeof connect>) {
  const reply = client.response(1);
  client.send(INITIALIZE);
  await reply;
  client.send(INITIALIZED);
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
  it('lists the tools it was given', async () => {
    const client = connect(fakeSession().session);
    await initialized(client);
    const reply = client.response(2);
    client.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect((await reply).result?.tools).toEqual(TOOLS);
  });

  it('sends ask_round to the session with its arguments and tool-use id', async () => {
    const { session, asks } = fakeSession();
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, {
      name: 'ask_round',
      arguments: { heading: 'Pick a theme' },
      _meta: { 'claudecode/toolUseId': 'toolu_01' },
    });

    expect(asks).toHaveLength(1);
    expect(asks[0].args).toEqual({ heading: 'Pick a theme' });
    expect(asks[0].toolUseId).toBe('toolu_01');
    expect(reply.result?.structuredContent).toEqual(PAYLOAD);
    expect(reply.result?.content).toEqual([
      { type: 'text', text: JSON.stringify(PAYLOAD, null, 2) },
    ]);
  });

  it('passes a null tool-use id when the host sends none', async () => {
    const { session, asks } = fakeSession();
    const client = connect(session);
    await initialized(client);

    await callTool(client, 2, { name: 'ask_round', arguments: {} });

    expect(asks[0].toolUseId).toBeNull();
  });

  it('returns a RoundError as a tool error carrying its message alone', async () => {
    const { session } = fakeSession(async () => {
      throw new RoundError('questions must hold at most 20 items');
    });
    const client = connect(session);
    await initialized(client);

    const reply = await callTool(client, 2, {
      name: 'ask_round',
      arguments: {},
    });

    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content).toEqual([
      { type: 'text', text: 'questions must hold at most 20 items' },
    ]);
  });

  it('returns any other error as a tool error naming its type', async () => {
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
    expect(reply.result?.content?.[0].text).toBe(
      'TypeError: body is not an object',
    );
  });

  it('collects with wait true unless the host sends wait false', async () => {
    const { session, collects } = fakeSession();
    const client = connect(session);
    await initialized(client);

    await callTool(client, 2, { name: 'collect_last_round', arguments: {} });
    await callTool(client, 3, {
      name: 'collect_last_round',
      arguments: { wait: false },
    });
    const reply = await callTool(client, 4, { name: 'collect_last_round' });

    expect(collects).toEqual([true, false, true]);
    expect(reply.result?.structuredContent).toEqual(PAYLOAD);
  });

  it('answers an unknown tool with a tool error naming the valid tools', async () => {
    const client = connect(fakeSession().session);
    await initialized(client);

    const reply = await callTool(client, 2, { name: 'ask', arguments: {} });

    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content?.[0].text).toBe(
      'Unknown tool: ask. Valid tools are ask_round, collect_last_round.',
    );
  });

  it('aborts the session call when the host cancels the request', async () => {
    const { session, asks } = fakeSession(() => new Promise(() => {}));
    const client = connect(session);
    await initialized(client);

    client.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'ask_round', arguments: {} },
    });
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    client.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2, reason: 'the user stopped the call' },
    });

    await vi.waitFor(() => expect(asks[0].signal.aborted).toBe(true));
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
