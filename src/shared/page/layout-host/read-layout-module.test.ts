import { describe, expect, it } from 'vitest';
import {
  readLayoutModule,
  readLayoutParts,
  requireLayoutParts,
} from './read-layout-module';

interface TestLayout {
  rail?: () => void;
  head?: () => void;
}

const PARTS: Record<keyof TestLayout, true> = { rail: true, head: true };
const rail = () => undefined;

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

describe('readLayoutParts', () => {
  it.each([
    {
      row: 'no object default',
      module: { default: 3 },
      error: 'layout mine: the default export is missing or not an object',
    },
    {
      row: 'a key that is no part',
      module: { default: { rail, tail: rail } },
      error: 'layout mine: tail is not a layout part',
    },
    {
      row: 'a part that is no function',
      module: { default: { rail, head: 'big' } },
      error: 'layout mine: head is not a function',
    },
    {
      row: 'an undefined part, left out',
      module: { default: { rail, head: undefined } },
      error: null,
    },
    { row: 'no parts', module: { default: {} }, error: null },
  ])('readLayoutParts: $row', ({ module, error }) => {
    const read = () => readLayoutParts<TestLayout>(module, 'mine', PARTS);

    if (error === null) {
      expect(read()).toBe(module.default);
    } else {
      expect(read).toThrow(error);
    }
  });

  it('requireLayoutParts_NestedObject_NamesTheKeyWithItsPrefix', () => {
    expect(() =>
      requireLayoutParts({ tail: rail }, 'mine', PARTS, 'entries.'),
    ).toThrow('layout mine: entries.tail is not a layout part');
  });
});
