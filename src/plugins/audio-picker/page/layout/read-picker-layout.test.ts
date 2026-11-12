import { describe, expect, it } from 'vitest';
import defaultLayout from '../../layouts/default/layout.js';
import { readPickerLayout } from './read-picker-layout';

const part = () => ({ element: {} as HTMLElement });

describe('readPickerLayout', () => {
  it.each([
    { case: 'no default export', module: {}, key: 'default export' },
    {
      case: 'a default that is no object',
      module: { default: 3 },
      key: 'default export',
    },
    {
      case: 'a key that is no part',
      module: { default: { row: part } },
      key: 'row',
    },
    {
      case: 'a part that is no function',
      module: { default: { candidate: 1 } },
      key: 'candidate',
    },
  ])(
    'readPickerLayout_InvalidShape_ThrowsNamingTheKey ($case)',
    ({ module, key }) => {
      expect(() => readPickerLayout(module, 'mine')).toThrow(
        new RegExp(`^layout mine: .*${key}`),
      );
    },
  );

  it('readPickerLayout_PartialLayout_ReturnsIt', () => {
    const layout = { none: part };

    expect(readPickerLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readPickerLayout_DefaultLayout_Reads', () => {
    expect(readPickerLayout({ default: defaultLayout }, 'default')).toBe(
      defaultLayout,
    );
  });
});
