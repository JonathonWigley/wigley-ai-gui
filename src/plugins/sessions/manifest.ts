import { definePlugin } from '../../shared/define-plugin';

// Agent sessions: the relay each one connects through, and Sessions mode, its
// sidebar of session rows beside the selected session's tabs. Its keys act in
// every scope; `idle` is the base scope while Sessions mode shows no tab.
export const sessionsManifest = definePlugin({
  id: 'sessions',
  dependsOn: ['keys'],
  commands: {
    showMode: {
      label: 'Sessions mode · toggle the sidebar',
      group: 'sessions',
      runsIn: 'page',
    },
    nextSession: { label: 'next session', group: 'sessions', runsIn: 'page' },
    prevSession: {
      label: 'previous session',
      group: 'sessions',
      runsIn: 'page',
    },
    nextTab: { label: 'next tab', group: 'tabs', runsIn: 'page' },
    prevTab: { label: 'previous tab', group: 'tabs', runsIn: 'page' },
    closeSession: {
      label: 'close the session',
      group: 'sessions',
      runsIn: 'page',
    },
  },
  scopes: { idle: 'Sessions' },
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
