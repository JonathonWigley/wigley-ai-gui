import { describe, expect, it } from 'vitest';
import { readBacklogLayout } from './read-layout';

const tableRow = () => ({}) as HTMLElement;

describe('readBacklogLayout', () => {
  it.each([
    { case: 'no default export', module: {}, throws: 'default export' },
    {
      case: 'a key that is no part',
      module: { default: { cards: {} } },
      throws: 'cards is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { tableRow: 1 } },
      throws: 'tableRow is not a function',
    },
    {
      case: 'one row part',
      module: { default: { tableRow } },
      throws: null,
    },
  ])('reads $case', ({ module, throws }) => {
    if (throws === null) {
      expect(readBacklogLayout(module, 'mine').tableRow).toBe(tableRow);
    } else {
      expect(() => readBacklogLayout(module, 'mine')).toThrow(throws);
    }
  });
});
