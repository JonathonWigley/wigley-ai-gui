import { describe, expect, it } from 'vitest';
import { readGalleryLayout } from './read-gallery-layout';

describe('readGalleryLayout', () => {
  it.each([
    { case: 'no default export', module: {}, names: 'default export' },
    {
      case: 'a default export that is no object',
      module: { default: 'cells' },
      names: 'default export',
    },
    {
      case: 'a key that is no layout part',
      module: { default: { blocks: () => null } },
      names: 'blocks is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { cell: {} } },
      names: 'cell is not a function',
    },
  ])('throws naming the layout and the key for $case', ({ module, names }) => {
    const read = () => readGalleryLayout(module, 'mine');

    expect(read).toThrow(/^layout mine: /);
    expect(read).toThrow(names);
  });
});
