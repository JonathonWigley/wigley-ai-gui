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
  settings: {
    whichKeyDelayMs: 200,
    whichKeyTimeoutMs: null as number | null,
  },
  optionalSettings: { whichKeyTimeoutMs: 'number' },
  settingInfo: {
    whichKeyDelayMs: {
      label: 'Which-key delay',
      description:
        'How long a pending key sequence waits before the which-key panel opens, in milliseconds.',
    },
    whichKeyTimeoutMs: {
      label: 'Which-key timeout',
      description:
        'How long the which-key panel waits before ending the sequence, in milliseconds; empty waits for a key.',
    },
  },
  themeTokens: {
    'which-key-command': { kind: 'color', default: 'var(--wg-fg)' },
    'which-key-prefix': { kind: 'color', default: 'var(--wg-fg-secondary)' },
  },
});
