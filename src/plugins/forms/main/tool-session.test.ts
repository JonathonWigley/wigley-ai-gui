import { describe, expect, it } from 'vitest';
import type { ToolCallContext } from '../../sessions/contract';
import type { AnswersPayload, FormsSession } from '../contract';
import { RoundError } from './round-error';
import { createFormsToolSession } from './tool-session';

const PAYLOAD: AnswersPayload = {
  outcome: 'submitted',
  summary: '1 of 1 answered.',
  next: 'Act on the answers.',
  answers: [],
  findings: [],
  notices: [],
};

interface AskCall {
  args: unknown;
  toolUseId: string | null;
  signal: AbortSignal;
}

function fakeSession(
  ask: (call: AskCall) => Promise<AnswersPayload> = async () => PAYLOAD,
) {
  const asks: AskCall[] = [];
  const collects: boolean[] = [];
  let ends = 0;
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
    end: () => {
      ends++;
    },
  };
  return { session, asks, collects, ends: () => ends };
}

function context(toolUseId: string | null = null): ToolCallContext {
  return { toolUseId, signal: new AbortController().signal };
}

describe('createFormsToolSession', () => {
  it('sends ask_round to the forms session with its arguments, tool-use id and signal', async () => {
    const { session, asks } = fakeSession();
    const callContext = context('toolu_01');

    const result = await createFormsToolSession(session).call(
      'ask_round',
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

  it('passes empty arguments when ask_round has none', async () => {
    const { session, asks } = fakeSession();

    await createFormsToolSession(session).call(
      'ask_round',
      undefined,
      context(),
    );

    expect(asks[0].args).toEqual({});
  });

  it('collects with wait true unless the call sends wait false', async () => {
    const { session, collects } = fakeSession();
    const toolSession = createFormsToolSession(session);

    await toolSession.call('collect_last_round', {}, context());
    await toolSession.call('collect_last_round', { wait: false }, context());
    await toolSession.call('collect_last_round', undefined, context());

    expect(collects).toEqual([true, false, true]);
  });

  it('returns a RoundError as an error result carrying its message alone', async () => {
    const { session } = fakeSession(async () => {
      throw new RoundError('questions must hold at most 20 items');
    });

    const result = await createFormsToolSession(session).call(
      'ask_round',
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
      createFormsToolSession(session).call('ask_round', {}, context()),
    ).rejects.toBe(error);
  });

  it('rejects a tool forms does not have', async () => {
    const { session } = fakeSession();

    await expect(
      createFormsToolSession(session).call('ask', {}, context()),
    ).rejects.toThrow('forms has no tool "ask"');
  });

  it('ends the forms session', () => {
    const { session, ends } = fakeSession();

    createFormsToolSession(session).end();

    expect(ends()).toBe(1);
  });
});
