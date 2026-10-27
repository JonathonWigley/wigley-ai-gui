import { describe, expect, it } from 'vitest';
import { rowPromptActions } from './row-prompt';

const none = () => {};

describe('rowPromptActions', () => {
  it.each([
    {
      actions: { open: none, edit: none, reset: none },
      expected: ['edit', 'reset'],
    },
    {
      actions: {
        open: none,
        edit: none,
        addBind: none,
        removeBind: none,
        reset: none,
      },
      expected: ['addBind', 'removeBind', 'reset'],
    },
    { actions: {}, expected: [] },
    { actions: { open: none, edit: none }, expected: ['edit'] },
  ])(
    'rowPromptActions of a row with $actions shows $expected',
    ({ actions, expected }) => {
      expect(rowPromptActions(actions)).toEqual(expected);
    },
  );
});
