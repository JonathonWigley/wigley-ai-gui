import { describe, expect, it } from 'vitest';
import { readVisualLayout } from './read-visual-layout';

const part = () => null;

describe('readVisualLayout', () => {
  it.each([
    { module: {}, part: null, error: 'default export' },
    { module: { default: { footer: part } }, part: null, error: 'footer' },
    { module: { default: { visual: 3 } }, part: null, error: 'visual' },
    { module: { default: { card: part } }, part: 'card', error: null },
    { module: { default: { overlay: part } }, part: 'overlay', error: null },
  ] as const)(
    'readVisualLayout_Shapes_AcceptsOrNamesTheFirstBadKey $error $part',
    (row) => {
      const read = () => readVisualLayout(row.module, 'x');

      if (row.part === null) {
        expect(read).toThrow(row.error);
      } else {
        expect(read()[row.part]).toBe(part);
      }
    },
  );
});
