import { describe, expect, it } from 'vitest';
import { readShellLayout } from './read-shell-layout';

const devTag = () => ({}) as HTMLElement;

describe('readShellLayout', () => {
  // `throws` null: the read returns a layout whose devTag is the module's.
  it.each([
    { case: 'no default export', module: {}, throws: 'default export' },
    {
      case: 'an unknown key',
      module: { default: { sideBar: devTag } },
      throws: 'sideBar is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { activityItem: {} } },
      throws: 'activityItem is not a function',
    },
    { case: 'only devTag', module: { default: { devTag } }, throws: null },
    {
      case: 'the activity bar divider and pin',
      module: {
        default: { devTag, activityDivider: devTag, activityPin: devTag },
      },
      throws: null,
    },
  ])(
    'readShellLayout_Shapes_AcceptsOrNamesTheFirstBadKey: $case',
    ({ module, throws }) => {
      const read = () => readShellLayout(module, 'mine');

      if (throws === null) {
        expect(read().devTag).toBe(devTag);
      } else {
        expect(read).toThrow(throws);
      }
    },
  );
});
