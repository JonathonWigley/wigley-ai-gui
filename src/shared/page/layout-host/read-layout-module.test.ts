import { describe, expect, it } from 'vitest';
import { readLayoutModule } from './read-layout-module';

describe('readLayoutModule', () => {
  it.each([null, {}, { default: 3 }, { default: null }])(
    'readLayoutModule_NoObjectDefault_Throws: %j',
    (module) => {
      expect(() => readLayoutModule(module, 'mine')).toThrow(
        'layout mine: the default export is missing or not an object',
      );
    },
  );

  it('readLayoutModule_ObjectDefault_ReturnsIt', () => {
    expect(readLayoutModule({ default: { a: 1 } }, 'mine')).toEqual({ a: 1 });
  });
});
