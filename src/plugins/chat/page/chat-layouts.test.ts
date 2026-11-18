import { describe, expect, it } from 'vitest';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { isActivityInTranscript, pickEntry } from './chat-layouts';

const builder = () => ({ element: {} as HTMLElement });

describe('chat layouts', () => {
  it.each([
    {
      case: 'user sets true',
      user: 'mine',
      mine: { activityInTranscript: true },
      expected: true,
    },
    {
      case: 'user sets false',
      user: 'mine',
      mine: { activityInTranscript: false },
      expected: false,
    },
    { case: 'user leaves it out', user: 'mine', mine: {}, expected: false },
    {
      case: 'user not loaded',
      user: 'missing',
      mine: { activityInTranscript: true },
      expected: false,
    },
  ] as { case: string; user: string; mine: ChatLayout; expected: boolean }[])(
    'isActivityInTranscript ($case)',
    ({ user, mine, expected }) => {
      const layouts = new Map<string, ChatLayout>([
        ['default', defaultLayout],
        ['mine', mine],
      ]);

      expect(isActivityInTranscript({ layouts, user })).toBe(expected);
    },
  );

  it.each([
    {
      case: 'names it',
      mine: { entries: { 'fake:card': builder } },
      expected: 'mine',
    },
    { case: 'leaves it out', mine: { entries: {} }, expected: 'default' },
  ] as { case: string; mine: ChatLayout; expected: string }[])(
    'pickEntry_HarnessKindTheUserNames_PicksTheUserLayout ($case)',
    ({ mine, expected }) => {
      const layouts = new Map<string, ChatLayout>([
        ['default', defaultLayout],
        ['mine', mine],
      ]);

      expect(pickEntry({ layouts, user: 'mine' }, 'fake:card').name).toBe(
        expected,
      );
    },
  );
});
