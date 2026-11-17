import { describe, expect, it } from 'vitest';
import type {
  AgentFormSession,
  AgentFormToolSession,
} from '../../contracts/agent-forms';
import {
  TEST_FORM_TYPE,
  type TestPayload,
  testFormError,
} from './test-form-type';
import { createAgentFormToolSession } from './tool-session';

const PAYLOAD: TestPayload = {
  outcome: 'submitted',
  heading: 'Pick a theme',
  note: 'dark',
};

function toolSessionOver(
  session: AgentFormSession<TestPayload>,
): AgentFormToolSession {
  return createAgentFormToolSession(session, TEST_FORM_TYPE);
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
    end: () => {},
  };
  return { session, asks, collects };
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

  it("returns the args error as an error result carrying the type's text for it", async () => {
    const { session } = fakeSession(async () => {
      throw testFormError('questions must hold at most 20 items');
    });

    const result = await toolSessionOver(session).call(
      'open_form',
      {},
      context(),
    );

    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Bad form: questions must hold at most 20 items' },
      ],
      isError: true,
    });
  });

  it('rejects with a plain Error the type has no text for', async () => {
    const error = new Error('boom');
    const { session } = fakeSession(async () => {
      throw error;
    });

    await expect(
      toolSessionOver(session).call('open_form', {}, context()),
    ).rejects.toBe(error);
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
    ).rejects.toThrow(/"ask"/);
  });
});
