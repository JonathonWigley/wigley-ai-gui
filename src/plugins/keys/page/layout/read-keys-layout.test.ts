import { describe, expect, it } from 'vitest';
import { readKeysLayout } from './read-keys-layout';

const part = () => null;

describe('readKeysLayout', () => {
  it.each([
    { module: {}, error: 'default export' },
    { module: { default: { footer: part } }, error: 'footer' },
    { module: { default: { helpRow: 3 } }, error: 'helpRow' },
    { module: { default: { whichKeyEntry: part } }, error: null },
  ])(
    'readKeysLayout_Shapes_AcceptsOrNamesTheFirstBadKey $error',
    ({ module, error }) => {
      const read = () => readKeysLayout(module, 'x');

      if (error === null) {
        expect(read().whichKeyEntry).toBe(part);
      } else {
        expect(read).toThrow(error);
      }
    },
  );
});
