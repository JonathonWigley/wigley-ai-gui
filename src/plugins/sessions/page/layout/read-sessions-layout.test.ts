import { describe, expect, it } from 'vitest';
import defaultLayout from '../../layouts/default/layout.js';
import { readSessionsLayout } from './read-sessions-layout';

const row = () => ({ element: {} as HTMLElement });

describe('readSessionsLayout', () => {
  it.each([
    { case: 'no default export', module: {}, key: 'default export' },
    {
      case: 'a default that is no object',
      module: { default: 3 },
      key: 'default export',
    },
    {
      case: 'a key that is no part',
      module: { default: { rows: row } },
      key: 'rows',
    },
    {
      case: 'a part that is no function',
      module: { default: { row: 1 } },
      key: 'row',
    },
    {
      case: 'a pane that is no function',
      module: { default: { pane: 1 } },
      key: 'pane',
    },
  ])(
    'readSessionsLayout_BadShape_ThrowsNamingIt ($case)',
    ({ module, key }) => {
      expect(() => readSessionsLayout(module, 'mine')).toThrow(
        new RegExp(`^layout mine: .*${key}`),
      );
    },
  );

  it('readSessionsLayout_PartialLayout_ReturnsTheDefinedParts', () => {
    const layout = { row };

    expect(readSessionsLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readSessionsLayout_DefaultLayout_Reads', () => {
    expect(readSessionsLayout({ default: defaultLayout }, 'default')).toBe(
      defaultLayout,
    );
  });
});
