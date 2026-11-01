import { describe, expect, it } from 'vitest';
import { readUsageLayout } from './read-usage-layout';

const part = () => null;

describe('readUsageLayout', () => {
  it.each([
    { module: {}, error: 'default export' },
    { module: { default: { footer: part } }, error: 'footer' },
    { module: { default: { statusLine: 3 } }, error: 'statusLine' },
    { module: { default: { details: part } }, error: null },
  ])(
    'readUsageLayout_Shapes_AcceptsOrNamesTheFirstBadKey $error',
    ({ module, error }) => {
      const read = () => readUsageLayout(module, 'x');

      if (error === null) {
        expect(read().details).toBe(part);
      } else {
        expect(read).toThrow(error);
      }
    },
  );
});
