import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { sessionStashPagePart } from './start';

const CONTEXT = {} as PageCommandContext;

// Session-stash's page part over a sessions fake that shows `s1` and closes any
// session, a main that answers every invoke, and a row for `s1` published.
function startStash() {
  installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  const sessions = fakeDependency(
    sessionsPageKey,
    () =>
      ({
        shownSessionId: () => 's1',
        closeSession: () => Promise.resolve(true),
      }) as unknown as SessionsPageExports,
  );
  const harness = startPagePart(sessionStashPagePart, {
    dependencies: [sessions],
    invoke: () => Promise.resolve(undefined),
  });
  harness.state.publish(sessionsRowsSlot).set('s1', sessionRow('s1'));
  return harness;
}

describe('sessionStashPagePart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { state: 'fresh start', commands: [], expected: null },
    {
      state: 'note dialog open',
      commands: ['stash'] as const,
      expected: 'Stash or cancel the open stash note first',
    },
    {
      state: 'note dialog cancelled',
      commands: ['stash', 'noteCancel'] as const,
      expected: null,
    },
  ])(
    'refuses a switch-off only while the note dialog is open ($state)',
    async ({ commands, expected }) => {
      const harness = startStash();
      for (const command of commands) {
        harness.started().commands[command](CONTEXT);
      }

      expect(harness.started().mayStop?.()).toBe(expected);
      await harness.stop();
    },
  );
});
