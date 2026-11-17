import { describe, expect, it } from 'vitest';
import { readNotesLayout } from './read-notes-layout';

describe('readNotesLayout', () => {
  it.each([
    { case: 'default export missing', module: {}, names: 'default export' },
    {
      case: 'default export not an object',
      module: { default: 'x' },
      names: 'default export',
    },
    {
      case: 'a key that is no part',
      module: { default: { fields: () => null } },
      names: 'fields is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { image: 'x' } },
      names: 'image is not a function',
    },
    {
      case: 'a cursor prompt that is not a function',
      module: { default: { cursorPrompt: 'x' } },
      names: 'cursorPrompt is not a function',
    },
  ])('readNotesLayout_BadShape_ThrowsNamingIt ($case)', ({ module, names }) => {
    expect(() => readNotesLayout(module, 'mine')).toThrow(
      new RegExp(`^layout mine: .*${names}`),
    );
  });
});
