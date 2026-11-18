import { describe, expect, it } from 'vitest';
import type { ToastTone } from '../../../contracts/plugin';
import { REFUSED_TOAST, stashSession } from './stash-flow';

// Flow deps whose ask answers `kept` (or rejects when it is an Error), whose
// close answers `closed` (once `closing` resolves, when handed in) and whose
// drop rejects with `dropFailure` when one is handed in, recording every call
// in order.
function flowSetup(
  kept: boolean | Error,
  closed: boolean,
  options: {
    closing?: Promise<void>;
    dropFailure?: Error;
    isStopped?: () => boolean;
  } = {},
) {
  const calls: string[] = [];
  const logged: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const deps = {
    ask: async () => {
      calls.push('ask');
      if (kept instanceof Error) {
        throw kept;
      }
      return kept;
    },
    drop: async (sessionId: string) => {
      calls.push(`drop ${sessionId}`);
      if (options.dropFailure !== undefined) {
        throw options.dropFailure;
      }
    },
    closeSession: async (sessionId: string) => {
      calls.push(`close ${sessionId}`);
      await options.closing;
      return closed;
    },
    log: (message: string) => {
      logged.push(message);
    },
    toast: (text: string, tone: ToastTone) => {
      toasts.push([text, tone]);
    },
    isStopped: options.isStopped ?? (() => false),
  };
  return { deps, calls, logged, toasts };
}

describe('stashSession', () => {
  it.each([
    {
      case: 'the row closes',
      kept: true,
      closed: true,
      calls: ['ask', 'close s1'],
      logged: [],
      toasts: [],
    },
    {
      case: 'the close is kept (confirm declined or a guard refused)',
      kept: true,
      closed: false,
      calls: ['ask', 'close s1', 'drop s1'],
      logged: ['stash dropped: gamma stayed open'],
      toasts: [],
    },
    {
      case: 'main refuses a session the app did not start',
      kept: false,
      closed: true,
      calls: ['ask'],
      logged: ['stash refused: gamma was not started in the app'],
      toasts: [[REFUSED_TOAST, 'error']],
    },
    {
      case: 'the ask fails',
      kept: new Error('main gone'),
      closed: true,
      calls: ['ask'],
      logged: ['stash not asked: main gone'],
      toasts: [],
    },
  ])('stashSession_EachOutcome_ClosesOrDropsOnce ($case)', async (test) => {
    const { deps, calls, logged, toasts } = flowSetup(test.kept, test.closed);

    await stashSession(deps, { sessionId: 's1', note: 'n' }, 'gamma');

    expect(calls).toEqual(test.calls);
    expect(logged).toEqual(test.logged);
    expect(toasts).toEqual(test.toasts);
  });

  // Breaks: a call that lands after the page stops logging, toasting or
  // asking main again.
  it.each([
    {
      case: 'the ask answers kept',
      kept: true,
      closed: true,
      calls: ['ask'],
    },
    {
      case: 'the ask answers refused',
      kept: false,
      closed: true,
      calls: ['ask'],
    },
    {
      case: 'the ask fails',
      kept: new Error('main gone'),
      closed: true,
      calls: ['ask'],
    },
  ])(
    'does nothing more when the page stops during the ask ($case)',
    async (test) => {
      let isStopped = false;
      const { deps, calls, logged, toasts } = flowSetup(
        test.kept,
        test.closed,
        {
          isStopped: () => isStopped,
        },
      );
      const asking = deps.ask;
      deps.ask = async () => {
        try {
          return await asking();
        } finally {
          isStopped = true;
        }
      };

      await stashSession(deps, { sessionId: 's1', note: 'n' }, 'gamma');

      expect({ calls, logged, toasts }).toEqual({
        calls: test.calls,
        logged: [],
        toasts: [],
      });
    },
  );

  it('drops and logs nothing when the page stops during the close', async () => {
    let isStopped = false;
    const { deps, calls, logged } = flowSetup(true, false, {
      isStopped: () => isStopped,
    });
    const closing = deps.closeSession;
    deps.closeSession = async (sessionId) => {
      const closed = await closing(sessionId);
      isStopped = true;
      return closed;
    };

    await stashSession(deps, { sessionId: 's1', note: 'n' }, 'gamma');

    expect(calls).toEqual(['ask', 'close s1']);
    expect(logged).toEqual([]);
  });

  it('stashSession_DropFails_LogsTheDrop', async () => {
    const { deps, calls, logged } = flowSetup(true, false, {
      dropFailure: new Error('main gone'),
    });

    await stashSession(deps, { sessionId: 's1', note: 'n' }, 'gamma');

    expect(calls).toEqual(['ask', 'close s1', 'drop s1']);
    expect(logged).toEqual(['stash drop not sent for gamma: main gone']);
  });

  it('stashSession_CloseWaitsOnAPrompt_DropsNothingWhileItWaits', async () => {
    let answerPrompt: () => void = () => undefined;
    const closing = new Promise<void>((resolve) => {
      answerPrompt = resolve;
    });
    const { deps, calls } = flowSetup(true, true, { closing });

    const stashing = stashSession(
      deps,
      { sessionId: 's1', note: 'n' },
      'gamma',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['ask', 'close s1']);
    answerPrompt();
    await stashing;

    expect(calls).toEqual(['ask', 'close s1']);
  });
});
