import { describe, expect, it } from 'vitest';
import { readInboxLayout } from './read-layout';

const card = () => ({}) as HTMLElement;

describe('readInboxLayout', () => {
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
      expect(readInboxLayout(module, 'mine').card).toBe(card);
    } else {
      expect(() => readInboxLayout(module, 'mine')).toThrow(throws);
    }
  });
});
