import type { CommandId } from '../contracts/commands';
import type { Keymap } from '../contracts/keymap';
import type { CommandDecl, ScopeInfo } from '../contracts/plugin';

// The core's own keys; each plugin's binds come from its manifest and merge
// in after these.
export const coreKeymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [],
    binds: [],
  },
  page: [],
  app: [],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }],
};

export const coreCommands: Record<CommandId, CommandDecl> = {
  'window.summon': { label: 'show the app', group: 'window', runsIn: 'main' },
};

export const coreScopes: ScopeInfo[] = [
  { id: 'any', title: 'Everywhere', plugin: 'core' },
];
