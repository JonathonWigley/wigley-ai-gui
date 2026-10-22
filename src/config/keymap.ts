import type { CommandId } from '../contracts/commands';
import type { CommandDecl, ScopeInfo } from '../contracts/plugin';

// The core's own commands and scopes; its default keys sit with every
// plugin's in `src/plugins/keymap.ts`.
export const coreCommands: Record<CommandId, CommandDecl> = {
  'window.summon': { label: 'show the app', group: 'window', runsIn: 'main' },
};

export const coreScopes: ScopeInfo[] = [
  { id: 'any', title: 'Everywhere', plugin: 'core' },
];
