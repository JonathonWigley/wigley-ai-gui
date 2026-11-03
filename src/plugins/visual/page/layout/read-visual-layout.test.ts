import { describe, expect, it } from 'vitest';
import { readVisualLayout } from './read-visual-layout';

const part = () => null;

describe('readVisualLayout', () => {
  it.each([
    { module: {}, error: 'default export' },
    { module: { default: { footer: part } }, error: 'footer' },
    { module: { default: { visual: 3 } }, error: 'visual' },
    { module: { default: { card: part } }, error: null },
  ])(
    'readVisualLayout_Shapes_AcceptsOrNamesTheFirstBadKey $error',
    ({ module, error }) => {
      const read = () => readVisualLayout(module, 'x');

      if (error === null) {
        expect(read().card).toBe(part);
      } else {
        expect(read).toThrow(error);
      }
    },
  );
});
