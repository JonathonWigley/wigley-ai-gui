import { describe, expect, it } from 'vitest';
import defaultLayout from '../../layouts/default/layout.js';
import { readSessionStashLayout } from './read-session-stash-layout';

const noteDialog = () => ({ element: {} as HTMLElement });

describe('readSessionStashLayout', () => {
  it.each([
    { case: 'no default export', module: {}, key: 'default export' },
    {
      case: 'a default that is no object',
      module: { default: 3 },
      key: 'default export',
    },
    {
      case: 'a key that is no part',
      module: { default: { renameDialog: noteDialog } },
      key: 'renameDialog',
    },
    {
      case: 'a part that is no function',
      module: { default: { noteDialog: 1 } },
      key: 'noteDialog',
    },
  ])(
    'readSessionStashLayout_BadShape_ThrowsNamingIt ($case)',
    ({ module, key }) => {
      expect(() => readSessionStashLayout(module, 'mine')).toThrow(
        new RegExp(`^layout mine: .*${key}`),
      );
    },
  );

  it('readSessionStashLayout_PartialLayout_ReturnsTheDefinedParts', () => {
    const layout = {};

    expect(readSessionStashLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readSessionStashLayout_DefaultLayout_Reads', () => {
    expect(readSessionStashLayout({ default: defaultLayout }, 'default')).toBe(
      defaultLayout,
    );
  });
});
