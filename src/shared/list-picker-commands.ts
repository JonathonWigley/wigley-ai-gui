import type { CommandDecl } from '../contracts/plugin';

// The commands every list picker takes, spread into each picker plugin's
// manifest; `listPickerCommands` (`src/shared/page/list-picker.ts`) handles
// them and `listPickerBinds` (`src/plugins/keymap.ts`) binds them.
export const LIST_PICKER_COMMANDS = {
  pickerDown: { label: 'next choice', group: 'picker', runsIn: 'page' },
  pickerUp: { label: 'previous choice', group: 'picker', runsIn: 'page' },
  pickerTop: { label: 'first choice', group: 'picker', runsIn: 'page' },
  pickerBottom: { label: 'last choice', group: 'picker', runsIn: 'page' },
  pickerChoose: { label: 'choose', group: 'picker', runsIn: 'page' },
  pickerCancel: { label: 'close', group: 'picker', runsIn: 'page' },
  pickerFilter: { label: 'filter', group: 'picker', runsIn: 'page' },
  pickerList: { label: 'back to the list', group: 'picker', runsIn: 'page' },
} as const satisfies Record<string, CommandDecl>;

export type ListPickerCommand = keyof typeof LIST_PICKER_COMMANDS;
