import type { AcceleratorBind, Keymap } from '../contracts/keymap';

// Chords a browser tab never hands to the page; the app menu claims them.
const claimedChords: AcceleratorBind[] = ['W', 'T', 'N', 'L', '1'].map(
  (key) => ({
    accelerator: `CommandOrControl+${key}`,
    command: 'proof.logClaim',
  }),
);

export const defaultKeymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    binds: [
      { keys: '<Leader><Leader>', command: 'agent.submit' },
      { keys: '<Leader>j', command: 'box.next' },
      { keys: '<Leader>k', command: 'box.prev' },
      { keys: '<Leader>q', command: 'box.leave' },
    ],
  },
  page: [{ key: 'i', command: 'box.focusFirst' }],
  app: claimedChords,
  intercept: [{ key: 'Tab', control: true, command: 'proof.logIntercept' }],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }],
};
