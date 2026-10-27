import { describe, expect, it } from 'vitest';
import { readDocsLayout } from './read-layout';

const part = () => ({ element: null });

describe('readDocsLayout', () => {
  it.each([
    { layout: {}, error: null },
    { layout: { treeRow: part, confirmDialog: part }, error: null },
    { layout: { rows: part }, error: 'layout x: rows is not a layout part' },
    { layout: { treeRow: 1 }, error: 'layout x: treeRow is not a function' },
  ])(
    'readDocsLayout_AcceptsPartsAndRejectsTheFirstBadKey $error',
    ({ layout, error }) => {
      const read = () => readDocsLayout({ default: layout }, 'x');

      if (error === null) {
        expect(read()).toBe(layout);
      } else {
        expect(read).toThrow(error);
      }
    },
  );
});
