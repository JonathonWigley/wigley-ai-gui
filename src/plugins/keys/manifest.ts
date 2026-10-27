import { definePlugin } from '../../shared/define-plugin';

// Key hints over the merged keymap: which-key while a sequence is pending,
// the help overlay listing every key, the title bar's Keys button, and the
// prompts drawn into the anchors views name, each surface drawn through the
// `layout` setting's keys layout. Its main part only registers that layout
// contract, and it names no other plugin.
// `whichKeyDelayMs` is how long a pending sequence waits before the panel
// opens; `whichKeyTimeoutMs`, when set, ends a sequence the panel has shown
// that long, and `null` lets it wait for the next key or Esc. `showHints`
// off hides every anchored hint.
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
    showHints: true,
    layout: 'default',
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
    showHints: {
      label: 'Key hints',
      description:
        'Show each key beside the control or row it acts on. Which-key and the Keys dialog list every key either way.',
    },
    layout: {
      label: 'Keys layout',
      description:
        'The layout that draws help, which-key and the Keys button: a folder in the layouts/keys folder, or default.',
    },
  },
  themeTokens: {
    'which-key-command': { kind: 'color', default: 'var(--wg-fg)' },
    'which-key-prefix': { kind: 'color', default: 'var(--wg-fg-secondary)' },
  },
});
