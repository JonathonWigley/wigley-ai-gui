import { definePlugin } from '../../shared/define-plugin';

// Agent sessions: the relay each one connects through, and a tab each. Its
// keys act in every scope.
export const sessionsManifest = definePlugin({
  id: 'sessions',
  dependsOn: [],
  commands: {
    nextTab: { label: 'next tab', group: 'tabs', runsIn: 'page' },
    prevTab: { label: 'previous tab', group: 'tabs', runsIn: 'page' },
    closeTab: { label: 'close the tab', group: 'tabs', runsIn: 'page' },
  },
  scopes: {},
  keys: {
    page: [
      { keys: ['<A-o>'], scope: 'any', command: 'nextTab' },
      { keys: ['<A-i>'], scope: 'any', command: 'prevTab' },
      { keys: ['<D-w>'], scope: 'any', command: 'closeTab' },
      { keys: [' ', ';'], scope: 'any', command: 'closeTab' },
    ],
    editor: [{ keys: '<Leader>;', scope: 'any', command: 'closeTab' }],
    app: [],
    global: [],
    intercept: [],
  },
  settings: {},
});
