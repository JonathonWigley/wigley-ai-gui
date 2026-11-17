import { describe, expect, it } from 'vitest';
import { readSettingsLayout } from './read-layout';

const settingRow = () => ({}) as HTMLElement;

describe('readSettingsLayout', () => {
  // `throws` null: the read returns a layout whose settingRow is the module's.
  it.each([
    { case: 'no default export', module: {}, throws: 'default export' },
    {
      case: 'a key that is no layout part',
      module: { default: { cards: {} } },
      throws: 'cards is not a layout part',
    },
    {
      case: 'a part that is not a function',
      module: { default: { keyRow: 'x' } },
      throws: 'keyRow is not a function',
    },
    {
      case: 'a pluginRow that is not a function',
      module: { default: { pluginRow: 'x' } },
      throws: 'pluginRow is not a function',
    },
    {
      case: 'a cursorPrompt that is not a function',
      module: { default: { cursorPrompt: 'x' } },
      throws: 'cursorPrompt is not a function',
    },
    {
      case: 'a boxMessage that is not a function',
      module: { default: { boxMessage: 'x' } },
      throws: 'boxMessage is not a function',
    },
    {
      case: 'a settingRow function',
      module: { default: { settingRow } },
      throws: null,
    },
  ])('reads $case', ({ module, throws }) => {
    const read = () => readSettingsLayout(module, 'mine');

    if (throws === null) {
      expect(read().settingRow).toBe(settingRow);
    } else {
      expect(read).toThrow(throws);
    }
  });
});
