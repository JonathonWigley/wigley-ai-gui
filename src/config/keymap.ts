import type { Keymap } from '../contracts/keymap';

export const defaultKeymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    binds: [
      { keys: '<Leader>j', command: 'box.next' },
      { keys: '<Leader>k', command: 'box.prev' },
      { keys: '<Leader>q', command: 'box.leave' },
    ],
  },
  page: [{ keys: ['i'], scope: 'forms', command: 'box.focusFirst' }],
  app: [],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }],
};
