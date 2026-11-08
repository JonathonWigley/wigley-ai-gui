import {
  type CommandId,
  PICKER_CANCEL,
  PICKER_CHOOSE_ROW,
} from '../contracts/commands';
import { PANE_FOCUS_COMMANDS, PANE_RESIZE_COMMANDS } from '../contracts/panes';
import type { CommandDecl, ScopeInfo } from '../contracts/plugin';

// The core's own commands and scopes; its default keys sit with every
// plugin's in `src/plugins/keymap.ts`.
export const coreCommands: Record<CommandId, CommandDecl> = {
  [PANE_RESIZE_COMMANDS.left]: {
    label: 'move the pane divider left',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_RESIZE_COMMANDS.right]: {
    label: 'move the pane divider right',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_RESIZE_COMMANDS.up]: {
    label: 'move the pane divider up',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_RESIZE_COMMANDS.down]: {
    label: 'move the pane divider down',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_FOCUS_COMMANDS.left]: {
    label: 'focus the pane on the left',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_FOCUS_COMMANDS.right]: {
    label: 'focus the pane on the right',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_FOCUS_COMMANDS.up]: {
    label: 'focus the pane above',
    group: 'panes',
    runsIn: 'page',
  },
  [PANE_FOCUS_COMMANDS.down]: {
    label: 'focus the pane below',
    group: 'panes',
    runsIn: 'page',
  },
  [PICKER_CHOOSE_ROW.id]: {
    label: 'choose the row',
    group: 'picker',
    runsIn: 'page',
    arg: { owner: 'string', index: 'number' },
  },
  [PICKER_CANCEL.id]: {
    label: 'cancel the list',
    group: 'picker',
    runsIn: 'page',
    arg: 'string',
  },
};

export const coreScopes: ScopeInfo[] = [
  { id: 'any', title: 'Everywhere', plugin: 'core' },
];
