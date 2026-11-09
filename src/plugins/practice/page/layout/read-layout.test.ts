import { describe, expect, it } from 'vitest';
import { readPracticeLayout } from './read-layout';

const problemRow = () => ({}) as HTMLElement;

describe('readPracticeLayout', () => {
  it.each([
    { case: 'no default export', module: {}, throws: 'default export' },
    {
      case: 'a key that is no part',
      module: { default: { cards: {} } },
      throws: 'cards is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { problemRow: 1 } },
      throws: 'problemRow is not a function',
    },
    {
      case: 'one row part',
      module: { default: { problemRow } },
      throws: null,
    },
  ])('reads $case', ({ module, throws }) => {
    if (throws === null) {
      expect(readPracticeLayout(module, 'mine').problemRow).toBe(problemRow);
    } else {
      expect(() => readPracticeLayout(module, 'mine')).toThrow(throws);
    }
  });
});
