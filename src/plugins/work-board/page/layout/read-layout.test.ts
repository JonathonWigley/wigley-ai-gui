import { describe, expect, it } from 'vitest';
import { readBoardLayout } from './read-layout';

const card = () => ({}) as HTMLElement;

describe('readBoardLayout', () => {
  it.each([
    { case: 'no default export', module: {}, throws: 'default export' },
    {
      case: 'a key that is no part',
      module: { default: { cards: {} } },
      throws: 'cards is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { card: 1 } },
      throws: 'card is not a function',
    },
    {
      case: 'one card part',
      module: { default: { card } },
      throws: null,
    },
  ])('reads $case', ({ module, throws }) => {
    if (throws === null) {
      expect(readBoardLayout(module, 'mine').card).toBe(card);
    } else {
      expect(() => readBoardLayout(module, 'mine')).toThrow(throws);
    }
  });
});
