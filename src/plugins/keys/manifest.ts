import { definePlugin } from '../../shared/define-plugin';

// Key hints over the merged keymap: which-key while a sequence is pending,
// the help overlay listing every key, and the status bar's key list. Page-only,
// and names no other plugin. `whichKeyDelayMs` is how long a
// pending sequence waits before the panel opens; `whichKeyTimeoutMs`, when
// set, ends a sequence the panel has shown that long, and `null` lets it wait
// for the next key or Esc.
export const keysManifest = definePlugin({
  id: 'keys',
  dependsOn: [],
  commands: {
    toggleHelp: { label: 'help', group: 'help', runsIn: 'page' },
    closeHelp: { label: 'close help', group: 'help', runsIn: 'page' },
  },
  scopes: { help: 'In help' },
  keys: {
    page: [
      { keys: [' ', '?'], scope: 'any', command: 'toggleHelp' },
      { keys: ['Escape'], scope: 'help', command: 'closeHelp' },
    ],
    editor: [{ keys: '<Leader>?', scope: 'any', command: 'toggleHelp' }],
    app: [],
    global: [],
    intercept: [],
  },
  settings: {
    whichKeyDelayMs: 200,
    whichKeyTimeoutMs: null as number | null,
  },
  themeTokens: {
    'which-key-command': { kind: 'color', default: 'var(--wg-status-success)' },
    'which-key-prefix': { kind: 'color', default: 'var(--wg-accent)' },
  },
});
