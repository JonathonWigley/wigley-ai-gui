import { describe, expect, it } from 'vitest';
import { rowPromptActions, samePromptActions } from './row-prompt';

const none = () => {};

describe('rowPromptActions', () => {
  it.each([
    {
      actions: { open: none, edit: none, reset: none },
      expected: [
        { command: 'settings.edit', label: 'edit' },
        { command: 'settings.reset', label: 'reset' },
      ],
    },
    {
      actions: {
        open: none,
        edit: none,
        addBind: none,
        removeBind: none,
        reset: none,
      },
      expected: [
        { command: 'settings.open', label: 'reassign' },
        { command: 'settings.addBind', label: 'add key' },
        { command: 'settings.removeBind', label: 'clear' },
        { command: 'settings.reset', label: 'reset' },
      ],
    },
    { actions: {}, expected: [] },
    {
      actions: { open: none, edit: none },
      expected: [{ command: 'settings.edit', label: 'edit' }],
    },
  ])(
    'rowPromptActions of a row with $actions shows $expected',
    ({ actions, expected }) => {
      expect(rowPromptActions(actions)).toEqual(expected);
    },
  );
});

describe('samePromptActions', () => {
  const reset = { command: 'settings.reset', label: 'reset' };
  const edit = { command: 'settings.edit', label: 'edit' };

  it.each([
    { case: 'the same list', drawn: [edit, reset], next: [edit, reset], same: true },
    { case: 'both empty', drawn: [], next: [], same: true },
    { case: 'a shorter list', drawn: [edit, reset], next: [edit], same: false },
    { case: 'another order', drawn: [edit, reset], next: [reset, edit], same: false },
    {
      case: 'another label',
      drawn: [reset],
      next: [{ ...reset, label: 'clear' }],
      same: false,
    },
  ])('samePromptActions of $case is $same', ({ drawn, next, same }) => {
    expect(samePromptActions(drawn, next)).toBe(same);
  });
});
