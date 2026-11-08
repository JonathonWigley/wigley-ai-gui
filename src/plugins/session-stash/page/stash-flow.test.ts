import { describe, expect, it } from 'vitest';
import type { ToastTone } from '../../../contracts/plugin';
import { REFUSED_TOAST, stashSession } from './stash-flow';

// Flow deps whose ask answers `kept` (or rejects when it is an Error) and
// whose close answers `closed`, recording every call in order.
function flowSetup(kept: boolean | Error, closed: boolean) {
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
    },
    closeSession: async (sessionId: string) => {
      calls.push(`close ${sessionId}`);
      return closed;
    },
    log: (message: string) => {
      logged.push(message);
    },
    toast: (text: string, tone: ToastTone) => {
      toasts.push([text, tone]);
    },
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
});
