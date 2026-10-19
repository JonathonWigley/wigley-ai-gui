import { definePlugin } from '../../shared/define-plugin';

// Key hints over the merged keymap: which-key while a sequence is pending.
// Page-only, and names no other plugin. `whichKeyDelayMs` is how long a
// pending sequence waits before the panel opens; `whichKeyTimeoutMs`, when
// set, ends a sequence the panel has shown that long, and `null` lets it wait
// for the next key or Esc.
export const keysManifest = definePlugin({
  id: 'keys',
  dependsOn: [],
  commands: {},
  scopes: {},
  keys: {
    page: [],
    editor: [],
    app: [],
    global: [],
    intercept: [],
  },
  settings: {
    whichKeyDelayMs: 200,
    whichKeyTimeoutMs: null as number | null,
  },
});
