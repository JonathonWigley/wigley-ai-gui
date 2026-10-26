import { describe, expect, it } from 'vitest';
import type {
  AgentFormSession,
  AgentFormToolSession,
} from '../../contracts/agent-forms';
import { TEST_FORM_ERROR_NAME, type TestPayload } from './test-form-type';
import { createAgentFormToolSession } from './tool-session';

const PAYLOAD: TestPayload = {
  outcome: 'submitted',
  heading: 'Pick a theme',
  note: 'dark',
};

const TOOLS = { open: 'open_form', collect: 'collect_last_form' };

function toolSessionOver(
  session: AgentFormSession<TestPayload>,
): AgentFormToolSession {
  return createAgentFormToolSession(session, TOOLS, TEST_FORM_ERROR_NAME);
}

function testFormError(message: string): Error {
  const error = new Error(message);
  error.name = TEST_FORM_ERROR_NAME;
  return error;
}

interface AskCall {
  args: unknown;
  toolUseId: string | null;
  signal: AbortSignal;
}

function fakeSession(
  ask: (call: AskCall) => Promise<TestPayload> = async () => PAYLOAD,
) {
  const asks: AskCall[] = [];
  const collects: boolean[] = [];
  let ends = 0;
  const session: AgentFormSession<TestPayload> = {
    open: (args, toolUseId, signal) => {
      const call = { args, toolUseId, signal };
      asks.push(call);
      return ask(call);
    },
    collect: async (wait) => {
      collects.push(wait);
      return PAYLOAD;
    },
    end: () => {
      ends++;
    },
  };
  return { session, asks, collects, ends: () => ends };
}

function context(toolUseId: string | null = null): {
  toolUseId: string | null;
  signal: AbortSignal;
} {
  return { toolUseId, signal: new AbortController().signal };
}

describe('createAgentFormToolSession', () => {
  it('sends the open tool to the form session with its arguments, tool-use id and signal', async () => {
    const { session, asks } = fakeSession();
    const callContext = context('toolu_01');

    const result = await toolSessionOver(session).call(
      'open_form',
      { heading: 'Pick a theme' },
      callContext,
    );

    expect(asks).toEqual([
      {
        args: { heading: 'Pick a theme' },
        toolUseId: 'toolu_01',
        signal: callContext.signal,
      },
    ]);
    expect(asks[0].signal).toBe(callContext.signal);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(PAYLOAD, null, 2) },
    ]);
    expect(result.structuredContent).toEqual(PAYLOAD);
  });

  it('passes empty arguments when the open tool has none', async () => {
    const { session, asks } = fakeSession();

    await toolSessionOver(session).call('open_form', undefined, context());

    expect(asks[0].args).toEqual({});
  });

  it('collects with wait true unless the call sends wait false', async () => {
    const { session, collects } = fakeSession();
    const toolSession = toolSessionOver(session);

    await toolSession.call('collect_last_form', {}, context());
    await toolSession.call('collect_last_form', { wait: false }, context());
    await toolSession.call('collect_last_form', undefined, context());

    expect(collects).toEqual([true, false, true]);
  });

  it('returns the args error as an error result carrying its message alone', async () => {
    const { session } = fakeSession(async () => {
      throw testFormError('questions must hold at most 20 items');
    });

    const result = await toolSessionOver(session).call(
      'open_form',
      {},
      context(),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'questions must hold at most 20 items' }],
      isError: true,
    });
  });

  it('lets any other error out', async () => {
    const error = new TypeError('body is not an object');
    const { session } = fakeSession(async () => {
      throw error;
    });

    await expect(
      toolSessionOver(session).call('open_form', {}, context()),
    ).rejects.toBe(error);
  });

  it('rejects a tool the session does not have', async () => {
    const { session } = fakeSession();

    await expect(
      toolSessionOver(session).call('ask', {}, context()),
    ).rejects.toThrow('no agent form tool "ask"');
  });

  it('ends the form session', () => {
    const { session, ends } = fakeSession();

    toolSessionOver(session).end();

    expect(ends()).toBe(1);
  });
});
